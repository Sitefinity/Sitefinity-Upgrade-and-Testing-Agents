import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadUpgradeSettings } from "../util.js";

/**
 * Test Directory Management Handlers
 * Tools for scaffolding and validating Sitefinity test directory structure
 *
 * Templates live as real files under resources/templates/ for full IDE support.
 * Tests and utils are copied from the source tests/ directory; the backend
 * utils.ts is context-aware and resolves settings.json first, then falls back
 * to the workspace file, so no post-copy patching is needed.
 */

// Resolve project root paths once
const __filename_handler = fileURLToPath(import.meta.url);
const __dirname_handler = dirname(__filename_handler);
const PROJECT_ROOT = join(__dirname_handler, "..", ".."); // mcp-server/handlers/ → root
const TEMPLATES_DIR = join(PROJECT_ROOT, "resources", "templates");

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

/**
 * Copy a template file from resources/templates/ to the target directory.
 * Supports renaming (e.g. "gitignore" → ".gitignore").
 */
function copyTemplate(
  testDir: string,
  templateName: string,
  destName: string,
  result: ScaffoldResult
): void {
  const srcPath = join(TEMPLATES_DIR, templateName);
  const destPath = join(testDir, destName);

  if (existsSync(destPath)) {
    result.skipped.push(`${destName} (already exists)`);
    return;
  }

  if (!existsSync(srcPath)) {
    result.errors.push(`Template not found: ${templateName}`);
    return;
  }

  copyFileSync(srcPath, destPath);
  result.created.push(destName);
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

    // Copy template files from resources/templates/
    copyTemplate(testDir, "playwright.config.ts", "playwright.config.ts", result);
    copyTemplate(testDir, "package.json", "package.json", result);
    copyTemplate(testDir, "README.md", "README.md", result);
    copyTemplate(testDir, "gitignore", ".gitignore", result); // renamed on copy
    copyTemplate(testDir, "smoke.spec.ts", join("tests", "smoke.spec.ts"), result);

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

    // Copy tests/ directory (backend/frontend tests and shared utils)
    const sourceTestsPath = join(PROJECT_ROOT, "tests");
    const destTestsPath = join(testDir, "tests");
    if (existsSync(sourceTestsPath)) {
      try {
        cpSync(sourceTestsPath, destTestsPath, {
          recursive: true,
          force: false, // Don't overwrite existing files
          errorOnExist: false
        });
        result.created.push("tests/ (copied tests from upgrade-and-testing)");
      } catch (error) {
        // If files already exist, that's okay
        result.skipped.push("tests/ (some or all files already exist)");
      }
    }

    // Copy snapshots/ directory (frontend and backend baselines)
    const sourceSnapshotsPath = join(PROJECT_ROOT, "snapshots");
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
