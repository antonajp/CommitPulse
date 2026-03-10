# Gitr Settings Reference

Complete reference for all VS Code settings used by the Gitr extension (v0.1.0).

All settings use the `gitrx.*` namespace and can be configured in VS Code's `settings.json` (File > Preferences > Settings > Extensions > Gitr).

## Quick Reference

| Setting | Type | Default | When to Change |
|---------|------|---------|----------------|
| `gitrx.repositories` | array | `[]` | Always — must configure at least one repo |
| `gitrx.database.host` | string | `"localhost"` | Remote database or non-default Docker host |
| `gitrx.database.port` | number | `5433` | Port conflict with another service |
| `gitrx.database.name` | string | `"gitrx"` | Multiple Gitr installations or custom DB name |
| `gitrx.database.user` | string | `"gitrx_admin"` | Custom database user |
| `gitrx.database.migrationUser` | string | `""` | Privilege separation for DDL operations |
| `gitrx.jira.server` | string | `""` | Using Jira as issue tracker |
| `gitrx.jira.username` | string | `""` | Using Jira as issue tracker |
| `gitrx.jira.projectKeys` | array | `[]` | Using Jira — specify which projects to track |
| `gitrx.jira.keyAliases` | object | `{}` | Jira projects have been renamed |
| `gitrx.jira.pointsField` | string | `"customfield_10034"` | Your Jira uses a different story points field |
| `gitrx.jira.maxKeys` | number | `0` | Override auto-detection of max issue number |
| `gitrx.jira.increment` | number | `200` | Adjust incremental scan range per run |
| `gitrx.jira.daysAgo` | number | `2` | Adjust how far back to refresh unfinished issues |
| `gitrx.jira.urlPrefix` | string | `""` | Custom Jira URL for issue navigation |
| `gitrx.linear.teamKeys` | array | `[]` | Using Linear as issue tracker |
| `gitrx.linear.keyAliases` | object | `{}` | Linear teams have been renamed |
| `gitrx.linear.maxKeys` | number | `0` | Override auto-detection of max issue number |
| `gitrx.linear.increment` | number | `200` | Adjust incremental scan range per run |
| `gitrx.linear.daysAgo` | number | `2` | Adjust how far back to refresh unfinished issues |
| `gitrx.linear.urlPrefix` | string | `""` | Custom Linear URL for issue navigation |
| `gitrx.github.organization` | string | `""` | Using GitHub contributor sync |
| `gitrx.schedule.enabled` | boolean | `false` | Enable automatic pipeline runs |
| `gitrx.schedule.cronExpression` | string | `"0 9 * * 1-5"` | Change automatic run schedule |
| `gitrx.pipeline.steps` | array | 5 core Jira steps | Run only specific pipeline steps |
| `gitrx.pipeline.sinceDate` | string | `""` | Limit git extraction to commits after this date |
| `gitrx.docker.postgresVersion` | string | `"16"` | Use a different PostgreSQL version |
| `gitrx.logLevel` | string | `"INFO"` | Debugging issues or reducing log noise |
| `gitrx.arcComponent.extensionMapping` | object | (see below) | Customize file extension to component mapping |
| `gitrx.arcComponent.filenameMapping` | object | (see below) | Customize filename to component mapping |
| `gitrx.charts.topNComplexFiles` | number | `20` | Change number of files in complexity chart |
| `gitrx.releaseManagement.productionBranches` | array | (see below) | Customize production branch names |
| `gitrx.releaseManagement.stagingBranches` | array | (see below) | Customize staging branch names |
| `gitrx.releaseManagement.defaultTimeRangeDays` | number | `30` | Default time range for release chart |

## SecretStorage Credentials

Secrets are stored encrypted by VS Code's platform-specific credential store (macOS Keychain, Windows Credential Locker, Linux libsecret). They are **never** stored in `settings.json`.

| Command | Secret | Format | Notes |
|---------|--------|--------|-------|
| `Gitr: Set Database Password` | PostgreSQL password | Any string | Must match `DB_PASSWORD` in `.env` |
| `Gitr: Set Migration Database Password` | Migration user password | Any string | For DDL operations when using privilege separation |
| `Gitr: Set Jira API Token` | Jira API token | Any string | Generate at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `Gitr: Set GitHub Token` | GitHub PAT | `ghp_*` or `github_pat_*` | Requires `read:org` and `read:user` scopes |
| `Gitr: Set Linear API Token` | Linear API key | `lin_api_*` | Generate at Linear > Settings > API > Personal API keys |

To set a credential, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and search for the command name above.

---

## Repositories

### `gitrx.repositories`

**Type:** `array` of objects
**Default:** `[]`
**Impact:** Defines which Git repositories are analyzed by the pipeline.

Each entry requires:
- `path` (string, required) — Absolute path to the Git repository
- `name` (string, required) — Display name shown in TreeViews and reports
- `organization` (string, optional) — Organization or team that owns this repository
- `trackerType` (string, optional) — Issue tracker type: `"jira"` (default), `"linear"`, or `"none"`
- `repoUrl` (string, optional) — Repository URL for commit and PR linking (e.g., `https://github.com/owner/repo`)
- `startDate` (string, optional) — Earliest commit date to extract in `YYYY-MM-DD` format. Commits before this date are ignored. Overrides the global `gitrx.pipeline.sinceDate` setting.

The `trackerType` determines which issue tracker is used for linking commits to issues for each repository. This is a per-repository setting — each repo uses exactly one tracker type. You cannot use both Jira and Linear for the same repository.

The `repoUrl` is used to generate clickable links to commits in charts and dashboards. When set, commit hashes link directly to the commit page on GitHub (or other Git hosting platforms).

**Example — Jira repositories with GitHub links:**
```json
"gitrx.repositories": [
  {
    "path": "/home/user/repos/web-app",
    "name": "Web App",
    "organization": "Engineering",
    "trackerType": "jira",
    "repoUrl": "https://github.com/myorg/web-app"
  },
  {
    "path": "/home/user/repos/mobile-app",
    "name": "Mobile App",
    "organization": "Engineering"
  }
]
```

> When `trackerType` is omitted, it defaults to `"jira"` for backward compatibility.

**Example — Linear repositories:**
```json
"gitrx.repositories": [
  {
    "path": "/home/user/repos/platform-api",
    "name": "Platform API",
    "organization": "Platform",
    "trackerType": "linear",
    "repoUrl": "https://github.com/myorg/platform-api"
  }
]
```

**Example — Mixed environment (Jira + Linear):**
```json
"gitrx.repositories": [
  {
    "path": "/home/user/repos/legacy-app",
    "name": "Legacy App",
    "trackerType": "jira",
    "repoUrl": "https://github.com/myorg/legacy-app"
  },
  {
    "path": "/home/user/repos/new-service",
    "name": "New Service",
    "trackerType": "linear",
    "repoUrl": "https://github.com/myorg/new-service"
  },
  {
    "path": "/home/user/repos/scripts",
    "name": "Scripts",
    "trackerType": "none"
  }
]
```

**Example — Limiting git history extraction with startDate:**
```json
"gitrx.repositories": [
  {
    "path": "/home/user/repos/ancient-monolith",
    "name": "Monolith",
    "trackerType": "jira",
    "repoUrl": "https://github.com/myorg/monolith",
    "startDate": "2022-01-01"
  },
  {
    "path": "/home/user/repos/new-microservice",
    "name": "New Microservice",
    "trackerType": "linear",
    "repoUrl": "https://github.com/myorg/new-microservice",
    "startDate": "2024-06-01"
  }
]
```

> **Performance tip:** For repositories with 10+ years of history, setting a `startDate` significantly reduces initial pipeline run time by skipping irrelevant historical commits that predate your issue tracker adoption.

---

## Database

### `gitrx.database.host`

**Type:** `string`
**Default:** `"localhost"`
**Impact:** PostgreSQL connection target. Only change for remote database hosting.

### `gitrx.database.port`

**Type:** `number`
**Default:** `5433`
**Range:** 1–65535
**Impact:** Port on which the PostgreSQL Docker container is exposed. Default `5433` avoids conflicts with other local PostgreSQL instances running on the standard `5432` port.

> Must match `DB_PORT` in your `.env` file and the `docker-compose.yml` port mapping.

### `gitrx.database.name`

**Type:** `string`
**Default:** `"gitrx"`
**Impact:** PostgreSQL database name. Must match `DB_NAME` in `.env`.

### `gitrx.database.user`

**Type:** `string`
**Default:** `"gitrx_admin"`
**Impact:** PostgreSQL login user. Must match `DB_USER` in `.env`. The password is stored via **Gitr: Set Database Password** (SecretStorage), not in settings.

### `gitrx.database.migrationUser`

**Type:** `string`
**Default:** `""` (empty)
**Impact:** Optional privileged PostgreSQL user for running database migrations (DDL operations like CREATE TABLE, ALTER, DROP). If left empty, the main `gitrx.database.user` is used for both migrations and pipeline queries.

Set this for privilege separation: keep `gitrx.database.user` restricted to DML (SELECT, INSERT, UPDATE, DELETE) while using `migrationUser` for schema changes.

The migration user's password is stored via **Gitr: Set Migration Database Password** (SecretStorage). If no migration password is set, the main database password is used.

---

## Jira

Configure these settings when your repositories use `trackerType: "jira"` (the default).

### `gitrx.jira.server`

**Type:** `string`
**Default:** `""` (empty)
**Format:** URI
**Impact:** Jira server URL for API authentication. Required for Jira issue loading.

**Example:**
```json
"gitrx.jira.server": "https://yourorg.atlassian.net"
```

### `gitrx.jira.username`

**Type:** `string`
**Default:** `""` (empty)
**Impact:** Jira username (email address) for API authentication. The API token is stored via **Gitr: Set Jira API Token** (SecretStorage).

**Example:**
```json
"gitrx.jira.username": "developer@yourorg.com"
```

### `gitrx.jira.projectKeys`

**Type:** `array` of strings
**Default:** `[]`
**Pattern:** Each key must match `^[A-Z][A-Z0-9_]+$`
**Impact:** Jira project keys to track. The pipeline loads issues from these projects and uses the keys for commit-Jira linking via regex.

**Example:**
```json
"gitrx.jira.projectKeys": ["PROJ", "FEAT", "BUG"]
```

### `gitrx.jira.keyAliases`

**Type:** `object` (string keys → string values)
**Default:** `{}`
**Impact:** Maps old Jira project keys to their current names. When a project is renamed in Jira (e.g., `PROJ` → `PROJ2`), add an alias so historical commits referencing the old key are correctly linked.

**Example:**
```json
"gitrx.jira.keyAliases": {
  "PROJ": "PROJ2",
  "CRM": "CRMSYS"
}
```

### `gitrx.jira.pointsField`

**Type:** `string`
**Default:** `"customfield_10034"`
**Impact:** Jira custom field ID used for story points. This varies by Jira instance — check your Jira administration settings to find the correct field ID.

### `gitrx.jira.maxKeys`

**Type:** `number`
**Default:** `0`
**Range:** 0+
**Impact:** Maximum issue key number to scan per project.

- `0` (default) — Auto-detect from database: finds the current max key and scans forward by `gitrx.jira.increment`
- Any positive number — Scan up to `PROJECT-N` (e.g., setting `500` scans `PROJ-1` through `PROJ-500`)

### `gitrx.jira.increment`

**Type:** `number`
**Default:** `200`
**Range:** 1–5000
**Impact:** Number of issues to fetch beyond the current max issue number per incremental run. During each pipeline execution, the loader scans from `maxKey` to `maxKey + increment` for each project. Increase for high-velocity projects, decrease for small projects.

### `gitrx.jira.daysAgo`

**Type:** `number`
**Default:** `2`
**Range:** 0–365
**Impact:** Number of days to look back when refreshing unfinished Jira issues. Issues that transitioned to Done/Cancelled within this window are also refreshed. Increase if issues are frequently updated days after completion.

### `gitrx.jira.urlPrefix`

**Type:** `string`
**Default:** `""` (empty)
**Format:** URI
**Impact:** Base URL for Jira issue navigation in charts and dashboards. When set, issue links open as `{urlPrefix}/browse/{ISSUE-KEY}`. If empty, falls back to `gitrx.jira.server/browse/`.

Use this when your Jira server URL differs from the URL used for API access (e.g., internal vs external URLs).

**Example:**
```json
"gitrx.jira.urlPrefix": "https://yourorg.atlassian.net"
```

---

## Linear

Configure these settings when your repositories use `trackerType: "linear"`.

### `gitrx.linear.teamKeys`

**Type:** `array` of strings
**Default:** `[]`
**Pattern:** Each key must match `^[A-Z][A-Z0-9_]+$`
**Impact:** Linear team keys to track. The pipeline loads issues from these teams and uses the keys for commit-Linear linking via regex. These are the short prefix codes visible in Linear issue identifiers (e.g., `ENG` in `ENG-123`).

**Example:**
```json
"gitrx.linear.teamKeys": ["ENG", "PLAT", "IQS"]
```

### `gitrx.linear.keyAliases`

**Type:** `object` (string keys → string values)
**Default:** `{}`
**Impact:** Maps old Linear team keys to their current names. When a team is renamed in Linear, add an alias so historical commits referencing the old key are correctly linked.

**Example:**
```json
"gitrx.linear.keyAliases": {
  "OLD": "NEW"
}
```

### `gitrx.linear.maxKeys`

**Type:** `number`
**Default:** `0`
**Range:** 0+
**Impact:** Maximum issue key number to scan per team. Set to `0` (default) to auto-detect from the database and scan forward by `gitrx.linear.increment`.

### `gitrx.linear.increment`

**Type:** `number`
**Default:** `200`
**Range:** 1–5000
**Impact:** Number of issues to fetch beyond the current max issue number per incremental Linear run. Increase for high-velocity teams with many issues per sprint.

### `gitrx.linear.daysAgo`

**Type:** `number`
**Default:** `2`
**Range:** 0–365
**Impact:** Number of days to look back when refreshing unfinished Linear issues. Issues that recently transitioned to Completed or Canceled are refreshed during this window.

### `gitrx.linear.urlPrefix`

**Type:** `string`
**Default:** `""` (empty)
**Format:** URI
**Impact:** Base URL for Linear issue navigation in charts and dashboards. When set, issue links open as `{urlPrefix}/issue/{ISSUE-KEY}`. If empty, the team key is extracted from the issue ID and the URL is built as `https://linear.app/{team}/issue/{ISSUE-KEY}`.

**Example:**
```json
"gitrx.linear.urlPrefix": "https://linear.app/yourteam"
```

---

## GitHub

### `gitrx.github.organization`

**Type:** `string`
**Default:** `""` (empty)
**Impact:** GitHub organization name for contributor sync. When configured along with a GitHub token (via **Gitr: Set GitHub Token**), the pipeline fetches contributor profiles from GitHub and populates the `commit_contributors` table.

**Example:**
```json
"gitrx.github.organization": "my-org"
```

---

## Schedule

### `gitrx.schedule.enabled`

**Type:** `boolean`
**Default:** `false`
**Impact:** When `true`, the pipeline runs automatically on the schedule defined by `gitrx.schedule.cronExpression`. Can also be toggled via the **Gitr: Toggle Scheduled Pipeline** command.

### `gitrx.schedule.cronExpression`

**Type:** `string`
**Default:** `"0 9 * * 1-5"`
**Impact:** Cron expression defining the automatic pipeline run schedule. Uses standard 5-field cron syntax (`minute hour day-of-month month day-of-week`).

**Common cron expressions:**

| Expression | Schedule |
|------------|----------|
| `0 9 * * 1-5` | Weekdays at 9:00 AM (default) |
| `0 */4 * * *` | Every 4 hours |
| `0 0 * * *` | Daily at midnight |
| `0 0 * * 0` | Weekly on Sunday at midnight |
| `0 6,18 * * 1-5` | Weekdays at 6:00 AM and 6:00 PM |
| `30 8 * * 1-5` | Weekdays at 8:30 AM |

---

## Pipeline

### `gitrx.pipeline.steps`

**Type:** `array` of strings
**Default:** 5 core Jira steps: `["gitCommitExtraction", "githubContributorSync", "jiraIssueLoading", "jiraChangelogUpdate", "commitJiraLinking"]`
**Impact:** Controls which pipeline steps execute when running **Gitr: Run Pipeline**. The default runs 5 core Jira steps that work out of the box. Set to `[]` (empty array) to run all 9 steps including Linear integration and team assignment.

**Available steps (in execution order):**

| Step ID | Description | Tracker |
|---------|-------------|---------|
| `gitCommitExtraction` | Extract commits from Git repositories | All |
| `githubContributorSync` | Sync contributors from GitHub | All |
| `jiraIssueLoading` | Load new Jira issues incrementally | Jira |
| `jiraChangelogUpdate` | Refresh unfinished Jira issues | Jira |
| `commitJiraLinking` | Link commits to Jira issues via regex | Jira |
| `linearIssueLoading` | Load new Linear issues incrementally | Linear |
| `linearChangelogUpdate` | Refresh unfinished Linear issues | Linear |
| `commitLinearLinking` | Link commits to Linear issues via regex | Linear |
| `teamAssignment` | Calculate primary team assignments | All |

**Tracker-conditional behavior:** When the pipeline runs, Jira steps (`jiraIssueLoading`, `jiraChangelogUpdate`, `commitJiraLinking`) operate on repositories with `trackerType: "jira"`, while Linear steps (`linearIssueLoading`, `linearChangelogUpdate`, `commitLinearLinking`) operate on repositories with `trackerType: "linear"`. Steps for an unconfigured tracker are gracefully skipped.

**Step dependency chain:**

```
gitCommitExtraction ─┐
                     ├─ commitJiraLinking ──┐
jiraIssueLoading ────┤                      │
jiraChangelogUpdate ─┘                      ├─ teamAssignment
                                            │
githubContributorSync ──────────────────────┤
                                            │
linearIssueLoading ───┐                     │
linearChangelogUpdate ┤─ commitLinearLinking┘
                      └
```

Commit extraction and issue loading must complete before linking steps. Team assignment runs last as it depends on commit-issue links.

**Example — Run only Git extraction and Jira steps:**
```json
"gitrx.pipeline.steps": [
  "gitCommitExtraction",
  "jiraIssueLoading",
  "jiraChangelogUpdate",
  "commitJiraLinking"
]
```

### `gitrx.pipeline.sinceDate`

**Type:** `string`
**Default:** `""` (empty)
**Pattern:** `YYYY-MM-DD`
**Impact:** Global cutoff date for commit extraction. Commits before this date are ignored during the `gitCommitExtraction` pipeline step. This is essential for large repositories with many years of history where only recent commits are relevant.

When both a global `sinceDate` and a per-repository `startDate` are configured, the **later** of the two dates is used for that repository.

**Example:**
```json
"gitrx.pipeline.sinceDate": "2023-01-01"
```

> **When to use:** Set this when you have multiple repositories that all started tracking issues around the same time (e.g., when your organization adopted Jira or Linear). For repositories with different histories, use the per-repo `startDate` instead.

---

## Docker

### `gitrx.docker.postgresVersion`

**Type:** `string`
**Default:** `"16"`
**Impact:** PostgreSQL Docker image version tag used in `docker-compose.yml`. The default matches the project's tested configuration (`postgres:16-alpine`).

---

## Logging

### `gitrx.logLevel`

**Type:** `string` (enum)
**Default:** `"INFO"`
**Impact:** Controls verbosity of the Gitr output channel (View > Output > Gitr).

| Level | Description | When to Use |
|-------|-------------|-------------|
| `TRACE` | Most verbose — all internal operations, SQL queries, iteration details | Deep debugging of pipeline internals |
| `DEBUG` | Detailed diagnostic information — service initialization, step transitions | Troubleshooting configuration or connectivity |
| `INFO` | General operational messages — pipeline start/end, step summaries | Normal operation (default) |
| `WARN` | Warning conditions — missing config, fallback defaults, recoverable errors | Monitoring for potential issues |
| `ERROR` | Error conditions — step failures, connection errors, API failures | Production monitoring |
| `CRITICAL` | Only critical failures — pipeline start/end markers, fatal errors | Minimal logging for quiet operation |

---

## Architecture Components

These settings control how files are classified into architecture components for the Architecture Drift chart and related analytics.

### `gitrx.arcComponent.extensionMapping`

**Type:** `object` (string keys → string values)
**Default:** Comprehensive mapping of common extensions (see below)
**Impact:** Maps file extensions to architecture component categories. Multi-dot extensions (e.g., `.test.tsx`) take precedence over single-dot extensions (`.tsx`). Extension matching is case-insensitive.

**Categories:** `Front-End`, `Back-End`, `Database`, `DevOps/CI`, `Configuration`, `Documentation`, `Testing`, `Build/Tooling`, `Assets`, `Other`

**Default mappings include:**
| Extensions | Category |
|------------|----------|
| `.ts`, `.js`, `.py`, `.mjs`, `.cjs`, `.cls`, `.trigger`, `.apex` | Back-End |
| `.jsx`, `.html`, `.css`, `.ejs`, `.svg`, `.component`, `.page` | Front-End |
| `.tf`, `.tfvars`, `.yaml`, `.yml`, `.sh`, `.worker`, `.service` | DevOps/CI |
| `.sql`, `.prisma`, `.rules`, `.object`, `.field`, `.soql` | Database |
| `.json`, `.toml`, `.ini`, `.xml`, `.example`, `.profile` | Configuration |
| `.md`, `.txt`, `.docx`, `.rtf`, `.auradoc` | Documentation |
| `.test.ts`, `.test.js`, `.spec.ts`, `.spec.js`, `.testSuite` | Testing |
| `.map` | Build/Tooling |
| `.png`, `.jpg`, `.jpeg`, `.webp`, `.ico`, `.mp3`, `.resource` | Assets |
| `.csv`, `.backup`, `.bkup` | Other |

**Example — Add custom mappings:**
```json
"gitrx.arcComponent.extensionMapping": {
  ".proto": "Back-End",
  ".graphql": "Back-End",
  ".scss": "Front-End",
  ".less": "Front-End"
}
```

> After editing, run **Gitr: Backfill Architecture Components** to apply changes to existing data.

### `gitrx.arcComponent.filenameMapping`

**Type:** `object` (string keys → string values)
**Default:** Common config and build filenames (see below)
**Impact:** Maps specific filenames (case-sensitive) to architecture component categories. Filename matches always take precedence over extension matches.

**Default mappings include:**
| Filename | Category |
|----------|----------|
| `Dockerfile`, `.dockerignore`, `Jenkinsfile`, `docker-compose.yml` | DevOps/CI |
| `tfplan`, `pre-commit`, `.trivyignore` | DevOps/CI |
| `.gitignore`, `.gitkeep`, `.prettierrc`, `tsconfig.json` | Configuration |
| `sfdx-project.json`, `.firebaserc`, `eslint.config.mjs` | Configuration |
| `LICENSE` | Documentation |
| `Makefile`, `package.json`, `esbuild.config.mjs` | Build/Tooling |
| `jest.config.js`, `vitest.config.ts` | Testing |

**Example — Add custom mappings:**
```json
"gitrx.arcComponent.filenameMapping": {
  "Procfile": "DevOps/CI",
  ".eslintrc": "Configuration",
  "webpack.config.js": "Build/Tooling"
}
```

> After editing, run **Gitr: Backfill Architecture Components** to apply changes to existing data.

---

## Charts

### `gitrx.charts.topNComplexFiles`

**Type:** `number`
**Default:** `20`
**Range:** 1–100
**Impact:** Number of top complex files to display in the File Complexity chart. Increase to see more files, decrease for a cleaner view.

---

## Release Management

These settings control how the Release Management chart identifies production and staging releases.

### `gitrx.releaseManagement.productionBranches`

**Type:** `array` of strings
**Default:** `["main", "master", "prod", "production"]`
**Impact:** Branch names considered as production environments for release tracking. Merges to these branches are counted as production releases. Branches matching `release/*` patterns are also considered production.

**Example:**
```json
"gitrx.releaseManagement.productionBranches": ["main", "release"]
```

### `gitrx.releaseManagement.stagingBranches`

**Type:** `array` of strings
**Default:** `["staging", "stage", "uat", "develop", "dev"]`
**Impact:** Branch names considered as staging/development environments for release tracking. Merges to these branches are counted as staging releases.

**Example:**
```json
"gitrx.releaseManagement.stagingBranches": ["staging", "qa", "develop"]
```

### `gitrx.releaseManagement.defaultTimeRangeDays`

**Type:** `number`
**Default:** `30`
**Range:** 1–365
**Impact:** Default time range in days for the Release Management chart. Controls how far back the chart displays release data by default.

---

## Example Configurations

### Minimal Required (Jira)

```json
{
  "gitrx.repositories": [
    {
      "path": "/home/user/repos/my-app",
      "name": "My App",
      "repoUrl": "https://github.com/myorg/my-app"
    }
  ],
  "gitrx.jira.server": "https://yourorg.atlassian.net",
  "gitrx.jira.username": "developer@yourorg.com",
  "gitrx.jira.projectKeys": ["MYAPP"]
}
```

Then set credentials via Command Palette:
- **Gitr: Set Database Password**
- **Gitr: Set Jira API Token**

### Minimal Required (Linear)

```json
{
  "gitrx.repositories": [
    {
      "path": "/home/user/repos/my-service",
      "name": "My Service",
      "trackerType": "linear",
      "repoUrl": "https://github.com/myorg/my-service"
    }
  ],
  "gitrx.linear.teamKeys": ["ENG"]
}
```

Then set credentials via Command Palette:
- **Gitr: Set Database Password**
- **Gitr: Set Linear API Token**

### Full Production

```json
{
  "gitrx.repositories": [
    {
      "path": "/home/user/repos/web-app",
      "name": "Web App",
      "organization": "Engineering",
      "trackerType": "jira",
      "repoUrl": "https://github.com/myorg/web-app"
    },
    {
      "path": "/home/user/repos/platform-api",
      "name": "Platform API",
      "organization": "Platform",
      "trackerType": "linear",
      "repoUrl": "https://github.com/myorg/platform-api"
    },
    {
      "path": "/home/user/repos/devops-scripts",
      "name": "DevOps Scripts",
      "organization": "Infrastructure",
      "trackerType": "none",
      "repoUrl": "https://github.com/myorg/devops-scripts"
    }
  ],
  "gitrx.database.host": "localhost",
  "gitrx.database.port": 5433,
  "gitrx.database.name": "gitrx",
  "gitrx.database.user": "gitrx_admin",
  "gitrx.jira.server": "https://yourorg.atlassian.net",
  "gitrx.jira.username": "developer@yourorg.com",
  "gitrx.jira.projectKeys": ["PROJ", "FEAT", "BUG"],
  "gitrx.jira.keyAliases": {
    "PROJ": "PROJ2",
    "CRM": "CRMSYS"
  },
  "gitrx.jira.pointsField": "customfield_10034",
  "gitrx.jira.increment": 200,
  "gitrx.jira.daysAgo": 2,
  "gitrx.linear.teamKeys": ["ENG", "PLAT"],
  "gitrx.linear.keyAliases": {},
  "gitrx.linear.increment": 200,
  "gitrx.linear.daysAgo": 2,
  "gitrx.github.organization": "my-org",
  "gitrx.schedule.enabled": true,
  "gitrx.schedule.cronExpression": "0 9 * * 1-5",
  "gitrx.logLevel": "INFO",
  "gitrx.releaseManagement.productionBranches": ["main", "master"],
  "gitrx.releaseManagement.stagingBranches": ["staging", "develop"],
  "gitrx.charts.topNComplexFiles": 25
}
```

### Debugging

```json
{
  "gitrx.logLevel": "DEBUG",
  "gitrx.pipeline.steps": ["gitCommitExtraction"],
  "gitrx.schedule.enabled": false
}
```

Set log level to `DEBUG` or `TRACE`, run a single pipeline step, and examine the Gitr output channel for diagnostic details.
