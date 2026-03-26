# Sitefinity Upgrade and Testing Agents

A pipeline of specialized AI agents that generate tests for your Sitefinity CMS site, execute an automated upgrade to a newer version, and then run the tests against the upgraded site to verify its post-upgrade state and surface any issues if they occurred. After the upgrade, the agents automatically fix breaking changes introduced by the new version and resolve runtime errors that may appear during site initialization. The entire process is designed to run with minimal manual intervention — you start each agent, review its output, and move to the next.

## Important!
With this project we are aiming to reduce the friction of upgrading Sitefinity CMS projects to a minimum. This is a complex process and we have built our agents to be as robust as possible and adaptable to different projects and upgrade scenarios.
The agents are designed to run without needing any instructions in advance. Each one of them knows its goal and how to achieve it. We don't expect issues to occur often, but if you notice an agent drifting from its intent or losing focus during execution, the general guidance is to open a new conversation with the same agent and simply prompt it to "start" — it will pick up from where it needs to.
Keep in mind that AI agents are non-deterministic by nature and may occasionally produce imperfect results. We have designed ours to minimize the chances of that, but we advise you to review each agent's output along the way. If an agent asks for input or you are not entirely happy with the results, this is the moment to step in — you can open a new conversation and ask it to try again or give it specific instructions on what to do differently in the same conversation.

In the [Agent Playbook](#agent-playbook) section below you can find more details about what each agent does and guidance on how to steer the agent if needed to produce optimal results.

## Prerequisites

- Visual Studio Code 1.109 or newer
- GitHub Copilot PRO subscription
- Node.js (v18 or higher) and npm
- Working and compiled Sitefinity CMS solution
- Running Sitefinity instance (for test generation and execution)
- Visual Studio 2019 or newer
- [Sitefinity CLI](https://github.com/Sitefinity/Sitefinity-CLI) tool installed and added to PATH - [documentation on the CLI tool](https://www.progress.com/documentation/sitefinity-cms/upgrade-using-sitefinity-cli) 
- Playwright (auto-installed via `npm install`)

> **Recommended:** Keep the Sitefinity project being upgraded under source control (e.g., Git).

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

   > **Note:** `BackendCredentials` are only required if you plan to generate backend (admin panel) tests. You can leave them empty for frontend-only testing.
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

Run the agents in the sequence listed below, one at a time. To launch an agent, simply type **"start"** in the chat — that is all it needs. Each agent knows its job and will begin working immediately. When it finishes, it will tell you which agent to run next.

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

## Agent Playbook

> This section explains what each agent does and includes field-tested tips and guidance on what to expect and how to steer the agent if needed. We recommend reading the tips for each agent while it is running — they will help you understand what is happening and get the best results from that session.

### Pre-upgrade Agents

#### @sf-test-generator
The test generator uses plans to drive both frontend and backend test creation. Plans are located at `test-plans/frontend/plan.md` and `test-plans/backend/plan.md` and are written in plain, human-readable language similar to a prompt — you don't need to specify exact selectors, code, or technical details. You can describe which pages to test, what workflows matter, specify concrete pages or user journeys, or simply request a number of tests (e.g., "Generate 50 test cases"). See `test-plans/example-a.md`, `example-b.md`, and `example-c.md` for reference.

The default frontend plan applies a 70/30 test mix — 70% Visual Regression Tests (VRT) across distinct pages and 30% functional/interaction tests targeting high-value workflows. It discovers pages automatically from the site navigation. You can override or customize the plans at any time to fit your project's needs.

When the generator starts, it **lists its understanding of the plans in the chat** before generating any code. This is your opportunity to review and correct:

- **Verify the plan summary.** Read through what the agent lists — check that page URLs, test counts, and workflows match your expectations. If something looks off, tell the agent directly in the chat (e.g., "Skip the /blog page" or "I actually need 30 tests, not 50") and it will adjust before proceeding.
- **Confirm to start.** Once you are satisfied the agent understood the plans correctly, tell it to go ahead and it will begin generating the test files.
- **Backend credentials.** If your plans include backend (admin panel) tests, the agent needs valid Sitefinity admin credentials to log in and inspect the backend while writing tests. Make sure `BackendCredentials` is filled in inside `upgrade-and-testing.code-workspace` under `settings.sf_agents` **before** you start the generator. If you are only generating frontend tests, backend credentials are not required and can be left empty.

#### @sf-test-healer
The test healer's job is to run the generated tests and stabilize them — ensuring every test reaches a passing state so you have a reliable baseline before the upgrade begins. This is essential because the upgrade verification later compares post-upgrade results against this baseline, so any test that fails before the upgrade would produce misleading results.

It systematically identifies, diagnoses, and fixes test issues — including flaky tests, broken selectors, and VRT baseline mismatches. It iterates through failing tests one by one, debugging and fixing them in rounds until the full suite passes. If a test cannot be stabilized after multiple attempts, it is marked as `test.fixme()` with a detailed explanation so it does not block the upgrade process.

A few things to keep in mind:

- **Let it run.** The healer may need several rounds of fix-and-rerun cycles — this is normal and expected. Give it enough time to work through all failures so you end up with a clean, fully passing baseline before starting the upgrade.
- **Carousel and dynamic content stabilization.** The healer is designed to create shared utility functions (e.g., freezing carousels, stopping animations, waiting for AJAX grids) when individual test-level fixes are not enough. If you notice it struggling with a particular dynamic element across multiple rounds, you can nudge it with something like "Try writing a reusable utility to stabilize this" — though in most cases it will arrive at this approach on its own.
- **VRT baselines.** On the very first run all VRT tests will fail because no baseline screenshots exist yet. The healer knows this and will not treat it as an error — it lets Playwright generate the initial baselines and then re-runs. No action needed from you.

#### @sf-test-dir-builder
Builds a self-contained `sitefinity-tests` directory inside the Source Sitefinity Project by scaffolding the test structure, copying all tests and VRT snapshots, installing dependencies, and running a smoke test to verify the setup. It can also diagnose and fix setup issues autonomously if the smoke test fails.

### Upgrade Agents

#### @sf-upgrade-source-code-executor
Upgrades the Sitefinity project to a specified version using the Sitefinity CLI (`sf upgrade`). It handles NuGet restore, MSBuild compilation, and XML validation before each upgrade attempt. If the CLI upgrade fails, it delegates to the `sf-cli-upgrade-error-fixer` subagent to resolve known error patterns and retries automatically.

The CLI upgrade runs inside Visual Studio. While the upgrade is in progress, Visual Studio may display dialogs that require manual user action. **Keep Visual Studio visible and monitor it throughout the upgrade.**

**General rule:** As long as the `run_upgrade` tool is still executing in your agent session and has not returned a result, the upgrade is in progress. Do not interrupt the agent — let it finish.

##### Dialogs you may encounter

1. **"Save As" dialog for `SitefinityWebApp.csproj`**
   Visual Studio may open a "Save As" file dialog asking where to save the `.csproj` file. This dialog blocks the upgrade process. Click **Cancel** to dismiss it and allow the upgrade to continue.

2. **"Project modified outside the environment" dialog**
   Visual Studio may detect that project files have been modified externally (by the CLI) and ask whether to reload the project. **Do not click Reload** — choose **Ignore** or simply do not interact with this dialog. Reloading the project mid-upgrade can interfere with the CLI process.

3. **NuGet Package Manager — "Restart Visual Studio" prompt**
   If the NuGet Package Manager reports that a package could not be removed and requires a Visual Studio restart, a **Restart** button will appear next to the message. Click **Restart**. Visual Studio may not reopen automatically after this — that is expected. As long as the agent session still shows the `run_upgrade` tool running, the CLI upgrade is still executing in the background and should not be interrupted.

##### Verifying the upgrade is still running

If Visual Studio has closed and you want to confirm the upgrade is still progressing, open a **separate VS Code window** (or terminal) pointing at your Sitefinity project and check the **Git Changes** tab. If new file modifications keep appearing, the CLI is actively making changes and the upgrade is proceeding normally.

#### @sf-post-upgrade-build-repairer
Validates the post-upgrade build and fixes compilation errors iteratively. It cross-references compiler errors against official Sitefinity API breaking changes documentation to apply targeted fixes — such as namespace changes, removed types, and updated method signatures. If breaking changes data is missing, it delegates to the `sf-breaking-changes-fetcher` subagent.
#### @sf-post-upgrade-runtime-repairer
Validates that the Sitefinity site loads correctly after the upgrade and repairs runtime errors. It navigates to the homepage, detects ASP.NET/Sitefinity error screens, and applies fixes sourced from the Progress Knowledge Base and Community Archive. It performs a clean rebuild verification to ensure all fixes are durable.

### Verification Agents

#### @sf-post-upgrade-analyzer
Runs all Playwright tests after the upgrade and analyzes failures without attempting to fix them. It categorizes issues (custom widgets, built-in widgets, JS errors, layout/CSS, visual regressions, etc.) and generates an Excel report with detailed findings. The agent helps identify potential root causes for each failure, but its conclusions should be treated as guidance — a human reviewer should verify all findings and make the final judgment on each issue. It investigates failures concurrently while the test suite is still running for maximum efficiency.

Here is what to expect:

- **Wait for tests to start.** After the agent launches the test command, you should see test output appearing in the chat within the first one to two minutes. If no test output appears after that window, simply open a new chat session with the same agent and prompt it to "start" — it will re-launch the run.
- **Live failure investigation.** While the suite is running, the agent monitors output and begins debugging failing tests as they appear — navigating to failing pages, capturing screenshots, and checking console errors — all without interrupting the ongoing test execution. This means analysis is happening concurrently, saving you significant time.
- **Only truly failed tests are analyzed.** Tests that fail on an initial attempt but pass on a Playwright retry are considered flaky and are excluded from the analysis report. The agent focuses exclusively on tests that remain failed in the final summary.
- **Do not approve any other commands while tests are running.** If the agent suggests running a PowerShell command or any other action that requires your approval, **do not click Allow** until the test suite has finished. Running additional commands while tests are executing will interrupt the test run and you will need to start over.

### Subagents (invoked automatically by parent agents)

#### sf-cli-upgrade-error-fixer
Analyzes Sitefinity CLI upgrade failures by reading the PowerShell upgrade log, matching errors against a knowledge base of known patterns (duplicate references, missing packages, locked files), and applying targeted fixes. It is invoked as a subagent by `sf-upgrade-source-code-executor` and is not meant to be called directly.

#### sf-breaking-changes-fetcher
Fetches and caches Sitefinity API breaking changes from the official Progress documentation for the relevant upgrade version range. It extracts version-specific data from the documentation page and stores it locally as markdown files. It is invoked as a subagent by `sf-post-upgrade-build-repairer` when breaking changes data is missing.

---

## Preparing for the Next Upgrade

Once you have finished an upgrade cycle and want to start a new one for a different Sitefinity project, you need to reset the upgrade-and-testing workspace so it is ready for the new project.

### Step 1 — Clean the workspace

Open a chat in the default **GitHub Copilot** agent mode (not a custom agent) and send:

> prepare the environment for the next upgrade

Copilot will call the `clean_environment` tool, which does the following:
- Deletes all generated spec files from `tests/frontend/` and `tests/backend/`
- Restores utility files (`utils.ts`, `playwright-utils.ts`) and test plans to their clean defaults
- Clears `test-artifacts/`, `test-results/`, `playwright-report/`, `logs/`, `snapshots/`, and `.playwright-mcp/`

No files in your Source Project are touched. The tool reports exactly what was deleted and restored so you can verify.

### Step 2 — Point to the new project

After the cleanup, open `upgrade-and-testing.code-workspace` and update the `Source Project` folder path and `settings.sf_agents` to match the new Sitefinity project:

```json
{
  "name": "Source Project",
  "path": "C:\\path\\to\\new\\sitefinity\\project"
}
```

Also update `SitefinityUrl`, `TargetVersion`, `SourceVersion`, and `BackendCredentials` as needed.

### Step 3 — Run the upgrade workflow

You are ready to go. Follow the [Agent Sequence](#agent-sequence) from the beginning.

---

## Extending an Existing Test Suite

Use this workflow when you already have a `sitefinity-tests/` directory in your Source Project with a passing test suite and you want to add more tests — more pages, more interactions, more backend modules — without duplicating what is already there. This workflow is independent of the upgrade process and can be run at any time.

### When to use this

- You want broader frontend coverage (more pages, more interactions)
- You want additional backend module tests
- You want to add tests to a specific existing spec file (e.g., extend `homepage.spec.ts` with more tests)
- You ran the initial test generation a while ago and the site has grown since then

### Step 1 — Update the test plans

Edit `test-plans/frontend/plan.md` and/or `test-plans/backend/plan.md` to describe what additional tests you want.

The plans are free-form text — write them like a prompt. To add brand-new spec files simply describe the pages or workflows:

```markdown
Test 20 more pages from the navigation menu 
Test the /about page and its sub-pages
```

To extend an **existing** spec file with more tests, say so explicitly:

```markdown
Extend homepage.spec.ts with 5 more tests
Add tests for /about to the existing file
```

The extender agent reads these instructions and knows to copy that spec into the workspace. Existing tests in the spec are temporarily skipped with test.fixme() while the spec is being extended. The test.fixem() skipping of the original tests is removed automatically at the end of the process when the spec is copied back to the Source Project, so all tests run normally on subsequent runs.

### Step 2 — Run @sf-test-suite-extender

Open a new chat session, select the **@sf-test-suite-extender** agent, and type **start**.

The agent will:
1. Verify the Source Project is configured and `sitefinity-tests/` exists
2. Read all existing spec files and build an inventory of what is already covered
3. Read the test plans to understand what to add
4. **Clear the upgrade-and-testing workspace** and **seed it** with your utility files (and any spec files to be extended, with their existing tests temporarily marked as `test.fixme()` so they are skipped during healing)
5. Present a plan — new spec files + any specs being extended — and wait for your confirmation before writing any code
6. Generate the new tests

The agent will present a plan for review before writing any code. Key things to verify:
- **New spec files**: each entry should be a brand-new file name covering pages or modules not yet in the test suite
- **Specs to extend**: if you asked to extend an existing spec, confirm it appears in the list
- **No duplicates**: pages already covered in the existing suite should not appear

> **Note**: All new tests go into **brand-new spec files** by default. Only specs that the test plan explicitly requests to extend are edited in-place.

Once all tests are generated, proceed to Step 3.

### Step 3 — Run @sf-test-healer

Open a new chat session, select **@sf-test-healer**, and type **start**.

The healer will run all tests in the upgrade-and-testing workspace. You will notice two types of tests:
- **New tests** (in new spec files, or added to the bottom of an extended spec) — these will be run and healed normally
- **Pre-existing tests** (in extended spec files, marked as `test.fixme()`) — these are skipped. They are already known to pass in the Source Project and do not need to be re-healed

Let the healer work through all failures until the new tests are stable. VRT baselines are generated on the first run — this is expected and not an error.

### Step 4 — Copy the results back to your Source Project

When the healer has finished and you are satisfied with the results, **explicitly tell it**:

> copy the tests to the source project

The healer will call the `merge_tests_to_project` tool, which:
- Copies all new and updated `*.spec.ts` files from `tests/frontend/` and `tests/backend/` into `sitefinity-tests/tests/`
- Copies updated utility files (`utils.ts`, `playwright-utils.ts`) — any improvements made during healing are included
- Copies all new snapshot images from `snapshots/frontend/` and `snapshots/backend/` into `sitefinity-tests/snapshots/`
- **Automatically removes all `test.fixme()` markers** that were added to the extended specs — so all tests (old and new) run normally on subsequent runs
- Existing files in `sitefinity-tests/` that were not touched are left as-is (additive merge)

That is it — your `sitefinity-tests/` directory now contains the full extended suite, ready to run.

---

By using this project you accept the terms in [EULA.md](EULA.md).
