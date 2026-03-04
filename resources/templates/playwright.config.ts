import { defineConfig, devices } from '@playwright/test';
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
      
      const baseUrl = connection.SitefinityUrl?.replace(/\/$/, '') || 'http://localhost:18009';
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
 * Backend tests authenticate via the ensureAuthFile() mutex in tests/backend/utils.ts.
 * A single login is performed per 30-minute window and the session is shared across
 * all workers via storageState — no per-test login overhead, safe for parallel execution.
 * 
 * Frontend tests do not require authentication and run fully in parallel.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Projects override this individually
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined, // Let projects control workers, CI uses 1 for stability
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
      testMatch: /smoke\.spec\.ts/,
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'vrt-backend',
      testDir: './tests/backend',
      testMatch: /-vrt\.spec\.ts$/,
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
      testIgnore: /-vrt\.spec\.ts$/,
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
