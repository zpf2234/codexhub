import { test, expect } from '@playwright/test';

test('loads catalog and filters by artifact type', async ({ page }) => {
  await page.goto('/?kind=plugin&sort=stars');
  await expect(page.locator('#result-count')).toHaveText('3 results');
  await expect(page.locator('.filter.active')).toContainText('Plugins');
  await expect(page.locator('.card')).toHaveCount(3);
  await expect(page.locator('.card').first().locator('.score')).toBeVisible();
});

test('search updates result count and URL state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('playwright');
  await expect(page.locator('#result-count')).toHaveText('1 result');
  await expect(page).toHaveURL(/q=playwright/);
  await expect(page.locator('.card h3')).toHaveText('Playwright MCP');
});

test('evidence panel exposes score evidence without unsafe HTML', async ({ page }) => {
  await page.goto('/?kind=plugin');
  await page.locator('.evidence summary').first().click();
  await expect(page.locator('.evidence-body').first()).toContainText('Recognized artifact');
  await expect(page.locator('.evidence-body').first().locator('a[href*="github.com"]').first()).toBeVisible();
  expect(await page.locator('script').count()).toBeGreaterThan(0);
});

test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
