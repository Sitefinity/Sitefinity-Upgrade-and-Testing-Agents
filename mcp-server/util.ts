import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { UpgradeSettings } from "./interfaces/upgrade-settings.js";
import { parse } from "jsonc-parser";

export function loadUpgradeSettings(): UpgradeSettings {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const workspacePath = join(__dirname, "../upgrade-and-testing.code-workspace");
    let fileContent = readFileSync(workspacePath, "utf-8");
    
    // Remove BOM character if present
    if (fileContent.charCodeAt(0) === 0xFEFF) {
      fileContent = fileContent.slice(1);
    }
    
    // Parse workspace file using jsonc-parser to handle comments
    const workspace = parse(fileContent) as any;
    
    // Extract sf_agents settings
    const sfAgents = workspace?.settings?.sf_agents;
    if (!sfAgents) {
      throw new Error(
        'Workspace file does not contain settings.sf_agents configuration. ' +
        'Please ensure upgrade-and-testing.code-workspace has a settings.sf_agents section.'
      );
    }
    
    // Find Source Project folder path
    const sourceFolder = workspace?.folders?.find((f: any) => 
      f.name === "Source Project"
    );
    const sourceFilesPath = sourceFolder?.path || '';
    
    // Map workspace settings to UpgradeSettings
    const upgradeSettings: UpgradeSettings = {
      SitefinityUrl: sfAgents.SitefinityUrl || '',
      SitefinityCLIPath: sfAgents.SitefinityCLIPath || '',
      SourceFilesPath: sourceFilesPath,
      SourceVersion: sfAgents.SourceVersion || '',
      TargetVersion: sfAgents.TargetVersion || '',
      BackendCredentials: sfAgents.BackendCredentials
    };

    // Validate required fields
    const requiredFields = [
      { field: 'SitefinityUrl', value: upgradeSettings.SitefinityUrl },
      { field: 'SourceFilesPath', value: upgradeSettings.SourceFilesPath },
      { field: 'SourceVersion', value: upgradeSettings.SourceVersion },
      { field: 'TargetVersion', value: upgradeSettings.TargetVersion }
    ];

    const missingFields = requiredFields
      .filter(({ value }) => !value || (typeof value === 'string' && value.trim() === ''))
      .map(({ field }) => field);

    if (missingFields.length > 0) {
      throw new Error(
        `Workspace settings are missing required fields: ${missingFields.join(', ')}. ` +
        `Please ensure upgrade-and-testing.code-workspace settings.sf_agents contains: SitefinityUrl, SourceVersion, and TargetVersion. ` +
        `Also ensure a "Source Project" folder is configured.`
      );
    }

    return upgradeSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const attemptedPath = join(__dirname, "../upgrade-and-testing.code-workspace");
      throw new Error(
        `Workspace file not found at: ${attemptedPath}. Please ensure upgrade-and-testing.code-workspace exists in the project root.`
      );
    }
    throw error;
  }
}

export function getSitefinityCliPathFromEnv(): string {
  const pathEnv = process.env.Path || process.env.PATH || "";
  const paths = pathEnv.split(";");
  const sitefinityCliPath = paths.find(p => p.toLowerCase().includes("sitefinity cli"));
  
  if (!sitefinityCliPath) {
    throw new Error("Could not find 'Sitefinity CLI' in system PATH environment variable");
  }
  
  return sitefinityCliPath;
}
