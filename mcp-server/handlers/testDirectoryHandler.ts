import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadUpgradeSettings } from "../util.js";

/**
 * Test Directory Management Handlers
 * Tools for scaffolding and validating Sitefinity test directory structure
 */

// ============================================================================
// Scaffold Test Directory Structure
// ============================================================================

interface ScaffoldResult {
  success: boolean;
  created: string[];
  skipped: string[];
  errors: string[];
  message: string;
}

export async function scaffoldTestDirectoryHandler(args: {
  targetPath: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
  const result: ScaffoldResult = {
    success: true,
    created: [],
    skipped: [],
    errors: [],
    message: "",
  };

  try {
    const testDir = join(args.targetPath, "sitefinity-tests");

    // Create main directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
      result.created.push("sitefinity-tests/");
    } else {
      result.skipped.push("sitefinity-tests/ (already exists)");
    }

    // Create subdirectories
    const dirs = [
      "tests/backend",
      "tests/frontend",
      "tests/utils",
      "snapshots/backend",
      "snapshots/frontend",
      "test-artifacts",
    ];

    for (const dir of dirs) {
      const dirPath = join(testDir, dir);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        result.created.push(dir + "/");
      } else {
        result.skipped.push(dir + "/ (already exists)");
      }
    }

    // Create playwright.config.ts
    const configPath = join(testDir, "playwright.config.ts");
    if (!existsSync(configPath)) {
      const configContent = getPlaywrightConfigTemplate();
      writeFileSync(configPath, configContent, "utf-8");
      result.created.push("playwright.config.ts");
    } else {
      result.skipped.push("playwright.config.ts (already exists)");
    }

    // Create package.json
    const packagePath = join(testDir, "package.json");
    if (!existsSync(packagePath)) {
      const packageContent = getPackageJsonTemplate();
      writeFileSync(packagePath, packageContent, "utf-8");
      result.created.push("package.json");
    } else {
      result.skipped.push("package.json (already exists)");
    }

    // Create README.md
    const readmePath = join(testDir, "README.md");
    if (!existsSync(readmePath)) {
      const readmeContent = getReadmeTemplate();
      writeFileSync(readmePath, readmeContent, "utf-8");
      result.created.push("README.md");
    } else {
      result.skipped.push("README.md (already exists)");
    }

    // Create .gitignore
    const gitignorePath = join(testDir, ".gitignore");
    if (!existsSync(gitignorePath)) {
      const gitignoreContent = getGitignoreTemplate();
      writeFileSync(gitignorePath, gitignoreContent, "utf-8");
      result.created.push(".gitignore");
    } else {
      result.skipped.push(".gitignore (already exists)");
    }

    // Generate settings.json from workspace configuration (settings.sf_agents)
    const testSettingsPath = join(testDir, "settings.json");
    if (!existsSync(testSettingsPath)) {
      try {
        const upgradeSettings = loadUpgradeSettings();
        const testSettings = {
          SitefinityUrl: upgradeSettings.SitefinityUrl,
          BackendCredentials: upgradeSettings.BackendCredentials || {
            username: "admin@test.test",
            password: "admin@2"
          }
        };
        writeFileSync(testSettingsPath, JSON.stringify(testSettings, null, 2), "utf-8");
        result.created.push("settings.json (generated from workspace configuration)");
      } catch (error) {
        result.errors.push(`Could not generate settings.json from workspace configuration: ${error instanceof Error ? error.message : String(error)}`);
        result.skipped.push("settings.json (failed to read workspace settings - create manually)");
      }
    } else {
      result.skipped.push("settings.json (already exists)");
    }

    // Copy predefined tests and snapshots from upgrade-and-testing
    // Determine the root of upgrade-and-testing project
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const projectRoot = join(__dirname, "..", ".."); // From src/handlers/ to root

    // Copy tests/ directory (contains predefined backend tests)
    const sourceTestsPath = join(projectRoot, "tests");
    const destTestsPath = join(testDir, "tests");
    if (existsSync(sourceTestsPath)) {
      try {
        cpSync(sourceTestsPath, destTestsPath, { 
          recursive: true, 
          force: false, // Don't overwrite existing files
          errorOnExist: false 
        });
        result.created.push("tests/ (copied predefined tests from upgrade-and-testing)");
      } catch (error) {
        // If files already exist, that's okay
        result.skipped.push("tests/ (some or all files already exist)");
      }
    }

    // Copy snapshots/ directory (frontend and backend)
    const sourceSnapshotsPath = join(projectRoot, "snapshots");
    const destSnapshotsPath = join(testDir, "snapshots");
    if (existsSync(sourceSnapshotsPath)) {
      try {
        cpSync(sourceSnapshotsPath, destSnapshotsPath, { 
          recursive: true, 
          force: false,
          errorOnExist: false 
        });
        result.created.push("snapshots/ (copied from upgrade-and-testing)");
      } catch (error) {
        result.skipped.push("snapshots/ (some or all files already exist)");
      }
    }

    // Create smoke test for verifying setup
    const smokeTestPath = join(testDir, "tests", "smoke.spec.ts");
    if (!existsSync(smokeTestPath)) {
      const smokeTestContent = getSmokeTestTemplate();
      writeFileSync(smokeTestPath, smokeTestContent, "utf-8");
      result.created.push("tests/smoke.spec.ts");
    } else {
      result.skipped.push("tests/smoke.spec.ts (already exists)");
    }

    // Create shared playwright-utils.ts
    const playwrightUtilsPath = join(testDir, "tests", "utils", "playwright-utils.ts");
    if (!existsSync(playwrightUtilsPath)) {
      const utilsContent = getPlaywrightUtilsTemplate();
      writeFileSync(playwrightUtilsPath, utilsContent, "utf-8");
      result.created.push("tests/utils/playwright-utils.ts");
    } else {
      result.skipped.push("tests/utils/playwright-utils.ts (already exists)");
    }

    result.message = `Scaffolding complete! Created ${result.created.length} items, skipped ${result.skipped.length} existing items.`;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
    result.message = "Scaffolding failed with errors.";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}

// ============================================================================
// Validate Test Directory Structure
// ============================================================================

interface ValidationResult {
  valid: boolean;
  issues: string[];
  suggestions: string[];
  summary: string;
}

export async function validateTestStructureHandler(args: {
  testDir: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
  const result: ValidationResult = {
    valid: true,
    issues: [],
    suggestions: [],
    summary: "",
  };

  try {
    const testDir = args.testDir;

    // Check if test directory exists
    if (!existsSync(testDir)) {
      result.valid = false;
      result.issues.push("Test directory does not exist");
      result.suggestions.push("Run scaffold_test_directory to create the structure");
      result.summary = "Test directory not found - needs scaffolding.";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    // Check required files
    const requiredFiles = [
      { path: "playwright.config.ts", suggestion: "Create playwright.config.ts with proper configuration" },
      { path: "package.json", suggestion: "Create package.json with Playwright dependencies" },
      { path: ".gitignore", suggestion: "Create .gitignore to exclude test artifacts" },
    ];

    for (const file of requiredFiles) {
      const filePath = join(testDir, file.path);
      if (!existsSync(filePath)) {
        result.valid = false;
        result.issues.push(`Missing required file: ${file.path}`);
        result.suggestions.push(file.suggestion);
      }
    }

    // Check required directories
    const requiredDirs = [
      { path: "tests/backend", suggestion: "Create tests/backend directory for admin tests" },
      { path: "tests/frontend", suggestion: "Create tests/frontend directory for public site tests" },
      { path: "tests/utils", suggestion: "Create tests/utils directory for shared playwright-utils" },
      { path: "snapshots/backend", suggestion: "Create snapshots/backend directory for backend VRT baselines" },
      { path: "snapshots/frontend", suggestion: "Create snapshots/frontend directory for frontend VRT baselines" },
    ];

    for (const dir of requiredDirs) {
      const dirPath = join(testDir, dir.path);
      if (!existsSync(dirPath)) {
        result.valid = false;
        result.issues.push(`Missing required directory: ${dir.path}`);
        result.suggestions.push(dir.suggestion);
      }
    }

    // Check if settings.json exists
    const settingsPath = join(testDir, "settings.json");
    if (!existsSync(settingsPath)) {
      result.issues.push("settings.json not found");
      result.suggestions.push("Create settings.json with SitefinityUrl and BackendCredentials, or copy from parent project");
    }

    // Check if node_modules exists (dependencies installed)
    const nodeModulesPath = join(testDir, "node_modules");
    if (!existsSync(nodeModulesPath)) {
      result.issues.push("node_modules not found - dependencies not installed");
      result.suggestions.push("Run 'npm install' in the sitefinity-tests directory");
    }

    // Generate summary
    if (result.valid) {
      result.summary = "Test directory structure is valid and ready for use.";
    } else {
      result.summary = `Found ${result.issues.length} issue(s) that need attention.`;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    result.valid = false;
    result.issues.push(error instanceof Error ? error.message : String(error));
    result.summary = "Validation failed with errors.";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }
}

// ============================================================================
// File Templates
// ============================================================================

function getPlaywrightConfigTemplate(): string {
  return `import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Sitefinity Connection Configuration
 */
interface SitefinityConnection {
  SitefinityUrl: string;
  BackendCredentials?: {
    username: string;
    password: string;
  };
}

/**
 * Load Sitefinity URL from settings.json in the test directory
 */
function getSitefinityConfig(): { baseUrl: string; credentials: { username: string; password: string } } {
  try {
    const settingsPath = path.join(__dirname, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const connection: SitefinityConnection = JSON.parse(content);
      
      const baseUrl = connection.SitefinityUrl?.replace(/\\/$/, '') || 'http://localhost:18009';
      const credentials = connection.BackendCredentials || {
        username: 'admin@test.test',
        password: 'admin@2'
      };
      
      return { baseUrl, credentials };
    }
  } catch (error) {
    console.warn('Could not load settings.json:', error);
  }
  
  // Fallback to environment variables or defaults
  return {
    baseUrl: process.env.SITE_URL || 'http://localhost:18009',
    credentials: {
      username: process.env.ADMIN_USER || 'admin@test.test',
      password: process.env.ADMIN_PASS || 'admin@2'
    }
  };
}

const config = getSitefinityConfig();

/**
 * Sitefinity Upgrade Verification - Playwright Configuration
 * 
 * IMPORTANT: Backend tests MUST run with a single worker due to Sitefinity's 
 * single-session-per-user restriction. Multiple concurrent logins will cause
 * "User already logged in" errors and session conflicts.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1, // CRITICAL: Force single worker globally for Sitefinity session safety
  timeout: 90000,
  outputDir: 'test-artifacts',
  grep: process.env.GREP ? new RegExp(process.env.GREP) : undefined,
  /* Skip @external-tagged tests unless explicitly included via GREP */
  grepInvert: process.env.GREP ? undefined : /@external/,
  maxFailures: process.env.CI ? 10 : undefined,
  
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],
  
  use: {
    baseURL: config.baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20000,
    navigationTimeout: 45000,
  },

  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\\.spec\\.ts/,
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'vrt-backend',
      testDir: './tests/backend',
      testMatch: /-vrt\\.spec\\.ts$/,
      snapshotPathTemplate: './snapshots/backend/{testFilePath}-snapshots/{arg}{ext}',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
      fullyParallel: false,
    },
    {
      name: 'backend-chromium',
      testDir: './tests/backend',
      testIgnore: /-vrt\\.spec\\.ts$/,
      snapshotPathTemplate: './snapshots/backend/{testFilePath}-snapshots/{arg}{ext}',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
      fullyParallel: false,
    },
    {
      name: 'frontend-chromium', 
      testDir: './tests/frontend',
      snapshotPathTemplate: './snapshots/frontend/{testFilePath}-snapshots/{arg}{ext}',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
      fullyParallel: true,
    }
  ],
  
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 30000,
      threshold: 0.02,
    },
    timeout: 15000, // 15s default for expect assertions (screenshots can be slow)
  },
});
`;
}

function getPackageJsonTemplate(): string {
  return `{
  "name": "sitefinity-upgrade-tests",
  "version": "1.0.0",
  "description": "Comprehensive Playwright test suite for Sitefinity CMS upgrade verification",
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:backend": "playwright test --project=backend-chromium",
    "test:frontend": "playwright test --project=frontend-chromium",
    "test:vrt:backend": "playwright test --project=vrt-backend",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "test:debug": "playwright test --debug",
    "show-report": "playwright show-report",
    "update-snapshots:backend": "playwright test --project=vrt-backend --update-snapshots",
    "update-snapshots": "playwright test --update-snapshots"
  },
  "keywords": [
    "sitefinity",
    "playwright",
    "testing",
    "e2e",
    "upgrade",
    "verification"
  ],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@playwright/test": "^1.41.0",
    "@types/node": "^20.11.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
`;
}

function getGitignoreTemplate(): string {
  return `# Playwright artifacts
test-results/
test-artifacts/
playwright-report/
playwright/.cache/

# Credentials - NEVER commit settings.json with real credentials!
settings.json

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Dependencies
node_modules/

# Environment
.env
.env.local
`;
}

function getReadmeTemplate(): string {
  return `# Sitefinity Upgrade Verification Tests

Comprehensive Playwright test suite for verifying Sitefinity CMS upgrades.

## Quick Start

1. Install dependencies:
\`\`\`bash
npm install
npx playwright install
\`\`\`

2. Configure your Sitefinity connection in \`settings.json\`:
\`\`\`json
{
  "SitefinityUrl": "https://your-site.com",
  "BackendCredentials": {
    "username": "admin@test.test",
    "password": "admin@2"
  }
}
\`\`\`

3. Run tests:
\`\`\`bash
npm test                    # Run all tests
npm run test:backend        # Backend functional tests only
npm run test:frontend       # Frontend tests (VRT + interactions)
npm run test:vrt:backend    # Backend VRT tests only
\`\`\`

4. Update visual regression snapshots:
\`\`\`bash
npm run update-snapshots:backend  # Regenerate backend VRT snapshots only
npm run update-snapshots          # Regenerate all snapshots (backend + frontend)
\`\`\`

## Test Structure

### Backend File Naming Convention
- **VRT tests** (Visual Regression): Backend files ending with \`-vrt.spec.ts\` contain ONLY screenshot tests
  - Example: \`dashboard-vrt.spec.ts\`, \`content-module-vrt.spec.ts\`
  - Matched by \`vrt-backend\` project for selective snapshot regeneration
  - Organize per module/feature (not one monolithic file)
- **Functional tests**: Backend files ending with \`.spec.ts\` (no \`-vrt\`) contain interaction and assertion tests
  - Example: \`auth.spec.ts\`, \`content.spec.ts\`
  - Matched by \`backend-chromium\` project

### Frontend File Naming
- **No special naming required** - Frontend tests freely mix VRT + interactions
- Example: \`homepage.spec.ts\` can contain navigation, interactions, AND screenshots
- All matched by \`frontend-chromium\` project

### Directory Structure
- \`tests/backend/\` - Admin panel tests (authentication, content management, VRT)
- \`tests/frontend/\` - Public site tests (pages, navigation, interactions, VRT)
- \`tests/utils/\` - Shared Playwright utilities (screenshot helpers, stable navigation, overlay handling)
- \`snapshots/backend/\` - Backend visual regression baselines
- \`snapshots/frontend/\` - Frontend visual regression baselines

## Shared Utilities (tests/utils/playwright-utils.ts)

Import helpers for resilient navigation and screenshots:

\`\`\`typescript
import {
  gotoStable,
  stabilizeForScreenshot,
  takeStableScreenshot,
  hideScrollbars,
  waitForImagesToLoad,
  assertEndpoint,
  EXTERNAL_TAG,
} from '../utils/playwright-utils';
\`\`\`

### Key helpers
- **\`gotoStable(page, url)\`** - Navigate with networkidle + image wait + overlay dismiss
- **\`stabilizeForScreenshot(page)\`** - Stop carousels + hide scrollbars + wait for images
- **\`takeStableScreenshot(page, name)\`** - Full stabilization + \`toHaveScreenshot\`
- **\`assertEndpoint(request, url)\`** - Test non-HTML endpoints (sitemap, robots.txt)
- **\`EXTERNAL_TAG\`** - Tag tests that hit external sites (skipped by default)

### Environment variables
- \`ENABLE_TRIAL_HANDLING=false\` - Disable Sitefinity trial screen auto-dismiss
- \`GREP="@external"\` - Include external-tagged tests in the run

## Documentation

See README.md for full documentation.
`;
}

function getSmokeTestTemplate(): string {
  return `import { test, expect, request as playwrightRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { assertEndpoint, gotoStable, stabilizeForScreenshot } from './utils/playwright-utils';

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
`;
}

function getPlaywrightUtilsTemplate(): string {
  return `import { expect, Page } from '@playwright/test';

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
 * Best-effort: gives up after timeout ms without throwing.
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
    console.log('waitForImagesToLoad timed out – proceeding anyway');
  }
}

// ============================================================================
// Overlay / Trial-Screen Handling (Sitefinity-specific, env-gated)
// ============================================================================

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

export async function dismissSitefinityTrialScreen(page: Page): Promise<boolean> {
  if (!TRIAL_HANDLING_ENABLED) return false;
  try {
    const isTrialScreen = await isSitefinityTrialScreenVisible(page);
    if (!isTrialScreen) return false;

    console.log('Sitefinity trial screen detected, dismissing...');

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
 *  1. page.goto -> domcontentloaded
 *  2. best-effort networkidle wait
 *  3. dismiss transient overlays
 *  4. wait for images to finish loading
 */
export async function gotoStable(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1]
): Promise<Awaited<ReturnType<Page['goto']>>> {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', ...options });
  await page.waitForLoadState('networkidle').catch(() => {});
  await dismissSitefinityTrialScreen(page);
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
      console.log(\`Overlay dismissed, retrying selector wait (\${attempt}/\${maxRetries})\`);
    }
  }
}

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
      console.log(\`Overlay dismissed, retrying visibility check (\${attempt}/\${maxRetries})\`);
    }
  }
}

// ============================================================================
// Screenshot Stabilization
// ============================================================================

/**
 * Hide scrollbars for consistent viewport width during VRT screenshots.
 */
export async function hideScrollbars(page: Page): Promise<void> {
  await page.addStyleTag({
    content: \`
      html, body, * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
    \`,
  });
}

/**
 * Stop all carousels/sliders and reset to the first slide for consistent VRT.
 */
export async function stopCarousels(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.carousel').forEach((carousel: any) => {
      if (typeof carousel.pause === 'function') carousel.pause();
      const firstSlide = carousel.querySelector('.carousel-item');
      if (firstSlide) {
        carousel.querySelectorAll('.carousel-item').forEach((item: any) => item.classList.remove('active'));
        firstSlide.classList.add('active');
      }
    });
    document.querySelectorAll('.slick-slider').forEach((slider: any) => {
      if (slider?.slick) {
        slider.slick.slickPause();
        slider.slick.slickGoTo(0);
      }
    });
    document.querySelectorAll('[data-ride="carousel"], [data-autoplay="true"]').forEach((el: any) => {
      if (el.pause) el.pause();
      el.style.animationPlayState = 'paused';
    });
  });
}

/**
 * Full stabilization before a VRT screenshot.
 */
export async function stabilizeForScreenshot(page: Page): Promise<void> {
  await stopCarousels(page);
  await hideScrollbars(page);
  await waitForImagesToLoad(page);
  await page.waitForTimeout(300);
}

/**
 * Take a full-page screenshot with all stabilization applied.
 */
export async function takeStableScreenshot(
  page: Page,
  name: string,
  options?: Record<string, unknown>
): Promise<void> {
  await stabilizeForScreenshot(page);
  await expect(page).toHaveScreenshot(name, { fullPage: true, ...options });
}

// ============================================================================
// Non-UI Endpoint Testing
// ============================================================================

/**
 * Assert that an HTTP endpoint responds successfully and optionally contains expected text.
 * Uses the Playwright request context — no browser rendering.
 *
 * Example:
 *   await assertEndpoint(request, '/sitemap/sitemap.xml', { containsText: '<?xml' });
 */
export async function assertEndpoint(
  request: { get: (url: string, options?: object) => Promise<{ status: () => number; text: () => Promise<string> }> },
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
 * Tag for tests that navigate to external content.
 * Tests tagged @external are skipped by default.
 * To run them: GREP="@external" npx playwright test
 */
export const EXTERNAL_TAG = '@external';
`;
}
