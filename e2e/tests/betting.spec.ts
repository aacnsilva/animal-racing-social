import { expect, test } from '@playwright/test';
import { headerBalance, market, placeSingle, signIn } from './support.ts';

const horseRace = () => process.env.E2E_RACE_HORSE!;
const giraffeRace = () => process.env.E2E_RACE_GIRAFFE!;

test('places a pre-race win bet and sees it accepted and debited', async ({ page }) => {
  await signIn(page, { from: `/races/${horseRace()}` });
  await expect(page.getByTestId('race-status')).toHaveText(/OPEN/);
  await placeSingle(page, market(page, 'FINISH_POSITION', { position: 1 }), 100);
  await expect(page.getByTestId('my-bet').first()).toHaveAttribute('data-bet-status', 'ACCEPTED');
  await expect.poll(() => headerBalance(page)).toBe(9900);
  await page.goto('/wallet');
  await expect(page.locator('[data-testid="ledger-row"][data-type="BET_STAKE"]')).toHaveCount(1);
  await page.getByTestId('nav-bets').click();
  await expect(page.locator('[data-testid="my-bet"][data-bet-status="ACCEPTED"]')).toHaveCount(1);
});

test('quotes and places a tricast', async ({ page }) => {
  await signIn(page, { from: `/races/${horseRace()}` });
  const builder = page.getByTestId('tricast-builder');
  await expect(builder).toBeVisible();
  for (const [index, pick] of ['tricast-pick-1', 'tricast-pick-2', 'tricast-pick-3'].entries()) {
    await builder.getByTestId(pick).selectOption({ index: index + 1 });
  }
  await builder.getByTestId('tricast-quote').click();
  await expect(builder.getByTestId('tricast-price')).toHaveText(/\d+\.\d{2}/);
  await builder.getByTestId('tricast-place').click();
  const slip = page.getByTestId('bet-slip');
  await slip.getByTestId('stake-input').fill('25');
  await slip.getByTestId('place-bet').click();
  await expect(page.locator('[data-testid="my-bet"][data-bet-status="ACCEPTED"]')).toHaveCount(1);
  await expect.poll(() => headerBalance(page)).toBe(9975);
});

test('builds a two-race combo and places it', async ({ page }) => {
  await signIn(page, { from: `/races/${horseRace()}` });
  await market(page, 'FINISH_POSITION', { position: 1 }).getByTestId('price-button').first().click();
  await page.getByTestId('add-to-combo').click();
  await page.goto(`/races/${giraffeRace()}`);
  await market(page, 'TOP_N', { n: 3 }).getByTestId('price-button').first().click();
  await page.getByTestId('add-to-combo').click();
  const combo = page.getByTestId('combo-slip');
  await expect(combo).toContainText(/2 legs|2 selections/i);
  await combo.getByTestId('combo-stake').fill('50');
  await combo.getByTestId('place-combo').click();
  await expect(combo.getByTestId('combo-message')).toContainText(/accepted|placed/i);
  await expect.poll(() => headerBalance(page)).toBe(9950);
  await page.getByTestId('nav-bets').click();
  await expect(page.locator('[data-testid="my-bet"][data-bet-status="ACCEPTED"]')).toHaveCount(1);
  await expect(page.getByTestId('my-bet').first()).toContainText(/combo/i);
});

test('blocks combos with two legs on the same race', async ({ page }) => {
  await signIn(page, { from: `/races/${horseRace()}` });
  await market(page, 'FINISH_POSITION', { position: 1 }).getByTestId('price-button').first().click();
  await page.getByTestId('add-to-combo').click();
  await market(page, 'FINISH_POSITION', { position: 2 }).getByTestId('price-button').nth(1).click();
  await page.getByTestId('add-to-combo').click();
  await expect(page.getByTestId('combo-slip').getByTestId('combo-message')).toContainText(/different races|same race/i);
});

test('cashes out an open bet before the race', async ({ page }) => {
  await signIn(page, { from: `/races/${giraffeRace()}` });
  await placeSingle(page, market(page, 'TOP_N', { n: 3 }), 200, 1);
  const bet = page.getByTestId('my-bet').first();
  await expect(bet).toHaveAttribute('data-bet-status', 'ACCEPTED');
  await bet.getByTestId('cashout-button').click();
  const amountText = await page.getByTestId('cashout-amount').textContent();
  const amount = Number((amountText ?? '').replace(/[^\d]/g, ''));
  expect(amount).toBeGreaterThan(100);
  expect(amount).toBeLessThan(200);
  await page.getByTestId('cashout-confirm').click();
  await expect(bet).toHaveAttribute('data-bet-status', 'CASHED_OUT');
  await expect.poll(() => headerBalance(page)).toBe(10000 - 200 + amount);
});

test('rejects a stake above the balance', async ({ page }) => {
  await signIn(page, { from: `/races/${horseRace()}` });
  await market(page, 'FINISH_POSITION', { position: 1 }).getByTestId('price-button').first().click();
  await page.getByTestId('stake-input').fill('20000');
  await page.getByTestId('place-bet').click();
  await expect(page.getByTestId('bet-slip-message')).toContainText(/enough points|insufficient/i);
  await expect.poll(() => headerBalance(page)).toBe(10000);
});
