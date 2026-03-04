# Sitefinity upgrade agents instructions

# Important!
With this project we are aiming to reduce the friction of upgrading Sitefinity CMS projects to a minimum. This is a complex process and we have built our agents to be as robust as possible and adaptable to different projects and upgrade scenarios.
The agents are designed to run without needing any instructions in advance. Each one of them knows its goal and how to achieve it. We don't expect issues to occur often, but if you notice an agent drifting from its intent or losing focus during execution, the general guidance is to open a new conversation with the same agent and simply prompt it to "start" — it will pick up from where it needs to.
Keep in mind that AI agents are non-deterministic by nature and may occasionally produce imperfect results. We have designed ours to minimize the chances of that, but we advise you to review each agent's output along the way. If an agent asks for input or you are not entirely happy with the results, this is the moment to step in — you can open a new conversation and ask it to try again or give it specific instructions on what to do differently in the same conversation.

In the [Agents Overview](#agents-overview) section below you can find more details about what each agent does and guidance on how to act in case the agent output is not satisfactory.

## Project Overview

AI custom agents and an MCP server that automate Sitefinity CMS upgrades. Agents perform test generation, upgrade execution, error fixing, and verification with the help of the MCP server tools.

## Prerequisites

- Visual Studio Code 1.109 or newer
- GitHub Copilot PRO subscription
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

2. **Launch VS Code as Administrator and open the cloned repository**

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

## Running the Agents

Run the agents in the sequence listed below, one at a time. Each agent will tell you which agent to run next when it finishes.

> **Always start each agent in a new chat session.** This keeps the context window clean and prevents agents from losing focus. If an agent's responses start drifting or becoming less accurate mid-session, open a fresh chat with the same agent and prompt it to "start" — it will resume its workflow.

### Agent Sequence

| Phase | Agent | What it does |
|-------|-------|-------------|
| **1. Pre-upgrade** | @sf-test-generator | Generates Playwright VRT and interaction tests |
| | @sf-test-healer | Debugs and fixes failing tests to establish a passing baseline |
| | @sf-test-dir-builder | Copies tests into the Source Project and verifies the setup |
| **2. Upgrade** | @sf-upgrade-source-code-executor | Runs the Sitefinity CLI upgrade |
| | @sf-post-upgrade-build-repairer | Fixes post-upgrade compilation errors |
| | @sf-post-upgrade-runtime-repairer | Fixes runtime errors so the site loads |
| **3. Verification** | @sf-post-upgrade-analyzer | Runs tests and analyzes failures — produces a report |


## Agents Overview

**Test execution parallelism:** Both frontend and backend tests run in parallel using Playwright's default worker count. Backend tests rely on a before-all login mechanism (`ensureAuthFile` mutex) that performs a single login per 30-minute window and shares the authenticated session across all workers via `storageState`. This avoids per-test login overhead and session conflicts despite parallel execution.

### Pre-upgrade Agents

#### @sf-test-generator
Generates Playwright Visual Regression Tests (VRT) and interaction tests for both frontend pages and the Sitefinity admin backend. It auto-discovers pages via site navigation or follows a user-provided test plan. By default, it applies a 70/30 test mix — 70% VRT tests across distinct pages and 30% functional/interaction tests targeting high-value workflows.

The generator reads test plans from `test-plans/frontend/plan.md` and `test-plans/backend/plan.md`. Plans are written in plain, human-readable language — you don't need to specify exact selectors, code, or technical details. You can simply describe which pages to test, what workflows matter, or just request a number of tests (e.g., "Generate 50 test cases"). See `test-plans/example-a.md`, `example-b.md`, and `example-c.md` for reference.

#### @sf-test-healer
Debugs and fixes failing Playwright tests before the upgrade begins. It systematically identifies, diagnoses, and remediates test issues — including flaky tests, broken selectors, and VRT baseline mismatches — to establish a fully passing test baseline. If a test cannot be stabilized after multiple attempts, it is marked as `test.fixme()` with a detailed explanation.

#### @sf-test-dir-builder
Builds a self-contained `sitefinity-tests` directory inside the Source Sitefinity Project by scaffolding the test structure, copying all tests and VRT snapshots, installing dependencies, and running a smoke test to verify the setup. It can also diagnose and fix setup issues autonomously if the smoke test fails.

### Upgrade Agents

#### @sf-upgrade-source-code-executor
Upgrades the Sitefinity project to a specified version using the Sitefinity CLI (`sf upgrade`). It handles NuGet restore, MSBuild compilation, and XML validation before each upgrade attempt. If the CLI upgrade fails, it delegates to the `sf-cli-upgrade-error-fixer` subagent to resolve known error patterns and retries automatically.

#### @sf-post-upgrade-build-repairer
Validates the post-upgrade build and fixes compilation errors iteratively (up to 5 attempts). It cross-references compiler errors against official Sitefinity API breaking changes documentation to apply targeted fixes — such as namespace changes, removed types, and updated method signatures. If breaking changes data is missing, it delegates to the `sf-breaking-changes-fetcher` subagent.

#### @sf-post-upgrade-runtime-repairer
Validates that the Sitefinity site loads correctly after the upgrade and repairs runtime errors. It navigates to the homepage, detects ASP.NET/Sitefinity error screens, and applies fixes sourced from the Progress Knowledge Base and Community Archive. It performs a clean rebuild verification to ensure all fixes are durable.

### Verification Agents

#### @sf-post-upgrade-analyzer
Runs all Playwright tests after the upgrade and analyzes failures without attempting to fix them. It categorizes issues (custom widgets, built-in widgets, JS errors, layout/CSS, visual regressions, etc.) and generates a CSV report with detailed findings. It investigates failures concurrently while the test suite is still running for maximum efficiency.

### Subagents (invoked automatically by parent agents)

#### sf-cli-upgrade-error-fixer
Analyzes Sitefinity CLI upgrade failures by reading the PowerShell upgrade log, matching errors against a knowledge base of known patterns (duplicate references, missing packages, locked files), and applying targeted fixes. It is invoked as a subagent by `sf-upgrade-source-code-executor` and is not meant to be called directly.

#### sf-breaking-changes-fetcher
Fetches and caches Sitefinity API breaking changes from the official Progress documentation for the relevant upgrade version range. It extracts version-specific data from the documentation page and stores it locally as markdown files. It is invoked as a subagent by `sf-post-upgrade-build-repairer` when breaking changes data is missing.

---
