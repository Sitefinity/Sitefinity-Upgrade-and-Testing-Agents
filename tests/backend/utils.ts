import { test as base, expect, Page, Dialog } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Re-export shared utilities so tests can import everything from './utils'
export {
  waitForImagesToLoad,
  hideScrollbars,
  stopCarousels,
  stabilizeForScreenshot,
  takeStableScreenshot,
  gotoStable,
  clickStable,
  waitForSelectorWithRetries,
  expectVisibleWithRetries,
  assertEndpoint,
  EXTERNAL_TAG,
} from '../utils/playwright-utils.js';

import {
  dismissSitefinityTrialScreen as _dismissOverlay,
  isSitefinityTrialScreenVisible as _isOverlayVisible,
  waitForImagesToLoad,
} from '../utils/playwright-utils.js';

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Global session management to handle worker-specific sessions
 * 
 * CRITICAL: Sitefinity only allows ONE active session per user account.
 * When multiple tests try to login simultaneously, all but one will see
 * "User already logged in" errors. This is by design in Sitefinity.
 * 
 * Solution: Tests MUST run sequentially (workers: 1) to prevent conflicts.
 */

/**
 * Validate that the page/browser is still usable
 */
async function isPageUsable(page: Page): Promise<boolean> {
  try {
    // Simple check to see if page context is still valid
    await page.url();
    return true;
  } catch {
    return false;
  }
}

/**
 * Sitefinity Backend Test Utilities
 * Common functions for admin panel testing
 */

export interface SitefinityConfig {
  baseUrl: string;
  adminPath: string;
  credentials: {
    username: string;
    password: string;
  };
}

export interface SitefinityConnection {
  SitefinityUrl: string;
  Token: string;
  SitefinityCLIPath?: string;
  BackendCredentials?: {
    username: string;
    password: string;
  };
}

/**
 * Load Sitefinity connection settings.
 *
 * Resolution order:
 * 1. settings.json in the test project root (sitefinity-tests/settings.json) — used when
 *    tests have been scaffolded into their own directory via the test-directory builder.
 * 2. upgrade-and-testing.code-workspace settings.sf_agents — used when running tests
 *    directly from the upgrade-and-testing-agents repo during development.
 */
function loadSitefinityConnection(): SitefinityConnection | null {
  // 1. Try local settings.json (../../settings.json relative to tests/backend/)
  const settingsJsonPath = path.resolve(__dirname, '../../settings.json');
  try {
    if (fs.existsSync(settingsJsonPath)) {
      let content = fs.readFileSync(settingsJsonPath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      const settings = JSON.parse(content);
      if (settings?.SitefinityUrl) {
        return {
          SitefinityUrl: settings.SitefinityUrl || '',
          Token: '',
          SitefinityCLIPath: settings.SitefinityCLIPath,
          BackendCredentials: settings.BackendCredentials
        } as SitefinityConnection;
      }
    }
  } catch (error) {
    console.warn('Could not load settings.json:', error);
  }

  // 2. Fallback: workspace file (when running from the agents repo)
  const workspacePath = path.resolve(__dirname, '../../upgrade-and-testing.code-workspace');
  try {
    if (fs.existsSync(workspacePath)) {
      let content = fs.readFileSync(workspacePath, 'utf-8');
      // Remove BOM if present
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      // Strip JSON comments (// and /* */) - only match // at start of lines, not in URLs
      content = content.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const workspace = JSON.parse(content);
      const sfAgents = workspace?.settings?.sf_agents;
      if (sfAgents) {
        return {
          SitefinityUrl: sfAgents.SitefinityUrl || '',
          Token: '',
          SitefinityCLIPath: sfAgents.SitefinityCLIPath,
          BackendCredentials: sfAgents.BackendCredentials
        } as SitefinityConnection;
      }
    }
  } catch (error) {
    console.warn('Could not load workspace settings:', error);
  }
  return null;
}

/**
 * Get the Sitefinity URL from connection file or environment/default
 */
function getSitefinityUrl(): string {
  const connection = loadSitefinityConnection();
  if (connection?.SitefinityUrl) {
    // Remove trailing slash if present
    return connection.SitefinityUrl.replace(/\/$/, '');
  }
  return process.env.SITE_URL || 'http://localhost';
}

/**
 * Get backend credentials from connection file or fallback to environment/defaults
 */
function getBackendCredentials(): { username: string; password: string } {
  const connection = loadSitefinityConnection();
  if (connection?.BackendCredentials) {
    return {
      username: connection.BackendCredentials.username,
      password: connection.BackendCredentials.password
    };
  }
  // Fallback to environment variables or defaults
  return {
    username: process.env.ADMIN_USER || 'admin@test.test',
    password: process.env.ADMIN_PASS || 'admin@2'
  };
}

export const defaultConfig: SitefinityConfig = {
  baseUrl: getSitefinityUrl(),
  adminPath: '/Sitefinity', // Backend tests access admin panel
  credentials: getBackendCredentials()
};

// Sitefinity Trial Screen Handling — delegates to shared playwright-utils.
// Local wrappers kept so existing call-sites don't break.
export const isSitefinityTrialScreenVisible = _isOverlayVisible;
export const dismissSitefinityTrialScreen = _dismissOverlay;

/**
 * Extended Playwright test fixture with automatic trial screen handling for backend tests
 * 
 * Usage in backend test files:
 * import { test, expect } from './utils';
 * 
 * test('admin test', async ({ page }) => {
 *   await loginToSitefinity(page);
 *   // Trial screens are automatically handled during admin navigation
 * });
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page: originalPage }, use) => {
    // Enhanced goto: domcontentloaded → dismiss overlays → wait for images (2s cap)
    // networkidle is intentionally omitted (can hang on long-polling sites).
    // waitForImagesToLoad ensures layout is settled for VRT screenshots.
    // NOTE: No background setInterval — trial screen is handled inline on goto/click
    // to avoid racing with test actions and causing mid-test navigations.
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
      await originalPage.waitForTimeout(1000);
      await dismissSitefinityTrialScreen(originalPage);
    };

    // Use the enhanced page object
    await use(originalPage);
  },
});

/**
 * Re-export expect for convenience
 */
export { expect };

/**
 * Login to Sitefinity admin panel
 * Robust approach with proper dialog handling and retry logic for flaky login scenarios
 */
export async function loginToSitefinity(page: Page, config: SitefinityConfig = defaultConfig): Promise<void> {
  const adminUrl = `${config.baseUrl}${config.adminPath}`;
  const dashboardUrl = `${config.baseUrl}/Sitefinity/dashboard`;
  
  // Enhanced dialog handler BEFORE any navigation - handles multiple dialog types
  // This is critical for self-logout confirmation dialogs in Sitefinity 15.4
  // Remove any existing handlers first to prevent conflicts
  page.removeAllListeners('dialog');
  
  const dialogHandler = async (dialog: Dialog) => {
    const message = dialog.message();
    const type = dialog.type();
    console.log(`Dialog detected [${type}]: "${message}" - Accepting automatically`);
    
    try {
      // Small delay to ensure dialog is fully rendered
      await page.waitForTimeout(100);
      await dialog.accept();
      console.log('Dialog accepted successfully');
      // Additional wait after dialog acceptance to ensure proper handling
      await page.waitForTimeout(500);
    } catch (error) {
      console.warn(`Failed to accept dialog: ${error}`);
      try {
        await dialog.dismiss();
        console.log('Dialog dismissed as fallback');
      } catch (dismissError) {
        console.warn(`Failed to dismiss dialog: ${dismissError}`);
      }
    }
  };
  
  // Add our enhanced dialog handler
  page.on('dialog', dialogHandler);
  
  console.log(`Navigating to admin URL: ${adminUrl}`);
  await page.goto(adminUrl);
  await page.waitForLoadState('domcontentloaded');
  
  // Check for trial dialog immediately after navigation
  await dismissSitefinityTrialScreen(page);
  
  // Main login attempt with retries
  const maxLoginAttempts = 5; // Increased from 3 to handle session conflicts better
  
  for (let attempt = 1; attempt <= maxLoginAttempts; attempt++) {
    console.log(`Login attempt ${attempt}/${maxLoginAttempts}`);
    
    // Check for trial dialog at start of each attempt
    await dismissSitefinityTrialScreen(page);
    
    // Check if we're already logged in (dashboard visible)
    const dashboardVisible = await page.getByRole('heading', { name: 'Dashboard' }).isVisible({ timeout: 2000 }).catch(() => false);
    if (dashboardVisible) {
      console.log('Already logged in to Sitefinity admin');
      return;
    }
    
    // Check current page state
    const currentUrl = page.url();
    
    // Handle self-logout page first (user already logged in elsewhere)
    if (currentUrl.includes('/selflogout')) {
      console.log('Self-logout page detected - another session exists');
      await handleSelfLogoutPage(page, config);
      continue; // Re-check login state
    }
    
    // Handle login page - use URL-based detection first (more reliable), then element-based
    const isLoginUrl = currentUrl.includes('/Login') || currentUrl.includes('/login');
    const emailField = page.getByRole('textbox', { name: 'Email' });
    const isLoginPage = isLoginUrl || await emailField.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (isLoginPage) {
      console.log('Login page detected, entering credentials');
      
      // Clear fields first to avoid stale data - use multiple selector strategies
      const emailSelectors = [
        'input[type="text"]',
        'input[id*="UserName"]', 
        'input[id*="Email"]',
        '[role="textbox"][name="Email"]'
      ];
      
      let emailField = null;
      for (const selector of emailSelectors) {
        const field = page.locator(selector).first();
        if (await field.isVisible({ timeout: 1000 }).catch(() => false)) {
          emailField = field;
          break;
        }
      }
      
      if (!emailField) {
        throw new Error('Could not find email field on login page');
      }
      
      await emailField.clear();
      await emailField.fill(config.credentials.username);
      
      // Find password field with similar approach
      const passwordSelectors = [
        'input[type="password"]',
        'input[id*="Password"]',
        '[role="textbox"][name="Password"]'
      ];
      
      let passwordField = null;
      for (const selector of passwordSelectors) {
        const field = page.locator(selector).first();
        if (await field.isVisible({ timeout: 1000 }).catch(() => false)) {
          passwordField = field;
          break;
        }
      }
      
      if (!passwordField) {
        throw new Error('Could not find password field on login page');
      }
      
      await passwordField.clear();
      await passwordField.fill(config.credentials.password);
      
      // Wait a moment for form validation
      await page.waitForTimeout(500);
      
      // Click login and wait for navigation
      const loginButton = page.getByRole('link', { name: 'Log in' });
      
      // Capture current URL to detect navigation
      const beforeUrl = page.url();
      
      // Use Promise.all to handle navigation that may or may not happen
      try {
        await Promise.all([
          page.waitForURL(url => !url.toString().includes('/Login'), { timeout: 15000 }),
          loginButton.click()
        ]);
      } catch (navigationError) {
        console.log('Navigation timeout or error, checking current state...');
        // Continue to check what actually happened
      }
      
      // Wait for navigation to settle - use state-based waiting instead of fixed timeout
      try {
        // Check if page is still usable
        if (!await isPageUsable(page)) {
          console.log(`Page closed during login (attempt ${attempt}), retrying...`);
          continue;
        }
        
        // Wait for DOM to be ready
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        
        // Give network time to settle, but be defensive about page closure
        const networkSettled = await Promise.race([
          page.waitForLoadState('networkidle', { timeout: 5000 }).then(() => true).catch(() => false),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000))
        ]);
        
        if (!networkSettled) {
          console.log('Network did not settle, but continuing...');
        }
        
      } catch (error) {
        console.log(`Error waiting for page state (attempt ${attempt}):`, error instanceof Error ? error.message : error);
        continue;
      }
      
      // Check if login was successful or if we're still on login page (refresh issue)
      const stillOnLoginPage = await emailField.isVisible({ timeout: 1000 }).catch(() => false);
      if (stillOnLoginPage) {
        console.log(`Login page refreshed without logging in (attempt ${attempt}), retrying...`);
        continue;
      }
    }
    
    // After login attempt, check for self-logout page again
    if (page.url().includes('/selflogout')) {
      console.log('Redirected to self-logout page after login');
      await handleSelfLogoutPage(page, config);
      continue;
    }
    
    // Verify we reached the dashboard
    const reachedDashboard = await verifyDashboardAccess(page, config);
    if (reachedDashboard) {
      console.log('Successfully logged into Sitefinity admin');
      return;
    }
  }
  
  // Final fallback: try direct dashboard navigation
  console.log('Login attempts exhausted, trying direct dashboard navigation');
  await page.goto(dashboardUrl);
  await page.waitForLoadState('domcontentloaded');
  
  const finalCheck = await page.getByRole('heading', { name: 'Dashboard' }).isVisible({ timeout: 5000 }).catch(() => false);
  if (finalCheck) {
    console.log('Successfully accessed dashboard via direct navigation');
    return;
  }
  
  throw new Error(`Failed to login to Sitefinity admin after ${maxLoginAttempts} attempts. Current URL: ${page.url()}`);
}

/**
 * Handle the self-logout page when another user session exists
 * Enhanced for Sitefinity stricter session management
 * 
 * NOTE: With sequential execution (workers: 1), self-logout should be rare.
 * It mainly occurs when tests don't properly clean up or when running
 * tests while someone is logged into the admin manually.
 */
async function handleSelfLogoutPage(page: Page, config: SitefinityConfig): Promise<void> {
  console.log('Self-logout page detected - another session exists');
  console.log('Handling self-logout page');
  
  try {
    // Multiple possible selectors for the self-logout link
    const selfLogoutSelectors = [
      'a:has-text("Log the other user out and enter")',
      'a[href*="selfLogoutButton"]',
      'a:has-text("Log the other user out")',
      'input[value*="Log the other user out"]',
      '[id*="selfLogoutButton"]'
    ];
    
    let selfLogoutElement = null;
    for (const selector of selfLogoutSelectors) {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
        selfLogoutElement = element;
        console.log(`Found self-logout element using selector: ${selector}`);
        break;
      }
    }
    
    if (selfLogoutElement) {
      console.log('Clicking self-logout element to take over session');
      
      // Click and wait for navigation away from self-logout page
      try {
        await Promise.all([
          page.waitForURL(url => !url.toString().includes('/selflogout'), { timeout: 20000 }).catch(() => {}),
          selfLogoutElement.click()
        ]);
      } catch (clickError) {
        console.log('Self-logout click timeout or error, checking current state...');
      }
      
      // Wait for page to stabilize after dialog acceptance
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      
    } else {
      console.log('Self-logout button not found, trying alternative approaches');
    }
    
    // After handling self-logout, if still on logout page, force navigation
    if (page.url().includes('/selflogout') || page.url().includes('/SignOut')) {
      console.log('Still on logout page, forcing navigation to login');
      await page.goto(`${config.baseUrl}/Sitefinity`);
      await page.waitForLoadState('domcontentloaded');
    }
    
  } catch (error) {
    console.warn(`Error handling self-logout page: ${error}`);
    // Fallback: navigate directly to admin login
    await page.goto(`${config.baseUrl}/Sitefinity`);
    await page.waitForLoadState('domcontentloaded');
  }
}

/**
 * Verify that we have access to the dashboard
 * Enhanced for Sitefinity 15.4 new admin interface
 */
async function verifyDashboardAccess(page: Page, config: SitefinityConfig): Promise<boolean> {
  const currentUrl = page.url();
  
  // Check if we're on any admin page (not login or logout)
  if (currentUrl.includes('/Sitefinity') && !currentUrl.includes('/Login') && !currentUrl.includes('/selflogout')) {
    
    // Multiple indicators that we're successfully logged into admin
    const adminIndicators = [
      // Dashboard heading (most reliable)
      () => page.getByRole('heading', { name: 'Dashboard' }).isVisible({ timeout: 3000 }).catch(() => false),
      
      // Admin app renderer (new in 15.4)
      () => page.locator('[id*="adminapp"]').isVisible({ timeout: 2000 }).catch(() => false),
      
      // Progress Sitefinity CMS text
      () => page.locator('text=Progress Sitefinity CMS').isVisible({ timeout: 2000 }).catch(() => false),
      
      // Admin menu (legacy selector)
      () => page.locator('a.rmLink.rmRootLink').first().isVisible({ timeout: 2000 }).catch(() => false),
      
      // Live site link (admin interface indicator)
      () => page.getByRole('link', { name: 'Live site' }).isVisible({ timeout: 2000 }).catch(() => false),
      
      // User settings button (admin interface indicator) 
      () => page.getByRole('button', { name: 'User settings' }).isVisible({ timeout: 2000 }).catch(() => false)
    ];
    
    // Check each indicator
    for (const indicator of adminIndicators) {
      if (await indicator()) {
        return true;
      }
    }
    
    // Additional check for specific admin URLs that indicate successful login
    if (currentUrl.includes('/adminapp/renderer/dashboard') || 
        currentUrl.includes('/Sitefinity/dashboard') ||
        currentUrl.includes('/Sitefinity/adminapp')) {
      console.log('Admin URL detected - considered logged in');
      return true;
    }
  }
  
  return false;
}

/**
 * Clean up any existing sessions to prevent conflicts
 * Call this at the beginning of each test for clean state
 * 
 * NOTE: Since tests run sequentially with workers: 1, this is mainly for 
 * ensuring a clean slate between tests, not for parallel isolation.
 */
export async function cleanupSitefinitySessions(page: Page, config: SitefinityConfig = defaultConfig): Promise<void> {
  console.log('Cleaning up Sitefinity sessions...');
  
  // Check if page is still usable before attempting cleanup
  if (!await isPageUsable(page)) {
    console.log('Page context closed, skipping cleanup');
    return;
  }
  
  try {
    // Navigate to logout URL to clear any existing sessions
    const logoutUrl = `${config.baseUrl}/Sitefinity/SignOut`;
    await page.goto(logoutUrl, { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    
    // Clear cookies and session storage for the domain
    await page.context().clearCookies();
    await page.evaluate(() => {
      try {
        sessionStorage.clear();
        localStorage.clear();
      } catch (e) {
        console.log('Storage clear failed:', e);
      }
    });
    
    console.log('Session cleanup completed');
  } catch (error) {
    console.warn('Session cleanup encountered error:', error);
    // Continue anyway - this is a best-effort cleanup
  }
}

/**
 * Navigate to a content type in the admin panel
 * Updated for post-migration admin interface structure
 */
export async function navigateToContent(page: Page, contentType: string): Promise<void> {
  // Post-migration: Admin menu structure may have changed - try multiple possible selectors
  const contentMenuSelectors = [
    'a.rmLink.rmRootLink[title*="Content"]', // Original selector with title attribute
    'a.rmLink.rmRootLink:has-text("Content")', // Alternative text matching
    'a[href*="content"]:has-text("Content")', // More generic content link
    'li:has-text("Content") > a', // Menu item approach
    '[data-sf-menu="content"]', // Data attribute approach
    '.sf-content-menu', // CSS class approach
    'a.rmLink:has-text("Content")' // Less specific class selector
  ];
  
  let contentMenuFound = false;
  for (const selector of contentMenuSelectors) {
    try {
      const menuElement = page.locator(selector).first();
      if (await menuElement.isVisible({ timeout: 2000 })) {
        await menuElement.click();
        contentMenuFound = true;
        break;
      }
    } catch (e) {
      // Continue to next selector
      continue;
    }
  }
  
  if (!contentMenuFound) {
    // Fallback: Try to navigate directly to the content section
    const directUrl = `${page.url().split('/Sitefinity')[0]}/Sitefinity/content/${contentType.toLowerCase()}`;
    console.log(`Content menu not found, trying direct navigation to: ${directUrl}`);
    await page.goto(directUrl);
    await page.waitForLoadState('domcontentloaded');
    return;
  }
  
  // Wait for menu to expand
  await page.locator('a.rmLink').first().waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  
  const contentTypeSelectors = [
    `a:has-text("${contentType}")`,
    `link:has-text("${contentType}")`,
    `[href*="${contentType.toLowerCase()}"]`,
    `li:has-text("${contentType}") a`
  ];
  
  for (const selector of contentTypeSelectors) {
    try {
      const contentLink = page.locator(selector).first();
      if (await contentLink.isVisible({ timeout: 3000 })) {
        await contentLink.click();
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  // Wait for page to load
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Navigate to an admin section
 */
export async function navigateToAdmin(page: Page, section: string): Promise<void> {
  await page.getByRole('link', { name: 'Administration ' }).click();
  await page.getByRole('link', { name: section, exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
}

/**
 * Take a snapshot for visual regression
 */
export async function captureSnapshot(page: Page, name: string, directory: string = 'snapshots'): Promise<string> {
  const screenshotPath = `${directory}/${name}.png`;
  await page.screenshot({ 
    path: screenshotPath, 
    fullPage: true,
    animations: 'disabled'
  });
  return screenshotPath;
}

/**
 * Check for console errors on the page
 */
export function setupConsoleErrorCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  return errors;
}
