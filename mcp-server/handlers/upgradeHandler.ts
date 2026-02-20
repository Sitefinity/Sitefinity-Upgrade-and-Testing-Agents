import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, mkdirSync, createWriteStream, rmSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { get } from "https";
import { loadUpgradeSettings } from "../util.js";

const execAsync = promisify(exec);

// ============================================================================
// Constants
// ============================================================================

/**
 * Relative path to the upgrade log file from MCP server root
 */
const UPGRADE_LOG_RELATIVE_PATH = "logs/sitefinity-cli-upgrade.log";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Locates MSBuild.exe by searching Visual Studio installations
 */
async function locateMSBuild(): Promise<string | null> {
  const vsVersions = ["2022", "2019", "2017"];
  const vsEditions = ["Enterprise", "Professional", "Community", "BuildTools"];

  // Search standard VS installation paths
  for (const version of vsVersions) {
    for (const edition of vsEditions) {
      const currentPath = `C:\\Program Files\\Microsoft Visual Studio\\${version}\\${edition}\\MSBuild\\Current\\Bin\\MSBuild.exe`;
      if (existsSync(currentPath)) {
        return currentPath;
      }
      // VS 2017 uses different path structure
      const legacyPath = `C:\\Program Files (x86)\\Microsoft Visual Studio\\${version}\\${edition}\\MSBuild\\15.0\\Bin\\MSBuild.exe`;
      if (existsSync(legacyPath)) {
        return legacyPath;
      }
    }
  }

  // Fallback: Try vswhere
  const vswherePath = `${process.env["ProgramFiles(x86)"]}\\Microsoft Visual Studio\\Installer\\vswhere.exe`;
  if (existsSync(vswherePath)) {
    try {
      const { stdout } = await execAsync(
        `"${vswherePath}" -latest -products * -requires Microsoft.Component.MSBuild -property installationPath`,
        { shell: "cmd.exe" }
      );
      const installPath = stdout.trim();
      if (installPath) {
        const msbuildPath = join(installPath, "MSBuild\\Current\\Bin\\MSBuild.exe");
        if (existsSync(msbuildPath)) {
          return msbuildPath;
        }
      }
    } catch {
      // vswhere failed, continue to return null
    }
  }

  return null;
}

/**
 * Locates nuget.exe or downloads it if not found
 */
async function locateOrDownloadNuget(projectPath: string): Promise<string | null> {
  const searchPaths = [
    join(projectPath, "tools", "nuget.exe"),
    join(projectPath, ".nuget", "nuget.exe"),
    join(process.env.LOCALAPPDATA || "", "NuGet", "nuget.exe"),
    join(process.env.ChocolateyInstall || "", "bin", "nuget.exe"),
  ];

  for (const searchPath of searchPaths) {
    if (searchPath && existsSync(searchPath)) {
      return searchPath;
    }
  }

  // Download nuget.exe to project tools folder
  const toolsDir = join(projectPath, "tools");
  if (!existsSync(toolsDir)) {
    mkdirSync(toolsDir, { recursive: true });
  }

  const nugetPath = join(toolsDir, "nuget.exe");
  
  try {
    await downloadFile("https://dist.nuget.org/win-x86-commandline/latest/nuget.exe", nugetPath);
    return nugetPath;
  } catch {
    return null;
  }
}

/**
 * Downloads a file from URL to destination path
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }
      
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      reject(err);
    });
  });
}

/**
 * Finds the solution file in the project path
 */
function findSolutionFile(projectPath: string): string | null {
  try {
    const files = readdirSync(projectPath);
    const slnFile = files.find((f) => f.endsWith(".sln"));
    return slnFile ? join(projectPath, slnFile) : null;
  } catch {
    return null;
  }
}

/**
 * Gets the absolute path to the upgrade log file
 * Resolves from src/handlers/ to MCP server root, then applies the relative log path
 */
function getUpgradeLogPath(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const mcpServerRoot = join(__dirname, "..", ".."); // From src/handlers/ to root
  return join(mcpServerRoot, UPGRADE_LOG_RELATIVE_PATH);
}

/**
 * Writes upgrade output to log file in the MCP server workspace
 * Log location: {mcpServerRoot}/logs/sitefinity-cli-upgrade.log
 */
function writeUpgradeLog(content: string): void {
  try {
    const logFilePath = getUpgradeLogPath();
    const logsDir = dirname(logFilePath);
    
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    
    writeFileSync(logFilePath, content, "utf-8");
  } catch (logError) {
    // Silently fail if logging fails - don't let it break the upgrade process
    console.error("Failed to write upgrade log:", logError);
  }
}

// ============================================================================
// MCP Tool Handlers
// ============================================================================

export interface UpgradeSettings {
  sourcePath: string;
  targetVersion: string;
  sourceVersion: string;
  solutionPath: string | null;
  sitefinityUrl: string;
  backendCredentials?: {
    username: string;
    password: string;
  };
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  errors?: string[];
  warnings?: string[];
}

/**
 * Handler for get_upgrade_settings tool
 * Returns project settings and discovers solution path
 */
export async function getUpgradeSettingsHandler(): Promise<{
  content: Array<{ type: "text"; text: string }>;
}> {
  try {
    const settings = loadUpgradeSettings();
    
    if (!settings.SourceFilesPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "SourceFilesPath not configured in workspace settings.sf_agents"
        }, null, 2) }],
      };
    }

    if (!existsSync(settings.SourceFilesPath)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `SourceFilesPath does not exist: ${settings.SourceFilesPath}`
        }, null, 2) }],
      };
    }

    const solutionPath = findSolutionFile(settings.SourceFilesPath);

    const result: UpgradeSettings = {
      sourcePath: settings.SourceFilesPath,
      targetVersion: settings.TargetVersion || "",
      sourceVersion: settings.SourceVersion || "",
      solutionPath,
      sitefinityUrl: settings.SitefinityUrl,
      ...(settings.BackendCredentials && { backendCredentials: settings.BackendCredentials })
    };

    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        ...result
      }, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }, null, 2) }],
    };
  }
}

/**
 * Handler for restore_packages tool
 * Auto-discovers nuget.exe and runs restore
 */
export async function restorePackagesHandler(params: {
  solutionPath?: string | undefined;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const settings = loadUpgradeSettings();
    const projectPath = settings.SourceFilesPath;
    
    // Use provided solution path or discover it
    let solutionPath = params.solutionPath;
    if (!solutionPath) {
      solutionPath = findSolutionFile(projectPath) || undefined;
    }

    if (!solutionPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `No solution file found in: ${projectPath}`
        }, null, 2) }],
      };
    }

    // Locate or download nuget.exe
    const nugetPath = await locateOrDownloadNuget(projectPath);
    if (!nugetPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "Could not locate or download nuget.exe"
        }, null, 2) }],
      };
    }

    // Run nuget restore
    const { stdout, stderr } = await execAsync(
      `"${nugetPath}" restore "${solutionPath}"`,
      { shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024 }
    );

    const output = stdout + (stderr ? `\n${stderr}` : "");
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true
      }, null, 2) }],
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: execError.message || String(error),
        stdout: execError.stdout,
        stderr: execError.stderr
      }, null, 2) }],
    };
  }
}

/**
 * Handler for build_solution tool
 * Auto-discovers MSBuild and runs build
 */
export async function buildSolutionHandler(params: {
  solutionPath?: string | undefined;
  configuration?: string | undefined;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const settings = loadUpgradeSettings();
    const projectPath = settings.SourceFilesPath;
    const configuration = params.configuration || "Release";

    // Use provided solution path or discover it
    let solutionPath = params.solutionPath;
    if (!solutionPath) {
      solutionPath = findSolutionFile(projectPath) || undefined;
    }

    if (!solutionPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `No solution file found in: ${projectPath}`
        }, null, 2) }],
      };
    }

    // Locate MSBuild
    const msbuildPath = await locateMSBuild();
    if (!msbuildPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "MSBuild not found. Please install Visual Studio or Build Tools."
        }, null, 2) }],
      };
    }

    // Run MSBuild
    const { stdout, stderr } = await execAsync(
      `"${msbuildPath}" "${solutionPath}" /t:Build /p:Configuration=${configuration}`,
      { shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024 }
    );

    const output = stdout + (stderr ? `\n${stderr}` : "");
    
    // Parse errors and warnings from MSBuild output
    const errors: string[] = [];
    const warnings: string[] = [];
    
    const lines = output.split("\n");
    for (const line of lines) {
      if (line.includes(": error ")) {
        errors.push(line.trim());
      } else if (line.includes(": warning ")) {
        warnings.push(line.trim());
      }
    }

    // Check if build succeeded
    const buildSucceeded = output.includes("Build succeeded") || 
                          (errors.length === 0 && !output.includes("Build FAILED"));

    const result: any = { success: buildSucceeded };
    
    if (!buildSucceeded) {
      result.output = output;
      if (errors.length > 0) result.errors = errors;
      if (warnings.length > 0) result.warnings = warnings;
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    
    // Parse errors from failed build output
    const errors: string[] = [];
    const combinedOutput = (execError.stdout || "") + (execError.stderr || "");
    const lines = combinedOutput.split("\n");
    for (const line of lines) {
      if (line.includes(": error ")) {
        errors.push(line.trim());
      }
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: execError.message || String(error),
        errors,
        stdout: execError.stdout,
        stderr: execError.stderr
      }, null, 2) }],
    };
  }
}

/**
 * Handler for run_upgrade tool
 * Executes sf upgrade with standard flags
 */
export async function runUpgradeHandler(params: {
  projectPath?: string | undefined;
  version?: string | undefined;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const settings = loadUpgradeSettings();
    
    const projectPath = params.projectPath || settings.SourceFilesPath;
    const version = params.version || settings.TargetVersion;

    if (!projectPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "No project path provided and SourceFilesPath not configured in workspace settings.sf_agents"
        }, null, 2) }],
      };
    }

    if (!version) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "No version provided and TargetVersion not configured in workspace settings.sf_agents"
        }, null, 2) }],
      };
    }

    if (!existsSync(projectPath)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Project path does not exist: ${projectPath}`
        }, null, 2) }],
      };
    }

    // Discover solution file
    const solutionPath = findSolutionFile(projectPath);
    if (!solutionPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `No solution file found in: ${projectPath}`
        }, null, 2) }],
      };
    }

    // Execute sf upgrade command with solution file path
    const command = `sf upgrade "${solutionPath}" ${version} --skipPrompts --acceptLicense --removeDeprecatedPackages`;
    
    const { stdout, stderr } = await execAsync(command, {
      shell: "cmd.exe",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for upgrade output
      timeout: 30 * 60 * 1000, // 30 minute timeout
    });

    const output = stdout + (stderr ? `\n${stderr}` : "");
    
    // Write output to log file
    writeUpgradeLog(output);
    
    // Check for success indicators
    const success = !output.toLowerCase().includes("error") || 
                   output.includes("Upgrade completed") ||
                   output.includes("successfully");

    return {
      content: [{ type: "text" as const, text: JSON.stringify({ success }, null, 2) }],
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    
    // Write output to log file
    const combinedOutput = (execError.stdout || "") + (execError.stderr ? `\n${execError.stderr}` : "");
    if (combinedOutput) {
      writeUpgradeLog(combinedOutput);
    }
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: execError.message || String(error)
      }, null, 2) }],
    };
  }
}

/**
 * Handler for get_upgrade_log tool
 * Returns the contents of the upgrade log file
 */
export async function getUpgradeLogHandler(): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const logFilePath = getUpgradeLogPath();
    
    if (!existsSync(logFilePath)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Upgrade log file not found at: ${logFilePath}. The upgrade may not have been executed yet, or logging failed.`
        }, null, 2) }],
      };
    }
    
    const logContent = readFileSync(logFilePath, "utf-8");
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        content: logContent,
        logPath: logFilePath
      }, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: `Failed to read upgrade log: ${error instanceof Error ? error.message : String(error)}`
      }, null, 2) }],
    };
  }
}

/**
 * Handler for prepare_build_environment tool
 * Kills MSBuild processes, deletes bin/obj folders, and runs MSBuild clean
 */
export async function prepareBuildEnvironmentHandler(params: {
  projectPath?: string | undefined;
  solutionPath?: string | undefined;
  configuration?: string | undefined;
  skipMSBuildClean?: boolean | undefined;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const startTime = Date.now();
  
  try {
    const settings = loadUpgradeSettings();
    const projectPath = params.projectPath || settings.SourceFilesPath;
    const configuration = params.configuration || "Release";
    const skipMSBuildClean = params.skipMSBuildClean || false;

    if (!projectPath || !existsSync(projectPath)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Invalid or missing project path: ${projectPath}`
        }, null, 2) }],
      };
    }

    const result: any = {
      success: true,
      projectPath,
      warnings: [] as string[]
    };

    // 1. Kill MSBuild processes
    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-Process -Name 'msbuild' -ErrorAction SilentlyContinue | Stop-Process -Force; $LASTEXITCODE = 0"`,
        { shell: "cmd.exe", timeout: 10000 }
      );
      result.processesKilled = {
        success: true,
        message: "MSBuild processes terminated (if any were running)"
      };
    } catch (error) {
      result.processesKilled = {
        success: true,
        message: "No MSBuild processes found or already stopped"
      };
    }

    // 2. Recursively delete bin/obj folders
    const deletedFolders: string[] = [];
    const findAndDeleteBinObj = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullPath = join(dir, entry.name);
            if (entry.name === "bin" || entry.name === "obj") {
              try {
                rmSync(fullPath, { recursive: true, force: true });
                deletedFolders.push(fullPath);
              } catch (err) {
                result.warnings.push(`Could not delete ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
              }
            } else if (entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "packages") {
              findAndDeleteBinObj(fullPath);
            }
          }
        }
      } catch (err) {
        // Skip directories we can't read
      }
    };

    findAndDeleteBinObj(projectPath);
    result.binObjDeleted = {
      success: true,
      folders: deletedFolders,
      count: deletedFolders.length,
      message: deletedFolders.length > 0 
        ? `Deleted ${deletedFolders.length} bin/obj folder(s)` 
        : "No bin/obj folders found"
    };

    // 4. Run MSBuild clean (if not skipped)
    if (!skipMSBuildClean) {
      let solutionPath = params.solutionPath;
      if (!solutionPath) {
        solutionPath = findSolutionFile(projectPath) || undefined;
      }

      if (!solutionPath) {
        result.msbuildCleaned = {
          success: false,
          message: "Cannot run MSBuild clean: No solution file found"
        };
        result.warnings.push("MSBuild clean skipped: No solution file found");
      } else {
        const msbuildPath = await locateMSBuild();
        if (!msbuildPath) {
          result.msbuildCleaned = {
            success: false,
            message: "MSBuild not found"
          };
          result.warnings.push("MSBuild clean skipped: MSBuild.exe not found");
        } else {
          try {
            const { stdout, stderr } = await execAsync(
              `"${msbuildPath}" "${solutionPath}" /t:Clean /p:Configuration=${configuration}`,
              { shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 }
            );
            
            const output = stdout + (stderr ? `\n${stderr}` : "");
            const errors: string[] = [];
            const warnings: string[] = [];
            
            const lines = output.split("\n");
            for (const line of lines) {
              if (line.includes(": error ")) {
                errors.push(line.trim());
              } else if (line.includes(": warning ")) {
                warnings.push(line.trim());
              }
            }

            const cleanSucceeded = errors.length === 0;
            result.msbuildCleaned = {
              success: cleanSucceeded,
              output: cleanSucceeded ? "Clean succeeded" : output,
              errors,
              warnings,
              message: cleanSucceeded ? "MSBuild clean completed successfully" : "MSBuild clean completed with errors"
            };
            
            if (!cleanSucceeded) {
              result.success = false;
            }
          } catch (error) {
            const execError = error as { stdout?: string; stderr?: string; message?: string };
            result.msbuildCleaned = {
              success: false,
              output: execError.stdout,
              message: `MSBuild clean failed: ${execError.message}`
            };
            result.success = false;
          }
        }
      }
    }

    result.durationMs = Date.now() - startTime;
    
    if (result.warnings.length === 0) {
      delete result.warnings;
    }

    // Simplify output for successful operations
    if (result.success) {
      const simplifiedResult: any = { success: true };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(simplifiedResult, null, 2) }],
      };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      }, null, 2) }],
    };
  }
}

/**
 * Handler for get_breaking_changes tool
 * Retrieves and aggregates breaking changes between source and target versions
 */
export async function getBreakingChangesHandler(params: {
  sourceVersion: string;
  targetVersion: string;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const { sourceVersion, targetVersion } = params;

    // Get the breaking-changes directory path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const breakingChangesDir = join(__dirname, "../../resources/breaking-changes");
    const versionsJsonPath = join(breakingChangesDir, "versions.json");

    // Check if versions.json exists
    if (!existsSync(versionsJsonPath)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `versions.json not found at: ${versionsJsonPath}`
        }, null, 2) }],
      };
    }

    // Load and parse versions.json
    let versionsContent = readFileSync(versionsJsonPath, "utf-8");
    // Remove BOM character if present
    if (versionsContent.charCodeAt(0) === 0xFEFF) {
      versionsContent = versionsContent.slice(1);
    }
    const versionsData = JSON.parse(versionsContent) as { versions: string[] };
    const allVersions = versionsData.versions;

    // Validate source and target versions
    if (!allVersions.includes(sourceVersion)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Source version '${sourceVersion}' not found in versions.json. Available versions: ${allVersions.join(", ")}`
        }, null, 2) }],
      };
    }

    if (!allVersions.includes(targetVersion)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Target version '${targetVersion}' not found in versions.json. Available versions: ${allVersions.join(", ")}`
        }, null, 2) }],
      };
    }

    // Find version indices
    const sourceIndex = allVersions.indexOf(sourceVersion);
    const targetIndex = allVersions.indexOf(targetVersion);

    // Validate version order
    if (sourceIndex >= targetIndex) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Source version '${sourceVersion}' must be less than target version '${targetVersion}'`
        }, null, 2) }],
      };
    }

    // Get required versions (exclusive of source, inclusive of target)
    const requiredVersions = allVersions.slice(sourceIndex + 1, targetIndex + 1);

    // Check if all required version files exist
    const missingVersions: string[] = [];
    const versionFiles: { version: string; filePath: string }[] = [];

    for (const version of requiredVersions) {
      // Handle "SP" versions: "4.2 SP1" -> "4.2-SP1.md"
      const fileName = `${version.replace(/ /g, "-")}.md`;
      const filePath = join(breakingChangesDir, fileName);

      if (!existsSync(filePath)) {
        missingVersions.push(version);
      } else {
        versionFiles.push({ version, filePath });
      }
    }

    // If any versions are missing, return error with details
    if (missingVersions.length > 0) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Missing breaking changes files for versions: ${missingVersions.join(", ")}`,
          missingVersions,
          availableVersions: versionFiles.map(v => v.version),
          suggestion: "Use the breaking-changes-fetcher subagent to download missing version files"
        }, null, 2) }],
      };
    }

    // Read and aggregate all version files
    const aggregatedContent: string[] = [];

    for (const { version, filePath } of versionFiles) {
      let content = readFileSync(filePath, "utf-8");
      // Remove BOM character if present
      if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
      }

      aggregatedContent.push(`## Breaking Changes for Version ${version}`);
      aggregatedContent.push("");
      aggregatedContent.push(content.trim());
      aggregatedContent.push("");
      aggregatedContent.push("---");
      aggregatedContent.push("");
    }

    const finalContent = aggregatedContent.join("\n");

    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true,
        sourceVersion,
        targetVersion,
        versions: requiredVersions,
        content: finalContent
      }, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }, null, 2) }],
    };
  }
}
