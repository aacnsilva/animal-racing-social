import { one, type Client } from '../../lib/db.ts';
import { ApiError } from '../../lib/http.ts';
import { newId, shardOf } from '../../lib/ids.ts';
import { payload, Topics } from '../../lib/kafka.ts';
import { enqueue } from '../../lib/outbox.ts';

export type LedgerType = 'SEASON_GRANT' | 'DAILY_GRANT' | 'BET_STAKE' | 'BET_PAYOUT' | 'BET_REFUND' | 'BET_LOST' | 'CASHOUT' | 'ADMIN_ADJUST';
export type WalletState = { balance: number; openStake: number };

async function lockWallet(client: Client, userId: string, seasonId: string): Promise<WalletState | null> {
  const row = await one(client, 'SELECT balance, open_stake FROM wallet.wallets WHERE user_id = $1 AND season_id = $2 FOR UPDATE', [userId, seasonId]);
  return row ? { balance: Number(row.balance), openStake: Number(row.open_stake) } : null;
}

async function appendEntry(client: Client, userId: string, seasonId: string, type: LedgerType, amount: number, refId: string, after: WalletState): Promise<boolean> {
  const entryId = newId(shardOf(userId));
  const inserted = await client.query(
    `INSERT INTO wallet.ledger_entries (user_id, entry_id, season_id, type, amount, ref_id, balance_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (user_id, type, ref_id) DO NOTHING`,
    [userId, entryId, seasonId, type, amount, refId, after.balance],
  );
  if (inserted.rowCount === 0) return false;
  await enqueue(client, 'wallet', Topics.walletEvents, userId, payload('ledgerEntryAppended', {
    entryId, userId, seasonId, type, amount: String(amount), refId, balanceAfter: String(after.balance), openStakeAfter: String(after.openStake),
  }));
  return true;
}

export async function ensureWallet(client: Client, userId: string, seasonId: string): Promise<WalletState> {
  const existing = await lockWallet(client, userId, seasonId);
  if (existing) return existing;
  const season = await one(client, 'SELECT starting_grant FROM season.seasons WHERE season_id = $1', [seasonId]);
  if (!season) throw new ApiError(404, 'NOT_FOUND', 'Unknown season');
  const grant = Number(season.starting_grant);
  const inserted = await client.query(
    'INSERT INTO wallet.wallets (user_id, season_id, balance) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, seasonId, grant],
  );
  const state = await lockWallet(client, userId, seasonId);
  if (!state) throw new Error('wallet vanished');
  if (inserted.rowCount === 1) await appendEntry(client, userId, seasonId, 'SEASON_GRANT', grant, seasonId, state);
  return state;
}

export async function applyChange(
  client: Client,
  change: { userId: string; seasonId: string; type: LedgerType; refId: string; balanceDelta: number; openStakeDelta: number },
): Promise<{ applied: boolean; state: WalletState }> {
  const current = await ensureWallet(client, change.userId, change.seasonId);
  const duplicate = await one(client, 'SELECT 1 FROM wallet.ledger_entries WHERE user_id = $1 AND type = $2 AND ref_id = $3', [change.userId, change.type, change.refId]);
  if (duplicate) return { applied: false, state: current };
  const next = { balance: current.balance + change.balanceDelta, openStake: current.openStake + change.openStakeDelta };
  if (next.balance < 0) throw new ApiError(409, 'INSUFFICIENT_FUNDS', 'Not enough points');
  if (next.openStake < 0) throw new Error(`open stake would go negative for ${change.userId}`);
  await client.query(
    'UPDATE wallet.wallets SET balance = $3, open_stake = $4, updated_at = now() WHERE user_id = $1 AND season_id = $2',
    [change.userId, change.seasonId, next.balance, next.openStake],
  );
  await appendEntry(client, change.userId, change.seasonId, change.type, change.balanceDelta, change.refId, next);
  return { applied: true, state: next };
}
