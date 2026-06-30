# CommitPulse - Git Analytics for VS Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **This is a public open-source repository.** CommitPulse is a VS Code extension that provides Git commit analytics, linking commits to Jira and Linear issues, extracting code complexity metrics, and visualizing team contributions over time.

## Related Projects

- **[CommitPulse Sync](https://github.com/antonajp/CommitPulse)** - The public repo for the https://marketplace.visualstudio.com/items?itemName=ImproviseLabs.gitr VS Code extension.

---

Step-by-step guide for installing, configuring, and using the CommitPulse VS Code extension (v0.1.0).

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

The CommitPulse database runs in a Docker container using PostgreSQL 16. First, ensure Docker Desktop is running, then clone the repository and start the database.

1. Clone the CommitPulse repository:
   ```bash
   git clone https://github.com/antonajp/CommitPulse.git
   ```

2. Navigate to the repository directory:
   ```bash
   cd CommitPulse
   ```

3. Start the PostgreSQL container:
   ```bash
   docker compose up -d
   ```
   This pulls the `postgres:16-alpine` image, creates a container named `gitrx-postgres`, exposes PostgreSQL on port **5433**, and runs all migrations automatically on first startup.

4. Verify the container is running:
   ```bash
   docker ps
   ```
   You should see `gitrx-postgres` listed with status `Up`.

> **Note:** The `Gitr: Start Database` and `Gitr: Stop Database` commands are registered but not yet implemented. Use `docker compose up -d` and `docker compose down` from the terminal.

### Step 2: Install the Extension

1. Open VS Code
2. Click the Extensions icon in the Activity Bar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for **CommitPulse**
4. Click **Install**

### Step 3: Set Database Password

The extension needs the database password to connect. The default password is `gitrx_local_dev`.

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type **Gitr: Set Database Password** and select it
3. Enter `gitrx_local_dev` (or your custom password if you changed it)

The password is stored securely in VS Code's encrypted SecretStorage.

### Step 4: Configure Repositories

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
- `startDate` — Earliest commit date to extract (`YYYY-MM-DD`). See Step 4.1 below.

See [SETTINGS.md](docs/SETTINGS.md#gitrxrepositories) for full details and examples.

### Step 4.1: Control Git History Extraction Scope (Recommended)

**For repositories with extensive history (5+ years), limiting the extraction scope is highly recommended.** This dramatically improves initial pipeline performance and avoids loading commits that predate your issue tracker adoption.

**Option A: Global cutoff date** — Apply the same cutoff to all repositories:
```json
"gitrx.pipeline.sinceDate": "2022-01-01"
```

**Option B: Per-repository startDate** — Different cutoffs for each repo:
```json
"gitrx.repositories": [
  {
    "path": "/home/user/repos/legacy-monolith",
    "name": "Legacy Monolith",
    "startDate": "2020-01-01"
  },
  {
    "path": "/home/user/repos/new-service",
    "name": "New Service",
    "startDate": "2024-01-01"
  }
]
```

**Priority:** Per-repo `startDate` takes precedence over the global `sinceDate`. When both are set, the **later** date is used for that repository.

> **Why this matters:** A repository with 15 years of history might have 50,000+ commits. Without a cutoff, the initial pipeline run extracts all of them — which can take 30+ minutes and fills the database with commits that will never link to any issue. Setting `startDate` to when your organization adopted Jira/Linear reduces this to seconds.

### Step 5: Choose Your Tracker Type

Each repository is configured with exactly one issue tracker. The `trackerType` field determines which tracker is used for commit-issue linking.

| Tracker Type | When to Use |
|-------------|-------------|
| `"jira"` (default) | Repository uses Jira for issue tracking |
| `"linear"` | Repository uses Linear for issue tracking |
| `"none"` | No issue tracking — git analysis and team assignment only |

> You cannot use both Jira and Linear for the same repository. If your organization is migrating from Jira to Linear, configure older repos as `"jira"` and newer repos as `"linear"`.

### Step 6: Set Up Additional Credentials

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run these commands to store credentials securely:

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

### Step 7: Configure Jira (if applicable)

If any repositories use `trackerType: "jira"`, configure the Jira connection:

```json
"gitrx.jira.server": "https://yourorg.atlassian.net",
"gitrx.jira.username": "developer@yourorg.com",
"gitrx.jira.projectKeys": ["PROJ", "FEAT", "BUG"]
```

Optional Jira settings:
- `gitrx.jira.keyAliases` — Map renamed project keys (e.g., `{"PROJ": "PROJ2"}`)
- `gitrx.jira.pointsField` — Custom field ID for story points (default: `customfield_10034`)

See [SETTINGS.md](docs/SETTINGS.md#jira) for all Jira settings.

### Step 8: Configure Linear (if applicable)

If any repositories use `trackerType: "linear"`, configure Linear:

```json
"gitrx.linear.teamKeys": ["ENG", "PLAT"]
```

Optional Linear settings:
- `gitrx.linear.keyAliases` — Map renamed team keys
- `gitrx.linear.increment` — Issues to scan per incremental run (default: 200)
- `gitrx.linear.daysAgo` — Days to look back for unfinished issues (default: 2)

See [SETTINGS.md](docs/SETTINGS.md#linear) for all Linear settings.

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

The default runs 5 core Jira steps. Set to `[]` (empty array) to run all 9 steps. See [SETTINGS.md](docs/SETTINGS.md#gitrxpipelinesteps) for the full step list and dependency chain.

### Scheduled Pipeline

Enable automatic pipeline execution:

```json
"gitrx.schedule.enabled": true,
"gitrx.schedule.cronExpression": "0 9 * * 1-5"
```

Or toggle via the **Gitr: Toggle Scheduled Pipeline** command. The schedule status appears in the VS Code status bar.

See [SETTINGS.md](docs/SETTINGS.md#schedule) for cron expression examples.

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

### Upgrading from Version 0.1.53 or Earlier

If you installed CommitPulse before version 0.1.54, you need to manually apply new database migrations. The PostgreSQL init script only runs on first container creation, so existing databases won't receive new migrations automatically.

**Apply all pending migrations:**

*Bash (macOS/Linux):*
```bash
# From the repository root directory
for migration in docker/migrations/*.sql; do
  # Skip rollback files
  [[ "$migration" == *.rollback.sql ]] && continue
  echo "Applying: $migration"
  docker exec -i gitrx-postgres psql -U gitrx_admin -d gitrx < "$migration"
done
```

*PowerShell (Windows):*
```powershell
# From the repository root directory
Get-ChildItem docker/migrations/*.sql | Where-Object { $_.Name -notlike "*.rollback.sql" } | ForEach-Object {
    Write-Host "Applying: $($_.FullName)"
    Get-Content $_.FullName | docker exec -i gitrx-postgres psql -U gitrx_admin -d gitrx
}
```

**Or apply a specific migration:**

*Bash (macOS/Linux):*
```bash
docker exec -i gitrx-postgres psql -U gitrx_admin -d gitrx < docker/migrations/030_create_organizations_teams_tables.sql
```

*PowerShell (Windows):*
```powershell
Get-Content docker/migrations/030_create_organizations_teams_tables.sql | docker exec -i gitrx-postgres psql -U gitrx_admin -d gitrx
```

**Alternative — Fresh start (loses all data):**

*Bash (macOS/Linux):*
```bash
docker compose down -v && docker compose up -d
```

*PowerShell (Windows):*
```powershell
docker compose down -v; docker compose up -d
```

This removes the data volume and recreates the container, which runs all migrations automatically.

> **Note:** Migration 030 introduces the `organizations` and `teams` tables required for the Organization Profile Dashboard. Without this migration, opening the Organization Profile will show a "relation does not exist" error.

### Seed Required Tables (Migration 030+)

Migration 030 creates the `organizations` and `teams` tables but does not populate them. You must insert seed data for the Organization Profile Dashboard to function.

The data model follows this hierarchy: **Organizations → Teams → Contributors**

**Step 1: Create your organization**

```sql
INSERT INTO organizations (name) VALUES ('Your Company Name');
```

**Step 2: Create teams linked to the organization**

```sql
INSERT INTO teams (name, organization_id) VALUES
  ('Engineering', 1),
  ('Platform', 1),
  ('Product', 1);
```

**Step 3: Verify the setup**

```sql
SELECT o.name AS organization, t.name AS team
FROM organizations o
LEFT JOIN teams t ON t.organization_id = o.id;
```

> **Note:** If you previously had teams in `commit_contributors.team`, migration 030 automatically migrated those team names to the `teams` table. However, they will have `organization_id = NULL` until you manually update them:
> ```sql
> UPDATE teams SET organization_id = 1 WHERE organization_id IS NULL;
> ```

---

## TreeViews

The CommitPulse sidebar panel (click the Gitr icon in the Activity Bar) contains 4 TreeViews:

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
3. Stop the conflicting service: `docker compose down` (if another instance)

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

## Architecture Classification

Files in the `commit_files` table are classified into architecture components (Back-End, Front-End, Database, DevOps/CI, Configuration, Testing, Documentation, Build/Tooling, Assets, Other). This classification enables the Metrics Dashboard to show technology stack distribution charts.

### Running Classification (Recommended)

Use the VS Code command for architecture classification:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Gitr: Backfill Architecture Components**
3. The command classifies all unclassified files and shows progress in the Gitr output channel

The command runs in **incremental mode** by default, classifying only rows where `arc_component IS NULL`. To force reclassification of all files, first run this SQL to reset the column, then run the command:

```sql
UPDATE commit_files SET arc_component = NULL;
```

### Classification Strategy

The classification uses a **priority-based strategy** with 12 priority levels:

| Priority | Classification Type | Examples |
|----------|---------------------|----------|
| 1 | Git rename artifacts | Extensions ending in `}` → Other |
| 2 | Build artifacts | `.o`, `.dll`, `.swiftmodule` → Build/Tooling |
| 3 | Test files (path-based) | `__tests__/`, `spec/`, `*.test.ts` → Testing |
| 4 | Salesforce test classes | `*_TEST.cls` → Testing |
| 5 | CI/CD & DevOps paths | `.github/workflows/`, `docker/`, `scripts/` → DevOps/CI |
| 6 | Documentation paths | `docs/`, `guides/` → Documentation |
| 7 | Front-End paths | `studio/`, `ui/`, `lwc/`, `aura/` → Front-End |
| 8 | Salesforce metadata | `objects/`, `labels/` → Database/Configuration |
| 9 | Database paths | `migrations/`, `schema.sql` → Database |
| 10 | IDE/Editor config | `.claude/`, `.cursor/`, `.idea/` → Configuration |
| 11 | Extension-based | `.ts`, `.py`, `.java` → Back-End; `.tsx`, `.vue` → Front-End |
| 12 | Filename-based | `Dockerfile` → DevOps/CI; `Makefile` → Build/Tooling |

**LLM-informed decisions:** The classification rules were generated by Claude analyzing 69,402 distinct filenames across 10 repositories. Key decisions include:
- `.ts` in `apps/studio/` or `ui/` → Front-End (not Back-End)
- `.tsx` → Front-End everywhere (React JSX is inherently UI)
- `.mdx` → Documentation (docs site content, not Front-End)
- WSO2 `repository/conf/` → Configuration; `repository/components/` → Back-End

### Manual Classification (Advanced)

For advanced users who prefer direct SQL execution, the classification script is available at `scripts/classify-arc-component.sql`.

**Incremental mode** (classifies only rows where `arc_component IS NULL`):
```bash
psql -h localhost -p 5433 -U gitrx_admin -d gitrx -f scripts/classify-arc-component.sql
```

**Force mode** (re-classifies all rows):
```bash
psql -h localhost -p 5433 -U gitrx_admin -d gitrx -c "UPDATE commit_files SET arc_component = NULL;"
psql -h localhost -p 5433 -U gitrx_admin -d gitrx -f scripts/classify-arc-component.sql
```

### Validating Results

The classification includes a summary query that runs automatically:

```sql
SELECT arc_component, COUNT(*) AS total_rows, COUNT(DISTINCT filename) AS distinct_files
FROM commit_files
WHERE arc_component IS NOT NULL
GROUP BY arc_component
ORDER BY total_rows DESC;
```

Example output:
```
 arc_component  | total_rows | distinct_files
----------------+------------+----------------
 Back-End       |      45231 |          12847
 Front-End      |      18429 |           5621
 Testing        |      12847 |           4231
 Configuration  |       8923 |           2156
 Documentation  |       4521 |           1823
 DevOps/CI      |       3214 |            987
 Assets         |       2156 |            743
 Database       |       1847 |            412
 Build/Tooling  |        892 |            234
 Other          |        342 |            128
```

### Extending Classifications

To add patterns for new tech stacks (e.g., your organization's conventions):

1. **Path-based rules** — Add to Priority 5-10 sections:
   ```sql
   WHEN filename ~ '^your-framework/' THEN 'Back-End'
   ```

2. **Extension-based rules** — Add to Priority 11 section:
   ```sql
   WHEN file_extension = '.yourext' THEN 'Configuration'
   ```

3. **Run the Backfill command** or use force mode to reclassify existing files.

---

## Contributor Table Maintenance

The `commit_contributors` table stores contributor profiles and requires periodic maintenance to ensure accurate dashboards and team-based analytics.

### Table Structure

| Column | Purpose |
|--------|---------|
| `login` | Primary key (GitHub login or generated ID) |
| `username` | Git commit author name (varies by local Git config) |
| `full_name` | Canonical display name for the contributor |
| `team` | Team assignment for team-based analytics |
| `email` | Email address from Git commits |
| `jira_name` | Jira display name for commit-issue correlation |

### Why Maintenance is Needed

Contributors often appear with multiple identities:
- Different `username` values from varying Git configurations across machines
- Work and personal email addresses
- Name variations (nicknames, formal names)

Without deduplication, the same person appears multiple times in dashboards, inflating contributor counts and fragmenting their statistics.

### Deduplication Workflow

To consolidate multiple usernames to a single contributor identity, update the `full_name` column to a consistent value:

```sql
-- View potential duplicates (similar usernames)
SELECT login, username, full_name, email, team
FROM commit_contributors
ORDER BY LOWER(username);

-- Standardize a contributor's display name across all their identities
UPDATE commit_contributors
SET full_name = 'Jane Doe'
WHERE login IN ('jdoe', 'jane.doe', 'janedoe-personal');

-- Verify the update
SELECT login, username, full_name FROM commit_contributors
WHERE full_name = 'Jane Doe';
```

Dashboards and analytics group contributors by `full_name`, so setting this consistently consolidates their statistics.

### Team Assignment

The `team` column enables team-based filtering and grouping in dashboards (Sprint Velocity, Developer Profile, etc.).

```sql
-- Assign contributors to teams
UPDATE commit_contributors
SET team = 'Platform'
WHERE login IN ('alice', 'bob', 'charlie');

UPDATE commit_contributors
SET team = 'Product'
WHERE login IN ('dave', 'eve', 'frank');

-- View team assignments
SELECT team, COUNT(*) as member_count
FROM commit_contributors
WHERE team IS NOT NULL
GROUP BY team
ORDER BY team;
```

Team values should match your organization's structure. Common patterns:
- Department names: `Engineering`, `Data`, `DevOps`
- Squad names: `Platform`, `Growth`, `Core`
- Project teams: `Project-Alpha`, `Project-Beta`

### Maintenance Commands

After updating contributor data, refresh the Contributors TreeView:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Gitr: Refresh Contributors**

Or click the refresh icon in the Contributors TreeView title bar.

### Contributor Name Alignment for Jira-Git Joins

Several dashboards combine data from both Jira and Git sources to show comprehensive analytics:

- **Productivity > Sprint Velocity vs LOC** — Correlates story points completed with lines of code contributed
- **Developer Profile > Sprint Velocity vs Lines of Code** — Shows individual contributor productivity across both metrics

These dashboards rely on SQL joins between Jira tables and Git tables. For the joins to work correctly, **contributor names must be aligned across the data sources**.

#### Column Relationships

| Source | Table | Column(s) | Purpose |
|--------|-------|-----------|---------|
| **Git** | `commit_contributors` | `full_name` | Canonical display name for the contributor |
| **Git** | `commit_contributors` | `jira_name` | Jira display name (for cross-source joins) |
| **Jira** | `jira_detail` | `assignee` | Current assignee display name |
| **Jira** | `jira_history` | `to_value`, `from_value` | Assignee values when `field = 'assignee'` |

The `jira_name` column in `commit_contributors` exists specifically to map Git authors to their corresponding Jira display names. Without this mapping, a contributor known as "Jane Doe" in Git but "jane.doe@company.com" in Jira would be excluded from combined charts.

**Best Practice:** The `full_name` and `jira_name` values should ideally be the same. When you set `jira_name`, also update `full_name` to match. This ensures consistency across all dashboards — Git-only views use `full_name`, Jira-only views use `assignee`, and combined views join on `jira_name = assignee`. Keeping all three values identical eliminates confusion and ensures data appears correctly everywhere.

#### Why Alignment Matters

When the dashboards join Git and Jira data, they match on contributor names:

```sql
-- Example join pattern used by Sprint Velocity dashboards
SELECT cc.full_name, SUM(jd.points), SUM(ch.lines_added)
FROM commit_contributors cc
JOIN commit_history ch ON ch.author = cc.username
JOIN jira_detail jd ON jd.assignee = cc.jira_name  -- This join fails if jira_name is NULL or mismatched
...
```

If `jira_name` is `NULL` or doesn't match the exact value in `jira_detail.assignee`, the contributor's Jira data (story points, issue counts) will be excluded from the combined metrics — even though their Git data is present.

#### Alignment Process (Manual SQL Required)

**Important:** The `jira_detail` and `jira_history` tables must be populated BEFORE you can perform alignment. Run the pipeline first to load Jira data.

**Step 1: Run the pipeline to populate all tables**

```bash
# Via Command Palette: Gitr: Run Pipeline
# Or wait for scheduled pipeline execution
```

**Step 2: Identify mismatches between Git contributors and Jira assignees**

```sql
-- Find Git contributors without Jira name alignment
SELECT cc.login, cc.username, cc.full_name, cc.jira_name
FROM commit_contributors cc
WHERE cc.jira_name IS NULL
ORDER BY cc.full_name;

-- List distinct Jira assignee names (what you need to match)
SELECT DISTINCT assignee
FROM jira_detail
WHERE assignee IS NOT NULL
ORDER BY assignee;

-- Find potential matches (fuzzy comparison)
SELECT DISTINCT
    cc.full_name AS git_name,
    cc.jira_name AS current_jira_name,
    jd.assignee AS jira_assignee
FROM commit_contributors cc
CROSS JOIN (SELECT DISTINCT assignee FROM jira_detail WHERE assignee IS NOT NULL) jd
WHERE cc.jira_name IS NULL
  AND (
      LOWER(cc.full_name) LIKE '%' || LOWER(SPLIT_PART(jd.assignee, ' ', 1)) || '%'
      OR LOWER(jd.assignee) LIKE '%' || LOWER(SPLIT_PART(cc.full_name, ' ', 1)) || '%'
  )
ORDER BY cc.full_name, jd.assignee;
```

**Step 3: Update `full_name` and `jira_name` to match Jira assignee values**

Set both columns to the same value — this ensures consistency across all dashboard types.

```sql
-- Example: Map a Git contributor to their Jira identity
-- Set both full_name and jira_name to the exact value from jira_detail.assignee
UPDATE commit_contributors
SET full_name = 'Jane Doe',
    jira_name = 'Jane Doe'  -- Must match exactly what appears in jira_detail.assignee
WHERE login = 'jdoe';

-- Bulk update for multiple contributors (always set both columns)
UPDATE commit_contributors SET full_name = 'Alice Smith', jira_name = 'Alice Smith' WHERE login = 'asmith';
UPDATE commit_contributors SET full_name = 'Bob Johnson', jira_name = 'Bob Johnson' WHERE login = 'bjohnson';
UPDATE commit_contributors SET full_name = 'Charlie Brown', jira_name = 'Charlie Brown' WHERE login IN ('cbrown', 'charlie.brown');
```

**Step 4: Verify alignment with a test join**

```sql
-- Verify contributors now join correctly to Jira data
SELECT
    cc.full_name,
    cc.jira_name,
    COUNT(DISTINCT jd.jira_key) AS jira_issues,
    SUM(jd.points) AS total_points
FROM commit_contributors cc
LEFT JOIN jira_detail jd ON jd.assignee = cc.jira_name
WHERE cc.jira_name IS NOT NULL
GROUP BY cc.full_name, cc.jira_name
ORDER BY total_points DESC NULLS LAST;

-- Check for any remaining unaligned contributors with commits
SELECT cc.full_name, COUNT(ch.sha) AS commit_count
FROM commit_contributors cc
JOIN commit_history ch ON ch.author = cc.username
WHERE cc.jira_name IS NULL
GROUP BY cc.full_name
HAVING COUNT(ch.sha) > 10  -- Only show active contributors
ORDER BY commit_count DESC;
```

#### Workflow Summary

```
1. Run Pipeline          → Populates commit_contributors (Git) and jira_detail/jira_history (Jira)
2. Query Both Sources    → Identify name mismatches using SELECT queries above
3. Update jira_name      → Set commit_contributors.jira_name to match jira_detail.assignee exactly
4. Verify Alignment      → Run test join query to confirm data links correctly
5. Refresh Dashboards    → Sprint Velocity and Developer Profile charts now show combined metrics
```

**Note:** This is a one-time setup per contributor. Once `jira_name` is set, it persists across pipeline runs. You only need to revisit alignment when new contributors join or Jira display names change.

---

## Further Reference

- [SETTINGS.md](docs/SETTINGS.md) — Complete settings reference with all 24 settings
- [OVERVIEW.md](docs/OVERVIEW.md) — Extension overview and feature highlights
