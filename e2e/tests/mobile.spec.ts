import { expect, test, type Page } from '@playwright/test';
import { ADMIN_SUBJECT, headerBalance, market, signIn } from './support.ts';

const horseRace = () => process.env.E2E_RACE_HORSE!;

async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > width) found.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${width}`);
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || (rect.left >= -1 && rect.right <= width + 1)) continue;
      let parent = element.parentElement;
      let scrollable = false;
      while (parent && parent !== document.body) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)) {
          scrollable = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (scrollable) continue;
      const testId = element.dataset.testid ? `[data-testid="${element.dataset.testid}"]` : '';
      found.push(`${element.tagName.toLowerCase()}.${String(element.className).trim().replace(/\s+/g, '.')}${testId} spans ${Math.round(rect.left)}..${Math.round(rect.right)}`);
    }
    return found.slice(0, 10);
  });
}

async function expectFitsScreen(page: Page, label: string) {
  expect(await overflowingElements(page), `${label} overflows the screen`).toEqual([]);
}

async function expectTouchFriendly(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.btn, .price, .tabs button, .tabs a, .race-tabs button, .tabbar a, .tabbar button, .hud-cams button')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.height < 30;
      })
      .map((element) => `${element.className} "${element.textContent?.trim().slice(0, 20)}" ${Math.round(element.getBoundingClientRect().height)}px`),
  );
  expect(small, `${label} has tap targets under 30px`).toEqual([]);
}

test('the bottom tab bar replaces the desktop navigation', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('nav-bets')).toBeHidden();
  const tabbar = page.locator('.tabbar');
  await expect(tabbar).toBeVisible();
  const box = (await tabbar.boundingBox())!;
  expect(box.y + box.height).toBeCloseTo(page.viewportSize()!.height, 0);
  await expect(page.getByTestId('tab-races')).toHaveClass(/active/);

  for (const [tab, path] of [
    ['bets', '/bets'],
    ['wallet', '/wallet'],
    ['leaderboards', '/leaderboards'],
    ['races', '/'],
  ]) {
    await page.getByTestId(`tab-${tab}`).tap();
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/' : path}$`));
    await expect(page.getByTestId(`tab-${tab}`)).toHaveClass(/active/);
  }
});

test('the More sheet reaches the other pages and signs out', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('logout')).toBeHidden();

  for (const [item, path] of [
    ['nav-animals', '/animals'],
    ['nav-venues', '/venues'],
    ['nav-profile', '/me'],
  ]) {
    await page.getByTestId('tab-more').tap();
    await expect(page.getByTestId('nav-races')).toBeHidden();
    await page.getByTestId(item).tap();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByTestId(item)).toBeHidden();
    await expect(page.getByTestId('tab-more')).toHaveClass(/active/);
  }

  await page.getByTestId('tab-more').tap();
  await expect(page.getByTestId('nav-animals')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-animals')).toBeHidden();

  await page.getByTestId('tab-more').tap();
  await page.getByTestId('nav-logout').tap();
  await expect(page.getByTestId('login-google')).toBeVisible();
});

test('every screen fits a phone without sideways scrolling', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await signIn(page);
  const animalId = (await (await page.request.get('/v1/animals?limit=1')).json()).items[0].id;
  const screens: [string, string, () => ReturnType<Page['locator']>][] = [
    ['race card', '/', () => page.getByTestId('race-card-item').first()],
    ['results', '/results', () => page.getByRole('heading', { name: 'Results' })],
    ['race', `/races/${horseRace()}`, () => page.getByTestId('market').first()],
    ['my bets', '/bets', () => page.getByRole('heading', { name: 'My bets' })],
    ['wallet', '/wallet', () => page.getByTestId('ledger-row').first()],
    ['leaderboards', '/leaderboards', () => page.getByTestId('leaderboard-row').first()],
    ['animals', '/animals', () => page.getByTestId('animal-card').first()],
    ['animal', `/animals/${animalId}`, () => page.getByText(/velocity/i).first()],
    ['venues', '/venues', () => page.getByTestId('venue-card').first()],
    ['venue', '/venues/v_dune_loop', () => page.getByRole('img', { name: 'Track map' })],
    ['notifications', '/notifications', () => page.getByTestId('notification-setting').first()],
    ['profile', '/me', () => page.getByTestId('display-name-input')],
  ];
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: 700 });
    for (const [label, path, ready] of screens) {
      await page.goto(path);
      await expect(ready()).toBeVisible();
      await expectFitsScreen(page, `${label} at ${width}px`);
      await expectTouchFriendly(page, `${label} at ${width}px`);
    }
  }
});

test('the admin screens fit a phone', async ({ page }) => {
  await signIn(page, { subject: ADMIN_SUBJECT, name: 'Admin' });
  await page.getByTestId('tab-more').tap();
  await page.getByTestId('nav-admin').tap();
  await expect(page).toHaveURL(/\/admin$/);
  for (const tab of ['Races', 'Markets', 'Programme', 'Seasons', 'Users', 'DLQ & audit']) {
    await page.getByRole('button', { name: tab, exact: true }).tap();
    await expect(page.locator('.admin-grid, .stack .card').first()).toBeVisible();
    await expectFitsScreen(page, `admin ${tab}`);
  }
});

test('split layouts stack into one column', async ({ page }) => {
  await signIn(page);
  const width = page.viewportSize()!.width;

  await page.goto('/notifications');
  const inbox = page.locator('.race-body > main');
  const settings = page.locator('.race-body > aside');
  await expect(settings.getByTestId('notification-setting').first()).toBeVisible();
  const inboxBox = (await inbox.boundingBox())!;
  const settingsBox = (await settings.boundingBox())!;
  expect(inboxBox.width).toBeGreaterThan(width * 0.85);
  expect(settingsBox.y).toBeGreaterThanOrEqual(inboxBox.y + inboxBox.height);

  await page.goto('/venues/v_dune_loop');
  const map = page.getByRole('img', { name: 'Track map' });
  await expect(map).toBeVisible();
  expect((await map.boundingBox())!.width).toBeGreaterThan(width * 0.75);
});

test('bets from the bottom sheet and follows the race through section tabs', async ({ page }) => {
  await signIn(page, { from: `/races/${horseRace()}` });
  await expect(page.getByTestId('race-status')).toHaveText(/OPEN/);
  const height = page.viewportSize()!.height;

  const sections = page.getByTestId('race-sections');
  await expect(sections).toBeVisible();
  await expect(page.getByTestId('race-section-markets')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('standings')).toBeHidden();

  await page.getByTestId('race-section-race').tap();
  await expect(page.getByTestId('standing-row').first()).toBeVisible();
  await expect(page.getByTestId('market').first()).toBeHidden();

  await page.getByTestId('race-section-runners').tap();
  await expect(page.locator('tr[data-entrant-id]').first()).toBeVisible();

  await page.getByTestId('race-section-markets').tap();
  const win = market(page, 'FINISH_POSITION', { position: 1 });
  await win.getByTestId('price-button').first().scrollIntoViewIfNeeded();
  await expect(sections).toBeInViewport();
  await win.getByTestId('price-button').first().tap();

  const slip = page.getByTestId('bet-slip');
  await expect(slip).toBeVisible();
  const slipBox = (await slip.boundingBox())!;
  expect(slipBox.y + slipBox.height).toBeCloseTo(height, 0);
  expect(slipBox.width).toBeCloseTo(page.viewportSize()!.width, 0);
  await expectFitsScreen(page, 'bet slip');

  await slip.getByTestId('stake-input').fill('100');
  await slip.getByTestId('place-bet').tap();
  await expect(slip.getByTestId('bet-slip-message')).toContainText(/ACCEPTED/);
  await expect.poll(() => headerBalance(page)).toBe(9900);
  await slip.getByRole('button', { name: 'Close bet slip' }).tap();
  await expect(slip).toBeHidden();

  await expect(page.getByTestId('race-section-bets')).toContainText('1');
  await page.getByTestId('race-section-bets').tap();
  await expect(page.getByTestId('my-bet')).toHaveAttribute('data-bet-status', 'ACCEPTED');
  await expect(page.getByTestId('my-bet')).toBeVisible();
  await expect(page.getByTestId('market').first()).toBeHidden();
});
