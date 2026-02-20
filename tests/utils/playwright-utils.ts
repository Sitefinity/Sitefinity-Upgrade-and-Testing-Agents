import { expect, Page } from '@playwright/test';

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Whether trial/overlay screen auto-dismissal is enabled.
 * Set ENABLE_TRIAL_HANDLING=false to disable (e.g., for non-Sitefinity sites).
 * Defaults to true.
 */
export const TRIAL_HANDLING_ENABLED =
  (process.env.ENABLE_TRIAL_HANDLING ?? 'true').toLowerCase() !== 'false';

// ============================================================================
// Image Loading
// ============================================================================

/**
 * Wait until all <img> elements in the document are fully loaded.
 * Best-effort: gives up after `timeout` ms without throwing.
 * Call before taking full-page screenshots or visual diffs.
 */
export async function waitForImagesToLoad(page: Page, timeout = 2000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const imgs = Array.from(document.images);
        if (imgs.length === 0) return true;
        return imgs.every((img) => img.complete && img.naturalWidth > 0);
      },
      { timeout }
    );
  } catch {
    // Best-effort — don't fail the test if images are slow
    console.log('waitForImagesToLoad timed out – proceeding anyway');
  }
}

// ============================================================================
// Overlay / Trial‑Screen Handling (Sitefinity-specific, env-gated)
// ============================================================================

/**
 * Check if the Sitefinity trial screen is currently visible
 */
export async function isSitefinityTrialScreenVisible(page: Page): Promise<boolean> {
  if (!TRIAL_HANDLING_ENABLED) return false;
  try {
    const trialHeading = page.getByRole('heading', { name: /trial version of Sitefinity/i });
    const isVisible = await trialHeading.isVisible({ timeout: 500 }).catch(() => false);
    if (!isVisible) {
      const title = await page.title();
      return title.includes('Sitefinity trial version');
    }
    return isVisible;
  } catch {
    return false;
  }
}

/**
 * Dismiss the Sitefinity trial screen if it's present.
 * Returns true if a screen was dismissed.
 */
export async function dismissSitefinityTrialScreen(page: Page): Promise<boolean> {
  if (!TRIAL_HANDLING_ENABLED) return false;
  try {
    const isTrialScreen = await isSitefinityTrialScreenVisible(page);
    if (!isTrialScreen) return false;

    console.log('Sitefinity trial screen detected, dismissing…');

    const continueButton = page.getByRole('link', { name: 'Continue' });
    if (await continueButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await continueButton.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('Trial screen dismissed');
      return true;
    }

    const continueFallback = page.locator('a:has-text("Continue"), button:has-text("Continue")').first();
    if (await continueFallback.isVisible({ timeout: 1000 }).catch(() => false)) {
      await continueFallback.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('Trial screen dismissed (fallback)');
      return true;
    }

    return false;
  } catch (error) {
    console.warn('Error dismissing trial screen:', error);
    return false;
  }
}

// ============================================================================
// Stable Navigation & Interaction Wrappers
// ============================================================================

/**
 * Navigate to a URL with full stabilization:
 *  1. page.goto → domcontentloaded
 *  2. best-effort networkidle wait
 *  3. dismiss transient overlays
 *  4. wait for images to finish loading
 *
 * Use this instead of raw page.goto before taking screenshots or interacting
 * with page content that depends on async resources.
 */
export async function gotoStable(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1]
): Promise<Awaited<ReturnType<Page['goto']>>> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', ...options });

  // Best-effort networkidle – don't fail if the page has long-polling
  await page.waitForLoadState('networkidle').catch(() => {});

  // Dismiss any transient overlays (trial screen, cookie banners, etc.)
  await dismissSitefinityTrialScreen(page);

  // Wait for images so layout is fully settled
  await waitForImagesToLoad(page);

  return response;
}

/**
 * Click an element, then stabilize (short delay + overlay dismissal).
 */
export async function clickStable(
  page: Page,
  selector: string,
  options?: Parameters<Page['click']>[1]
): Promise<void> {
  await page.click(selector, options);
  await page.waitForTimeout(500);
  await dismissSitefinityTrialScreen(page);
}

// ============================================================================
// Retry Helpers (overlay-aware)
// ============================================================================

/**
 * Wait for a selector with automatic trial-screen retry.
 * If the selector isn't found, check for overlays, dismiss, retry.
 */
export async function waitForSelectorWithRetries(
  page: Page,
  selector: string,
  options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }
): Promise<void> {
  const maxRetries = 3;
  const timeout = options?.timeout ?? 5000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.waitForSelector(selector, { ...options, timeout });
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const dismissed = await dismissSitefinityTrialScreen(page);
      if (!dismissed) throw error;
      console.log(`Overlay dismissed, retrying selector wait (${attempt}/${maxRetries})`);
    }
  }
}

/**
 * Assert a locator is visible, retrying after overlay dismissal if needed.
 */
export async function expectVisibleWithRetries(
  page: Page,
  locator: ReturnType<Page['locator']> | ReturnType<Page['getByRole']> | ReturnType<Page['getByText']>
): Promise<void> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await expect(locator).toBeVisible({ timeout: 5000 });
      return;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const dismissed = await dismissSitefinityTrialScreen(page);
      if (!dismissed) throw error;
      console.log(`Overlay dismissed, retrying visibility check (${attempt}/${maxRetries})`);
    }
  }
}

// ============================================================================
// Screenshot Stabilization
// ============================================================================

/**
 * Hide scrollbars to ensure consistent viewport width for VRT screenshots.
 * Scrollbar width (typically 15px) causes width to fluctuate between screenshots.
 */
export async function hideScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      html, body, * {
        scrollbar-width: none !important;          /* Firefox */
        -ms-overflow-style: none !important;       /* IE / Edge */
      }
      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      *::-webkit-scrollbar {
        display: none !important;                  /* Chrome / Safari / Opera */
        width: 0 !important;
        height: 0 !important;
      }
    `,
  });
}

/**
 * Stop all carousels / sliders and reset to the first slide for consistent VRT.
 */
export async function stopCarousels(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Bootstrap carousels
    document.querySelectorAll('.carousel').forEach((carousel: any) => {
      if (typeof carousel.pause === 'function') carousel.pause();
      const firstSlide = carousel.querySelector('.carousel-item');
      if (firstSlide) {
        carousel.querySelectorAll('.carousel-item').forEach((item: any) => item.classList.remove('active'));
        firstSlide.classList.add('active');
      }
    });

    // Slick sliders
    document.querySelectorAll('.slick-slider').forEach((slider: any) => {
      if (slider?.slick) {
        slider.slick.slickPause();
        slider.slick.slickGoTo(0);
      }
    });

    // Generic auto-playing elements
    document.querySelectorAll('[data-ride="carousel"], [data-autoplay="true"]').forEach((el: any) => {
      if (el.pause) el.pause();
      el.style.animationPlayState = 'paused';
    });
  });
}

/**
 * Full stabilization before a VRT screenshot:
 *  1. Stop carousels / animations
 *  2. Hide scrollbars
 *  3. Wait for images
 *  4. Short settle delay
 */
export async function stabilizeForScreenshot(page: Page): Promise<void> {
  await stopCarousels(page);
  await hideScrollbars(page);
  await waitForImagesToLoad(page);
  await page.waitForTimeout(300); // let animations settle
}

/**
 * Take a full-page screenshot with all stabilization applied.
 * Wraps `expect(page).toHaveScreenshot()`.
 */
export async function takeStableScreenshot(
  page: Page,
  name: string,
  options?: Parameters<typeof expect<Page>['prototype']['toHaveScreenshot']>[1]
): Promise<void> {
  await stabilizeForScreenshot(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true, ...options });
}

// ============================================================================
// Non-UI Endpoint Testing
// ============================================================================

/**
 * Assert that an HTTP endpoint responds successfully and optionally contains
 * expected text. Uses the Playwright `request` context — no browser rendering.
 *
 * @example
 *   await assertEndpoint(request, '/sitemap/sitemap.xml', { containsText: '<?xml' });
 *   await assertEndpoint(request, '/robots.txt');
 */
export async function assertEndpoint(
  request: {
    get: (url: string, options?: object) => Promise<{ status: () => number; text: () => Promise<string> }>;
  },
  url: string,
  options?: { containsText?: string; maxStatus?: number }
): Promise<void> {
  const maxStatus = options?.maxStatus ?? 400;
  const response = await request.get(url);
  expect(response.status()).toBeLessThan(maxStatus);

  if (options?.containsText) {
    const body = await response.text();
    expect(body).toContain(options.containsText);
  }
}

// ============================================================================
// Test Tags / Annotations
// ============================================================================

/**
 * Tag name for tests that navigate to external content.
 * Tests tagged `@external` are skipped by default — use GREP to include them:
 *   GREP="@external" npx playwright test
 *
 * Usage in a test file:
 *   test('external link check', { tag: EXTERNAL_TAG }, async ({ page }) => { … });
 */
export const EXTERNAL_TAG = '@external';
