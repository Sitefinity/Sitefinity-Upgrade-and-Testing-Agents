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
 * Load Sitefinity configuration from upgrade-and-testing.code-workspace settings.sf_agents
 */
function loadSitefinityConfig(): { sitefinityUrl: string; backendCredentials: { username: string; password: string } } | null {
  try {
    const workspacePath = path.join(__dirname, 'upgrade-and-testing.code-workspace');
    if (fs.existsSync(workspacePath)) {
      let content = fs.readFileSync(workspacePath, 'utf-8');
      // Remove BOM if present
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      // Strip JSON comments (// and /* */) - only match // at start of lines, not in URLs
      content = content.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const workspace = JSON.parse(content);
      const sfAgents = workspace?.settings?.sf_agents;
      
      if (sfAgents) {
        const baseUrl = sfAgents.SitefinityUrl?.replace(/\/$/, '') || 'http://localhost';
        const credentials = sfAgents.BackendCredentials || {
          username: 'admin@test.test',
          password: 'admin@2'
        };
        return { sitefinityUrl: baseUrl, backendCredentials: credentials };
      }
    }
  } catch (error) {
    console.warn('Could not load workspace settings:', error);
  }
  
  return {
    sitefinityUrl: process.env.SITE_URL || 'http://localhost',
    backendCredentials: {
      username: process.env.ADMIN_USER || 'admin@test.test',
      password: process.env.ADMIN_PASS || 'admin@2'
    }
  };
}

const config = loadSitefinityConfig();

/**
 * Sitefinity Upgrade Verification - Playwright Configuration
 * 
 * IMPORTANT: Backend tests MUST run with a single worker due to Sitefinity's 
 * single-session-per-user restriction. Multiple concurrent logins will cause
 * "User already logged in" errors and session conflicts.
 * 
 * Frontend tests can use multiple workers for faster execution.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // Projects override this individually
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1, // Retry once for flaky tests
  workers: process.env.CI ? 1 : undefined, // Let projects control workers, CI uses 1 for stability
  timeout: 90000, // 90s per test timeout - increased for session handling
  outputDir: 'test-artifacts',
  grep: process.env.GREP ? new RegExp(process.env.GREP) : undefined,
  /* Skip @external-tagged tests unless explicitly included via GREP */
  grepInvert: process.env.GREP ? undefined : /@external/,
  maxFailures: process.env.CI ? 10 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'on-failure' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],
  
  use: {
    baseURL: config?.sitefinityUrl || 'http://localhost',
    trace: 'on-first-retry', // Capture traces on first retry to aid debugging
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20000, // 20s timeout for actions - increased for slow admin pages
    navigationTimeout: 45000, // 45s timeout for page loads - admin can be slow
  },

  projects: [
    {
      name: 'backend-chromium',
      testDir: './tests/backend',
      snapshotPathTemplate: './snapshots/backend/{testFilePath}-snapshots/{arg}{ext}',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
      // CRITICAL: Backend tests MUST run sequentially with single worker
      // Sitefinity only allows one active session per user account
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
      // Frontend tests can run in parallel - they don't require authentication
      // Uses 50% of CPU cores by default (e.g., 4 workers on 8-core machine)
      fullyParallel: true,
    },
    {
      name: 'vrt-backend',
      testDir: './tests/backend',
      testMatch: '**/*vrt*.spec.ts', // Match all backend tests with 'vrt' in the name
      snapshotPathTemplate: './snapshots/backend/{testFilePath}-snapshots/{arg}{ext}',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
      // VRT snapshots should be generated sequentially for consistency
      fullyParallel: false,
    }
  ],
  
  /* Expect settings for visual comparisons */
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 30000,
      threshold: 0.05, // 5% difference allowed for dynamic content
    },
    timeout: 15000, // 15s default for expect assertions (screenshots can be slow)
  },
});
