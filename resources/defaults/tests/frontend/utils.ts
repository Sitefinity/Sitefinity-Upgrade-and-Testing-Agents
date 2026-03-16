import { test as base, expect, Page } from '@playwright/test';

// Re-export shared utilities so existing imports keep working
export {
  isSitefinityTrialScreenVisible,
  dismissSitefinityTrialScreen,
  hideScrollbars,
  stopCarousels,
  takeStableScreenshot,
  waitForImagesToLoad,
  gotoStable,
  clickStable,
  stabilizeForScreenshot,
  waitForSelectorWithRetries,
  expectVisibleWithRetries,
  assertEndpoint,
  EXTERNAL_TAG,
} from '../utils/playwright-utils.js';

import {
  dismissSitefinityTrialScreen,
  waitForImagesToLoad,
} from '../utils/playwright-utils.js';

/**
 * Frontend Test Utilities for Sitefinity
 *
 * Core overlay / screenshot helpers live in tests/utils/playwright-utils.ts.
 * This file provides the extended page fixture that wires them in automatically.
 */

/**
 * Navigate to a URL with automatic trial screen handling (legacy compat wrapper).
 * Prefer `gotoStable` from playwright-utils for new code.
 */
export async function gotoWithTrialHandling(page: Page, url: string, options?: Parameters<Page['goto']>[1]): Promise<void> {
  await page.goto(url, options);
  await page.waitForLoadState('domcontentloaded');
  await dismissSitefinityTrialScreen(page);
}

/**
 * Click an element with automatic trial screen handling (legacy compat wrapper).
 * Prefer `clickStable` from playwright-utils for new code.
 */
export async function clickWithTrialHandling(page: Page, selector: string): Promise<void> {
  await page.click(selector);
  await page.waitForLoadState('domcontentloaded');
  await dismissSitefinityTrialScreen(page);
}

/**
 * Extended Playwright test fixture with automatic trial screen handling
 *
 * Usage in test files:
 *   import { test, expect } from './utils';
 *
 *   test('my test', async ({ page }) => {
 *     await page.goto('/some-page');
 *     // Trial screens + images are handled automatically
 *   });
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page: originalPage }, use) => {
    // Periodic monitor for unexpected trial overlays
    const trialScreenMonitor = setInterval(async () => {
      try {
        if (originalPage && !originalPage.isClosed()) {
          await dismissSitefinityTrialScreen(originalPage);
        }
      } catch {
        // Silently ignore
      }
    }, 2000);

    // Enhanced goto: domcontentloaded → dismiss overlays → wait for images (2s cap)
    // networkidle is intentionally omitted (can hang on long-polling sites).
    // waitForImagesToLoad ensures layout is settled for VRT screenshots.
    const originalGoto = originalPage.goto.bind(originalPage);
    originalPage.goto = async (url: string, options?: Parameters<Page['goto']>[1]) => {
      const response = await originalGoto(url, { waitUntil: 'domcontentloaded', ...options });
      await dismissSitefinityTrialScreen(originalPage);
      await waitForImagesToLoad(originalPage); // 2s best-effort
      return response;
    };

    // Enhanced click: short delay + overlay dismissal
    const originalClick = originalPage.click.bind(originalPage);
    originalPage.click = async (selector: string, options?: Parameters<Page['click']>[1]) => {
      await originalClick(selector, options);
      await originalPage.waitForTimeout(500);
      await dismissSitefinityTrialScreen(originalPage);
    };

    await use(originalPage);
    clearInterval(trialScreenMonitor);
  },
});

/**
 * Re-export expect for convenience
 */
export { expect };

// Legacy aliases — prefer the shared names from playwright-utils
export { waitForSelectorWithRetries as waitForSelectorWithTrialHandling } from '../utils/playwright-utils.js';
export { expectVisibleWithRetries as expectVisibleWithTrialHandling } from '../utils/playwright-utils.js';
