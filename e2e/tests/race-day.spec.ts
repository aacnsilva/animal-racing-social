import { expect, test } from '@playwright/test';
import { headerBalance, market, placeSingle, scheduleRace, signIn } from './support.ts';

test('a race day: bet, watch the live race in 3D, settle and verify fairness', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const raceId = await scheduleRace({ species: 'HORSE', raceClass: 'SPRINT', startInSeconds: 120 });
  await signIn(page, { from: `/races/${raceId}` });
  await expect(page.getByTestId('race-status')).toHaveText(/OPEN/);

  await placeSingle(page, market(page, 'FINISH_POSITION', { position: 1 }), 100, 0);
  await expect(page.locator('[data-testid="my-bet"][data-bet-status="ACCEPTED"]')).toHaveCount(1);
  await placeSingle(page, market(page, 'TOP_N', { n: 3 }), 100, 1);
  await expect(page.locator('[data-testid="my-bet"][data-bet-status="ACCEPTED"]')).toHaveCount(2);
  await expect.poll(() => headerBalance(page)).toBe(9800);

  await expect(page.getByTestId('race-status')).toHaveText(/LOCKED/, { timeout: 90_000 });
  await expect(page.getByTestId('race-status')).toHaveText(/LIVE/, { timeout: 90_000 });
  await expect(page.getByTestId('race-viewer')).toBeVisible();
  await expect(page.getByTestId('race-viewer').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('standing-row')).toHaveCount(6);
  const firstLeader = await page.getByTestId('standing-row').first().textContent();
  expect(firstLeader).toBeTruthy();

  await expect(page.getByTestId('race-status')).toHaveText(/FINISHED|SETTLED/, { timeout: 5 * 60_000 });
  await expect(page.getByTestId('result-row')).toHaveCount(6, { timeout: 30_000 });
  await expect(page.locator('[data-testid="my-bet"][data-bet-status="ACCEPTED"]')).toHaveCount(0, { timeout: 60_000 });
  const statuses = await page.getByTestId('my-bet').evaluateAll((bets) => bets.map((bet) => bet.getAttribute('data-bet-status')));
  expect(statuses).toHaveLength(2);
  for (const status of statuses) expect(['WON', 'LOST']).toContain(status);

  await page.getByTestId('verify-commitment').click();
  await expect(page.getByTestId('verify-status')).toContainText(/verified|match/i);

  await page.goto('/wallet');
  await expect(page.locator('[data-testid="ledger-row"][data-type="BET_STAKE"]')).toHaveCount(2);
  await expect(page.locator('[data-testid="ledger-row"][data-type="BET_PAYOUT"], [data-testid="ledger-row"][data-type="BET_LOST"]')).toHaveCount(2);

  await page.getByTestId('nav-notifications').click();
  await expect(page.getByTestId('notification-item').filter({ hasText: /won|lost/i }).first()).toBeVisible({ timeout: 30_000 });
});
