import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readdirSync, mkdirSync, createWriteStream, rmSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { get } from "https";
import { loadUpgradeSettings } from "../util.js";
import {
  LOGS_DIR,
  generateTimestampedLogPath,
  writeOperationLog
} from "./loggingHelpers.js";

const execAsync = promisify(exec);

// ============================================================================
// Constants
// ============================================================================

/**
 * Log file basenames for upgrade operations
 */
const UPGRADE_LOG_BASENAME = "sitefinity-cli-upgrade.log";
const NUGET_LOG_BASENAME = "nuget-restore.log";
const BUILD_LOG_BASENAME = "msbuild.log";
const PREPARE_BUILD_LOG_BASENAME = "prepare-build.log";

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
 * @param projectPath - Path to the project
 * @param logFilePath - Path to the log file for this operation
 */
async function locateOrDownloadNuget(projectPath: string, logFilePath: string): Promise<string | null> {
  const searchPaths = [
    join(projectPath, "tools", "nuget.exe"),
    join(projectPath, ".nuget", "nuget.exe"),
    join(process.env.LOCALAPPDATA || "", "NuGet", "nuget.exe"),
    join(process.env.ChocolateyInstall || "", "bin", "nuget.exe"),
  ];

  for (const searchPath of searchPaths) {
    if (searchPath && existsSync(searchPath)) {
      writeOperationLog(`NuGet.exe found at: ${searchPath}`, logFilePath);
      return searchPath;
    }
  }

  // Download nuget.exe to project tools folder
  const toolsDir = join(projectPath, "tools");
  if (!existsSync(toolsDir)) {
    mkdirSync(toolsDir, { recursive: true });
  }

  const nugetPath = join(toolsDir, "nuget.exe");
  const downloadUrl = "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe";
  
  writeOperationLog(`NuGet.exe not found in standard locations. Downloading from: ${downloadUrl}\nDestination: ${nugetPath}`, logFilePath);
  
  try {
    await downloadFile(downloadUrl, nugetPath);
    writeOperationLog(`NuGet.exe successfully downloaded to: ${nugetPath}`, logFilePath);
    return nugetPath;
  } catch (error) {
    writeOperationLog(`Failed to download NuGet.exe: ${error instanceof Error ? error.message : String(error)}`, logFilePath);
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
  // Generate a unique log file path for this run
  const logPath = generateTimestampedLogPath(NUGET_LOG_BASENAME);
  
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
    const nugetPath = await locateOrDownloadNuget(projectPath, logPath);
    if (!nugetPath) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "Could not locate or download nuget.exe",
          logPath
        }, null, 2) }],
      };
    }

    writeOperationLog(`Using NuGet.exe at: ${nugetPath}`, logPath);

    // Run nuget restore
    const command = `"${nugetPath}" restore "${solutionPath}"`;
    writeOperationLog(`Executing command: ${command}`, logPath);
    
    const { stdout, stderr } = await execAsync(
      command,
      { shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024 }
    );

    // Log the full output
    const fullOutput = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : "");
    writeOperationLog(`NuGet Restore Output:\n${fullOutput}`, logPath);

    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: true
      }, null, 2) }],
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    
    // Log the error output
    const errorOutput = (execError.stdout || "") + (execError.stderr ? `\n--- STDERR ---\n${execError.stderr}` : "");
    if (errorOutput) {
      writeOperationLog(`NuGet Restore Failed:\n${errorOutput}`, logPath);
    }
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: execError.message || String(error),
        stderr: execError.stderr,
        logPath
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
  // Generate a unique log file path for this run
  const logPath = generateTimestampedLogPath(BUILD_LOG_BASENAME);
  
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
      writeOperationLog("MSBuild not found", logPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: "MSBuild not found. Please install Visual Studio or Build Tools."
        }, null, 2) }],
      };
    }

    writeOperationLog(`Using MSBuild at: ${msbuildPath}`, logPath);
    writeOperationLog(`Building solution: ${solutionPath}`, logPath);
    writeOperationLog(`Configuration: ${configuration}`, logPath);

    // Run MSBuild
    const command = `"${msbuildPath}" "${solutionPath}" /t:Build /p:Configuration=${configuration}`;
    writeOperationLog(`Executing command: ${command}`, logPath);
    
    const { stdout, stderr } = await execAsync(
      command,
      { shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024 }
    );

    const output = stdout + (stderr ? `\n${stderr}` : "");
    
    // Log the full output
    writeOperationLog(`MSBuild Output:\n${output}`, logPath);
    
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
      if (errors.length > 0) result.errors = errors;
      if (warnings.length > 0) result.warnings = warnings;
      result.logPath = logPath;
      writeOperationLog(`Build failed with ${errors.length} error(s)`, logPath);
    } else {
      writeOperationLog("Build succeeded", logPath);
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    
    // Log the error output
    const errorOutput = (execError.stdout || "") + (execError.stderr ? `\n--- STDERR ---\n${execError.stderr}` : "");
    if (errorOutput) {
      writeOperationLog(`Build Failed:\n${errorOutput}`, logPath);
    }
    
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
        stderr: execError.stderr,
        logPath
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
  // Generate a unique log file path for this run
  const logPath = generateTimestampedLogPath(UPGRADE_LOG_BASENAME);
  
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

    writeOperationLog(`Starting Sitefinity upgrade to version ${version}\nSolution: ${solutionPath}`, logPath);

    // Execute sf upgrade command with solution file path
    const command = `sf upgrade "${solutionPath}" ${version} --skipPrompts --acceptLicense --removeDeprecatedPackages`;
    writeOperationLog(`Executing command: ${command}`, logPath);
    
    const { stdout, stderr } = await execAsync(command, {
      shell: "cmd.exe",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for upgrade output
      timeout: 30 * 60 * 1000, // 30 minute timeout
    });

    const output = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : "");
    
    // Write output to log file
    writeOperationLog(`Upgrade Output:\n${output}`, logPath);
    
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
    const errorOutput = (execError.stdout || "") + (execError.stderr ? `\n--- STDERR ---\n${execError.stderr}` : "");
    if (errorOutput) {
      writeOperationLog(`Upgrade Failed:\n${errorOutput}`, logPath);
    }
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: execError.message || String(error),
        stderr: execError.stderr,
        logPath
      }, null, 2) }],
    };
  }
}

/**
 * Handler for get_upgrade_log tool
 * Returns the contents of the most recent upgrade log file
 */
export async function getUpgradeLogHandler(): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const mcpServerRoot = join(__dirname, "..", "..");
    const logsDir = join(mcpServerRoot, LOGS_DIR);
    
    if (!existsSync(logsDir)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Logs directory not found at: ${logsDir}. No upgrades have been executed yet.`
        }, null, 2) }],
      };
    }
    
    // Find all upgrade log files
    const files = readdirSync(logsDir);
    const upgradeLogFiles = files.filter(f => f.endsWith(UPGRADE_LOG_BASENAME)).sort().reverse();
    
    if (upgradeLogFiles.length === 0) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `No upgrade log files found in: ${logsDir}. The upgrade may not have been executed yet.`
        }, null, 2) }],
      };
    }
    
    // Get the most recent log file
    const mostRecentLogFile = upgradeLogFiles[0]!; // Non-null assertion safe because we checked length above
    const logFilePath = join(logsDir, mostRecentLogFile);
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
  // Generate a unique log file path for this run
  const logPath = generateTimestampedLogPath(PREPARE_BUILD_LOG_BASENAME);
  const startTime = Date.now();
  
  try {
    const settings = loadUpgradeSettings();
    const projectPath = params.projectPath || settings.SourceFilesPath;
    const configuration = params.configuration || "Release";
    const skipMSBuildClean = params.skipMSBuildClean || false;

    writeOperationLog(`Preparing build environment for: ${projectPath}`, logPath);
    writeOperationLog(`Configuration: ${configuration}`, logPath);
    writeOperationLog(`Skip MSBuild clean: ${skipMSBuildClean}`, logPath);

    if (!projectPath || !existsSync(projectPath)) {
      writeOperationLog(`Invalid or missing project path: ${projectPath}`, logPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: false,
          error: `Invalid or missing project path: ${projectPath}`,
          logPath
        }, null, 2) }],
      };
    }

    const result: any = {
      success: true,
      projectPath,
      warnings: [] as string[]
    };

    // 1. Kill MSBuild processes
    writeOperationLog("Terminating MSBuild processes...", logPath);
    try {
      const { stdout } = await execAsync(
        `powershell -Command "Get-Process -Name 'msbuild' -ErrorAction SilentlyContinue | Stop-Process -Force; $LASTEXITCODE = 0"`,
        { shell: "cmd.exe", timeout: 10000 }
      );
      writeOperationLog("MSBuild processes terminated (if any were running)", logPath);
      result.processesKilled = {
        success: true,
        message: "MSBuild processes terminated (if any were running)"
      };
    } catch (error) {
      writeOperationLog("No MSBuild processes found or already stopped", logPath);
      result.processesKilled = {
        success: true,
        message: "No MSBuild processes found or already stopped"
      };
    }

    // 2. Recursively delete bin/obj folders
    writeOperationLog("Deleting bin/obj folders...", logPath);
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
                writeOperationLog(`Deleted: ${fullPath}`, logPath);
              } catch (err) {
                const errorMsg = `Could not delete ${fullPath}: ${err instanceof Error ? err.message : String(err)}`;
                result.warnings.push(errorMsg);
                writeOperationLog(`Warning: ${errorMsg}`, logPath);
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
    const deleteMessage = deletedFolders.length > 0 
      ? `Deleted ${deletedFolders.length} bin/obj folder(s)` 
      : "No bin/obj folders found";
    writeOperationLog(deleteMessage, logPath);
    result.binObjDeleted = {
      success: true,
      count: deletedFolders.length,
      message: deleteMessage
    };

    // 4. Run MSBuild clean (if not skipped)
    if (!skipMSBuildClean) {
      writeOperationLog("Running MSBuild clean...", logPath);
      let solutionPath = params.solutionPath;
      if (!solutionPath) {
        solutionPath = findSolutionFile(projectPath) || undefined;
      }

      if (!solutionPath) {
        const msg = "Cannot run MSBuild clean: No solution file found";
        writeOperationLog(msg, logPath);
        result.msbuildCleaned = {
          success: false,
          message: msg
        };
        result.warnings.push("MSBuild clean skipped: No solution file found");
      } else {
        writeOperationLog(`Solution: ${solutionPath}`, logPath);
        const msbuildPath = await locateMSBuild();
        if (!msbuildPath) {
          const msg = "MSBuild not found";
          writeOperationLog(msg, logPath);
          result.msbuildCleaned = {
            success: false,
            message: msg
          };
          result.warnings.push("MSBuild clean skipped: MSBuild.exe not found");
        } else {
          writeOperationLog(`Using MSBuild at: ${msbuildPath}`, logPath);
          try {
            const command = `"${msbuildPath}" "${solutionPath}" /t:Clean /p:Configuration=${configuration}`;
            writeOperationLog(`Executing command: ${command}`, logPath);
            
            const { stdout, stderr } = await execAsync(
              command,
              { shell: "cmd.exe", maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 }
            );
            
            const output = stdout + (stderr ? `\n${stderr}` : "");
            writeOperationLog(`MSBuild Clean Output:\n${output}`, logPath);
            
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
            writeOperationLog(cleanSucceeded ? "Clean succeeded" : `Clean failed with ${errors.length} error(s)`, logPath);
            
            result.msbuildCleaned = {
              success: cleanSucceeded,
              errors,
              warnings,
              message: cleanSucceeded ? "MSBuild clean completed successfully" : "MSBuild clean completed with errors"
            };
            
            if (!cleanSucceeded) {
              result.success = false;
            }
          } catch (error) {
            const execError = error as { stdout?: string; stderr?: string; message?: string };
            const errorOutput = (execError.stdout || "") + (execError.stderr ? `\n--- STDERR ---\n${execError.stderr}` : "");
            if (errorOutput) {
              writeOperationLog(`MSBuild Clean Failed:\n${errorOutput}`, logPath);
            }
            
            result.msbuildCleaned = {
              success: false,
              message: `MSBuild clean failed: ${execError.message}`
            };
            result.success = false;
          }
        }
      }
    } else {
      writeOperationLog("MSBuild clean skipped (skipMSBuildClean=true)", logPath);
    }

    result.durationMs = Date.now() - startTime;
    writeOperationLog(`Build environment preparation completed in ${result.durationMs}ms`, logPath);

    // Simplify output for successful operations
    if (result.success) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true }, null, 2) }],
      };
    }

    // For failures, return minimal result with only errors and logPath
    const errors: string[] = [];
    if (result.msbuildCleaned?.errors) {
      errors.push(...result.msbuildCleaned.errors);
    }
    
    const failureResult: any = {
      success: false,
      logPath
    };
    
    if (errors.length > 0) {
      failureResult.errors = errors;
    }
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify(failureResult, null, 2) }],
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    writeOperationLog(`Build environment preparation failed: ${errorMsg}`, logPath);
    
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        success: false,
        error: errorMsg,
        logPath
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
