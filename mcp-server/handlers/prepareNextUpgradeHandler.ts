import {
  existsSync,
  readdirSync,
  rmSync,
  copyFileSync,
  mkdirSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename_handler = fileURLToPath(import.meta.url);
const __dirname_handler = dirname(__filename_handler);
const PROJECT_ROOT = join(__dirname_handler, "..", ".."); // mcp-server/handlers/ → root
const DEFAULTS_DIR = join(PROJECT_ROOT, "resources", "defaults");

interface PrepareResult {
  success: boolean;
  deleted: string[];
  restored: string[];
  cleared: string[];
  errors: string[];
  manualSteps: string[];
  summary: string;
}

/**
 * Delete all files (non-recursively) inside a directory that match an optional
 * filter. Sub-directories are also removed when removeSubDirs = true.
 */
function clearDirectory(
  dirPath: string,
  result: PrepareResult,
  label: string,
  removeSubDirs = true
): void {
  if (!existsSync(dirPath)) return;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    try {
      rmSync(fullPath, { recursive: true, force: true });
    } catch (err) {
      result.errors.push(
        `Could not delete ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  result.cleared.push(label);
}

/**
 * Delete all *.spec.ts files inside a directory (non-recursive).
 */
function deleteSpecFiles(dirPath: string, result: PrepareResult): void {
  if (!existsSync(dirPath)) return;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      const fullPath = join(dirPath, entry.name);
      try {
        rmSync(fullPath, { force: true });
        result.deleted.push(`${dirPath.replace(PROJECT_ROOT, ".")}/${entry.name}`);
      } catch (err) {
        result.errors.push(
          `Could not delete ${fullPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}

/**
 * Restore a file from resources/defaults/ to its live location,
 * overwriting whatever is there.
 */
function restoreDefault(
  relativePath: string,
  result: PrepareResult
): void {
  const srcPath = join(DEFAULTS_DIR, relativePath);
  const destPath = join(PROJECT_ROOT, relativePath);

  if (!existsSync(srcPath)) {
    result.errors.push(`Default not found, skipping restore: resources/defaults/${relativePath}`);
    return;
  }

  try {
    mkdirSync(dirname(destPath), { recursive: true });
    copyFileSync(srcPath, destPath);
    result.restored.push(relativePath);
  } catch (err) {
    result.errors.push(
      `Could not restore ${relativePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function prepareNextUpgradeHandler(): Promise<{
  content: [{ type: "text"; text: string }];
}> {
  const result: PrepareResult = {
    success: true,
    deleted: [],
    restored: [],
    cleared: [],
    errors: [],
    manualSteps: [
      "Update 'upgrade-and-testing.code-workspace': change the Source Project path to point to the new Sitefinity project.",
    ],
    summary: "",
  };

  // ── 1. Delete generated spec files ────────────────────────────────────────
  deleteSpecFiles(join(PROJECT_ROOT, "tests", "frontend"), result);
  deleteSpecFiles(join(PROJECT_ROOT, "tests", "backend"), result);

  // ── 2. Restore utils to clean defaults ────────────────────────────────────
  restoreDefault("tests/frontend/utils.ts", result);
  restoreDefault("tests/backend/utils.ts", result);
  restoreDefault("tests/utils/playwright-utils.ts", result);

  // ── 3. Restore test plans to clean defaults ────────────────────────────────
  restoreDefault("test-plans/frontend/plan.md", result);
  restoreDefault("test-plans/backend/plan.md", result);

  // ── 4. Clear output / artifact directories ────────────────────────────────
  clearDirectory(join(PROJECT_ROOT, "test-artifacts"), result, "test-artifacts/");
  clearDirectory(join(PROJECT_ROOT, "test-results"), result, "test-results/");
  clearDirectory(join(PROJECT_ROOT, "playwright-report"), result, "playwright-report/");
  clearDirectory(join(PROJECT_ROOT, "logs"), result, "logs/");

  // ── 5. Delete .playwright-mcp/ (browser session screenshots) ─────────────
  const playwrightMcpDir = join(PROJECT_ROOT, ".playwright-mcp");
  if (existsSync(playwrightMcpDir)) {
    try {
      rmSync(playwrightMcpDir, { recursive: true, force: true });
      result.deleted.push(".playwright-mcp/");
    } catch (err) {
      result.errors.push(
        `.playwright-mcp/ could not be deleted: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── 6. Snapshot directories – delete contents (keep dir structure) ─────────
  // Snapshots are regenerated per-project by the test generator / healer.
  clearDirectory(join(PROJECT_ROOT, "snapshots", "frontend"), result, "snapshots/frontend/");
  clearDirectory(join(PROJECT_ROOT, "snapshots", "backend"), result, "snapshots/backend/");

  result.success = result.errors.length === 0;
  result.summary = result.success
    ? `Workspace successfully reset for the next upgrade. ${result.deleted.length} spec file(s) deleted, ${result.restored.length} file(s) restored from defaults, ${result.cleared.length} director(ies) cleared.`
    : `Reset completed with ${result.errors.length} error(s). Review the errors array for details.`;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
