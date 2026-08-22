import { test, expect } from '@playwright/test';

test('loads catalog and filters by artifact type', async ({ page }) => {
  const catalog = await (await page.request.get('/api/v1/catalog.json')).json();
  const expected = catalog.entries.filter((entry) => entry.kind === 'plugin').length;
  await page.goto('/?kind=plugin&sort=stars');
  await expect(page.locator('#result-count')).toHaveText(`${expected} results`);
  await expect(page.locator('.filter.active')).toContainText('Plugins');
  await expect(page.locator('.card')).toHaveCount(expected);
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

test('compares two projects side by side', async ({ page }) => {
  await page.goto('/?kind=mcp');
  await page.locator('.compare-button').nth(0).click();
  await page.locator('.compare-button').nth(1).click();
  await expect(page.locator('#compare-count')).toHaveText('2 selected');
  await page.locator('#compare-open').click();
  await expect(page.locator('#compare-dialog')).toBeVisible();
  await expect(page.locator('.compare-table')).toContainText('Quality score');
  await expect(page.locator('.compare-table thead th')).toHaveCount(3);
});

test('discovery dashboard loads, filters artifacts, and switches to repositories', async ({ page }) => {
  const discovery = await (await page.request.get('/api/v1/discovery/dashboard.json')).json();
  await page.goto('/discovery.html');
  await expect(page.locator('#discovery-repositories')).toHaveText(new Intl.NumberFormat('en').format(discovery.coverage.repositoriesDiscovered));
  await expect(page.locator('#discovery-results .discovery-card').first()).toBeVisible();
  await page.locator('#discovery-search').fill('skill.md');
  await expect(page.locator('#discovery-result-count')).toContainText('artifact');
  await page.locator('#discovery-view').selectOption('repositories');
  await expect(page.locator('#discovery-results .repository-card').first()).toBeVisible();
  await expect(page.locator('#verification-filter')).toBeDisabled();
  await expect(page.locator('#source-coverage-list .source-row')).toHaveCount((discovery.coverage.declaredSources ?? discovery.coverage.sources).length + 1 + (discovery.coverage.local ? 1 : 0));
});

test('discovery dashboard has no mobile horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1200 });
  await page.goto('/discovery.html');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
