#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getUpgradeSettingsHandler, restorePackagesHandler, buildSolutionHandler, runUpgradeHandler, getUpgradeLogHandler, prepareBuildEnvironmentHandler, getBreakingChangesHandler } from "./handlers/upgradeHandler.js";
import { scaffoldTestDirectoryHandler, validateTestStructureHandler } from "./handlers/testDirectoryHandler.js";
import { prepareNextUpgradeHandler } from "./handlers/prepareNextUpgradeHandler.js";

// Create an MCP server
const server = new McpServer({
  name: "upgrade-and-testing",
  version: "1.0.0",
});

// ============================================================================
// Upgrade Tools
// ============================================================================

// Tool to get upgrade settings from workspace configuration
server.registerTool(
  "get_upgrade_settings",
  {
    description: "Gets upgrade settings from workspace configuration (settings.sf_agents) including SourceFilesPath, TargetVersion, and auto-discovers the solution file path.",
    inputSchema: {},
  },
  getUpgradeSettingsHandler
);

// Tool to restore NuGet packages
server.registerTool(
  "restore_packages",
  {
    description: "Restores NuGet packages for a solution. Auto-discovers nuget.exe (downloads if not found). Uses SourceFilesPath from workspace configuration if solutionPath not provided.",
    inputSchema: {
      solutionPath: z.string().optional().describe("Path to the solution file. If not provided, auto-discovers from SourceFilesPath in workspace configuration."),
    },
  },
  restorePackagesHandler
);

// Tool to build solution
server.registerTool(
  "build_solution",
  {
    description: "Builds a solution using MSBuild. Auto-discovers MSBuild.exe from Visual Studio installations. Uses SourceFilesPath from workspace configuration if solutionPath not provided.",
    inputSchema: {
      solutionPath: z.string().optional().describe("Path to the solution file. If not provided, auto-discovers from SourceFilesPath in workspace configuration."),
      configuration: z.string().optional().describe("Build configuration (Debug/Release). Defaults to Release."),
    },
  },
  buildSolutionHandler
);

// Tool to run Sitefinity upgrade
server.registerTool(
  "run_upgrade",
  {
    description: "Runs Sitefinity CLI upgrade command (sf upgrade) with standard flags: --skipPrompts --acceptLicense --removeDeprecatedPackages. Uses workspace configuration values if parameters not provided.",
    inputSchema: {
      projectPath: z.string().optional().describe("Path to the Sitefinity project. If not provided, uses SourceFilesPath from workspace configuration."),
      version: z.string().optional().describe("Target Sitefinity version (e.g., '15.4.8600'). If not provided, uses TargetVersion from workspace configuration."),
    },
  },
  runUpgradeHandler
);

// Tool to get upgrade log
server.registerTool(
  "get_upgrade_log",
  {
    description: "Retrieves the contents of the upgrade log file (logs/sitefinity-cli-upgrade.log) written by run_upgrade. Returns the full CLI output for error analysis.",
    inputSchema: {},
  },
  getUpgradeLogHandler
);

// Tool to prepare build environment
server.registerTool(
  "prepare_build_environment",
  {
    description: "Prepares the build environment by killing active MSBuild processes, recursively deleting bin/obj directories, and running MSBuild clean. Uses SourceFilesPath from workspace configuration if projectPath not provided. Safe to run even if some artifacts don't exist.",
    inputSchema: {
      projectPath: z.string().optional().describe("Path to the project directory. If not provided, uses SourceFilesPath from workspace configuration."),
      solutionPath: z.string().optional().describe("Path to the solution file for MSBuild clean. If not provided, auto-discovers from projectPath."),
      configuration: z.string().optional().describe("Build configuration for MSBuild clean (Debug/Release). Defaults to Release."),
      skipMSBuildClean: z.boolean().optional().describe("Skip the MSBuild clean step. Defaults to false."),
    },
  },
  prepareBuildEnvironmentHandler
);

// Tool to get breaking changes between versions
server.registerTool(
  "get_breaking_changes",
  {
    description: "Retrieves and aggregates Sitefinity API breaking changes between source and target versions. Automatically resolves version ranges and reads/aggregates individual version files. Returns combined markdown content with all breaking changes.",
    inputSchema: {
      sourceVersion: z.string().describe("Source version in major.minor format (e.g., '10.0'). Breaking changes AFTER this version will be included."),
      targetVersion: z.string().describe("Target version in major.minor format (e.g., '11.0'). Breaking changes UP TO and INCLUDING this version will be included."),
    },
  },
  getBreakingChangesHandler
);

// ============================================================================
// Test Tools
// ============================================================================

// Tool to scaffold test directory structure
server.registerTool(
  "scaffold_test_directory",
  {
    description: "Creates a self-contained sitefinity-tests directory with complete setup: playwright.config.ts, package.json, .gitignore, README, tests (frontend/backend), snapshots (frontend/backend), smoke test, and settings.json. Reads settings from workspace configuration (settings.sf_agents) and generates settings.json in the test directory. Copies ALL tests and snapshots from upgrade-and-testing. Safe to run - skips existing files.",
    inputSchema: {
      targetPath: z.string().describe("Path to the Source Project directory where sitefinity-tests/ will be created"),
    },
  },
  scaffoldTestDirectoryHandler
);

// Tool to validate test directory structure
server.registerTool(
  "validate_test_structure",
  {
    description: "Validates that the test directory has all required files and folders. Returns detailed validation results with issues and suggestions for fixing them. Use this before generating or healing tests to ensure the structure is correct.",
    inputSchema: {
      testDir: z.string().describe("Path to the sitefinity-tests directory to validate"),
    },
  },
  validateTestStructureHandler
);

// Tool to reset the workspace for the next upgrade project
server.registerTool(
  "prepare_next_upgrade",
  {
    description: "Resets the upgrade-and-testing workspace for a new Sitefinity project. Deletes all generated spec files (tests/frontend/*.spec.ts, tests/backend/*.spec.ts), restores utils (tests/frontend/utils.ts, tests/backend/utils.ts, tests/utils/playwright-utils.ts) and test plans (test-plans/frontend/plan.md, test-plans/backend/plan.md) from clean defaults stored in resources/defaults/, clears test-artifacts/, test-results/, playwright-report/, logs/, snapshots/, and deletes .playwright-mcp/. NOTE: the upgrade-and-testing.code-workspace file must be updated manually by the user to point to the new Source Project path.",
    inputSchema: {},
  },
  prepareNextUpgradeHandler
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch(console.error);
