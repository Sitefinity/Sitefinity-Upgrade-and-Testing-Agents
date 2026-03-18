#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getUpgradeSettingsHandler, restorePackagesHandler, buildSolutionHandler, runUpgradeHandler, getUpgradeLogHandler, prepareBuildEnvironmentHandler, getBreakingChangesHandler } from "./handlers/upgradeHandler.js";
import { scaffoldTestDirectoryHandler, validateTestStructureHandler } from "./handlers/testDirectoryHandler.js";
import { cleanEnvironmentHandler } from './handlers/cleanEnvironmentHandler.js';
import { mergeTestsToProjectHandler } from './handlers/mergeTestsToProjectHandler.js';
import { seedTestWorkspaceHandler } from './handlers/seedTestWorkspaceHandler.js';

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

// Tool to clean the upgrade-and-testing workspace (used before generating new tests or initiating a new upgrade cycle)
server.registerTool(
  "clean_environment",
  {
    description: "Clears the upgrade-and-testing workspace for a fresh test generation cycle or fresh upgrade. Deletes all generated spec files (tests/frontend/*.spec.ts, tests/backend/*.spec.ts), restores utils (tests/frontend/utils.ts, tests/backend/utils.ts, tests/utils/playwright-utils.ts) and test plans (test-plans/frontend/plan.md, test-plans/backend/plan.md) from clean defaults stored in resources/defaults/, clears test-artifacts/, test-results/, playwright-report/, logs/, snapshots/, and deletes .playwright-mcp/. Safe to call at any time — only affects the upgrade-and-testing project, never the Source Project.",
    inputSchema: {},
  },
  cleanEnvironmentHandler
);

// Tool to merge newly generated tests and snapshots into an existing source project test directory
server.registerTool(
  "merge_tests_to_project",
  {
    description: "Merges the tests and snapshots from the upgrade-and-testing workspace into an existing test directory in the Source Project (e.g. sitefinity-tests/ or a renamed equivalent). Copies all *.spec.ts files from tests/frontend/ and tests/backend/, copies utility files (utils.ts, playwright-utils.ts), and copies all snapshot images from snapshots/frontend/ and snapshots/backend/ into the target directory. Overwrites files with the same name. IMPORTANT: any test.fixme( calls that were added by seed_test_workspace are automatically converted back to test( on copy so all tests run normally in subsequent runs. Existing files in the target that are NOT present in upgrade-and-testing are left untouched (additive merge, not a full replace).",
    inputSchema: {
      targetTestsDir: z.string().describe("Absolute path to the existing test directory in the Source Project (e.g. C:/MyProject/sitefinity-tests or the renamed equivalent). This directory must already exist."),
    },
  },
  mergeTestsToProjectHandler
);

// Tool to seed the upgrade-and-testing workspace from an existing source project test directory
server.registerTool(
  "seed_test_workspace",
  {
    description: "Seeds the upgrade-and-testing workspace from an existing test directory in the Source Project. Copies all utility files (utils.ts, playwright-utils.ts) and optionally copies specific spec files that need to be extended. Spec files that are copied for extension have all their test() calls automatically marked as test.fixme() so they are skipped during the healing run — only the new tests added by the extender will be executed and healed. The fixme markers are automatically removed when the tests are merged back to the source project via merge_tests_to_project.",
    inputSchema: {
      sourceTestsDir: z.string().describe("Absolute path to the existing test directory in the Source Project (e.g. C:/MyProject/sitefinity-tests or renamed equivalent). This directory must already exist."),
      specsToExtend: z.array(z.string()).optional().describe("Relative paths of spec files to copy for extension, e.g. ['frontend/homepage.spec.ts', 'backend/content-nav-vrt.spec.ts']. Tests in these files will be marked as test.fixme() so they are skipped during healing. Omit or pass [] if no existing specs need to be extended."),
    },
  },
  seedTestWorkspaceHandler
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Server running on stdio");
}

main().catch(console.error);
