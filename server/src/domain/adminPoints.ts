export const ADMIN_POINT_KINDS = ['BONUS', 'PENALTY'] as const;
export type AdminPointKind = (typeof ADMIN_POINT_KINDS)[number];

export function adminPointsLedgerType(kind: AdminPointKind): 'ADMIN_BONUS' | 'ADMIN_PENALTY' {
  return kind === 'BONUS' ? 'ADMIN_BONUS' : 'ADMIN_PENALTY';
}

export function adminPointsDelta(kind: AdminPointKind, amount: number, balance: number): number {
  if (kind === 'BONUS') return amount;
  return 0 - Math.min(amount, Math.max(balance, 0));
}

export function adminPointsNotification(ledgerType: string): 'POINTS_BONUS' | 'POINTS_PENALTY' | null {
  if (ledgerType === 'ADMIN_BONUS') return 'POINTS_BONUS';
  if (ledgerType === 'ADMIN_PENALTY') return 'POINTS_PENALTY';
  return null;
}
