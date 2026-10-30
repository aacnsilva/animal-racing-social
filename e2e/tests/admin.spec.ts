import { expect, test } from '@playwright/test';
import { ADMIN_SUBJECT, apiSession, call, headerBalance, market, placeSingle, signIn, uniqueSubject, waitForRace } from './support.ts';

test('hides the admin area from regular users', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();
});

test('admin schedules a one-off race from the admin page', async ({ page }) => {
  await signIn(page, { subject: ADMIN_SUBJECT, name: 'Admin' });
  await page.getByTestId('nav-admin').click();
  await page.getByTestId('admin-race-species').selectOption('HORSE');
  await page.getByTestId('admin-race-class').selectOption('STANDARD');
  await page.getByTestId('admin-race-minutes').fill('40');
  await page.getByTestId('admin-schedule-submit').click();
  const raceId = (await page.getByTestId('admin-scheduled-race-id').textContent())!.replace(/\D/g, '');
  expect(raceId.length).toBeGreaterThan(10);
  const viewer = await apiSession(uniqueSubject('viewer'));
  await waitForRace(viewer.api, raceId, ['OPEN'], 60_000);
  await viewer.api.dispose();
});

test('cancelling a race voids bets and refunds the stake', async ({ page, browser }) => {
  const raceId = process.env.E2E_RACE_CANCEL!;
  await signIn(page, { from: `/races/${raceId}` });
  await placeSingle(page, market(page, 'FINISH_POSITION', { position: 1 }), 300);
  await expect(page.getByTestId('my-bet').first()).toHaveAttribute('data-bet-status', 'ACCEPTED');
  await expect.poll(() => headerBalance(page)).toBe(9700);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, { subject: ADMIN_SUBJECT, name: 'Admin', from: '/' });
  await adminPage.goto('/admin');
  await adminPage.getByTestId('admin-cancel-race-id').fill(raceId);
  await adminPage.getByTestId('admin-cancel-submit').click();
  await adminContext.close();

  await expect(page.getByTestId('race-status')).toHaveText(/CANCELLED/, { timeout: 30_000 });
  await expect(page.getByTestId('my-bet').first()).toHaveAttribute('data-bet-status', 'VOID', { timeout: 30_000 });
  await expect.poll(() => headerBalance(page), { timeout: 30_000 }).toBe(10000);
  await page.goto('/wallet');
  await expect(page.locator('[data-testid="ledger-row"][data-type="BET_REFUND"]')).toHaveCount(1);
});

test('admin API rejects regular users', async () => {
  const user = await apiSession(uniqueSubject('plain'));
  const result = await call(user.api, user.token, 'GET', '/v1/admin/programme');
  expect(result.status).toBe(403);
  await user.api.dispose();
});
