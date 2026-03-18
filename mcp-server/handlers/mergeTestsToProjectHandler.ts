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

interface MergeResult {
  success: boolean;
  copied: string[];
  skipped: string[];
  errors: string[];
  summary: string;
}

/**
 * Recursively copy all files from srcDir into destDir, overwriting existing
 * files.  Sub-directories are created as needed.
 */
function copyDirContents(
  srcDir: string,
  destDir: string,
  result: MergeResult,
  labelPrefix: string
): void {
  if (!existsSync(srcDir)) return;

  mkdirSync(destDir, { recursive: true });

  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirContents(srcPath, destPath, result, `${labelPrefix}${entry.name}/`);
    } else if (entry.isFile()) {
      try {
        copyFileSync(srcPath, destPath);
        result.copied.push(`${labelPrefix}${entry.name}`);
      } catch (err) {
        result.errors.push(
          `Could not copy ${srcPath} → ${destPath}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}

/**
 * Copy only *.spec.ts files from srcDir into destDir.
 * Any test.fixme( calls that were injected by seed_test_workspace are
 * converted back to test( so all tests run normally in the target project.
 */
function copySpecFiles(
  srcDir: string,
  destDir: string,
  result: MergeResult,
  labelPrefix: string
): void {
  if (!existsSync(srcDir)) return;

  mkdirSync(destDir, { recursive: true });

  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);
      try {
        const content = readFileSync(srcPath, "utf-8");
        // Strip fixme markers that were added by seed_test_workspace
        const restored = content.replace(/\btest\.fixme\s*\(/g, "test(");
        writeFileSync(destPath, restored, "utf-8");
        result.copied.push(`${labelPrefix}${entry.name}`);
      } catch (err) {
        result.errors.push(
          `Could not copy ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
}

export async function mergeTestsToProjectHandler(args: {
  targetTestsDir: string;
}): Promise<{ content: [{ type: "text"; text: string }] }> {
  const result: MergeResult = {
    success: true,
    copied: [],
    skipped: [],
    errors: [],
    summary: "",
  };

  const { targetTestsDir } = args;

  // ── Guard: target directory must already exist ────────────────────────────
  if (!existsSync(targetTestsDir)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: `Target directory does not exist: ${targetTestsDir}. Please verify the path and try again.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // ── 1. Copy frontend spec files ───────────────────────────────────────────
  copySpecFiles(
    join(PROJECT_ROOT, "tests", "frontend"),
    join(targetTestsDir, "tests", "frontend"),
    result,
    "tests/frontend/"
  );

  // ── 2. Copy backend spec files ────────────────────────────────────────────
  copySpecFiles(
    join(PROJECT_ROOT, "tests", "backend"),
    join(targetTestsDir, "tests", "backend"),
    result,
    "tests/backend/"
  );

  // ── 3. Copy utility files (frontend/utils.ts, backend/utils.ts, utils/) ───
  // These may have been updated by the test healer and should be kept in sync.
  const utilsToSync = [
    { src: join(PROJECT_ROOT, "tests", "frontend", "utils.ts"), dest: join(targetTestsDir, "tests", "frontend", "utils.ts"), label: "tests/frontend/utils.ts" },
    { src: join(PROJECT_ROOT, "tests", "backend", "utils.ts"),  dest: join(targetTestsDir, "tests", "backend", "utils.ts"),  label: "tests/backend/utils.ts"  },
  ];

  for (const f of utilsToSync) {
    if (existsSync(f.src)) {
      try {
        mkdirSync(dirname(f.dest), { recursive: true });
        copyFileSync(f.src, f.dest);
        result.copied.push(f.label);
      } catch (err) {
        result.errors.push(
          `Could not copy ${f.label}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Copy the shared utils sub-directory (playwright-utils.ts etc.)
  copyDirContents(
    join(PROJECT_ROOT, "tests", "utils"),
    join(targetTestsDir, "tests", "utils"),
    result,
    "tests/utils/"
  );

  // ── 4. Copy frontend snapshots ────────────────────────────────────────────
  copyDirContents(
    join(PROJECT_ROOT, "snapshots", "frontend"),
    join(targetTestsDir, "snapshots", "frontend"),
    result,
    "snapshots/frontend/"
  );

  // ── 5. Copy backend snapshots ─────────────────────────────────────────────
  copyDirContents(
    join(PROJECT_ROOT, "snapshots", "backend"),
    join(targetTestsDir, "snapshots", "backend"),
    result,
    "snapshots/backend/"
  );

  result.success = result.errors.length === 0;
  result.summary = result.success
    ? `Merge complete. ${result.copied.length} file(s) copied to ${targetTestsDir}.`
    : `Merge completed with ${result.errors.length} error(s). ${result.copied.length} file(s) were copied successfully. Review the errors array for details.`;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

