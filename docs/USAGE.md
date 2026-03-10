# Gitr Usage Guide

Step-by-step guide for installing, configuring, and using the Gitr VS Code extension (v0.1.0).

## Prerequisites

Verify the following are installed before proceeding:

| Requirement | Minimum Version | Verify Command |
|-------------|-----------------|----------------|
| VS Code | 1.85.0 | `code --version` |
| Docker | 20.10+ | `docker --version` |
| Docker Compose | v2.0+ | `docker compose version` |
| Node.js | 20.x | `node --version` |
| Git | 2.x | `git --version` |
| scc *(optional)* | 3.x | `scc --version` |

Docker is **required** — the PostgreSQL database runs in a Docker container.

**scc** ([Sloc Cloc and Code](https://github.com/boyter/scc)) is **optional** but recommended. When available, the pipeline extracts per-file code metrics — total lines, code lines, comment lines, cyclomatic complexity, and weighted complexity — and stores them in the `commit_files` table. Without scc, the pipeline runs normally but these columns remain zero.

Install scc via one of:
```bash
go install github.com/boyter/scc/v3@latest   # Go
brew install scc                               # macOS
snap install scc                               # Linux (snap)
```

---

## Initial Setup

### Step 1: Start the Database

The Gitr database runs in a Docker container using PostgreSQL 16.

1. Copy the environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and set a secure database password:
   ```
   DB_PASSWORD=your_secure_password_here
   ```

   > **Security:** The `.env` file is excluded from version control via `.gitignore`. Never commit `.env` to Git. Also store the same password in VS Code SecretStorage via **Gitr: Set Database Password** so the extension can connect.

3. Start the container:
   ```bash
   docker compose up -d
   ```

4. Verify the container is running and healthy:
   ```bash
   docker compose ps
   ```
   You should see `gitrx-postgres` with status `healthy`.

> **Note:** The `Gitr: Start Database` and `Gitr: Stop Database` commands are registered but not yet implemented. Use `docker compose up -d` and `docker compose down` from the terminal.

### Step 2: Install the Extension

Install the VSIX package:
```bash
code --install-extension gitr-0.1.0.vsix
```

Or install from source:
```bash
npm install
npm run dev
code --install-extension gitr-0.1.0.vsix
```

### Step 3: Configure Repositories

Open VS Code settings (`Ctrl+,` / `Cmd+,`) and add your repositories:

```json
"gitrx.repositories": [
  {
    "path": "/home/user/repos/my-app",
    "name": "My App",
    "organization": "Engineering",
    "trackerType": "jira"
  }
]
```

Each repository must specify:
- `path` — Absolute path to the Git repository root
- `name` — Display name used in TreeViews and reports

Optional:
- `organization` — Organization or team label
- `trackerType` — `"jira"` (default), `"linear"`, or `"none"`

See [SETTINGS.md](SETTINGS.md#gitrxrepositories) for full details and examples.

### Step 4: Choose Your Tracker Type

Each repository is configured with exactly one issue tracker. The `trackerType` field determines which tracker is used for commit-issue linking.

| Tracker Type | When to Use |
|-------------|-------------|
| `"jira"` (default) | Repository uses Jira for issue tracking |
| `"linear"` | Repository uses Linear for issue tracking |
| `"none"` | No issue tracking — git analysis and team assignment only |

> You cannot use both Jira and Linear for the same repository. If your organization is migrating from Jira to Linear, configure older repos as `"jira"` and newer repos as `"linear"`.

### Step 5: Set Up Credentials

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run these commands to store credentials securely:

**Always required:**
- **Gitr: Set Database Password** — Must match `DB_PASSWORD` in your `.env` file

**For Jira repositories:**
- **Gitr: Set Jira API Token** — Generate at [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

**For Linear repositories:**
- **Gitr: Set Linear API Token** — Generate at Linear > Settings > API > Personal API keys. The key must start with `lin_api_`.

  1. Open VS Code
  2. Press Ctrl+Shift+P to open the Command Palette
  3. Type "Gitr: Set Linear API Token" and select it
  4. Paste your Linear API key in the password-masked input box

**For GitHub contributor sync:**
- **Gitr: Set GitHub Token** — GitHub PAT with `read:org` and `read:user` scopes

  1. Open VS Code
  2. Press Ctrl+Shift+P again
  3. Type "Gitr: Set GitHub Token" and select it
  4. Paste your GitHub PAT in the password-masked input box

All credentials are stored in VS Code's encrypted SecretStorage — never in `settings.json` or plaintext files.

### Step 6: Configure Jira (if applicable)

If any repositories use `trackerType: "jira"`, configure the Jira connection:

```json
"gitrx.jira.server": "https://yourorg.atlassian.net",
"gitrx.jira.username": "developer@yourorg.com",
"gitrx.jira.projectKeys": ["PROJ", "FEAT", "BUG"]
```

Optional Jira settings:
- `gitrx.jira.keyAliases` — Map renamed project keys (e.g., `{"PROJ": "PROJ2"}`)
- `gitrx.jira.pointsField` — Custom field ID for story points (default: `customfield_10034`)

See [SETTINGS.md](SETTINGS.md#jira) for all Jira settings.

### Step 7: Configure Linear (if applicable)

If any repositories use `trackerType: "linear"`, configure Linear:

```json
"gitrx.linear.teamKeys": ["ENG", "PLAT"]
```

Optional Linear settings:
- `gitrx.linear.keyAliases` — Map renamed team keys
- `gitrx.linear.increment` — Issues to scan per incremental run (default: 200)
- `gitrx.linear.daysAgo` — Days to look back for unfinished issues (default: 2)

See [SETTINGS.md](SETTINGS.md#linear) for all Linear settings.

---

## Data Model Overview

The pipeline processes data through a sequence of extraction, loading, linking, and analysis steps:

```
Git Repositories
    │
    ▼
┌──────────────────┐      ┌──────────────────┐
│ Commit Extraction │      │ GitHub Contributor│
│ (git log parsing) │      │    Sync          │
└────────┬─────────┘      └────────┬─────────┘
         │                         │
         ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│  commit_history   │      │commit_contributors│
│  commit_files     │      └──────────────────┘
│  commit_directory │
│  commit_tags      │
└────────┬─────────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼                             ▼
┌──────────────┐         ┌───────────────┐
│ Jira Issues  │         │ Linear Issues │
│ (API loading)│         │ (API loading) │
└──────┬───────┘         └───────┬───────┘
       │                         │
       ▼                         ▼
┌──────────────┐         ┌───────────────┐
│ jira_detail   │         │ linear_detail  │
│ jira_history  │         │ linear_history │
└──────┬───────┘         └───────┬───────┘
       │                         │
       ▼                         ▼
┌──────────────┐         ┌───────────────┐
│ commit_jira   │         │ commit_linear  │
│ (regex link)  │         │ (regex link)   │
└──────┬───────┘         └───────┬───────┘
       │                         │
       └─────────┬───────────────┘
                 │
                 ▼
        ┌────────────────┐
        │ Team Assignment │
        │ (most-frequent  │
        │  issue prefix)  │
        └────────────────┘
```

**Database tables (23 tables, 9 views, across 4 migrations):**

- **Commit Analysis:** `commit_history`, `commit_files`, `commit_files_types`, `commit_directory`, `commit_branch_relationship`, `commit_tags`, `commit_msg_words`
- **Jira Integration:** `jira_detail`, `jira_history`, `jira_issue_link`, `jira_parent`, `jira_github_branch`, `jira_github_pullrequest`
- **Jira Linkage:** `commit_jira`
- **Linear Integration:** `linear_detail`, `linear_history`
- **Linear Linkage:** `commit_linear`
- **Contributors/Teams:** `commit_contributors`, `gitja_team_contributor`
- **Pipeline Audit:** `gitr_pipeline_run`, `gitr_pipeline_log`, `gitr_pipeline_sha`, `gitr_pipeline_jira`, `gitr_pipeline_linear`, `gitja_pipeline_table_counts`

---

## Running the Pipeline

### Manual Full Run

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Gitr: Run Pipeline**
3. A progress notification shows each step as it executes
4. Results are logged to the Gitr output channel (View > Output > Gitr)

The pipeline executes 9 steps in order:

| # | Step | Description |
|---|------|-------------|
| 1 | `gitCommitExtraction` | Parse `git log` for all configured repos and insert commits |
| 2 | `githubContributorSync` | Fetch contributor profiles from GitHub API |
| 3 | `jiraIssueLoading` | Load new Jira issues incrementally |
| 4 | `jiraChangelogUpdate` | Refresh recently changed Jira issues |
| 5 | `commitJiraLinking` | Regex-match commit messages to Jira issue keys |
| 6 | `linearIssueLoading` | Load new Linear issues incrementally |
| 7 | `linearChangelogUpdate` | Refresh recently changed Linear issues |
| 8 | `commitLinearLinking` | Regex-match commit messages to Linear issue keys |
| 9 | `teamAssignment` | Calculate primary team per contributor |

**Tracker-aware behavior:** Jira steps (3–5) run for repositories with `trackerType: "jira"`. Linear steps (6–8) run for repositories with `trackerType: "linear"`. If a tracker is not configured, its steps are gracefully skipped with an informational message.

### Selective Steps

To run only specific steps, configure `gitrx.pipeline.steps`:

```json
"gitrx.pipeline.steps": ["gitCommitExtraction", "commitJiraLinking"]
```

The default runs 5 core Jira steps. Set to `[]` (empty array) to run all 9 steps. See [SETTINGS.md](SETTINGS.md#gitrxpipelinesteps) for the full step list and dependency chain.

### Scheduled Pipeline

Enable automatic pipeline execution:

```json
"gitrx.schedule.enabled": true,
"gitrx.schedule.cronExpression": "0 9 * * 1-5"
```

Or toggle via the **Gitr: Toggle Scheduled Pipeline** command. The schedule status appears in the VS Code status bar.

See [SETTINGS.md](SETTINGS.md#schedule) for cron expression examples.

---

## Docker Database Operations

Since the database start/stop commands are not yet implemented, manage the Docker container directly:

| Operation | Command |
|-----------|---------|
| Start | `docker compose up -d` |
| Stop (keep data) | `docker compose down` |
| Stop (wipe data) | `docker compose down -v` |
| View logs | `docker compose logs -f postgres` |
| Connect via psql | `psql -h localhost -p 5433 -U gitrx_admin -d gitrx` |
| Check status | `docker compose ps` |
| Restart | `docker compose restart` |

The database uses a named volume (`gitrx-pgdata`) for data persistence. Running `docker compose down` preserves data; `docker compose down -v` removes all data.

Migrations are applied automatically on first container startup via the init script at `docker/init/01_run_migrations.sh`.

---

## TreeViews

The Gitr sidebar panel (click the Gitr icon in the Activity Bar) contains 4 TreeViews:

### Repositories

Displays all configured repositories from `gitrx.repositories` with statistics. Each repository shows a **tracker badge** indicating its tracker type (Jira, Linear, or None).

**Context menu actions (right-click):**
- **Run Pipeline for Repo** — Run the pipeline for the selected repository
- **Open in Terminal** — Open a terminal at the repository path

**Refresh:** Click the refresh icon in the TreeView title bar, or run **Gitr: Refresh Repositories**.

### Repo Stats

Displays configured repositories with commit count, branch count, and other statistics loaded from the database.

### Contributors

Displays contributors grouped by team, with commit counts.

**View modes (toggle via title bar icon):**
- **Grouped** — Contributors nested under team nodes
- **Flat** — All contributors in a single list

**Click** a contributor to see their details in the Gitr output channel.

**Refresh:** Click the refresh icon or run **Gitr: Refresh Contributors**.

### Pipeline Runs

Displays recent pipeline run history with status, duration, and step counts.

**Click** a pipeline run to view its detailed log entries in the Gitr output channel.

**Refresh:** Click the refresh icon or run **Gitr: Refresh Pipeline Runs**.

---

## Webview Panels

### Metrics Dashboard

Open via Command Palette: **Gitr: Open Metrics Dashboard**

Displays interactive Chart.js visualizations of:
- Commit trends over time
- Team contributions breakdown
- Technology stack distribution
- Code complexity metrics

### Issue Linkage

Open via Command Palette: **Gitr: Open Issue Linkage**

Displays a searchable, sortable table showing which commits are linked to which issues. The panel title dynamically reflects the active tracker types — showing "Commit-Jira Linkage", "Commit-Linear Linkage", or both depending on your repository configurations.

---

## Commands Reference

All 18 commands available in the Command Palette:

| Command | Description |
|---------|-------------|
| **Gitr: Run Pipeline** | Execute the analytics pipeline (all or selected steps) |
| **Gitr: Start Database** | *(Placeholder — not yet implemented)* |
| **Gitr: Stop Database** | *(Placeholder — not yet implemented)* |
| **Gitr: Set Database Password** | Store PostgreSQL password in SecretStorage |
| **Gitr: Set Jira API Token** | Store Jira API token in SecretStorage |
| **Gitr: Set GitHub Token** | Store GitHub PAT in SecretStorage |
| **Gitr: Set Linear API Token** | Store Linear API key in SecretStorage |
| **Gitr: Toggle Scheduled Pipeline** | Enable/disable automatic pipeline execution |
| **Gitr: Refresh Repositories** | Refresh the Repo Stats TreeView |
| **Run Pipeline for Repo** | Run pipeline for a specific repository (context menu) |
| **Open in Terminal** | Open terminal at repository path (context menu) |
| **Gitr: Refresh Contributors** | Refresh the Contributors TreeView |
| **Gitr: Toggle Contributors View Mode** | Switch between grouped and flat contributor view |
| **Show Contributor Details** | Display contributor info in output channel (on click) |
| **Gitr: Refresh Pipeline Runs** | Refresh the Pipeline Runs TreeView |
| **Show Pipeline Run Log** | Display pipeline run log in output channel (on click) |
| **Gitr: Open Metrics Dashboard** | Open the Chart.js metrics dashboard webview |
| **Gitr: Open Issue Linkage** | Open the commit-issue linkage webview |

---

## Troubleshooting

### Database Connection Failures

**Symptom:** Pipeline fails with "connection refused" or "ECONNREFUSED".

**Solutions:**
1. Verify the container is running: `docker compose ps`
2. Check container health: `docker compose logs postgres`
3. Verify port is correct — default is `5433`, not `5432`
4. Ensure `gitrx.database.port` in VS Code settings matches `DB_PORT` in `.env`
5. Check for port conflicts: `lsof -i :5433` or `ss -tlnp | grep 5433`

### Port Conflicts

**Symptom:** `docker compose up` fails with "port is already allocated".

**Solutions:**
1. Change `DB_PORT` in `.env` to an unused port (e.g., `5434`)
2. Update `gitrx.database.port` in VS Code settings to match
3. Stop the conflicting service: `docker compose down` (if another Gitr instance)

### Empty Dashboards

**Symptom:** Metrics Dashboard or Issue Linkage shows no data.

**Solutions:**
1. Run the pipeline first: **Gitr: Run Pipeline**
2. Check the Gitr output channel for errors during pipeline execution
3. Verify repositories are configured in `gitrx.repositories`
4. Verify database connectivity by checking `docker compose ps` shows `healthy`

### Jira API Errors

**Symptom:** `jiraIssueLoading` or `jiraChangelogUpdate` step fails.

**Solutions:**
1. Verify Jira server URL: `gitrx.jira.server` must include `https://`
2. Re-enter Jira token: **Gitr: Set Jira API Token**
3. Verify your Jira username (email) is correct
4. Check project keys exist in your Jira instance
5. Test connectivity: `curl -u user@email:token https://yourorg.atlassian.net/rest/api/3/myself`

### Linear API Errors

**Symptom:** `linearIssueLoading` or `linearChangelogUpdate` step fails.

**Solutions:**
1. Re-enter Linear API key: **Gitr: Set Linear API Token** — key must start with `lin_api_`
2. Verify team keys exist in your Linear workspace
3. Check Linear API rate limits — the `@linear/sdk` uses GraphQL, which has a separate rate limit from the REST API
4. Set log level to `DEBUG` to see detailed API interaction logs

### Linear API Key Missing

**Symptom:** Linear steps skip with "Linear not configured".

**Solutions:**
1. Run **Gitr: Set Linear API Token** from the Command Palette
2. Verify at least one repository has `trackerType: "linear"`
3. Verify `gitrx.linear.teamKeys` contains your team key(s)

### Rate Limiting

**Symptom:** API steps fail intermittently with 429 errors or "rate limit exceeded".

**Solutions:**
1. Reduce `gitrx.jira.increment` or `gitrx.linear.increment` for smaller batches
2. Increase `gitrx.schedule.cronExpression` interval to reduce frequency
3. Check your API tier's rate limits (Jira Cloud: 100 req/min, Linear: 1500 complexity points/hour)

### Pipeline Partially Succeeds

**Symptom:** Some steps succeed, others fail — pipeline status shows `PARTIAL`.

**Solutions:**
1. Check the Gitr output channel for error details on failed steps
2. Each step runs independently — a failure in one step does not block others
3. Fix the root cause and re-run the pipeline
4. Use selective steps to re-run only the failed step:
   ```json
   "gitrx.pipeline.steps": ["jiraIssueLoading"]
   ```

---

## Further Reference

- [SETTINGS.md](SETTINGS.md) — Complete settings reference with all 24 settings
- [OVERVIEW.md](OVERVIEW.md) — Extension overview and feature highlights
