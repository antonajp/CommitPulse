# Changelog

All notable changes to the CommitPulse extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.49] - 2026-06-26

### Fixed

- Fix team profile queries using wrong join column for commit author

## [0.1.48] - 2026-06-26

### Added

- Add Team Profile Dashboard

### Fixed

- Fix requestAllData message type to requestTeamAllData

## [0.1.47] - 2026-06-26

### Fixed

- Fix publish script not generating changelog for single-commit releases
- Fix Developer Profile story points + Diagnostic Tool queries

### Technical

- Add seed script for test Jira data

## [0.1.46] - 2026-06-26

### Added

- Fix Developer Profile story points + Add Join Diagnostic Tool

## [0.1.45] - 2026-06-24

### Changed

- Document contributor name alignment for Jira-Git joins

### Fixed

- Fix CHANGELOG corruption from publish script log output
- Remove hardcoded 'per Week' from Developer Profile chart labels

## [0.1.44] - 2026-06-24

_No user-facing changes - version bump only._

## [0.1.43] - 2026-06-24

### Added

- Developer Profile Dashboard UX improvements

## [0.1.42] - 2026-06-23

### Fixed

- Join commit author to full_name for Developer Profile LOC

## [0.1.41] - 2026-06-23

### Fixed

- Use jira_detail.assignee for Developer Profile velocity data

## [0.1.40] - 2026-06-23

### Fixed

- Standardize contributor filtering on full_name across charts

## [0.1.39] - 2026-06-17

### Added

- Enhance LOC per Week chart with zero-value gaps and multi-row legend
- Add custom tooltips to LOC per Week chart

## [0.1.38] - 2026-06-16

### Fixed

- Fix database pool lifecycle race condition

## [0.1.37] - 2026-06-15

### Added

- Change LOC per Week chart from bar to line chart
- Add Test Debt Predictor section to Developer Profile dashboard
- Group Team dashboard metrics by full_name instead of login

### Fixed

- Fix missing complexity metrics for AWS and WSO2 repositories

## [0.1.36] - 2026-06-14

### Added

- Group contributor metrics by full_name instead of login
- Self-healing repository name mismatch detection and correction
- Add Last 2 years timeframe option to Developer Profile dashboard

### Changed

- Update README with architecture command and contributor maintenance

## [0.1.35] - 2026-06-09

### Fixed

- Fix Sprint Velocity chart not rendering with filters; remove Repository filter
- Fix Developer Profile dashboard not rendering due to CSS important override failure

## [0.1.34] - 2026-06-09

_No user-facing changes - version bump only._

## [0.1.33] - 2026-06-09

### Added

- Add provider-specific commit URLs and disabled state UX

### Fixed

- Fix Developer Profile dashboard loading failures

## [0.1.32] - 2026-06-09

_No user-facing changes - version bump only._

## [0.1.31] - 2026-06-09

_No user-facing changes - version bump only._

## [0.1.30] - 2026-06-08

### Added

- Add LOC drill-down to main dashboard chart
- Add Sprint Velocity vs LOC chart and performance enhancements
- Add Part 2 charts to Developer Profile Dashboard
- Add Developer Profile Dashboard MVP
- Move Team Scorecard to bottom of dashboard and make collapsible
- Add focus trap to LOC drill-down modal for WCAG 2.1 compliance
- Implement SHA navigation in LOC drill-down modal

### Changed

- Document classify-arc-component.sql and add WSO2 patterns

### Fixed

- Fix Developer Profile Dashboard data loading
- Correct team member JOIN queries column name

### Technical

- Add integration tests for LOC drill-down flow
- Add docs/test-plans/ to .gitignore

## [0.1.29] - 2026-04-01

_No user-facing changes - version bump only._

## [0.1.28] - 2026-03-31

_No user-facing changes - version bump only._

## [0.1.27] - 2026-03-30

### Added

- Simplify arc component backfill to SQL-based classification
- Configure custom domain api.commitpulse.dev for GCP Cloud Function
- Deploy GCP API Gateway and Cloud Function for Claude AI integration
- Add Refresh Tech Stack Baseline command with Claude AI integration

### Changed

- Now covers all 9 repos with support for Java/Gradle, Python/Django, Salesforce Apex, Rust, Ruby/Rails, PHP/WordPress, TypeScript/React, Swift, and Kotlin frameworks
- Sql to update arc tech stack based on analysis of 4 agentic and non agentic repos

### Fixed

- Fix Cloud Function deployment issues
- Add Cloud Build service account permissions for Cloud Functions Gen 2
- Fix Cloud Function CPU requirement and API Keys quota project
- Use Internet NEG for API Gateway load balancing

## [0.1.26] - 2026-03-30

_No user-facing changes - version bump only._

## [0.1.25] - 2026-03-29

_No user-facing changes - version bump only._

## [0.1.24] - 2026-03-29

### Fixed

- Fix Technology Stack pie chart repository filtering

## [0.1.23] - 2026-03-28

### Added

- Add multi-series Complexity Trend chart

## [0.1.22] - 2026-03-28

### Fixed

- Fix Complexity Trend chart JS syntax error

## [0.1.21] - 2026-03-26

_No user-facing changes - version bump only._

## [0.1.20] - 2026-03-24

_No user-facing changes - version bump only._

## [0.1.19] - 2026-03-23

_No user-facing changes - version bump only._

## [0.1.18] - 2026-03-21

### Added

- Add per-repository extraction control
- Add File Author LOC Contribution Report with D3.js visualization

### Fixed

- Fix empty dropdown filters and add date range selection

## [0.1.17] - 2026-03-20

_No user-facing changes - version bump only._

## [0.1.16] - 2026-03-19

_No user-facing changes - version bump only._

## [0.1.15] - 2026-03-19

### Added

- Improve first-run UX for extraction mode selection

### Fixed

- Optimize Quick Pick database connection to avoid double initialization

### Technical

- Add unit tests for extraction mode Quick Pick functions

## [0.1.14] - 2026-03-16

### Added

- Add team, team member, and repository filters to Sprint Velocity vs LOC chart

### Fixed

- Use fixed dates in velocity-jira-support tests

## [0.1.13] - 2026-03-15

### Added

- Add Bitbucket credential support and remote branch discovery

### Changed

- Add jira repo defaults

### Fixed

- Add repository indexes and per-repo incremental extraction

## [0.1.12] - 2026-03-13

_No user-facing changes - version bump only._

## [0.1.11] - 2026-03-13

### Changed

- Split velocity-chart-html.ts into modular components

### Fixed

- Fix profile badge contrast for dark VS Code themes

## [0.1.10] - 2026-03-13

_No user-facing changes - version bump only._

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

## [0.1.8] - 2026-03-11

### Added

- Add configurable log level for Git history extraction

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
