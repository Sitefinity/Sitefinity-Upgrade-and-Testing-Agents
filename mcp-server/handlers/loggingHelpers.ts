import { existsSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ============================================================================
// Constants
// ============================================================================

/**
 * Directory for all operation logs from MCP server root
 */
export const LOGS_DIR = "logs";

// ============================================================================
// Logging Helpers
// ============================================================================

/**
 * Generates a timestamp prefix for log files
 * Format: yyMMdd_HHmmss_
 */
export function generateTimestampPrefix(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  
  return `${yy}${MM}${dd}_${HH}${mm}${ss}_`;
}

/**
 * Generates a timestamped log file path for any operation
 * Format: logs/yyMMdd_HHmmss_<basename>
 * @param basename - The base name for the log file (e.g., "sitefinity-cli-upgrade.log")
 */
export function generateTimestampedLogPath(basename: string): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const mcpServerRoot = join(__dirname, "..", ".."); // From src/handlers/ to root
  
  const logFileName = generateTimestampPrefix() + basename;
  return join(mcpServerRoot, LOGS_DIR, logFileName);
}

/**
 * Writes timestamped content to log file in the MCP server workspace
 * Always appends to the log file. Creates the file if it doesn't exist.
 * @param content - Content to write to the log
 * @param logFilePath - Full path to the log file
 */
export function writeOperationLog(content: string, logFilePath: string): void {
  try {
    const logsDir = dirname(logFilePath);
    
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${content}\n`;
    
    appendFileSync(logFilePath, logEntry, "utf-8");
  } catch (logError) {
    // Silently fail if logging fails - don't let it break the operation
    console.error(`Failed to write log:`, logError);
  }
}
