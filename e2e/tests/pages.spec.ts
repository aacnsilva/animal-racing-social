import { expect, test } from '@playwright/test';
import { signIn } from './support.ts';

test('browses animals and an animal profile', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-animals').click();
  const first = page.getByTestId('animal-card').first();
  await expect(first).toBeVisible();
  const animalId = await first.getAttribute('data-animal-id');
  await first.click();
  await expect(page).toHaveURL(new RegExp(`/animals/${animalId}$`));
  await expect(page.getByText(/velocity/i).first()).toBeVisible();
});

test('lists the 12 venues and shows a track map', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-venues').click();
  await expect(page.getByTestId('venue-card')).toHaveCount(12);
  await page.locator('[data-testid="venue-card"][data-venue-id="v_dune_loop"]').click();
  await expect(page.getByRole('heading', { name: 'Dune Loop' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Track map' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Elevation profile/ })).toBeVisible();
});

test('shows the season leaderboards with the signed-in user', async ({ page }) => {
  const { name } = await signIn(page);
  await page.getByTestId('nav-leaderboards').click();
  await expect(page.getByTestId('leaderboard-row').filter({ hasText: name })).toBeVisible();
});

test('edits notification settings', async ({ page }) => {
  await signIn(page);
  await page.getByTestId('nav-notifications').click();
  const toggle = page.getByRole('checkbox', { name: /won/i }).first();
  await expect(toggle).toBeChecked();
  await toggle.locator('xpath=..').click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /won/i }).first()).not.toBeChecked();
});
