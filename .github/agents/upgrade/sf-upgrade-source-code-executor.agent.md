---
name: sf-upgrade-source-code-executor
description: 'Upgrade Sitefinity CMS projects to a specified version using Sitefinity CLI.'
tools: ['execute/getTerminalOutput', 'execute/awaitTerminal', 'execute/killTerminal', 'execute/runInTerminal', 'agent', 'edit/createDirectory', 'edit/createFile', 'edit/editFiles', 'upgrade-and-testing/build_solution', 'upgrade-and-testing/get_upgrade_settings', 'upgrade-and-testing/restore_packages', 'upgrade-and-testing/run_upgrade']
agents: ['sf-sitefinity-cli-upgrade-error-fixer']
model: Claude Sonnet 4.5 (copilot)
---

# Sitefinity Upgrade Agent

Upgrades Sitefinity CMS projects using MCP tools that auto-discover build tools and load settings.

## Upgrade Procedure

1. **Get settings**: Call `get_upgrade_settings`
   - Returns: `sourcePath`, `targetVersion`, `solutionPath`
   - If fails, STOP and report the configuration error

2. **Restore packages**: Call `restore_packages`
   - Auto-discovers/downloads nuget.exe
   - If fails, STOP and report restore error

3. **Verify build**: Call `build_solution`
   - Auto-discovers MSBuild.exe
   - **If fails, STOP**: Report "❌ The initial project is not in a good state. Cannot proceed until build succeeds." Include the errors from the response.

4. **Execute upgrade**: Call `run_upgrade`
   - **If fails** (response has `success: false`): Delegate to **sf-sitefinity-cli-upgrade-error-fixer** subagent. Do not attempt to read or inspect the error details yourself. After resolution, retry the upgrade. Repeat this process for any new errors until upgrade succeeds or the error resolver reports the issue cannot be fixed.

5. **On success**: Report upgrade results and instruct the user to open a **new chat session** and start the **sf-post-upgrade-build-repairer** agent to validate the build and fix any compilation errors. Do NOT automatically hand off or invoke the next agent.
