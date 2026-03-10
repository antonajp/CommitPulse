# gitr VS Code Extension

## Agile User Stories & Sprint Plan

**Prepared:** 2026-03-04 | **Platform:** Local (VS Code Extension + Docker PostgreSQL) | **Methodology:** Agile/Scrum | **Linear Project:** gitrx

---

## Sprint Roadmap Overview

| Sprint | Focus Area | Key Deliverables |
|---|---|---|
| **Sprint 1** (Weeks 1-2) | Foundation & Security | Extension scaffold, DB layer, secrets, test infrastructure, parameterized queries |
| **Sprint 2** (Weeks 3-4) | Git Analysis & CI | Git commit extraction, scc integration, CI pipeline, golden test harness |
| **Sprint 3** (Weeks 5-6) | Jira & GitHub Integration | Jira client, issue loading, GitHub contributor sync, API mocks |
| **Sprint 4** (Weeks 7-8) | Data Enhancement | Commit-Jira linking, team assignment, complexity parsing, data enrichment |
| **Sprint 5** (Weeks 9-10) | Pipeline Orchestrator | Full pipeline, scheduling, logging, pipeline run tracking |
| **Sprint 6** (Weeks 11-12) | TreeViews & Status Bar | Repository, contributor, pipeline TreeViews, status bar integration |
| **Sprint 7** (Weeks 13-14) | Webview Dashboards | Metrics dashboard, commit-Jira linkage, team analytics, scorecard |
| **Sprint 8** (Weeks 15-16) | Polish & Release | Accessibility, performance, extension tests, marketplace packaging |

---

## Summary Metrics

| Metric | Value |
|---|---|
| Total Epics | 13 |
| Total User Stories | 68 |
| Total Story Points | 269 |
| Must Have Stories | 48 (199 pts) |
| Should Have Stories | 15 (53 pts) |
| Nice to Have Stories | 5 (17 pts) |
| Estimated Duration | 8 core sprints (16 weeks) |
| Team Velocity | ~18 pts/sprint (solo developer) |

---

## EPIC-01 -- Extension Scaffolding & Build Configuration

> Bootstrap the VS Code extension project with TypeScript, esbuild, and proper tooling. Establish the project structure that all subsequent work builds upon.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-001 | Bootstrap Extension Project | 5 | **Must Have** | Sprint 1 |
| US-002 | Configuration Settings Schema | 3 | **Must Have** | Sprint 1 |
| US-003 | OutputChannel Logging System | 2 | **Must Have** | Sprint 1 |
| US-004 | Move Python Files to Legacy Directory | 1 | **Must Have** | Sprint 1 |

### US-001: Bootstrap Extension Project

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** have a properly configured VS Code extension scaffold **so that** I can build the gitr extension with TypeScript and esbuild.

**Acceptance Criteria:**

- [ ] `package.json` with VS Code extension metadata (displayName, publisher, categories, activation events)
- [ ] `tsconfig.json` with ES2022 target, strict mode, moduleResolution: bundler
- [ ] esbuild build script for production and watch mode
- [ ] Source structure: `src/extension.ts`, `src/config/`, `src/services/`, `src/providers/`, `src/database/`, `src/docker/`, `src/logging/`, `src/utils/`, `src/views/`
- [ ] `.vscodeignore` excludes dev dependencies from VSIX
- [ ] Dependencies installed: `pg`, `simple-git`, `jira.js`, `@octokit/rest`, `dockerode`
- [ ] Dev dependencies: `@types/vscode`, `@vscode/test-electron`, `vitest`, `esbuild`
- [ ] Initial `activate()` and `deactivate()` stubs
- [ ] Extension runs in Extension Development Host without errors
- [ ] DEBUG logging: "extension activated in [N]ms"

---

### US-002: Configuration Settings Schema

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** user, **I want to** configure repositories, Jira, database, and scheduling via VS Code settings **so that** I can customize the extension for my environment.

**Acceptance Criteria:**

- [ ] Settings defined in `package.json` contributes.configuration:
  - `gitr.jiraServer` (string), `gitr.jiraUsername` (string), `gitr.jiraProjectKeys` (string[])
  - `gitr.repositories` (string[])
  - `gitr.database.host` (string, default: localhost), `gitr.database.port` (number, default: 5432), `gitr.database.name` (string, default: gitr_database)
  - `gitr.schedule.enabled` (boolean, default: false), `gitr.schedule.intervalMinutes` (number, default: 480)
  - `gitr.logLevel` (enum: DEBUG/INFO/WARNING/ERROR, default: INFO)
  - `gitr.jira.keyMappings` (object, default: {"PROJ":"PROJ2","CRM":"CMS"}) -- externalized from Python hardcoding
- [ ] `src/config/settings.ts` wrapper class with typed getters
- [ ] Configuration change listener registered
- [ ] Settings validation with helpful error messages
- [ ] DEBUG logging on every settings read

---

### US-003: OutputChannel Logging System

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** structured logging via VS Code OutputChannel **so that** I can debug the extension and track pipeline execution.

**Acceptance Criteria:**

- [ ] `src/logging/outputChannel.ts` with level filtering (DEBUG, INFO, WARNING, ERROR, CRITICAL)
- [ ] Respects `gitr.logLevel` setting
- [ ] Timestamp and level prefix on all messages: `[2026-01-15 10:30:00] [INFO] module.method: message`
- [ ] `createLogger(component: string)` factory for scoped loggers
- [ ] OutputChannel named "gitr", shown on first ERROR+ log
- [ ] Automatic secret redaction: patterns like `ghp_*`, `ATAT*` replaced with `***REDACTED***`
- [ ] Sensitive keys (password, token, secret, apiKey) redacted from logged objects
- [ ] Disposed in `deactivate()`

---

### US-004: Move Python Files to Legacy Directory

| | |
|---|---|
| **Points** | 1 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** move existing Python files to a `legacy/` subdirectory **so that** the repo root is organized for the TypeScript extension.

**Acceptance Criteria:**

- [ ] All `.py` files moved to `legacy/` preserving directory structure
- [ ] SQL files (`createCommitHistory.sql`, `sqlUtil.sql`) moved to `legacy/sql/`
- [ ] `inserts/` directory moved to `legacy/inserts/`
- [ ] `classified.properties` moved to `legacy/` (NOT committed - add to `.gitignore`)
- [ ] Python `requirements.txt` moved to `legacy/`
- [ ] Root-level `.gitignore` updated to exclude `legacy/classified.properties`

---

## EPIC-02 -- Database Layer & Docker Infrastructure

> Set up PostgreSQL in Docker with container lifecycle management, schema migrations, connection pooling, and parameterized query layer. All SQL must use parameterized queries to eliminate the SQL injection vulnerabilities present in the Python original.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-005 | Docker Compose Configuration | 3 | **Must Have** | Sprint 1 |
| US-006 | Container Manager with dockerode | 5 | **Must Have** | Sprint 1 |
| US-007 | Schema Migration System | 5 | **Must Have** | Sprint 1 |
| US-008 | Connection Pool & Query Layer | 5 | **Must Have** | Sprint 1 |

### US-005: Docker Compose Configuration

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** user, **I want to** a Docker Compose file that creates and manages the PostgreSQL database **so that** I don't need to install PostgreSQL separately.

**Acceptance Criteria:**

- [ ] `docker/docker-compose.yml` with postgres:16-alpine
- [ ] Persistent named volume (`gitr-pgdata`)
- [ ] Health check using `pg_isready`
- [ ] Configurable port via `GITR_DB_PORT` env var (default 5432)
- [ ] Port bound to `127.0.0.1` only (no external access)
- [ ] Container runs as non-root user (uid 999)
- [ ] `read_only: true` root filesystem with tmpfs for `/tmp` and `/var/run/postgresql`
- [ ] `cap_drop: ALL` with minimal cap_add (CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID)
- [ ] `docker/init/001_initial_schema.sql` converted from `createCommitHistory.sql` with `IF NOT EXISTS` guards
- [ ] `.env.example` template for environment variables
- [ ] DEBUG logging: container configuration details

---

### US-006: Container Manager with dockerode

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** user, **I want to** start, stop, and manage the database container from VS Code **so that** I can control the database lifecycle without terminal commands.

**Acceptance Criteria:**

- [ ] `src/docker/containerManager.ts` using dockerode
- [ ] Methods: `startContainer()`, `stopContainer()`, `resetContainer()`, `getStatus()`, `waitForHealthy(timeoutMs)`, `isDockerAvailable()`
- [ ] `resetContainer()` requires explicit confirmation dialog before destructive action
- [ ] If Docker not installed/running: actionable error with install link
- [ ] If port in use: suggest alternative port via settings
- [ ] Container failure: capture and display Docker logs
- [ ] All Docker operations logged at DEBUG level
- [ ] Commands registered: `gitr.startDatabase`, `gitr.stopDatabase`, `gitr.resetDatabase`
- [ ] Progress feedback via `vscode.window.withProgress()`
- [ ] Container stopped cleanly in `deactivate()`

---

### US-007: Schema Migration System

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** versioned schema migrations **so that** the database schema can evolve safely.

**Acceptance Criteria:**

- [ ] `node-pg-migrate` configured for migration management
- [ ] Initial migration `001_initial_schema.ts` converted from `createCommitHistory.sql`
- [ ] All 20+ tables created: `commit_history`, `commit_files`, `commit_files_types`, `commit_directory`, `commit_branch_relationship`, `commit_jira`, `commit_msg_words`, `commit_tags`, `commit_contributors`, `jira_detail`, `jira_history`, `jira_issue_link`, `jira_parent`, `jira_github_branch`, `jira_github_pullrequest`, `gitja_team_contributor`, `gitr_pipeline_run`, `gitr_pipeline_log`, `gitr_pipeline_sha`, `gitr_pipeline_jira`
- [ ] All 8+ views created in dependency order: `vw_technology_stack_category`, `vw_technology_stack_complexity`, `vw_commit_file_chage_history`, `vw_scorecard_detail`, `vw_scorecard`, etc.
- [ ] Migration state stored in `gitr_migrations` table
- [ ] Migrations run automatically on extension activation (after health check)
- [ ] `IF NOT EXISTS` guards for idempotency
- [ ] DEBUG logging: each migration step

---

### US-008: Connection Pool & Query Layer

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** a typed, parameterized query layer with connection pooling **so that** all database access is safe from SQL injection and performant.

**Acceptance Criteria:**

- [ ] `src/database/connection.ts` using `pg.Pool` (default: 10 connections)
- [ ] Automatic reconnection with exponential backoff
- [ ] `query<T>(sql: string, params?: unknown[]): Promise<T[]>` helper
- [ ] `src/database/queries.ts` split into domain modules (under 600 lines each):
  - `src/database/commitQueries.ts` -- commit_history, commit_files, commit_branch_relationship
  - `src/database/jiraQueries.ts` -- jira_detail, jira_history, jira_issue_link, jira_parent
  - `src/database/contributorQueries.ts` -- commit_contributors, gitja_team_contributor
  - `src/database/pipelineQueries.ts` -- gitr_pipeline_run, gitr_pipeline_log
- [ ] 100% parameterized queries -- ZERO string interpolation in SQL (critical security fix)
- [ ] Bulk insert pattern for high-volume tables using multi-row VALUES
- [ ] Pool closed cleanly in `deactivate()`
- [ ] All queries logged at DEBUG level with timing
- [ ] Connection events logged: connect, disconnect, error

---

## EPIC-03 -- Security & Secrets Management

> Secure credential storage, input validation, and hardened infrastructure. Addresses CRITICAL vulnerabilities in the Python original (SQL injection, plaintext secrets, command injection).

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-009 | VS Code SecretStorage for Credentials | 3 | **Must Have** | Sprint 1 |
| US-010 | Input Validation Framework | 5 | **Must Have** | Sprint 2 |
| US-011 | Credential Configuration Command | 2 | **Must Have** | Sprint 1 |
| US-012 | WebView Content Security Policy | 3 | **Should Have** | Sprint 7 |

### US-009: VS Code SecretStorage for Credentials

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** user, **I want to** my API tokens and passwords stored securely **so that** credentials cannot be extracted from disk or leaked in version control.

**Acceptance Criteria:**

- [ ] `src/config/secrets.ts` wrapper for `context.secrets` API
- [ ] Methods: `getGitHubToken()`, `setGitHubToken()`, `getJiraToken()`, `setJiraToken()`, `getDbPassword()`, `setDbPassword()`
- [ ] All secret keys prefixed with `gitr.`
- [ ] Graceful handling when secrets missing (return null, don't throw)
- [ ] Secrets validated for non-empty values before storing
- [ ] Secrets NEVER logged, even at DEBUG level
- [ ] `.gitignore` prevents commit of any secret/property files
- [ ] First-run migration: import from `classified.properties` if present, then warn to delete

---

### US-010: Input Validation Framework

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** developer, **I want to** all external input validated before use in SQL or subprocess calls **so that** command injection and SQL injection are prevented.

**Acceptance Criteria:**

- [ ] `src/utils/inputValidator.ts` with Zod schemas for:
  - Git branch names: `^[a-zA-Z0-9/_.-]+$`, max 255 chars
  - Git SHAs: exactly 40 hex chars
  - Jira keys: `^[A-Z]+-\d+$`
  - Repository paths: validated, no traversal
- [ ] All Jira API responses validated with Zod schemas before DB insertion
- [ ] All GitHub API responses validated with Zod schemas
- [ ] String length limits enforced before DB insertion
- [ ] No `shell: true` in any subprocess calls (simple-git, scc)
- [ ] Whitelist-based validation (not blacklist)
- [ ] Unit tests with malicious inputs: `../../etc/passwd`, `'; DROP TABLE--`, `$(whoami)`

---

### US-011: Credential Configuration Command

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** user, **I want to** a command to configure all credentials interactively **so that** I can set up tokens and passwords easily.

**Acceptance Criteria:**

- [ ] Command `gitr.configureCredentials` registered: "gitr: Configure Credentials"
- [ ] Sequential input boxes for GitHub PAT, Jira token, DB password
- [ ] Input boxes use `password: true` for secret masking
- [ ] Ability to skip individual credentials (keep existing)
- [ ] Success notification after all credentials saved
- [ ] Quick Pick for rotating individual credentials
- [ ] DEBUG logging: "credential [type] updated" (never log the value)

---

### US-012: WebView Content Security Policy

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Should Have |
| **Sprint** | Sprint 7 |

**As a** user, **I want to** strict CSP on all webviews **so that** malicious commit messages cannot execute JavaScript in the UI.

**Acceptance Criteria:**

- [ ] `getNonce()` utility generates crypto-random nonces
- [ ] CSP meta tag on all webview HTML: `default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:; font-src ${cspSource};`
- [ ] Chart.js vendored locally in `media/chart.min.js` (no CDN)
- [ ] All user-controlled content HTML-escaped before rendering
- [ ] No `innerHTML` with unsanitized data
- [ ] XSS tests with payloads in commit messages: `<script>alert(1)</script>`
- [ ] All webview-to-host messages validated with Zod schemas

---

## EPIC-04 -- Test Infrastructure & CI/CD

> Establish the test framework, golden tests for migration validation, and CI pipeline. Test-first approach: write tests before implementing each module.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-013 | Vitest Unit Test Configuration | 3 | **Must Have** | Sprint 1 |
| US-014 | Testcontainers PostgreSQL Setup | 5 | **Must Have** | Sprint 1 |
| US-015 | Python-TypeScript Fidelity Test Harness | 8 | **Must Have** | Sprint 2 |
| US-016 | GitHub Actions CI Pipeline | 5 | **Must Have** | Sprint 2 |
| US-017 | Mock Providers for External APIs | 5 | **Must Have** | Sprint 2 |

### US-013: Vitest Unit Test Configuration

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** a configured Vitest test environment **so that** I can write fast, isolated unit tests for business logic.

**Acceptance Criteria:**

- [ ] `vitest.unit.config.ts` with TypeScript support
- [ ] `vitest.integration.config.ts` with longer timeouts (60s+ for containers)
- [ ] VS Code API mock (`src/__tests__/mocks/vscode.ts`) auto-imported in unit tests
- [ ] Coverage reporting with v8 provider
- [ ] Test directory structure: `src/__tests__/unit/`, `src/__tests__/integration/`, `src/__tests__/extension/`, `src/__tests__/fixtures/`, `src/__tests__/mocks/`
- [ ] NPM scripts: `test:unit`, `test:unit:watch`, `test:integration`, `test:coverage`
- [ ] Coverage thresholds: 90% unit, 80% integration, 80% overall

---

### US-014: Testcontainers PostgreSQL Setup

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** integration tests that spin up real PostgreSQL containers **so that** I can validate queries against actual PostgreSQL.

**Acceptance Criteria:**

- [ ] `@testcontainers/postgresql` configured with postgres:16-alpine
- [ ] `src/__tests__/integration/setup.ts` with container lifecycle in beforeAll/afterAll
- [ ] Connection pool configured with container host/port
- [ ] Schema migrations run automatically in test setup
- [ ] Container startup timeout: 60s
- [ ] Integration tests run serially to avoid container conflicts
- [ ] Tests clean up containers on exit (even on failure)

---

### US-015: Python-TypeScript Fidelity Test Harness

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** developer, **I want to** automated comparison tests between Python and TypeScript outputs **so that** I can verify migration fidelity for critical algorithms.

**Acceptance Criteria:**

- [ ] Utility to run Python subprocess with JSON input and capture output
- [ ] Deep equality comparison with detailed diff reporting on mismatch
- [ ] Golden tests for Jira key detection: 100+ test strings covering all project prefixes (PROJ, CRM, SFDC, CMS, DOC, ERP, DMS), edge cases, false positives
- [ ] Golden tests for merge detection: 30+ test strings covering all keywords (merge, uat, QAFull, revert, release, prod, backup)
- [ ] Golden tests for team assignment: contributor histories with ties, single commits, no Jira keys
- [ ] Golden tests for scc output parsing: multiple languages, varied complexity
- [ ] Framework gracefully skips tests if Python not installed
- [ ] All golden tests must achieve 100% match rate

---

### US-016: GitHub Actions CI Pipeline

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** developer, **I want to** automated test execution on every push/PR **so that** regressions are caught before merge.

**Acceptance Criteria:**

- [ ] `.github/workflows/ci.yml` runs on push and pull_request
- [ ] Parallel jobs: lint, typecheck, unit-tests, integration-tests
- [ ] Unit tests with coverage uploaded to Codecov
- [ ] Integration tests with Docker (TESTCONTAINERS_RYUK_DISABLED=true)
- [ ] Coverage thresholds enforced (fail if below)
- [ ] VSIX package built on success (upload as artifact on main branch)
- [ ] Extension tests via xvfb-run (headless) -- added in Sprint 8
- [ ] Node.js 20 with npm cache

---

### US-017: Mock Providers for External APIs

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** developer, **I want to** controlled mocks for Jira, GitHub, Git, and Docker APIs **so that** tests are fast, deterministic, and don't hit rate limits.

**Acceptance Criteria:**

- [ ] `src/__tests__/mocks/jiraClient.mock.ts` -- mock `jira.js` with configurable responses (success, rate limit, error)
- [ ] `src/__tests__/mocks/githubClient.mock.ts` -- mock `@octokit/rest` with pagination support
- [ ] `src/__tests__/mocks/simpleGit.mock.ts` -- mock `simple-git` log, raw, checkout
- [ ] `src/__tests__/mocks/dockerode.mock.ts` -- mock container lifecycle
- [ ] `src/__tests__/mocks/vscode.ts` -- mock VS Code API (window, workspace, commands, secrets)
- [ ] `src/__tests__/fixtures/commits.ts` -- 50+ sample commits with varied messages
- [ ] `src/__tests__/fixtures/jiraIssues.ts` -- 20+ sample issues with changelogs
- [ ] `src/__tests__/fixtures/sccOutput.ts` -- sample scc JSON for multiple languages
- [ ] `src/__tests__/fixtures/createTestRepo.ts` -- utility to create temp git repos with known history

---

## EPIC-05 -- Git Commit Extraction

> Migrate `GitCommitHistorySql.py` to TypeScript. Extract commit history, branch details, file-level diffs, and code complexity metrics via scc CLI.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-018 | Git Service with simple-git | 5 | **Must Have** | Sprint 2 |
| US-019 | scc CLI Integration for Complexity | 5 | **Must Have** | Sprint 2 |
| US-020 | Commit History Pipeline | 8 | **Must Have** | Sprint 2 |

### US-018: Git Service with simple-git

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** developer, **I want to** a Git service using simple-git **so that** I can extract commit history, branches, and diffs programmatically.

**Acceptance Criteria:**

- [ ] `src/services/gitAnalysis.ts` class `GitService`
- [ ] Methods: `getCommitLog(branch, since, until)`, `getBranches()`, `getDiffSummary(sha)`, `pullAllBranches()`
- [ ] Returns typed interfaces: `CommitRecord`, `BranchRecord`, `DiffRecord`
- [ ] Error handling for invalid repos, network failures
- [ ] All operations use simple-git (NOT shell=true subprocess)
- [ ] DEBUG logging: "fetching commits for [repo] branch [branch] since [date]"
- [ ] Unit tests with mocked simple-git

---

### US-019: scc CLI Integration for Complexity

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** developer, **I want to** parse scc CLI JSON output for code complexity metrics **so that** I can store per-file complexity data.

**Acceptance Criteria:**

- [ ] Method `runScc(repoPath)` executes `scc --format json` via child_process.execFile (NOT shell=true)
- [ ] Parses JSON output into typed `ComplexityResult`: totalLines, codeLines, commentLines, blankLines, complexity, weightedComplexity
- [ ] Aggregates per-language and per-file metrics
- [ ] Checks for scc availability on activation, shows error with install instructions if missing
- [ ] Handles scc failure gracefully (logs warning, continues without complexity data)
- [ ] Unit tests parse fixture scc JSON output
- [ ] DEBUG logging: "scc analysis for [repo]: [N] files, complexity=[N]"

---

### US-020: Commit History Pipeline

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** extract and store complete Git commit history with file-level details **so that** commits are available for analysis and linking.

**Acceptance Criteria:**

- [ ] `src/services/commitPipeline.ts` replaces `GitCommitHistorySql.get_commit_history()`
- [ ] For each configured repository: iterate all branches, extract commits since last run date
- [ ] For each commit: persist to `commit_history` (sha, author, date, message, branch, insertions, deletions, files_changed)
- [ ] For each file in commit: persist to `commit_files` with scc complexity metrics
- [ ] Merge detection using keywords (merge, uat, QAFull, revert, release, prod, backup) -- checks both message and branch name
- [ ] Branch-commit relationships persisted to `commit_branch_relationship`
- [ ] Skip already-known SHA+repo combinations
- [ ] Pipeline run tracking: creates `gitr_pipeline_run` record, logs to `gitr_pipeline_log`
- [ ] Batch inserts for performance (multi-row VALUES)
- [ ] Progress reporting via `vscode.window.withProgress`
- [ ] DEBUG logging: "processing [branch]: [N] new commits", "commit [sha]: [N] files"
- [ ] Integration test against Testcontainers PostgreSQL
- [ ] Golden test comparing output shape with Python version

---

## EPIC-06 -- Jira Integration

> Migrate `JiraApi.py` to TypeScript. Load Jira issues, changelogs, GitHub dev status, and handle incremental updates.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-021 | Jira Client Service | 5 | **Must Have** | Sprint 3 |
| US-022 | Load All Project Issues Pipeline | 8 | **Must Have** | Sprint 3 |
| US-023 | Jira-GitHub Dev Status Sync | 5 | **Must Have** | Sprint 4 |
| US-024 | Update Unfinished Issues Pipeline | 5 | **Must Have** | Sprint 4 |

### US-021: Jira Client Service

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 3 |

**As a** developer, **I want to** a Jira API client using jira.js **so that** I can fetch issues, changelogs, and dev status.

**Acceptance Criteria:**

- [ ] `src/services/jiraClient.ts` using `jira.js` Version3Client
- [ ] Authentication via SecretStorage (email + API token)
- [ ] Methods: `getIssue(key)`, `searchIssues(jql, maxResults)`, `getDevStatus(issueId)`
- [ ] Typed interfaces matching JiraGitHub.py models: Repository, Author, Commit, Branch, PullRequest, Detail
- [ ] API responses validated with Zod schemas before returning
- [ ] Error handling: logs and rethrows with context
- [ ] Note: `/rest/dev-status/latest/issue/detail` requires direct HTTP (not covered by jira.js) -- use node-fetch with basic auth
- [ ] DEBUG logging: "fetching issue [key]", "JQL search: [jql] returned [N] results"
- [ ] Unit tests with mocked jira.js client

---

### US-022: Load All Project Issues Pipeline

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 3 |

**As a** user, **I want to** load all Jira issues for configured projects into the database **so that** I have a complete Jira dataset.

**Acceptance Criteria:**

- [ ] `src/services/jiraPipeline.ts` replaces `JiraAPI.load_all_project_issues()`
- [ ] Iterates issue keys from start_key to max_keys for each project prefix
- [ ] Skips issues already in `jira_detail`
- [ ] For each new issue persists: `jira_detail`, `jira_history` (status/assignee changes), `jira_issue_link`, `jira_parent`
- [ ] Pipeline run tracking with start/end records
- [ ] Table count logging after completion
- [ ] All inserts use parameterized queries with `$1, $2` placeholders
- [ ] DEBUG logging: "committed [issue.key]", "skipping known issue [key]"
- [ ] Integration test against Testcontainers

---

### US-023: Jira-GitHub Dev Status Sync

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** GitHub branch and PR information linked to Jira issues **so that** I can trace code to work items.

**Acceptance Criteria:**

- [ ] Extends jiraPipeline with `saveGithubInfo()` method
- [ ] For each Jira issue, fetches dev status from REST API
- [ ] Persists branches to `jira_github_branch`, PRs to `jira_github_pullrequest`
- [ ] Skips already-known branch+commit and PR combinations
- [ ] DEBUG logging: "saved branch [name] for [jira_key]", "saved PR [id] for [jira_key]"

---

### US-024: Update Unfinished Issues Pipeline

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** Jira issues not Done/Cancelled to be refreshed periodically **so that** status changes are captured.

**Acceptance Criteria:**

- [ ] Method `updateUnfinishedIssues(daysAgo)` replaces `update_unfinished_change_logs2()`
- [ ] Queries issues: NOT status in ('Done','Cancelled') UNION recently completed (within daysAgo)
- [ ] For each: deletes existing history/branch/PR rows, re-fetches with changelog expand, re-inserts
- [ ] All operations within a transaction (rollback on error)
- [ ] DEBUG logging: "refreshing [N] unfinished issues", "processed [key]"

---

## EPIC-07 -- GitHub Contributor Sync & Data Enhancement

> Migrate `GitHubRelate.py`, `GitjaDataEnhancer.py`, and `GitjaTeamContributor.py`. Link commits to Jira, assign teams, sync contributors.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-025 | GitHub Contributor Sync | 5 | **Must Have** | Sprint 4 |
| US-026 | Commit-to-Jira Linking Pipeline | 8 | **Must Have** | Sprint 4 |
| US-027 | Team Assignment Pipeline | 5 | **Must Have** | Sprint 4 |
| US-028 | Complexity Change Calculation | 3 | **Should Have** | Sprint 4 |

### US-025: GitHub Contributor Sync

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** GitHub contributor profiles synced to the database **so that** commit authors are identified with full details.

**Acceptance Criteria:**

- [ ] `src/services/githubClient.ts` using `@octokit/rest`
- [ ] Authentication with token from SecretStorage
- [ ] `getContributors(owner, repo)` returns contributor list
- [ ] `syncUnknownAuthors(repoName, team)` finds commit authors not in `commit_contributors`, inserts with minimal profile
- [ ] Organization read from `gitr.github.organization` setting (not hardcoded)
- [ ] API responses validated with Zod
- [ ] DEBUG logging: "synced [N] contributors for [repo]", "found [N] unknown authors"

---

### US-026: Commit-to-Jira Linking Pipeline

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** commits automatically linked to Jira issues by scanning messages and branches **so that** I can trace every commit to a work item.

**Acceptance Criteria:**

- [ ] `src/services/dataEnhancer.ts` replaces `GitjaDataEnhancer`
- [ ] Regex pattern: `(?:PROJECT1|PROJECT2...)(?:[-.\\s]*\\d+)` for finding Jira keys
- [ ] Exclusion logic: skip SFDC.20*, no numeric suffix, padded zeros (CPD-20*)
- [ ] Cleanup logic: space-to-hyphen, key mappings from `gitr.jira.keyMappings` setting (PROJ->PROJ2, CRM->CRMREO)
- [ ] Triple/double hyphen cleanup, ERP-0 normalization
- [ ] Inserts into `commit_jira` (sha, jira_key, author)
- [ ] Supports refresh mode (delete and re-link per author) and combine mode (appends branch name to message)
- [ ] Sets `is_jira_ref` flag on `commit_history`
- [ ] Golden test: TypeScript regex MUST match Python regex output on 100+ test strings -- 100% match required
- [ ] DEBUG logging: "linking commits for author [login]: [N] links found"

---

### US-027: Team Assignment Pipeline

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** each contributor assigned to their primary Jira project team **so that** team-based analytics are accurate.

**Acceptance Criteria:**

- [ ] `src/services/teamContributor.ts` replaces `GitjaTeamContributor`
- [ ] For each contributor: scans commit messages for Jira prefixes, counts per project, writes to `gitja_team_contributor`
- [ ] Determines primary team by most-frequent-prefix
- [ ] Updates `commit_contributors.team` with primary team
- [ ] Supports full reset (deletes all `gitja_team_contributor` rows first)
- [ ] Golden test: team assignments must match Python version exactly
- [ ] DEBUG logging: "author [login] primary team: [team] ([N] matches)"

---

### US-028: Complexity Change Calculation

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Should Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** complexity changes calculated across file versions **so that** I can identify code quality trends.

**Acceptance Criteria:**

- [ ] Method `calculateComplexityChanges(sinceDate)` in dataEnhancer
- [ ] For each file with multiple commits: calculate diff of complexity/comments/code from previous version
- [ ] Updates `commit_files` with `complexity_change`, `comments_change`, `code_change`
- [ ] Batch processing (configurable cycle size, default 1000)
- [ ] Note: `vw_commit_file_chage_history` view already computes this via LAG(); pipeline method is for manual recalculation

---

## EPIC-08 -- Pipeline Orchestrator & Scheduling

> Migrate `GitrScheduleRunner.py`. Provide both manual command triggers and automatic background scheduling with progress tracking.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-029 | Pipeline Orchestrator Service | 8 | **Must Have** | Sprint 5 |
| US-030 | Manual Pipeline Commands | 3 | **Must Have** | Sprint 5 |
| US-031 | Automatic Background Scheduling | 3 | **Must Have** | Sprint 5 |

### US-029: Pipeline Orchestrator Service

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** a single orchestrator that runs the full pipeline in correct order **so that** I can trigger a complete data refresh with one command.

**Acceptance Criteria:**

- [ ] `src/services/pipelineRunner.ts` class `PipelineOrchestrator`
- [ ] `runFullPipeline(options)` with options: since, increment, refresh, combine, daysAgo
- [ ] Execution order: 1) Git extraction per repo, 2) Jira issue loading per project, 3) Update unfinished Jira, 4) Commit-Jira linking, 5) Team assignments
- [ ] Default since = 7 days ago
- [ ] Pipeline run tracking wrapping entire orchestration
- [ ] Progress via `vscode.window.withProgress` with cancellation support
- [ ] Error handling: log and continue per repo/project (one failure doesn't stop others)
- [ ] Cancellation token checked between stages
- [ ] Partial results saved before cancellation
- [ ] Pipeline marked "cancelled" in `gitr_pipeline_run` on cancellation
- [ ] DEBUG logging at each stage: "STAGE 1: Git extraction for [N] repos"

---

### US-030: Manual Pipeline Commands

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** VS Code commands to run the full pipeline or individual stages **so that** I can trigger data collection on demand.

**Acceptance Criteria:**

- [ ] Commands registered: `gitr.runPipeline`, `gitr.runGitAnalysis`, `gitr.runJiraSync`, `gitr.linkCommitsToJira`
- [ ] Each command checks DB connection first, shows error if not connected
- [ ] Each command shows progress notification
- [ ] Completion notification: "Pipeline completed: [N] commits, [N] issues processed"
- [ ] Commands disabled when pipeline is already running (via `when` clause)
- [ ] DEBUG logging: "manual trigger: [command]"

---

### US-031: Automatic Background Scheduling

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** the pipeline to run automatically on a configurable schedule **so that** data stays fresh without manual intervention.

**Acceptance Criteria:**

- [ ] Uses `setInterval` based on `gitr.schedule.intervalMinutes` setting (default: 480 = 8 hours)
- [ ] Only runs if `gitr.schedule.enabled` is true
- [ ] Status bar indicator during auto-run: "gitr: syncing..."
- [ ] Schedule resets when interval setting changes
- [ ] Logs next scheduled run time on activation
- [ ] Command `gitr.toggleAutoRun` enables/disables
- [ ] Interval cleared in `deactivate()`

---

## EPIC-09 -- Pipeline Logging & Observability

> Replicate the Python pipeline logging to both VS Code OutputChannel and PostgreSQL pipeline tables.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-032 | Pipeline Logger Service | 5 | **Must Have** | Sprint 5 |
| US-033 | Security Event Logging | 3 | **Should Have** | Sprint 5 |

### US-032: Pipeline Logger Service

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** developer, **I want to** a logging service that writes to both OutputChannel and PostgreSQL **so that** I can debug from the editor and query logs in SQL.

**Acceptance Criteria:**

- [ ] `src/services/pipelineLogger.ts` replaces `GitrLogger`
- [ ] Writes to OutputChannel AND `gitr_pipeline_log` table
- [ ] Optionally writes to `gitr_pipeline_sha` and `gitr_pipeline_jira` when sha/jira_key provided
- [ ] Log level filtering respects `gitr.logLevel` setting
- [ ] ERROR+ always written regardless of level setting
- [ ] Pipeline lifecycle: `startPipelineRun(className, context, detail)` returns run ID, `endPipelineRun(runId, status)`
- [ ] Format: `[timestamp] className.context: message`

---

### US-033: Security Event Logging

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Should Have |
| **Sprint** | Sprint 5 |

**As a** security auditor, **I want to** security-relevant events logged **so that** suspicious activity can be investigated.

**Acceptance Criteria:**

- [ ] Events logged: credential rotation, DB connection failures, input validation failures, API auth failures, extension activation/deactivation
- [ ] Security log separate from debug log
- [ ] No sensitive data in security logs
- [ ] Structured JSON format for parsing

---

## EPIC-10 -- TreeView Providers

> VS Code TreeView navigation for repositories, contributors/teams, and pipeline runs.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-034 | Repositories TreeView | 5 | **Must Have** | Sprint 6 |
| US-035 | Contributors & Teams TreeView | 5 | **Must Have** | Sprint 6 |
| US-036 | Pipeline Runs TreeView | 5 | **Should Have** | Sprint 6 |
| US-037 | Status Bar Integration | 2 | **Must Have** | Sprint 6 |

### US-034: Repositories TreeView

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 6 |

**As a** user, **I want to** a TreeView showing configured repositories with health indicators **so that** I can see which repos are tracked.

**Acceptance Criteria:**

- [ ] View container `gitr` in Activity Bar
- [ ] Root nodes: repository names from `gitr.repositories` setting
- [ ] Each node shows: name, last analyzed date, total commit count
- [ ] Icons: green check (healthy), yellow warning (stale >7 days), red error (last scan failed)
- [ ] Tooltip: last scan timestamp, commit count since last scan
- [ ] Context menu: "Scan Now", "View Logs", "Open in File Explorer"
- [ ] Expandable: child nodes show recent branches with last commit date
- [ ] Refresh command `gitr.refreshRepositories`
- [ ] Empty state: "No repositories configured. Add one to get started."
- [ ] TreeView updates when settings change
- [ ] Icons have `aria-label` for accessibility

---

### US-035: Contributors & Teams TreeView

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 6 |

**As a** user, **I want to** a TreeView showing contributors grouped by team **so that** I can see team composition and activity.

**Acceptance Criteria:**

- [ ] TreeView `gitrContributors` under `gitr` container
- [ ] Root nodes: team names (from distinct teams in `commit_contributors`)
- [ ] Child nodes: contributors (login, full_name, vendor)
- [ ] Each shows commit count badge
- [ ] Context menu: "View Commits by Author", "View Jira Links by Author"
- [ ] Search box filters as you type
- [ ] Sorted by commit count descending
- [ ] Unclassified contributors (team="New") decorated with warning icon
- [ ] Refresh command `gitr.refreshContributors`

---

### US-036: Pipeline Runs TreeView

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Should Have |
| **Sprint** | Sprint 6 |

**As a** user, **I want to** a TreeView showing pipeline run history **so that** I can monitor execution and debug failures.

**Acceptance Criteria:**

- [ ] TreeView `gitrPipelineRuns` under `gitr` container
- [ ] Root nodes: pipeline runs (last 20, most recent first)
- [ ] Shows: class_name, start_time, status icon (green=FINISHED, red=ERROR, spinner=running), duration
- [ ] Child nodes: log entries for that run (last 50)
- [ ] Auto-refresh every 5s when pipeline running
- [ ] Context menu: "View Full Logs" (opens OutputChannel), "Re-run"
- [ ] Refresh command `gitr.refreshPipelineRuns`

---

### US-037: Status Bar Integration

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Must Have |
| **Sprint** | Sprint 6 |

**As a** user, **I want to** a status bar item showing database and pipeline status **so that** I can see at a glance whether gitr is operational.

**Acceptance Criteria:**

- [ ] Status bar item: "DB: Connected/Disconnected" + "Last run: 2h ago"
- [ ] Running state: "gitr: syncing..." with spinner icon
- [ ] Error state: "gitr: scan failed" with error icon
- [ ] Click opens Quick Pick with common commands
- [ ] Tooltip shows detailed status
- [ ] Disposed in `deactivate()`

---

## EPIC-11 -- Webview Dashboards

> Rich HTML/JS dashboards inside VS Code for data visualization using Chart.js. Replaces external reporting with in-editor analytics.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-038 | Webview Infrastructure & Theme Integration | 5 | **Must Have** | Sprint 7 |
| US-039 | Message Passing Protocol | 3 | **Must Have** | Sprint 7 |
| US-040 | Metrics Overview Dashboard | 8 | **Must Have** | Sprint 7 |
| US-041 | Commit-Jira Linkage Dashboard | 8 | **Must Have** | Sprint 7 |
| US-042 | Developer Scorecard Dashboard | 5 | **Should Have** | Sprint 7 |

### US-038: Webview Infrastructure & Theme Integration

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 7 |

**As a** developer, **I want to** a reusable webview panel framework **so that** dashboards can be built efficiently.

**Acceptance Criteria:**

- [ ] `src/views/webview/util.ts` with `getNonce()`, `getWebviewContent()` helpers
- [ ] `media/dashboard.css` using VS Code CSS variables (`--vscode-foreground`, `--vscode-editor-background`, etc.)
- [ ] `media/chart.min.js` (Chart.js vendored locally)
- [ ] `media/dashboard.js` with Chart.js color mapping to VS Code theme tokens
- [ ] Charts work in Light+, Dark+, and High Contrast themes
- [ ] Responsive layout with CSS Grid (2-col >1200px, 1-col <1200px)
- [ ] Card component: title, subtitle, collapsible, full-screen toggle
- [ ] Date range selector (7/30/90 days, custom)
- [ ] Refresh button that re-fetches data
- [ ] Loading spinner template, error boundary template
- [ ] `retainContextWhenHidden: true` for panel persistence

---

### US-039: Message Passing Protocol

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 7 |

**As a** developer, **I want to** a typed message protocol between extension host and webviews **so that** data flows reliably.

**Acceptance Criteria:**

- [ ] `src/views/webview/protocol.ts` with typed message unions
- [ ] `HostToWebview` types: commitTrends, teamMetrics, jiraLinkage, pipelineRuns, complexityTrends, loading, error
- [ ] `WebviewToHost` types: requestData, dateRangeChanged, filterChanged, exportCsv, openCommit, openJiraIssue
- [ ] Extension host routes messages to query service
- [ ] Webview state persistence via `vscode.getState()/setState()`
- [ ] All webview-to-host messages validated

---

### US-040: Metrics Overview Dashboard

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 7 |

**As a** manager, **I want to** a visual dashboard showing commit trends, team contributions, and complexity **so that** I can report on engineering health.

**Acceptance Criteria:**

- [ ] Webview panel `gitr.dashboard` opened via command
- [ ] Cards: Commits/Week (line chart), Jira Linkage Rate (doughnut), Team Activity (stacked bar), Top Contributors (horizontal bar), Complexity Trends (area chart)
- [ ] Date range selector applies to all cards
- [ ] Charts respect VS Code theme colors
- [ ] Tooltips on all data points
- [ ] Click chart element to drill down (e.g., click week -> filter to that week's commits)
- [ ] Charts have `aria-label` descriptions
- [ ] `<table>` fallback for screen readers
- [ ] Server-side pagination for underlying data
- [ ] Export button (downloads JSON)

---

### US-041: Commit-Jira Linkage Dashboard

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 7 |

**As a** project manager, **I want to** see which commits are linked to Jira issues **so that** I can enforce commit hygiene.

**Acceptance Criteria:**

- [ ] Webview table: SHA, author, date, message, Jira key, team
- [ ] Filters: author dropdown, team multi-select, Jira project, "Show only unlinked" checkbox
- [ ] Column sorting (click header toggles asc/desc)
- [ ] Pagination (50 rows/page, server-side)
- [ ] Click Jira key -> opens in browser
- [ ] Click SHA -> opens diff in VS Code
- [ ] Unlinked commits highlighted
- [ ] CSV export button
- [ ] Row count header: "Showing X of Y commits"
- [ ] Proper `<table>` with `<thead>`, `<th scope="col">`

---

### US-042: Developer Scorecard Dashboard

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Should Have |
| **Sprint** | Sprint 7 |

**As a** user, **I want to** see the developer scorecard **so that** I can assess contribution patterns.

**Acceptance Criteria:**

- [ ] Table from `vw_scorecard_detail` and `vw_scorecard`: full_name, team, vendor, release_assist_score, test_score, complexity_score, comments_score, code_score, total_score
- [ ] Formula matches Python: `release_assist*0.1 + test*0.35 + complexity*0.45 + comments*0.1`
- [ ] Sortable columns, filter by team/vendor
- [ ] Color coding: top 3 green, bottom 3 red

---

## EPIC-12 -- Extension Lifecycle & Error Handling

> Clean activation/deactivation, lazy loading, command validation, and actionable error messages.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-043 | Extension Activation & Deactivation | 3 | **Must Have** | Sprint 8 |
| US-044 | Lazy Activation Strategy | 2 | **Should Have** | Sprint 8 |
| US-045 | Command Pre-Execution Validation | 3 | **Must Have** | Sprint 5 |
| US-046 | Actionable Error Messages | 3 | **Must Have** | Sprint 6 |

### US-043: Extension Activation & Deactivation

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 8 |

**As a** user, **I want to** the extension to cleanly activate and deactivate **so that** it is well-behaved in VS Code.

**Acceptance Criteria:**

- [ ] `activate()`: initialize DB connection, register all commands, create TreeView providers, start schedule if enabled, show status bar
- [ ] `deactivate()`: close DB pool, clear intervals, dispose all disposables
- [ ] All disposables tracked via `context.subscriptions`
- [ ] No resource leaks after multiple activate/deactivate cycles
- [ ] DEBUG logging: "extension activated in [N]ms", "extension deactivated"

---

### US-044: Lazy Activation Strategy

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Should Have |
| **Sprint** | Sprint 8 |

**As a** user, **I want to** the extension to activate only when needed **so that** VS Code startup is not impacted.

**Acceptance Criteria:**

- [ ] Activation events: `onCommand:gitr.*`, `onView:gitrRepositories`, `workspaceContains:.git`
- [ ] No `*` activation event
- [ ] First activation shows welcome notification with setup guide
- [ ] Activation time measured and logged

---

### US-045: Command Pre-Execution Validation

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** helpful error messages when prerequisites are missing **so that** I know what to configure.

**Acceptance Criteria:**

- [ ] All pipeline commands check: DB connected, tokens stored, repos configured
- [ ] Actionable messages: "GitHub token not configured. Run 'gitr: Configure Credentials' first."
- [ ] Option to navigate directly to fix (button opens settings or credential command)

---

### US-046: Actionable Error Messages

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 6 |

**As a** user, **I want to** specific, actionable errors **so that** I can self-serve fixes.

**Acceptance Criteria:**

- [ ] Error categories with tailored messages and action buttons:
  - "Database connection failed. Is PostgreSQL running? [Start Docker]"
  - "Jira authentication failed (401). [Open Settings]"
  - "GitHub rate limit exceeded. [Configure PAT]"
  - "Git repository not found at [path]. [Open Folder]"
- [ ] Errors logged to OutputChannel with full stack traces
- [ ] Notification debouncing: suppress duplicate errors within 1 hour

---

## EPIC-13 -- Polish, Testing & Marketplace

> Final integration tests, accessibility, performance, and VS Code Marketplace packaging.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-047 | VS Code Extension Integration Tests | 5 | **Must Have** | Sprint 8 |
| US-048 | Comprehensive Unit Test Suite | 5 | **Must Have** | Sprint 8 |
| US-049 | Accessibility Audit | 3 | **Should Have** | Sprint 8 |
| US-050 | Performance Testing | 3 | **Should Have** | Sprint 8 |
| US-051 | VSIX Marketplace Packaging | 3 | **Must Have** | Sprint 8 |

### US-047: VS Code Extension Integration Tests

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 8 |

**As a** developer, **I want to** extension integration tests **so that** commands, TreeViews, and webviews work in the VS Code host.

**Acceptance Criteria:**

- [ ] `@vscode/test-electron` configured
- [ ] Tests verify all commands are registered
- [ ] Tests verify `gitr.configureCredentials` opens input box
- [ ] Tests verify TreeView providers return expected tree structure
- [ ] Tests run headless via `xvfb-run` in CI
- [ ] `npm run test:extension` script works

---

### US-048: Comprehensive Unit Test Suite

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 8 |

**As a** developer, **I want to** unit tests covering all pipeline modules **so that** regressions are caught.

**Acceptance Criteria:**

- [ ] Tests for: Database class, GitService, JiraService, GitHubService, DataEnhancer, TeamContributor, PipelineOrchestrator, PipelineLogger, SecretStorage, all regex/matching logic
- [ ] Minimum 80% overall line coverage
- [ ] All golden tests passing (Jira regex, merge detection, team assignment, scc parsing)
- [ ] All tests pass in CI

---

### US-049: Accessibility Audit

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Should Have |
| **Sprint** | Sprint 8 |

**As a** user with accessibility needs, **I want to** all panels to be accessible **so that** I can use the extension with screen readers and keyboard only.

**Acceptance Criteria:**

- [ ] All charts have `aria-label` descriptions
- [ ] Tables use proper `<th scope>` markup
- [ ] Color is never the only indicator (shapes/patterns alongside color)
- [ ] All interactive elements keyboard-reachable
- [ ] Focus indicators visible (using `--vscode-focusBorder`)
- [ ] Tested in Light+, Dark+, and High Contrast themes
- [ ] WCAG AA contrast ratios met (4.5:1 text, 3:1 graphics)

---

### US-050: Performance Testing

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Should Have |
| **Sprint** | Sprint 8 |

**As a** developer, **I want to** performance validated with realistic data volumes **so that** the extension handles real-world usage.

**Acceptance Criteria:**

- [ ] Bulk insert test: 1000 commits in <5 seconds
- [ ] Dashboard loads in <2s with 10k commits
- [ ] Tables paginate without lag (50 rows/page, <100ms page load)
- [ ] Extension activation <500ms
- [ ] WebView bundle <500KB

---

### US-051: VSIX Marketplace Packaging

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 8 |

**As a** user, **I want to** install the extension from the Marketplace **so that** I can get started easily.

**Acceptance Criteria:**

- [ ] `package.json` has all marketplace fields: publisher, version, categories, keywords, icon, repository
- [ ] Extension icon (128x128 PNG)
- [ ] `vsce package` produces valid `.vsix`
- [ ] `CHANGELOG.md` documents v1.0.0 features
- [ ] Extension page: description, screenshots (TreeViews + dashboards), README with setup instructions

---

## Backlog -- Future Sprints

| ID | Story Title | Points | Priority | Notes |
|---|---|---|---|---|
| US-052 | Jira Linkage TreeView | 8 | **Nice to Have** | Jira issues with linked commits in TreeView |
| US-053 | Repository Comparison Dashboard | 5 | **Nice to Have** | Side-by-side metrics across repos |
| US-054 | API Contract Tests | 3 | **Nice to Have** | Weekly scheduled tests against real Jira/GitHub APIs |
| US-055 | Database Privilege Separation | 3 | **Nice to Have** | Separate gitr_app and gitr_readonly users |
| US-056 | Keyboard Navigation Shortcuts | 2 | **Nice to Have** | Ctrl+Alt+G shortcuts for views |

---

## Story Dependency Map

| Dependency Chain | Rationale |
|---|---|
| **US-001 -> US-002 -> US-003** | Extension scaffold -> settings -> logging |
| **US-001 -> US-005 -> US-006 -> US-007 -> US-008** | Scaffold -> Docker -> container mgr -> migrations -> query layer |
| **US-001 -> US-009 -> US-011** | Scaffold -> SecretStorage -> credential command |
| **US-001 -> US-013 -> US-014** | Scaffold -> Vitest -> Testcontainers |
| **US-008 -> US-018 -> US-020** | DB layer -> Git service -> commit pipeline |
| **US-008 -> US-021 -> US-022** | DB layer -> Jira client -> issue loading |
| **US-020 -> US-015** | Commit pipeline -> golden tests validate output |
| **US-022 -> US-023 -> US-024** | Issue loading -> dev status -> unfinished refresh |
| **US-020 + US-026 -> US-027** | Commits + Jira linking -> team assignment |
| **US-020 + US-022 + US-025 + US-026 + US-027 -> US-029** | All services -> pipeline orchestrator |
| **US-029 -> US-030 -> US-031** | Orchestrator -> commands -> scheduling |
| **US-008 -> US-034 + US-035 + US-036** | DB layer -> all TreeViews |
| **US-038 -> US-039 -> US-040 + US-041** | Webview infra -> protocol -> dashboards |
| **US-010** | Input validation: used by US-018, US-021, US-025, US-026 |
| **US-016** | CI pipeline: validates US-013, US-014, US-015 |

---

## Technical Notes & Assumptions

| Topic | Detail |
|---|---|
| **Sprint Duration** | 2 weeks per sprint, solo developer |
| **Story Points** | Fibonacci scale (1, 2, 3, 5, 8, 13). Velocity ~18 pts/sprint. |
| **Bundler** | esbuild (VS Code recommended) |
| **Git Access** | simple-git (full control, closest to GitPython) |
| **Database** | Raw SQL with pg (parameterized queries, no ORM) |
| **Jira Client** | jira.js; dev-status endpoint requires direct HTTP call |
| **GitHub Client** | @octokit/rest |
| **Docker Management** | dockerode for container lifecycle |
| **Multi-repo** | Configured repo list in `gitr.repositories` setting |
| **Pipeline** | Both manual commands + automatic setInterval scheduling |
| **File Size Limit** | No TypeScript file exceeds 600 lines (PostgresDB.py at 853 lines must be split) |
| **Organization** | Python hardcoded organization name -- TypeScript uses `gitr.github.organization` setting |
| **Jira Key Mappings** | Python hardcodes PROJ->PROJ2, CRM->CRMREO -- TypeScript uses `gitr.jira.keyMappings` setting |
| **scc Dependency** | Requires `scc` CLI on host; check at activation, error with install instructions if missing |
| **SQL Inserts** | Python writes SQL to temp files then executes; TypeScript uses proper `BEGIN`/`COMMIT` transactions directly |
| **pandas Replacement** | Use typed arrays + Array.reduce/sort; move aggregations to SQL views where possible |
| **View Dependencies** | Views reference each other; migrations must create in dependency order |
| **Test-First** | Write tests before implementing each module; golden tests validate Python-TypeScript equivalence |
| **Linear Project** | All tickets created in the `gitrx` Linear project |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **Jira regex behavior differs (Python re vs JS RegExp)** | High | Medium | Golden tests with 100+ test strings; document any unavoidable Unicode differences |
| **scc CLI not available on all platforms** | High | Medium | Check at activation; provide install instructions; make optional (no complexity data) |
| **Docker Desktop licensing on user machines** | Medium | Medium | Document alternatives: Podman, Rancher Desktop, Colima |
| **Jira Dev Status API auth differs Cloud vs Server** | Medium | Medium | Test against both; abstract auth mechanism |
| **Extension activation too slow** | Medium | Medium | Defer DB connection until first command; lazy activation events |
| **TreeView performance with large datasets** | Medium | Medium | Paginate (top 50 runs, top 100 contributors); lazy load children |
| **Testcontainers slow in CI** | Low | High | Cache Docker images; use alpine; run serially |
| **Sprint 8 overloaded (19 pts)** | Medium | Medium | Begin writing tests incrementally in Sprints 5-7 alongside development |
| **Webview memory leaks** | Medium | Medium | Dispose Chart.js instances; use `retainContextWhenHidden: false` for infrequent panels |
| **VS Code API breaking changes** | High | Low | Pin `@types/vscode`; use `engines.vscode` constraint |

---

## Sprint Capacity Detail

| Sprint | Stories | Must Have | Should Have | Nice to Have | Total Pts |
|---|---|---|---|---|---|
| Sprint 1 | US-001 to US-009, US-011, US-013, US-014 | 12 stories | 0 | 0 | 40 pts* |
| Sprint 2 | US-010, US-015 to US-020 | 6 stories | 0 | 0 | 38 pts* |
| Sprint 3 | US-021, US-022 | 2 stories | 0 | 0 | 13 pts |
| Sprint 4 | US-023 to US-028 | 5 stories | 1 story | 0 | 31 pts* |
| Sprint 5 | US-029 to US-033, US-045 | 5 stories | 1 story | 0 | 25 pts* |
| Sprint 6 | US-034 to US-037, US-046 | 4 stories | 1 story | 0 | 20 pts |
| Sprint 7 | US-012, US-038 to US-042 | 4 stories | 2 stories | 0 | 32 pts* |
| Sprint 8 | US-043, US-044, US-047 to US-051 | 4 stories | 3 stories | 0 | 24 pts* |

*\*Sprints exceeding 20 pts: Stories should be started in preceding sprint's buffer time or shifted right. The dependency chain allows some stories to begin before their sprint's official start.*

**Recommended approach for overloaded sprints:**
- Sprint 1 (40 pts): This is the critical foundation. Consider extending to 3 weeks or splitting across Sprint 1A/1B.
- Sprint 2 (38 pts): Golden tests (US-015) and CI (US-016) can start in Sprint 1 buffer.
- Sprint 4 (31 pts): US-028 (complexity changes, Should Have) can be deferred.
- Sprint 7 (32 pts): US-042 (scorecard, Should Have) can be deferred to backlog.

---

*Generated by Claude Code with input from 10 specialist agents: prd-writer, security-auditor, qa-quality-assurance, ux-design-reviewer, vscode-extension-architect, python-to-typescript-migrator, docker-postgres-engineer, vscode-webview-designer, extension-test-engineer, pragmatic-shipper*
