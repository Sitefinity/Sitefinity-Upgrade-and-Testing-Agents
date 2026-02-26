import { test, expect, request as playwrightRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { gotoStable } from './utils/playwright-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Smoke test to verify the sitefinity-tests directory setup is correct.
 * This test validates configuration, connectivity, and basic page load.
 * Run with: npx playwright test tests/smoke.spec.ts
 */
test.describe('Setup Verification', () => {
  test('settings.json exists and has required fields', async () => {
    const settingsPath = path.join(__dirname, '..', 'settings.json');
    expect(fs.existsSync(settingsPath), 'settings.json must exist').toBeTruthy();

    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    expect(settings.SitefinityUrl, 'SitefinityUrl must be set').toBeTruthy();
    expect(settings.SitefinityUrl).not.toBe('https://localhost/');
  });

  test('site is reachable and returns a page', async ({ page }) => {
    const response = await gotoStable(page, '/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(500);
    await expect(page.locator('body')).toBeVisible();
  });
});
