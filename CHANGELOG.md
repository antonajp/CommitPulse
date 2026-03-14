# Changelog

All notable changes to the CommitPulse extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

[0;34m[INFO][0m Generating changelog from commits since v0.1.10...
## [0.1.11] - 2026-03-13

### Changed

- Split velocity-chart-html.ts into modular components

### Fixed

- Fix profile badge contrast for dark VS Code themes

[0;34m[INFO][0m Generating changelog from commits since v0.1.9...
## [0.1.10] - 2026-03-13

[0;34m[INFO][0m Generating changelog from commits since v0.1.8...
## [0.1.9] - 2026-03-13

### Added

- Add rate limiting and CSP documentation to webview panels
- Sprint Velocity vs LOC dual story points comparison
- Add Contributor Profile Badges to Team Scorecard Chart
- Story Points Trend Chart - Development vs QA Status

### Fixed

- Fix LOC/Complexity delta charts showing 1000-2000% inflated values
- Fix Team Scorecard commit count query join
- Fix incremental commit detection for subsequent pipeline runs
- Expand commit hygiene prefix detection and add Issues tooltip
- Support Bitbucket and GitLab commit URL formats

[0;34m[INFO][0m Generating changelog from commits since v0.1.7...
## [0.1.8] - 2026-03-11

### Added

- Add configurable log level for Git history extraction

[0;34m[INFO][0m Generating changelog from commits since v0.1.5...
## [0.1.7] - 2026-03-11

### Fixed

- Resolve TypeScript type check errors with ESM module imports

## [0.1.6] - 2026-03-11

### Fixed

- Fix TypeScript type check errors with jira.js v5.x ESM imports by switching to bundler module resolution
- Remove unused @ts-expect-error directives for @octokit/rest imports

## [0.1.5] - 2026-03-10

### Fixed

- Clean up CHANGELOG.md formatting

## [0.1.4] - 2026-03-09

### Added

- Add Jira Backfill Command to clear and reload Jira data
- Add Jira API debug logging with VS Code setting

### Changed

- Reference the associated VS Code Marketplace Extension in the README.md
- Revised CommitPulse description

## [0.1.3] - 2026-03-09

### Added

- Add per-repository startDate setting to limit git history extraction
- Add marketplace publish script with public repo sync
- Split Developer Pipeline into 4 separate metric charts
- Add chart explanation styles, update package.json for CommitPulse
- Set sensible default for gitrx.pipeline.steps setting
- Add explanatory paragraphs to all dashboard charts
- Enhance Development Pipeline chart with multi-axis display and team member coloring
- Add Repository Filter to Sprint Velocity Chart
- Change Dashboard Commit Velocity Chart to LOC per Week
- Add clickable commit and PR links to all webview panels
- Add Jira and Linear URL prefix settings for clickable issue links
- Add repoUrl configuration to repository settings
- Add URL validation utility and security hardening for external links
- Add Architecture Drift Heat Map - Part 2: Webview Panel
- Add Architecture Drift Heat Map - Part 1: Database & Data Service
- Add Commit Hygiene Tracker Dashboard - Part 2: Webview Panel
- Add Commit Hygiene Tracker Dashboard - Part 1: Database & Data Service
- Add Test Debt Predictor Dashboard - Part 2: Webview Panel
- Add Release Risk Gauge Dashboard - Part 2: Webview Panel
- Add Cross-Team Coupling Dashboard - Part 2: Webview & Visualization
- Add Developer Focus Score Dashboard - Part 2: Webview & Visualization
- Add Ticket Lifecycle Sankey Dashboard - Part 2: Webview & Visualization
- Add Knowledge Concentration Dashboard - Part 2: Webview & Visualization
- Add Hot Spots Dashboard - Part 2: Webview & Visualization
- Add Code Review Velocity Dashboard - Part 2: Webview & Visualization
- Add Test Debt Predictor Dashboard - Part 1: Database & Data Service
- Add Release Risk Gauge Dashboard - Part 1: Database & Data Service
- Add Cross-Team Coupling Dashboard - Part 1: Database & Data Service
- Add Developer Focus Score Dashboard - Part 1: Database & Data Service
- Add Ticket Lifecycle Sankey Dashboard - Part 1: Database & Data Service
- Add Knowledge Concentration Dashboard - Part 1: Database & Data Service
- Add Hot Spots Dashboard - Part 1: Database & Data Service
- Add Code Review Velocity Dashboard - Part 1: Database & Data Service
- Enhance Team Scorecard with sortable columns and score components
- Add Release Management Contributions grouped bar chart
- Add Development Pipeline Dashboard - Part 2: Webview & Visualization
- Add Development Pipeline Dashboard Part 1 - Database & Data Service
- Add Top Files by Churn horizontal stacked bar chart to Dashboard
- Replace File Complexity Trends with Top N Complex Files Horizontal Bar Chart
- Add LOC Committed stacked bar chart to Dashboard
- Add Sprint Velocity vs LOC dual-axis line chart (#45)
- Migrate Dashboard and Linkage charts from Chart.js to D3.js
- Add Architecture Component LOC chart with D3.js, Charts TreeView
- Add "Gitr: Backfill Architecture Components" command for commit_files classification
- Add "Gitr: Backfill Story Points" command for duration-based Fibonacci mapping
- Security hardening: scc resource limits, cleanup tracking, repo validation
- Security hardening: prompt rate limiting, migration timeout, path traversal
- Security hardening: SHA-256 checksums, privilege separation, Docker init script fix
- Auto-run pending database migrations on pipeline startup
- Add Linear tracker support: Pipeline Integration & UI Updates
- Add Linear tracker support: Database Schema & Linear API Integration
- Add Linear tracker support: Configuration & Abstraction Layer
- Add E2E integration tests with Docker PostgreSQL and fix getBranchLog bug
- Set up GitHub Actions CI/CD pipeline
- Implement webview export and shared CSS/JS framework
- Implement Commit-Jira Linkage webview panel
- Implement Metrics Dashboard webview panel
- Implement Pipeline Runs TreeView provider
- Implement Contributors/Teams TreeView provider
- Implement Repos TreeView provider with repository statistics
- Implement auto-scheduled background pipeline runs
- Implement pipeline orchestrator with manual command trigger
- Implement file metrics delta calculation (complexity, comments, code changes)
- Implement team assignment and contributor primary team calculation
- Implement commit-to-Jira linking via regex pattern matching
- Implement Jira incremental loading with configurable project list
- Implement Jira changelog, GitHub dev status, and issue update logic
- Implement GitHub contributor sync via @octokit/rest
- Implement Jira issue loading service via jira.js
- Implement scc CLI integration for file-level complexity metrics
- Implement Git commit extraction service using simple-git
- Implement Jira-GitHub data model interfaces
- Build Jira, contributor, and pipeline data repositories
- Build commit data repository (commit_history, commit_files, branches)
- Implement pg connection pool with config and health checks
- Port createCommitHistory.sql schema to TypeScript migration system
- Define VS Code settings schema for multi-repo configuration
- Implement LoggerService with configurable levels and DB logging interface
- Implement SecretStorage service for credentials management
- Add legacy README documenting Python codebase for migration reference
- Set up Docker Compose for PostgreSQL 16 with persistent volume
- Scaffold VS Code extension with TypeScript, esbuild, and package.json
- Move Python files and SQL assets to legacy/ directory

### Changed

- Split oversized Developer Pipeline files to meet 600-line guideline
- Simplify README setup for marketplace users
- Update CHANGELOG for v0.1.1 release
- Update SETTINGS.md with all new extension settings
- Refinements
- Add CommitPulse reference to README and MIT license
- Add marketplace logo for ImproviseLabs publisher
- Add scc as optional prerequisite for code complexity metrics
- Revise vs code secret key storage instructions
- Add trackerType to repositories setting description
- Create extension documentation (USAGE, SETTINGS, OVERVIEW)
- Incorporate linear expert agent
- Refinements
- Add README with local dev setup and npm run dev script
- Planning started
- Initial setup of claude proj
- Setup claude agents for conversion project

### Fixed

- Use repoUrl from VS Code settings for GitHub commit links
- Hide File Churn drilldown modal by default in CSS
- Add icons to view definitions in package.json
- Remove Architecture Components LOC chart (duplicate)
- Correct column name in Status Flow Timeline query
- Handle 404 errors gracefully in GitHub contributor sync
- Exclude dependency directories from LOC metrics
- Fix SQL injection and add input validation in Dashboard queries
- Use raw GraphQL query to eliminate N+1 API calls in Linear loader
- Merge configured teamKeys into Linear loader so first run bootstraps
- Update migration test to match actual docker-compose mount path
- Add custom problem matcher for esbuild watch task to suppress F5 warning
- Change default DB port to 5433 to avoid conflict with other local PostgreSQL instances

### Technical

- Add public repo reference to package.json description
- Add extension metadata and CHANGELOG
- Add CommitPulse sync script, update README, remove legacy/
- Add dev.sh script for build + database + launch workflow

## [0.1.2] - 2025-03-09

### Changed

- **Simplified README setup instructions** - Rewritten for users installing from VS Code Marketplace with step-by-step Docker database setup

## [0.1.1] - 2025-03-09

### Added

- **Split Developer Pipeline Charts** - Developer Pipeline view now offers 4 separate focused charts: Sprint Velocity vs LOC, Code Review Velocity, Hot Spots, and Knowledge Concentration

### Fixed

- Use `repoUrl` from VS Code settings for GitHub commit links instead of deriving from git remote
- Hide File Churn drilldown modal by default in CSS
- Add icons to TreeView definitions in package.json

### Changed

- Updated SETTINGS.md documentation with all extension settings

## [0.1.0] - 2025-03-08

### Added

- **Git Commit Extraction** - Parse git log from configured repositories and store commit history, file changes, directory structure, and tags in PostgreSQL
- **Jira Integration** - Load issues incrementally, sync changelogs, and link commits to Jira tickets via regex matching
- **Linear Integration** - Load issues incrementally, sync changelogs, and link commits to Linear tickets via regex matching
- **GitHub Contributor Sync** - Fetch contributor profiles and team memberships from GitHub API
- **Team Assignment** - Calculate primary team per contributor based on most-frequent issue prefix
- **Pipeline Scheduler** - Run the analytics pipeline on a configurable cron schedule
- **TreeView Panels** - Browse repositories, contributors, and pipeline run history in the sidebar
- **Metrics Dashboard** - Interactive Chart.js visualizations for commit trends, team contributions, and code complexity
- **Issue Linkage View** - Searchable table showing commit-to-issue relationships
- **11 Analytics Charts** - Sprint Velocity, Development Pipeline, Release Management, Code Review Velocity, Hot Spots, Knowledge Concentration, Ticket Lifecycle, Developer Focus, Team Coupling, Release Risk, Test Debt Predictor, Commit Hygiene, Architecture Drift
- **SCC Integration** - Optional code metrics extraction (lines, complexity) via scc tool
- **Architecture Component Classification** - Categorize files by type (Front-End, Back-End, DevOps, etc.) with configurable mappings
- **Secure Credential Storage** - API tokens stored in VS Code SecretStorage
- **Docker PostgreSQL** - Database runs in Docker with automatic schema migrations

### Technical

- TypeScript strict mode with ES2022 target
- PostgreSQL 16 with parameterized queries (zero SQL injection risk)
- esbuild bundler for fast builds
- Vitest for unit and integration testing
- Testcontainers for database integration tests
