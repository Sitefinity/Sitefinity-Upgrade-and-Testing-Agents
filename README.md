# Sitefinity upgrade agents instructions

## Overview

An MCP server and AI custom agents that automate Sitefinity CMS upgrades. Agents perform test generation, upgrade execution, error fixing, and verification with the help of the MCP server tools.

## Prerequisites

- Visual Studio Code 1.109 or newer
- Node.js (v18 or higher) and npm
- Working and compiled Sitefinity CMS solution
- Running Sitefinity instance (for test execution)
- Visual Studio 2019 or newer
- Sitefinity CLI tool installed and added to PATH
- Playwright (auto-installed via `npm install`)

## Local Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd upgrade-and-testing
   ```

2. **Open the repository in VS Code**

3. **Configure workspace settings**
   - Open `upgrade-and-testing.code-workspace` in VS Code
   - Update the `settings.sf_agents` section with your local configuration:
     ```json
     "sf_agents": {
       "SitefinityUrl": "https://your-site.local/",
       "BackendCredentials": {
         "username": "admin@test.test",
         "password": "your-password"
       },
       "TargetVersion": "15.4.8625",
       "SourceVersion": "14.4"
     }
     ```
   - Update the "Source Project" folder path to point to your Sitefinity project:
     ```json
     {
       "name": "Source Project",
       "path": "C:\\path\\to\\your\\sitefinity\\project"
     }
     ```
4. **Click on "Open Workspace" button on the bottom right**

5. **Ignore local workspace changes** (optional)
   
   To prevent your local workspace customizations from showing up in git:
   ```bash
   git update-index --skip-worktree upgrade-and-testing.code-workspace
   ```
   This allows you to customize the workspace file without accidentally committing your local paths and credentials, while still receiving updates when you pull from the repository.

6. **Install dependencies**
   ```bash
   npm install
   ```

7. **Build the MCP server**
   ```bash
   npm run build
   ```

8. **Start the MCP server**
   ```bash
   npm start
   ```

9. **Verify upgrade-and-testing MCP server is running**
  1. Open .vscode/mcp.json
  2. Verify you see status running and number of tools for the upgrade-and-testing server. 
  3. If you don't see the server running, click the "Restart" button on top of the server name and observe the MCP output for any errors.

## Instructions

Run agents in sequence. You can re-run an agent if it fails. **Important:** Always open the next agent in a new chat session to keep context windows clean and prevent context bloat.
If you notice agent responses becoming less relevant or accurate, start a new chat session with the same agent and restart the agent work if it makes sense in the current situation.

## Agent sequence

1. **Pre-upgrade**
   - @sf-test-generator (Generates Playwright tests)
   - @sf-test-healer (Debugs and fixes failing tests)
   - @sf-test-dir-builder (Builds self-contained test directory in source project)

2. **Upgrade**
   - @sf-upgrade-source-code-executor (Runs Sitefinity CLI upgrade)
   - @sf-post-upgrade-build-repairer (Fixes compilation errors)
   - @sf-post-upgrade-runtime-repairer (Fixes runtime errors)

3. **Verification**
   - @sf-post-upgrade-analyzer (Analyzes test failures)
     - *Workflow complete*

**Note:** Each agent should be run in its own session to prevent context window bloat and ensure clean state.


## MCP server (upgrade-and-testing)

### Installation

```
npm install
```

### Build

```
npm run build
```

### Run

```
npm start
```

## Using with VS Code

This project includes an MCP configuration file at `.vscode/mcp.json`. 
