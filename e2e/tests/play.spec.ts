import { expect, test } from '@playwright/test';
import { signIn } from './support.ts';

test('anyone can start a solo grand prix without signing in', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByTestId('gp-promo').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByTestId('gp-hub')).toBeVisible();
  await expect(page.getByTestId('gp-signin')).toBeVisible();
  await expect(page.getByTestId('gp-create')).toHaveCount(0);

  await page.goto('/play');
  await page.getByTestId('gp-animal-OCTOPUS').click();
  await page.getByTestId('gp-track-aurora').click();
  await page.getByTestId('gp-laps-1').click();
  await page.getByTestId('gp-solo').click();

  const race = page.getByTestId('gp-race');
  await expect(race).toBeVisible();
  await expect(race.locator('canvas.gp-canvas')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('gp-lap')).toHaveText('1/1', { timeout: 60_000 });

  await page.getByTestId('gp-menu').click({ timeout: 120_000 });
  await expect(page.getByTestId('gp-pause')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('gp-quit').click({ timeout: 60_000 });
  await expect(race).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('gp-hub')).toBeVisible();
});

test('friends share a room code and start a race together', async ({ browser }) => {
  test.setTimeout(300_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    const hostUser = await signIn(host, { from: '/play' });
    await host.getByTestId('gp-create').click();
    const code = ((await host.getByTestId('gp-room-code').textContent()) ?? '').trim();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    await expect(host).toHaveURL(new RegExp(`/play/room/${code}`));
    await expect(host.getByTestId('gp-player')).toHaveCount(1);

    await guest.goto(`/play/room/${code}`);
    await expect(guest.getByTestId('gp-signin').first()).toBeVisible();
    const guestUser = await signIn(guest, { from: `/play/room/${code}` });
    await expect(guest.getByTestId('gp-lobby-view')).toBeVisible();
    await expect(guest.getByTestId('gp-waiting')).toContainText(hostUser.name);
    await expect(host.getByTestId('gp-player')).toHaveCount(2);
    await expect(host.getByTestId('gp-player').nth(1)).toContainText(guestUser.name);

    await guest.getByTestId('gp-animal-SHARK').click();
    await expect(host.getByTestId('gp-player').nth(1)).toContainText('🦈');
    await host.getByTestId('gp-laps-1').click();
    await expect(guest.getByTestId('gp-laps-1')).toHaveClass(/active/);

    await host.getByTestId('gp-start').click();
    await expect(host.getByTestId('gp-race')).toBeVisible({ timeout: 60_000 });
    await expect(guest.getByTestId('gp-race')).toBeVisible({ timeout: 60_000 });
    await expect(guest.getByTestId('gp-lap')).toHaveText('1/1', { timeout: 60_000 });

    await guest.getByTestId('gp-menu').click({ timeout: 120_000 });
    await guest.getByTestId('gp-quit').click({ timeout: 60_000 });
    await expect(guest.getByTestId('gp-hub')).toBeVisible({ timeout: 60_000 });
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test('an unknown room code is reported', async ({ page }) => {
  await signIn(page, { from: '/play' });
  await page.getByTestId('gp-join-code').fill('ZZZZZ');
  await page.getByTestId('gp-join').click();
  await expect(page.getByTestId('gp-error')).toContainText('No room with that code');
});
