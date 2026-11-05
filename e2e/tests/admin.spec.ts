import { expect, test } from '@playwright/test';
import {
  ADMIN_SUBJECT,
  adminSession,
  apiSession,
  call,
  headerBalance,
  market,
  placeSingle,
  signIn,
  uniqueSubject,
  waitForRace,
} from './support.ts';

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
  await expect.poll(() => headerBalance(page)).toBe(700);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, { subject: ADMIN_SUBJECT, name: 'Admin', from: '/' });
  await adminPage.goto('/admin');
  await adminPage.getByTestId('admin-cancel-race-id').fill(raceId);
  await adminPage.getByTestId('admin-cancel-submit').click();
  await adminContext.close();

  await expect(page.getByTestId('race-status')).toHaveText(/CANCELLED/, { timeout: 30_000 });
  await expect(page.getByTestId('my-bet').first()).toHaveAttribute('data-bet-status', 'VOID', { timeout: 30_000 });
  await expect.poll(() => headerBalance(page), { timeout: 30_000 }).toBe(1000);
  await page.goto('/wallet');
  await expect(page.locator('[data-testid="ledger-row"][data-type="BET_REFUND"]')).toHaveCount(1);
});

test('admin API rejects regular users', async () => {
  const user = await apiSession(uniqueSubject('plain'));
  const result = await call(user.api, user.token, 'GET', '/v1/admin/programme');
  expect(result.status).toBe(403);
  await user.api.dispose();
});

test('admin grants a bonus and applies a cheating penalty the user can see', async ({ page }) => {
  const subject = uniqueSubject('cheater');
  const user = await apiSession(subject);
  const admin = await adminSession();

  const bonus = await call(admin.api, admin.token, 'POST', `/v1/admin/users/${user.userId}/points`, {
    kind: 'BONUS',
    amount: 250,
    reason: 'Community race host',
  });
  expect(bonus.status).toBe(200);
  expect(bonus.body).toMatchObject({ kind: 'BONUS', requested: 250, applied: 250, balance: 10250 });

  const invalid = await call(admin.api, admin.token, 'POST', `/v1/admin/users/${user.userId}/points`, {
    kind: 'PENALTY',
    amount: -5,
    reason: 'nope',
  });
  expect(invalid.status).toBe(422);

  const forbidden = await call(user.api, user.token, 'POST', `/v1/admin/users/${user.userId}/points`, {
    kind: 'BONUS',
    amount: 1000,
    reason: 'self-service',
  });
  expect(forbidden.status).toBe(403);

  await signIn(page, { subject: ADMIN_SUBJECT, name: 'Admin' });
  await page.goto('/admin?tab=users');
  await page.getByTestId('admin-user-search').fill(user.userId);
  await page.getByTestId('admin-user-search').press('Enter');
  await page.getByTestId('admin-user-row').filter({ hasText: user.userId }).click();
  await page.getByTestId('admin-points-kind').selectOption('PENALTY');
  await page.getByTestId('admin-points-amount').fill('20000');
  await page.getByTestId('admin-points-reason').fill('Multi-accounting');
  await page.getByTestId('admin-points-submit').click();
  await expect(page.getByTestId('admin-user-result')).toContainText('Penalty of 10,250 pts applied');

  const wallet = await call(user.api, user.token, 'GET', '/v1/me/wallet');
  expect(wallet.body.balance).toBe(0);
  const ledger = await call(user.api, user.token, 'GET', '/v1/me/wallet/ledger');
  expect(ledger.body.items[0]).toMatchObject({ type: 'ADMIN_PENALTY', amount: -10250, note: 'Multi-accounting' });
  expect(ledger.body.items[1]).toMatchObject({ type: 'ADMIN_BONUS', amount: 250, note: 'Community race host' });

  const lifesaver = await call(user.api, user.token, 'GET', '/v1/me/rewards/lifesaver');
  expect(lifesaver.body).toMatchObject({ state: 'PENALIZED', claimable: false });
  const claim = await call(user.api, user.token, 'POST', '/v1/me/rewards/lifesaver');
  expect(claim.status).toBe(409);

  await expect
    .poll(async () => {
      const result = await call(user.api, user.token, 'GET', '/v1/me/notifications');
      return JSON.stringify(result.body.items);
    })
    .toMatch(/POINTS_PENALTY[\s\S]*Multi-accounting/);
  const notifications = await call(user.api, user.token, 'GET', '/v1/me/notifications');
  expect(JSON.stringify(notifications.body.items)).toContain('POINTS_BONUS');

  await user.api.dispose();
  await admin.api.dispose();
});
