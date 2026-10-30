import { expect, test } from '@playwright/test';
import { headerBalance, signIn, uniqueSubject } from './support.ts';

test('signs in with the Google provider and gets the season grant', async ({ page }) => {
  await signIn(page, { provider: 'google', name: 'Gina Google' });
  await expect.poll(() => headerBalance(page)).toBe(10000);
  await expect(page.getByTestId('nav-admin')).toHaveCount(0);
});

test('signs in with the GitHub provider', async ({ page }) => {
  await signIn(page, { provider: 'github', name: 'Gil Hub' });
  await page.getByTestId('user-menu').click();
  await page.goto('/me');
  await expect(page.getByText(/github/i).first()).toBeVisible();
});

test('claims the daily reward once per day', async ({ page }) => {
  await signIn(page);
  await expect.poll(() => headerBalance(page)).toBe(10000);
  await page.getByTestId('daily-reward-claim').click();
  await expect.poll(() => headerBalance(page)).toBe(10050);
  await page.goto('/wallet');
  await expect(page.getByTestId('wallet-balance')).toContainText(/10[,.\s]?050/);
  await expect(page.locator('[data-testid="ledger-row"][data-type="DAILY_GRANT"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="ledger-row"][data-type="SEASON_GRANT"]')).toHaveCount(1);
  await expect(page.getByTestId('daily-reward-claim')).toBeDisabled();
});

test('keeps the session across reloads and signs out', async ({ page }) => {
  const { name } = await signIn(page, { subject: uniqueSubject('reload') });
  await page.reload();
  await expect(page.getByTestId('user-menu')).toContainText(name);
  await page.getByTestId('user-menu').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-google')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('login-google')).toBeVisible();
});

test('renames the profile', async ({ page }) => {
  await signIn(page);
  await page.goto('/me');
  await page.getByTestId('display-name-input').fill('Speedy Sam');
  await page.getByTestId('save-profile').click();
  await expect(page.getByTestId('user-menu')).toContainText('Speedy Sam');
});
