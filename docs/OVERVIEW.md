# Gitr - Git Analytics Pipeline

**Gitr** transforms your Git repositories into actionable engineering intelligence. It extracts commit history, links commits to Jira and Linear issues, syncs contributor data from GitHub, and calculates team-level metrics — all from within VS Code. Data is stored locally in PostgreSQL (via Docker), keeping your engineering analytics private, fast, and under your control. Supports both **Jira and Linear** as issue trackers, with per-repository configuration.

## Feature Highlights

### Git Commit Analysis
Extract and analyze commit history across multiple repositories. Track file changes, code complexity trends, branch activity, and contributor patterns from `git log` data.

### Dual Issue Tracker Support
Connect to **Jira** or **Linear** (or both, across different repositories) to load issues, track status changes, and link commits to issues via automatic regex pattern matching on commit messages.

### GitHub Contributor Sync
Enrich contributor profiles with data from the GitHub API — full names, organizations, and repository associations.

### Team Analytics
Automatically assign contributors to teams based on their most-frequent issue prefix. View team-level commit and contribution metrics in interactive dashboards.

### Interactive Dashboards
Two webview panels with Chart.js visualizations:
- **Metrics Dashboard** — Commit trends, team contributions, technology stack distribution, code complexity
- **Issue Linkage** — Searchable table of commit-to-issue relationships for both Jira and Linear

### Pipeline Scheduling
Run the analytics pipeline manually or on a configurable cron schedule. A 9-step pipeline handles everything from commit extraction through team assignment calculation.

### Sidebar TreeViews
Four TreeViews in the Gitr sidebar panel:
- **Repositories** — Configured repos with tracker type badges
- **Repo Stats** — Per-repo commit and branch statistics
- **Contributors** — Team-grouped contributor list with commit counts
- **Pipeline Runs** — Execution history with status and duration

## Quick Start

### Jira Setup

1. **Start the database:** `docker compose up -d`
2. **Install the extension:** `code --install-extension gitr-0.1.0.vsix`
3. **Configure repositories:** Add repos to `gitrx.repositories` in VS Code settings
4. **Set credentials:** Run **Gitr: Set Database Password** and **Gitr: Set Jira API Token** from the Command Palette
5. **Run the pipeline:** Run **Gitr: Run Pipeline** from the Command Palette

### Linear Setup

1. **Start the database:** `docker compose up -d`
2. **Install the extension:** `code --install-extension gitr-0.1.0.vsix`
3. **Configure repositories:** Add repos with `"trackerType": "linear"` to `gitrx.repositories`
4. **Set credentials:** Run **Gitr: Set Database Password** and **Gitr: Set Linear API Token** from the Command Palette
5. **Configure team keys:** Set `gitrx.linear.teamKeys` to your Linear team key prefixes (e.g., `["ENG", "PLAT"]`)
6. **Run the pipeline:** Run **Gitr: Run Pipeline** from the Command Palette

## Requirements

| Requirement | Version |
|-------------|---------|
| VS Code | >= 1.85.0 |
| Docker + Docker Compose | Required (PostgreSQL 16 container) |
| Node.js | >= 20.x (for building from source) |

## Key Settings

| Setting | Description |
|---------|-------------|
| `gitrx.repositories` | List of Git repos to analyze (path, name, trackerType) |
| `gitrx.jira.server` | Jira Cloud server URL |
| `gitrx.jira.projectKeys` | Jira project keys to track |
| `gitrx.linear.teamKeys` | Linear team keys to track |
| `gitrx.schedule.enabled` | Enable automatic pipeline execution |
| `gitrx.pipeline.steps` | Run specific steps (default = 5 core Jira steps, empty = all 9 steps) |
| `gitrx.logLevel` | Output channel verbosity (TRACE through CRITICAL) |

See [SETTINGS.md](SETTINGS.md) for the full reference of all 24 settings.

## Privacy and Security

- **Local data only** — All data is stored in a local PostgreSQL Docker container. No data leaves your machine.
- **Encrypted credentials** — API tokens and passwords are stored in VS Code's SecretStorage (platform keychain), never in settings files or plaintext.
- **No telemetry** — The extension does not collect or transmit usage data.
- **Parameterized queries** — All database operations use parameterized SQL to prevent injection.

## Release Notes

### v0.1.0

- Initial release
- Git commit extraction from multiple repositories
- Jira issue loading with incremental sync and changelog tracking
- **Linear issue tracking** with full API integration via `@linear/sdk`
- Per-repository `trackerType` configuration (`jira`, `linear`, `none`)
- GitHub contributor profile sync
- Commit-to-issue linking via regex for both Jira and Linear
- Team assignment by most-frequent issue prefix
- 9-step configurable pipeline with schedule support
- 4 sidebar TreeViews (Repositories, Repo Stats, Contributors, Pipeline Runs)
- 2 webview panels (Metrics Dashboard, Issue Linkage)
- 18 commands including credential management for 4 services
- PostgreSQL 16 in Docker with 4 migration scripts (23 tables, 9 views)

## License

MIT

## Repository

[github.com/antonajp/gitr](https://github.com/antonajp/gitr)

## Documentation

- [USAGE.md](USAGE.md) — Step-by-step usage guide
- [SETTINGS.md](SETTINGS.md) — Complete settings reference
