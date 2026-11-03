import { one, type Client } from '../../lib/db.ts';
import { ApiError } from '../../lib/http.ts';
import { activeSeason, type SeasonRow } from '../../lib/seasons.ts';
import { iso } from '../../lib/time.ts';
import {
  DEFAULT_LIFESAVER_GRANT,
  FREE_LIFESAVERS_PER_SEASON,
  freeLifesaverRef,
  lifesaverRejection,
  lifesaverState,
  type LifesaverStatus,
} from '../../domain/lifesaver.ts';
import { applyChange, ensureWallet, type WalletState } from './ledger.ts';

async function current(
  client: Client,
  userId: string,
): Promise<{ season: SeasonRow | undefined; wallet: WalletState | null; usedAt: Date | null }> {
  const season = await activeSeason(client);
  if (!season) return { season, wallet: null, usedAt: null };
  const wallet = await ensureWallet(client, userId, season.season_id);
  const used = await one(
    client,
    `SELECT created_at FROM wallet.ledger_entries WHERE user_id = $1 AND type = 'LIFESAVER' AND ref_id = $2`,
    [userId, freeLifesaverRef(season.season_id)],
  );
  return { season, wallet, usedAt: used ? used.created_at : null };
}

function statusOf(season: SeasonRow | undefined, wallet: WalletState | null, usedAt: Date | null): LifesaverStatus {
  const freeUsed = usedAt ? 1 : 0;
  const state = lifesaverState({
    hasSeason: Boolean(season),
    balance: wallet?.balance ?? 0,
    openStake: wallet?.openStake ?? 0,
    freeUsed,
  });
  return {
    state,
    claimable: state === 'READY',
    amount: Number(season?.lifesaver_grant ?? DEFAULT_LIFESAVER_GRANT),
    freePerSeason: FREE_LIFESAVERS_PER_SEASON,
    freeRemaining: Math.max(0, FREE_LIFESAVERS_PER_SEASON - freeUsed),
    seasonId: season?.season_id ?? null,
    usedAt: iso(usedAt),
  };
}

export async function lifesaverStatus(client: Client, userId: string): Promise<LifesaverStatus> {
  const { season, wallet, usedAt } = await current(client, userId);
  return statusOf(season, wallet, usedAt);
}

export async function lifesaverClaim(
  client: Client,
  userId: string,
): Promise<{ amount: number; balance: number; balanceBefore: number }> {
  const { season, wallet, usedAt } = await current(client, userId);
  const status = statusOf(season, wallet, usedAt);
  const rejection = lifesaverRejection(status.state);
  if (rejection || !season || !wallet) {
    throw new ApiError(409, rejection?.code ?? 'CONFLICT', rejection?.message ?? 'No active season');
  }
  const result = await applyChange(client, {
    userId,
    seasonId: season.season_id,
    type: 'LIFESAVER',
    refId: freeLifesaverRef(season.season_id),
    balanceDelta: status.amount,
    openStakeDelta: 0,
  });
  if (!result.applied) throw new ApiError(409, 'LIFESAVER_USED', 'Your free lifesaver for this season is already used');
  return { amount: status.amount, balance: result.state.balance, balanceBefore: wallet.balance };
}
