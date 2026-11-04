import { one, type Client } from '../../lib/db.ts';
import { ApiError } from '../../lib/http.ts';
import { activeSeason, type SeasonRow } from '../../lib/seasons.ts';
import { iso } from '../../lib/time.ts';
import {
  DEFAULT_LIFESAVER_GRANT,
  lifesaverRef,
  lifesaverRejection,
  lifesaverState,
  type LifesaverStatus,
} from '../../domain/lifesaver.ts';
import { applyChange, ensureWallet, type WalletState } from './ledger.ts';

type Usage = { count: number; lastAt: Date | null; emptiedByPenalty: boolean };

async function current(
  client: Client,
  userId: string,
): Promise<{ season: SeasonRow | undefined; wallet: WalletState | null; usage: Usage }> {
  const season = await activeSeason(client);
  if (!season) return { season, wallet: null, usage: { count: 0, lastAt: null, emptiedByPenalty: false } };
  const wallet = await ensureWallet(client, userId, season.season_id);
  const used = await one(
    client,
    `SELECT count(*)::int AS count, max(created_at) AS last_at
       FROM wallet.ledger_entries WHERE user_id = $1 AND type = 'LIFESAVER' AND season_id = $2`,
    [userId, season.season_id],
  );
  const lastMove = await one(
    client,
    `SELECT type FROM wallet.ledger_entries WHERE user_id = $1 AND season_id = $2 AND amount <> 0
      ORDER BY created_at DESC, entry_id DESC LIMIT 1`,
    [userId, season.season_id],
  );
  return {
    season,
    wallet,
    usage: {
      count: Number(used?.count ?? 0),
      lastAt: used?.last_at ?? null,
      emptiedByPenalty: lastMove?.type === 'ADMIN_PENALTY',
    },
  };
}

function statusOf(season: SeasonRow | undefined, wallet: WalletState | null, usage: Usage): LifesaverStatus {
  const state = lifesaverState({
    hasSeason: Boolean(season),
    balance: wallet?.balance ?? 0,
    openStake: wallet?.openStake ?? 0,
    emptiedByPenalty: usage.emptiedByPenalty,
  });
  return {
    state,
    claimable: state === 'READY',
    amount: Number(season?.lifesaver_grant ?? DEFAULT_LIFESAVER_GRANT),
    usedCount: usage.count,
    seasonId: season?.season_id ?? null,
    usedAt: iso(usage.lastAt),
  };
}

export async function lifesaverStatus(client: Client, userId: string): Promise<LifesaverStatus> {
  const { season, wallet, usage } = await current(client, userId);
  return statusOf(season, wallet, usage);
}

export async function lifesaverClaim(
  client: Client,
  userId: string,
): Promise<{ amount: number; balance: number; balanceBefore: number }> {
  const { season, wallet, usage } = await current(client, userId);
  const status = statusOf(season, wallet, usage);
  const rejection = lifesaverRejection(status.state);
  if (rejection || !season || !wallet) {
    throw new ApiError(409, rejection?.code ?? 'CONFLICT', rejection?.message ?? 'No active season');
  }
  const result = await applyChange(client, {
    userId,
    seasonId: season.season_id,
    type: 'LIFESAVER',
    refId: lifesaverRef(season.season_id, usage.count),
    balanceDelta: status.amount,
    openStakeDelta: 0,
  });
  if (!result.applied) throw new ApiError(409, 'NOT_BUSTED', 'A lifesaver was just thrown to you');
  return { amount: status.amount, balance: result.state.balance, balanceBefore: wallet.balance };
}
