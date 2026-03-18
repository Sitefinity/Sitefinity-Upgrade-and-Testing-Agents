import {
  existsSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename_handler = fileURLToPath(import.meta.url);
const __dirname_handler = dirname(__filename_handler);
const PROJECT_ROOT = join(__dirname_handler, "..", ".."); // mcp-server/handlers/ → root

interface SeedResult {
  success: boolean;
  copiedUtils: string[];
  copiedSpecs: string[];
  errors: string[];
  summary: string;
}

/**
 * Copy a single file from src to dest, creating directories as needed.
 */
function copyFile(
  src: string,
  dest: string,
  label: string,
  list: string[],
  errors: string[]
): void {
  if (!existsSync(src)) return;
  try {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    list.push(label);
  } catch (err) {
    errors.push(
      `Could not copy ${label}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Recursively copy all files from srcDir into destDir.
 */
function copyDirContents(
  srcDir: string,
  destDir: string,
  list: string[],
  errors: string[],
  labelPrefix: string
): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });

  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirContents(srcPath, destPath, list, errors, `${labelPrefix}${entry.name}/`);
    } else if (entry.isFile()) {
      copyFile(srcPath, destPath, `${labelPrefix}${entry.name}`, list, errors);
    }
  }
}

/**
 * Read a spec file and wrap every `test(` / `test.skip(` call (but NOT already-fixme ones)
 * with `test.fixme(` so the tests are skipped during the extension healing run.
 *
 * Specifically replaces:
 *   test('...',           → test.fixme('...',
 *   test("...",           → test.fixme("...",
 *   test(`...`,           → test.fixme(`...`,
 *
 * Does NOT touch:
 *   test.describe(
 *   test.fixme(           (already marked)
 *   test.skip(
 *   test.only(
 *   test.beforeAll( etc.
 */
function markSpecAsFixme(content: string): string {
  // Match `test(` that is NOT preceded by a dot (i.e., not test.anything)
  // Also match `test.skip(` → convert to `test.fixme(`
  return content
    .replace(/\btest\.skip\s*\(/g, "test.fixme(")
    .replace(/(?<!\.)(\btest)\s*\((?=\s*['"`])/g, "test.fixme(");
}

export async function seedTestWorkspaceHandler(args: {
  sourceTestsDir: string;
  specsToExtend?: string[] | undefined;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
  const result: SeedResult = {
    success: true,
    copiedUtils: [],
    copiedSpecs: [],
    errors: [],
    summary: "",
  };

  const { sourceTestsDir, specsToExtend = [] } = args;

  // ── Guard: source directory must already exist ────────────────────────────
  if (!existsSync(sourceTestsDir)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: `Source test directory does not exist: ${sourceTestsDir}. Please verify the path.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // ── 1. Copy utils from source project into upgrade-and-testing ────────────
  // frontend/utils.ts
  copyFile(
    join(sourceTestsDir, "tests", "frontend", "utils.ts"),
    join(PROJECT_ROOT, "tests", "frontend", "utils.ts"),
    "tests/frontend/utils.ts",
    result.copiedUtils,
    result.errors
  );

  // backend/utils.ts
  copyFile(
    join(sourceTestsDir, "tests", "backend", "utils.ts"),
    join(PROJECT_ROOT, "tests", "backend", "utils.ts"),
    "tests/backend/utils.ts",
    result.copiedUtils,
    result.errors
  );

  // tests/utils/ (shared utilities like playwright-utils.ts)
  copyDirContents(
    join(sourceTestsDir, "tests", "utils"),
    join(PROJECT_ROOT, "tests", "utils"),
    result.copiedUtils,
    result.errors,
    "tests/utils/"
  );

  // ── 2. Copy flagged spec files (with tests marked as fixme) ───────────────
  for (const specRelPath of specsToExtend) {
    // specRelPath can be e.g. "frontend/homepage.spec.ts" or "backend/content-nav-vrt.spec.ts"
    const srcPath = join(sourceTestsDir, "tests", specRelPath);
    const destPath = join(PROJECT_ROOT, "tests", specRelPath);

    if (!existsSync(srcPath)) {
      result.errors.push(`Spec not found in source: ${specRelPath}`);
      continue;
    }

    try {
      const originalContent = readFileSync(srcPath, "utf-8");
      const fixmeContent = markSpecAsFixme(originalContent);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, fixmeContent, "utf-8");
      result.copiedSpecs.push(`${specRelPath} (tests marked as fixme)`);
    } catch (err) {
      result.errors.push(
        `Could not process ${specRelPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  result.success = result.errors.length === 0;
  result.summary = result.success
    ? `Workspace seeded. ${result.copiedUtils.length} util file(s) copied, ${result.copiedSpecs.length} spec file(s) copied with tests marked as fixme.`
    : `Seeding completed with ${result.errors.length} error(s). ${result.copiedUtils.length} util(s) and ${result.copiedSpecs.length} spec(s) copied. Review the errors array for details.`;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
