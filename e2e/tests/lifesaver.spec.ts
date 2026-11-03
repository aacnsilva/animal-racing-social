import { expect, test } from '@playwright/test';
import { adminSession, apiSession, call, headerBalance, signIn, uniqueSubject } from './support.ts';

async function bust(subject: string, amount: number) {
  const { userId } = await apiSession(subject);
  const admin = await adminSession();
  const adjusted = await call(admin.api, admin.token, 'POST', `/v1/admin/users/${userId}/adjust`, {
    amount: -amount,
    reason: 'e2e: lose every point',
  });
  expect(adjusted.status).toBe(200);
  expect(adjusted.body.balance).toBe(0);
}

test('rescues a busted racer with one free lifesaver per season', async ({ page }) => {
  const subject = uniqueSubject('sinker');
  await signIn(page, { subject });
  await expect.poll(() => headerBalance(page)).toBe(10000);
  await page.goto('/wallet');
  await expect(page.getByTestId('lifesaver-tile')).toHaveAttribute('data-state', 'AFLOAT');
  await expect(page.getByTestId('lifesaver-open')).toHaveCount(0);

  await bust(subject, 10000);
  await page.reload();

  const dialog = page.getByTestId('lifesaver-dialog');
  await expect(dialog).toHaveAttribute('data-phase', 'sinking');
  await page.getByTestId('lifesaver-throw').click();
  await expect(dialog).toHaveAttribute('data-phase', 'saved', { timeout: 15_000 });
  await expect(page.getByTestId('lifesaver-balance')).toHaveText('5000');
  await page.getByTestId('lifesaver-done').click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(() => headerBalance(page)).toBe(5000);
  await expect(page.locator('[data-testid="ledger-row"][data-type="LIFESAVER"]')).toHaveCount(1);
  await expect(page.getByTestId('lifesaver-tile')).toContainText('Used');

  await bust(subject, 5000);
  const { api, token } = await apiSession(subject);
  const status = await call(api, token, 'GET', '/v1/me/rewards/lifesaver');
  expect(status.body).toMatchObject({ state: 'USED', claimable: false, freeRemaining: 0 });
  const again = await call(api, token, 'POST', '/v1/me/rewards/lifesaver');
  expect(again.status).toBe(409);
  expect(again.body.code).toBe('LIFESAVER_USED');
});
