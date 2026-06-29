# Organization Profile Dashboard

## Agile User Stories & Sprint Plan

**Prepared:** 2026-06-29 | **Platform:** VS Code Extension + Docker PostgreSQL | **Methodology:** Agile/Scrum | **Jira Project:** gitx

---

## Sprint Roadmap Overview

| Sprint | Focus Area | Key Deliverables |
|---|---|---|
| **Sprint 1** (Weeks 1-2) | Database & Infrastructure | Migration, organization column, queries foundation, data service skeleton |
| **Sprint 2** (Weeks 3-4) | Organization Profile Panel | Webview panel, all 15+ query methods, chart rendering, team-colored stacked bars |
| **Sprint 3** (Weeks 5-6) | TreeView Refactor & Integration | 3-level hierarchy, navigation, integration testing, edge case handling |
| **Sprint 4** (Weeks 7-8) | Caching & Multi-Panel Support | Dashboard caching service, multi-instance panels, Knowledge Concentration color coding |
| **Sprint 5** (Weeks 9-10) | Sprint Velocity Chart Promotion | Replace LOC charts with Sprint Velocity vs LOC as primary chart, team/member color coding |

---

## Summary Metrics

| Metric | Value |
|---|---|
| Total Epics | 5 |
| Total User Stories | 20 |
| Total Story Points | 62 |
| Must Have Stories | 17 (54 pts) |
| Should Have Stories | 3 (8 pts) |
| Nice to Have Stories | 0 |
| Estimated Duration | 5 core sprints (10 weeks) |
| Team Velocity | ~18 pts/sprint (solo developer) |

---

## Key Decisions (From Requirements Gathering)

| Decision | Choice | Rationale |
|---|---|---|
| **Database Schema** | Normalized `organizations` + `teams` tables | Cleaner hierarchy, easier to maintain, no denormalized data |
| **Team Assignment** | Contributors assigned to teams; org derived from team | Single source of truth for team-org relationship |
| **Metadata** | Minimal: id, name, created_at, updated_at | Just enough for tracking without over-engineering |
| **TreeView Navigation** | Organization -> Teams -> Contributors hierarchy | Full replacement of current structure |
| **Team Color Coding** | Stacked segments proportional to team contribution | Visual breakdown by team, not author |
| **Knowledge Concentration** | Organization-wide concentration risks | Any person owning >X% of critical files across all teams |
| **Velocity Query Fix** | Join on `full_name` or `jira_name` | NOT email or login (per user clarification) |
| **Empty/Partial Data** | Show available data with coverage notes | Not hiding charts when partial data exists |

---

## EPIC-01 -- Database & Core Infrastructure

> Add normalized organization and team tables to database schema and create foundation for organization-level queries. This epic blocks all other work and must be completed first.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-001 | Create Organizations and Teams Tables | 3 | **Must Have** | Sprint 1 |
| US-002 | Organization Profile Query Layer | 3 | **Must Have** | Sprint 1 |
| US-003 | Organization Profile Data Service Skeleton | 3 | **Must Have** | Sprint 1 |

### US-001: Create Organizations and Teams Tables

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** create normalized `organizations` and `teams` tables **so that** team-organization relationships are properly modeled and easy to maintain.

**Acceptance Criteria:**

- [ ] Migration file `030_create_organizations_teams_tables.sql` created in `docker/migrations/`
- [ ] `organizations` table created with: id (SERIAL PK), name (VARCHAR 100 UNIQUE NOT NULL), created_at, updated_at
- [ ] `teams` table created with: id (SERIAL PK), name (VARCHAR 100 UNIQUE NOT NULL), organization_id (FK nullable), created_at, updated_at
- [ ] Foreign key constraint: `teams.organization_id` REFERENCES `organizations(id)` ON DELETE SET NULL
- [ ] Index created: `idx_teams_organization_id` on teams.organization_id
- [ ] Migrate existing team names from `commit_contributors.team` into `teams` table (distinct values)
- [ ] Add `team_id` column to `commit_contributors` as nullable FK to `teams.id`
- [ ] Backfill `commit_contributors.team_id` from existing `team` column values
- [ ] Keep original `team` column for backward compatibility (deprecate later)
- [ ] Rollback script created and tested
- [ ] Migration is idempotent (can run multiple times safely)
- [ ] Integration test validates tables exist and relationships work

**Schema Design:**
```sql
-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Teams table with optional organization FK
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_teams_organization_id ON teams(organization_id);

-- Add team_id FK to commit_contributors
ALTER TABLE commit_contributors
ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;

-- Backfill team_id from existing team column
INSERT INTO teams (name)
SELECT DISTINCT team FROM commit_contributors WHERE team IS NOT NULL
ON CONFLICT (name) DO NOTHING;

UPDATE commit_contributors cc
SET team_id = t.id
FROM teams t
WHERE cc.team = t.name AND cc.team_id IS NULL;
```

**Security Considerations:**
- VARCHAR(100) constraint at database level
- Application-layer validation for name format (alphanumeric, spaces, hyphens, underscores, periods)
- Foreign key constraints prevent orphaned records

---

### US-002: Organization Profile Query Layer

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** parameterized SQL queries for organization-level aggregation **so that** I can fetch metrics across all teams in an organization.

**Acceptance Criteria:**

- [ ] File created: `src/database/queries/org-profile-queries.ts`
- [ ] Query: `QUERY_ALL_ORGANIZATIONS` - Get all organizations with team counts
- [ ] Query: `QUERY_ORG_SUMMARY_STATS` - Summary metrics (team count, contributor count, LOC, commits)
- [ ] Query: `QUERY_ORG_LOC_PER_WEEK` - LOC aggregated weekly
- [ ] Query: `QUERY_ORG_TOP_COMPLEX_FILES_BY_TEAM` - Top 15 complex files with team breakdown
- [ ] Query: `QUERY_ORG_TOP_FREQUENT_FILES_BY_TEAM` - Top 20 modified files with team breakdown
- [ ] Query: `QUERY_ORG_TECH_STACK` - Technology stack percentages
- [ ] Query: `QUERY_ORG_COMMENTS_PER_WEEK` - Comments added aggregation
- [ ] Query: `QUERY_ORG_TESTS_PER_WEEK` - Test files modified aggregation
- [ ] Query: `QUERY_ORG_HYGIENE_SCORE` - Average commit hygiene
- [ ] Query: `QUERY_ORG_VELOCITY_VS_LOC` - Sprint velocity with FIXED join logic
- [ ] Query: `QUERY_ORG_HOT_SPOTS` - Top 10 hot spots across all teams
- [ ] Query: `QUERY_ORG_KNOWLEDGE_CONCENTRATION` - Org-wide concentration risks
- [ ] All queries use `$1, $2, $3` parameterized placeholders (zero SQL injection)
- [ ] All queries JOIN through normalized tables: `organizations` -> `teams` -> `commit_contributors`

**Key Query Pattern (Normalized Schema):**
```sql
WITH org_teams AS (
  SELECT t.id AS team_id, t.name AS team_name
  FROM teams t
  WHERE t.organization_id = $1
),
team_members AS (
  SELECT DISTINCT cc.login, cc.full_name, cc.jira_name, t.team_name
  FROM commit_contributors cc
  INNER JOIN org_teams t ON cc.team_id = t.team_id
)
SELECT ...
FROM commit_history ch
JOIN team_members tm ON (
  ch.author = tm.full_name
  OR (tm.full_name IS NULL AND ch.author = tm.login)
)
WHERE ch.commit_date >= $2 AND ch.is_merge = FALSE
```

**Get All Organizations Query:**
```sql
SELECT
  o.id,
  o.name,
  COUNT(DISTINCT t.id) AS team_count,
  COUNT(DISTINCT cc.login) AS contributor_count
FROM organizations o
LEFT JOIN teams t ON t.organization_id = o.id
LEFT JOIN commit_contributors cc ON cc.team_id = t.id
GROUP BY o.id, o.name
ORDER BY o.name;
```

**Velocity Query Fix (CRITICAL):**
```sql
-- CORRECT: Join Jira on jira_name with full_name fallback
JOIN team_members tm ON jd.assignee = COALESCE(tm.jira_name, tm.full_name)

-- NOT: ld.assignee = tm.email OR ld.assignee = tm.login (incorrect)
```

---

### US-003: Organization Profile Data Service Skeleton

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 1 |

**As a** developer, **I want to** a data service class mirroring TeamProfileDataService **so that** organization-level queries are encapsulated with proper validation.

**Acceptance Criteria:**

- [ ] File created: `src/services/org-profile-data-service.ts`
- [ ] File created: `src/services/org-profile-data-types.ts`
- [ ] File created: `src/views/webview/org-profile-protocol.ts`
- [ ] Class: `OrganizationProfileDataService` with 15+ query methods
- [ ] Input validation: `validateOrganizationId()` - positive integer
- [ ] Input validation: `validateTimeframe()` - whitelist ['30', '60', '90', '180', '365', '730']
- [ ] Dynamic aggregation period: week (<365 days) or month (>=365 days)
- [ ] Methods: getOrganizations(), getOrganizationById(), getSummary(), getLocPerWeek(), etc.
- [ ] Protocol types defined for webview<->host communication
- [ ] CRUD methods for organizations: createOrganization(), updateOrganization(), deleteOrganization()
- [ ] CRUD methods for team-org assignment: assignTeamToOrganization(), removeTeamFromOrganization()
- [ ] Unit tests for validation edge cases

**Data Types:**
```typescript
export interface Organization {
  id: number;
  name: string;
  teamCount: number;
  contributorCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Team {
  id: number;
  name: string;
  organizationId: number | null;
  organizationName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSummary {
  organization: Organization;
  totalCommits: number;
  totalLoc: number;
  avgComplexity: number;
  teams: TeamSummary[];
}
```

**Validation Pattern:**
```typescript
private validateOrganizationId(orgId: number, methodName: string): void {
  if (!Number.isInteger(orgId) || orgId <= 0) {
    throw new Error('Organization ID must be a positive integer.');
  }
}

private validateOrganizationName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('Organization name is required.');
  }
  if (name.length > 100) {
    throw new Error('Organization name exceeds maximum length of 100 characters.');
  }
  if (!/^[a-zA-Z0-9\s\-_.]+$/.test(name)) {
    throw new Error('Organization name contains invalid characters.');
  }
}
```

---

## EPIC-02 -- Organization Profile Dashboard

> Implement the Organization Profile webview panel with all charts aggregated to organization level. Inherits patterns from Team Profile but aggregates across multiple teams.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-004 | Organization Profile Panel Manager | 3 | **Must Have** | Sprint 2 |
| US-005 | Organization Summary & KPI Cards | 2 | **Must Have** | Sprint 2 |
| US-006 | Lines of Code & Sprint Velocity Charts | 3 | **Must Have** | Sprint 2 |
| US-007 | Team-Colored Stacked Bar Charts | 5 | **Must Have** | Sprint 2 |
| US-008 | Hot Spots & Knowledge Concentration Charts | 3 | **Must Have** | Sprint 2 |
| US-009 | Partial Data Coverage Handling | 2 | **Should Have** | Sprint 2 |

### US-004: Organization Profile Panel Manager

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** a webview panel that displays Organization Profile metrics **so that** I can view aggregated analytics across all teams in an organization.

**Acceptance Criteria:**

- [ ] File created: `src/views/webview/org-profile-panel.ts`
- [ ] Singleton pattern: Only one OrganizationProfilePanel instance at a time
- [ ] Static method: `createOrShow(extensionUri, secretService, organization?)` with optional pre-selection
- [ ] Panel title: "Organization Profile: [Organization Name]"
- [ ] Message routing via discriminated union protocol
- [ ] Rate limiting on message handlers (match Team Profile pattern)
- [ ] Disposal state tracking to prevent race conditions
- [ ] Database connection via `ensureDbConnection()` pattern
- [ ] Command registered: `gitrx.openOrganizationProfile` with organization name argument
- [ ] Webview retains context when hidden: `retainContextWhenHidden: true`

**Panel Lifecycle:**
```typescript
static createOrShow(
  extensionUri: vscode.Uri,
  secretService: SecretStorageService,
  organization?: string // Pre-selected org from TreeView click
): void {
  if (OrganizationProfilePanel.currentPanel) {
    if (organization) {
      OrganizationProfilePanel.currentPanel.setOrganization(organization);
    }
    OrganizationProfilePanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
    return;
  }
  // Create new panel...
}
```

---

### US-005: Organization Summary & KPI Cards

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** see summary KPI cards for the organization **so that** I can quickly understand organizational health metrics.

**Acceptance Criteria:**

- [ ] Organization selector dropdown with format: "Org Name (X teams, Y contributors)"
- [ ] Date range selector: 30/60/90/180/365/730 days (dynamic aggregation week/month)
- [ ] KPI Cards (all styled consistently with Team Profile):
  - Total Teams (count)
  - Total Contributors (count across all teams)
  - Total Commits (sum)
  - Total LOC (sum)
  - Avg Complexity (weighted average)
  - Avg LOC/Period (average across teams)
  - Avg SP/Period (weighted average, excluded if no Jira data)
  - Repositories Worked On (distinct count)
- [ ] Aggregation period label adapts: "per week" or "per month" based on timeframe
- [ ] All cards have loading skeleton states
- [ ] All cards have VS Code theme-aware colors

**Aggregation Rules:**
- **Sum metrics**: Total Commits, Total LOC, Comments Added, Test Files Modified
- **Average metrics**: Avg LOC/Period, Avg SP/Period, Avg Complexity, Commit Hygiene Score (weighted by contributor count)
- **Percentage metrics**: Technology Stack (relative to sum of all changes)

---

### US-006: Lines of Code & Sprint Velocity Charts

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** see LOC trends and sprint velocity charts at the organization level **so that** I can track engineering output over time.

**Acceptance Criteria:**

- [ ] Lines of Code chart: Stacked bar chart by REPOSITORY (sum across all teams)
- [ ] Sprint Velocity vs LOC chart: Dual-axis (LOC bars, story points line)
- [ ] Velocity uses FIXED join logic: `COALESCE(tm.jira_name, tm.full_name)` NOT email/login
- [ ] Charts use dynamic aggregation (weekly for <365 days, monthly for >=365 days)
- [ ] Comments Added line chart (sum aggregation)
- [ ] Test Files Modified line chart (sum aggregation)
- [ ] Technology Stack doughnut chart (percentages relative to total)
- [ ] Commit Hygiene gauge (average across team members)
- [ ] All charts respect VS Code theme (light/dark/high-contrast)
- [ ] All charts have Chart.js/D3 tooltips with detailed values
- [ ] Empty state: "No data for selected timeframe"

---

### US-007: Team-Colored Stacked Bar Charts

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** file analysis charts color-coded by team **so that** I can see which teams contribute to complex or frequently modified files.

**Acceptance Criteria:**

- [ ] File created: `src/views/webview/d3-org-profile-file-charts.ts`
- [ ] Top 15 Complex Files: Horizontal stacked bar, segments proportional to TEAM contribution
- [ ] Top 20 Frequently Modified Files: Horizontal stacked bar, segments proportional to TEAM contribution
- [ ] Team color palette: Okabe-Ito colorblind-friendly palette (12 distinct colors)
- [ ] Legend: Shows team names with color indicators
- [ ] Interactive legend: Click to toggle team visibility (filter from chart)
- [ ] Tooltip: File path, team name, contribution value, percentage
- [ ] File path click: Opens file in VS Code editor
- [ ] High-contrast mode support: Border around bars, pattern fills as secondary differentiator
- [ ] Max teams displayed: 10 (remaining grouped as "Other Teams")

**Team Color Palette:**
```typescript
export function getTeamColorPalette(): string[] {
  return [
    '#E69F00', // Orange
    '#56B4E9', // Sky Blue
    '#009E73', // Bluish Green
    '#F0E442', // Yellow
    '#0072B2', // Blue
    '#D55E00', // Vermillion
    '#CC79A7', // Reddish Purple
    '#999999', // Gray
    '#8B4513', // Saddle Brown
    '#6A5ACD', // Slate Blue
    '#FF6347', // Tomato
    '#20B2AA', // Light Sea Green
  ];
}
```

---

### US-008: Hot Spots & Knowledge Concentration Charts

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** see hot spots and knowledge concentration at the organization level **so that** I can identify risky files across all teams.

**Acceptance Criteria:**

- [ ] Hot Spots: Top 10 files across ALL teams (bubble chart: X=complexity, Y=churn, size=LOC, color=risk tier)
- [ ] Knowledge Concentration: Org-wide concentration risks (treemap: any person owning >X% of files)
- [ ] Knowledge Concentration color-coded by team member using Okabe-Ito palette
- [ ] Legend shows team member names with assigned colors
- [ ] Interactive legend: Click to filter by team member
- [ ] Risk calculation: Same algorithm as Team Profile, applied across all organization teams
- [ ] Files are aggregated from all team members in the organization
- [ ] Tooltip: File path, complexity, churn count, risk tier, owning team member, team member color
- [ ] File click: Opens file in VS Code editor
- [ ] Empty state: "No hot spots identified" / "No concentration risks"

---

### US-009: Partial Data Coverage Handling

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Should Have |
| **Sprint** | Sprint 2 |

**As a** user, **I want to** see coverage notes when some teams have incomplete data **so that** I understand the scope of displayed metrics.

**Acceptance Criteria:**

- [ ] Warning banner at top of dashboard when data is partial
- [ ] Format: "Showing data for X of Y teams in this timeframe"
- [ ] "Details" button expands list showing team status:
  - ✓ Team A (120 commits)
  - ✓ Team B (89 commits)
  - ⚠ Team C (no data)
- [ ] Coverage note appears below organization selector
- [ ] Charts display available data only (no zeros for missing teams)
- [ ] Average metrics exclude teams without data from denominator
- [ ] Jira-dependent charts show separate coverage: "X of Y teams have Jira data"

---

## EPIC-03 -- TreeView Refactor & Integration

> Restructure the Contributors TreeView to support Organization -> Teams -> Contributors hierarchy. Highest-risk component requiring careful navigation testing.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-010 | TreeView 3-Level Hierarchy | 8 | **Must Have** | Sprint 3 |
| US-011 | TreeView Organization Node Commands | 2 | **Must Have** | Sprint 3 |
| US-012 | Integration Testing & Edge Cases | 2 | **Should Have** | Sprint 3 |

### US-010: TreeView 3-Level Hierarchy

| | |
|---|---|
| **Points** | 8 |
| **Priority** | Must Have |
| **Sprint** | Sprint 3 |

**As a** user, **I want to** see a 3-level hierarchy in the Contributors TreeView **so that** I can navigate by organization, team, and contributor.

**Acceptance Criteria:**

- [ ] TreeView structure: Organization (root) -> Teams (children) -> Contributors (grandchildren)
- [ ] File updated: `src/providers/contributor-tree-provider.ts`
- [ ] Node types defined: `OrganizationNode`, `TeamNode`, `ContributorNode` (discriminated union)
- [ ] Organization node display: "Org Name - X teams, Y contributors, Z commits"
- [ ] Team node display: "Team Name - X contributors, Y commits" (existing pattern)
- [ ] Contributor node display: "Full Name (X commits)" (existing pattern)
- [ ] NULL organization teams grouped under "Unassigned" node (sorted last)
- [ ] Organizations sorted alphabetically, "Unassigned" always at bottom
- [ ] Teams sorted by commit count descending within organization
- [ ] Contributors sorted by commit count descending within team
- [ ] Organization nodes collapsible (collapsed by default)
- [ ] Auto-expand organization node when clicking it to open dashboard
- [ ] Icons: `$(organization)` for org, `$(people)` for team, `$(person)` for contributor
- [ ] Keyboard navigation: Arrow keys traverse 3 levels correctly
- [ ] ARIA attributes: `aria-level="1|2|3"`, `aria-expanded="true|false"`

**Node Type Definitions:**
```typescript
export interface OrganizationNode {
  type: 'organization';
  name: string;
  teamCount: number;
  contributorCount: number;
  commitCount: number;
}

export interface TeamNode {
  type: 'team';
  organizationName: string | null;
  teamName: string;
  contributorCount: number;
  commitCount: number;
}

export interface ContributorNode {
  type: 'contributor';
  organizationName: string | null;
  teamName: string;
  fullName: string;
  email: string;
  commitCount: number;
}

export type TreeNodeData = OrganizationNode | TeamNode | ContributorNode;
```

---

### US-011: TreeView Organization Node Commands

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Must Have |
| **Sprint** | Sprint 3 |

**As a** user, **I want to** click organization nodes to open Organization Profile **so that** I can view org-level metrics directly from the TreeView.

**Acceptance Criteria:**

- [ ] Command registered: `gitrx.openOrganizationProfile` in `package.json`
- [ ] Organization node click: Opens Organization Profile panel with org pre-selected
- [ ] Team node click: Opens Team Profile panel (existing behavior preserved)
- [ ] Contributor node click: Opens Developer Profile panel (existing behavior preserved)
- [ ] Context menu for organization nodes: "Open Organization Profile"
- [ ] Extension manifest updated with new command
- [ ] Command handler in `src/extension.ts` with error handling

**Package.json Addition:**
```json
{
  "contributes": {
    "commands": [
      {
        "command": "gitrx.openOrganizationProfile",
        "title": "Open Organization Profile",
        "icon": "$(organization)"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "gitrx.openOrganizationProfile",
          "when": "view == gitrx-contributors && viewItem == organization",
          "group": "navigation@1"
        }
      ]
    }
  }
}
```

---

### US-012: Integration Testing & Edge Cases

| | |
|---|---|
| **Points** | 2 |
| **Priority** | Should Have |
| **Sprint** | Sprint 3 |

**As a** developer, **I want to** comprehensive integration tests for the organization feature **so that** edge cases are handled correctly.

**Acceptance Criteria:**

- [ ] Test: Organization with 3 teams, full data (happy path)
- [ ] Test: Organization with 1 team (sum/average of 1)
- [ ] Test: Empty organization (no teams assigned)
- [ ] Test: Organization with no data in timeframe
- [ ] Test: Team with no commits in timeframe (excluded from aggregation)
- [ ] Test: Contributor in multiple teams (uses primary team assignment)
- [ ] Test: Partial Jira integration (some teams have Jira, others don't)
- [ ] Test: NULL organization teams grouped under "Unassigned"
- [ ] Test: TreeView click navigation (org -> team -> contributor)
- [ ] Test: Database migration rollback
- [ ] Test: Query performance with 20 teams, 200 contributors (<500ms)
- [ ] Regression test: Team Profile dashboard unchanged
- [ ] Regression test: Developer Profile dashboard unchanged
- [ ] Regression test: Pipeline team assignment unchanged
- [ ] All tests pass in CI with Testcontainers PostgreSQL 16

---

## EPIC-04 -- Dashboard Caching & Multi-Panel Support

> Implement caching for dashboard queries and convert singleton panel patterns to multi-instance, allowing multiple profile dashboards to be open side-by-side.

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-013 | Knowledge Concentration Developer Color Coding (Team Profile) | 3 | **Must Have** | Sprint 4 |
| US-014 | Dashboard Query Caching Service | 5 | **Must Have** | Sprint 4 |
| US-015 | Multi-Instance Developer Profile Panels | 3 | **Must Have** | Sprint 4 |
| US-016 | Multi-Instance Team Profile Panels | 3 | **Must Have** | Sprint 4 |
| US-017 | Multi-Instance Organization Profile Panels | 4 | **Should Have** | Sprint 4 |

### US-013: Knowledge Concentration Developer Color Coding (Team Profile)

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** see the Knowledge Concentration chart on the Team Profile dashboard color-coded by developer **so that** I can quickly identify which team members own critical files.

**Acceptance Criteria:**

- [ ] File modified: `src/views/webview/team-profile-html.ts` or relevant chart module
- [ ] Knowledge Concentration treemap segments color-coded by developer
- [ ] Developer color palette: Okabe-Ito colorblind-friendly palette (12 distinct colors)
- [ ] Legend shows developer names with assigned color indicators
- [ ] Interactive legend: Click to toggle developer visibility (filter from chart)
- [ ] Tooltip: File path, ownership percentage, developer name, developer color
- [ ] Max developers displayed: 10 (remaining grouped as "Other Developers")
- [ ] Colors assigned deterministically based on sorted developer names for consistency
- [ ] High-contrast mode support: Pattern fills as secondary differentiator
- [ ] Existing functionality preserved: File click opens file in VS Code editor

**Developer Color Assignment:**
```typescript
export function getDeveloperColor(developerIndex: number): string {
  const palette = getTeamColorPalette(); // Reuse Okabe-Ito palette
  return palette[developerIndex % palette.length];
}
```

---

### US-014: Dashboard Query Caching Service

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** dashboard queries to be cached **so that** switching between profile tabs is fast and doesn't repeatedly query the database.

**Acceptance Criteria:**

- [ ] File created: `src/services/dashboard-cache-service.ts`
- [ ] Cache service: Singleton instance shared across all dashboard panels
- [ ] Cache key format: `{panelType}:{identifier}:{timeframe}:{queryName}`
- [ ] Time-based expiration: Default 5 minutes, configurable via setting
- [ ] Manual invalidation: `invalidate(panelType, identifier?)` method
- [ ] Auto-invalidation on pipeline run completion
- [ ] Memory management: LRU eviction when cache exceeds max size (default 100 entries)
- [ ] Cache hit logging: Debug output showing cache hits/misses for troubleshooting
- [ ] VS Code setting: `gitr.dashboardCacheTtlMinutes` (default: 5)
- [ ] VS Code setting: `gitr.dashboardCacheMaxEntries` (default: 100)
- [ ] Integration with existing data services (DevProfileDataService, TeamProfileDataService, OrganizationProfileDataService)

**Cache Service Interface:**
```typescript
export interface DashboardCacheService {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number): void;
  invalidate(panelType: 'dev' | 'team' | 'org', identifier?: string): void;
  invalidateAll(): void;
  getStats(): { hits: number; misses: number; size: number };
}
```

---

### US-015: Multi-Instance Developer Profile Panels

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** open multiple Developer Profile tabs side-by-side **so that** I can compare metrics between team members.

**Acceptance Criteria:**

- [ ] File modified: `src/views/webview/dev-profile-panel.ts`
- [ ] Remove singleton pattern: Delete `private static currentPanel` tracking
- [ ] `createOrShow()` always creates a new panel instance
- [ ] Panel title uniquely identifies developer: "Dev Profile: John Smith"
- [ ] Each panel maintains independent state (developer, timeframe, scroll position)
- [ ] Panel disposed correctly when closed (no memory leaks)
- [ ] Multiple panels can be arranged in VS Code split view (side-by-side)
- [ ] VS Code column assignment: New panels open in `ViewColumn.Beside` if another panel is active
- [ ] TreeView click creates new panel instead of revealing existing
- [ ] Maximum open panels: No artificial limit (VS Code handles naturally)
- [ ] All panels share the dashboard cache service (US-014)

**Panel Factory Pattern:**
```typescript
// BEFORE (singleton)
static createOrShow(extensionUri: vscode.Uri, devId?: string): void {
  if (DevProfilePanel.currentPanel) {
    DevProfilePanel.currentPanel.panel.reveal();
    return;
  }
  // create new...
}

// AFTER (multi-instance)
static create(extensionUri: vscode.Uri, devId?: string): DevProfilePanel {
  const column = vscode.window.activeTextEditor
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.One;
  // always create new panel...
  return new DevProfilePanel(panel, extensionUri, devId);
}
```

---

### US-016: Multi-Instance Team Profile Panels

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** open multiple Team Profile tabs side-by-side **so that** I can compare metrics between teams.

**Acceptance Criteria:**

- [ ] File modified: `src/views/webview/team-profile-panel.ts`
- [ ] Remove singleton pattern: Delete `private static currentPanel` tracking
- [ ] `createOrShow()` always creates a new panel instance
- [ ] Panel title uniquely identifies team: "Team Profile: Platform Team"
- [ ] Each panel maintains independent state (team, timeframe, scroll position)
- [ ] Panel disposed correctly when closed (no memory leaks)
- [ ] Multiple panels can be arranged in VS Code split view (side-by-side)
- [ ] VS Code column assignment: New panels open in `ViewColumn.Beside` if another panel is active
- [ ] TreeView click creates new panel instead of revealing existing
- [ ] All panels share the dashboard cache service (US-014)
- [ ] Regression test: All existing Team Profile functionality preserved

---

### US-017: Multi-Instance Organization Profile Panels

| | |
|---|---|
| **Points** | 4 |
| **Priority** | Should Have |
| **Sprint** | Sprint 4 |

**As a** user, **I want to** open multiple Organization Profile tabs side-by-side **so that** I can compare metrics between organizations.

**Acceptance Criteria:**

- [ ] File modified: `src/views/webview/org-profile-panel.ts`
- [ ] Remove singleton pattern: Delete `private static currentPanel` tracking
- [ ] `createOrShow()` always creates a new panel instance
- [ ] Panel title uniquely identifies organization: "Org Profile: Engineering"
- [ ] Each panel maintains independent state (organization, timeframe, scroll position)
- [ ] Panel disposed correctly when closed (no memory leaks)
- [ ] Multiple panels can be arranged in VS Code split view (side-by-side)
- [ ] VS Code column assignment: New panels open in `ViewColumn.Beside` if another panel is active
- [ ] TreeView click creates new panel instead of revealing existing
- [ ] All panels share the dashboard cache service (US-014)
- [ ] Consider: Panel memory footprint (organization dashboards have more data)

**Note:** This story depends on EPIC-02 being complete (OrganizationProfilePanel must exist first).

---

## EPIC-05 -- Sprint Velocity Chart Promotion

> Replace the standalone Lines of Code chart with Sprint Velocity vs LOC as the primary chart on all profile dashboards. Story point bars are color-coded by contributor (Team Profile) or team (Organization Profile).

| ID | Story Title | Points | Priority | Sprint |
|---|---|---|---|---|
| US-018 | Sprint Velocity Chart on Developer Profile | 3 | **Must Have** | Sprint 5 |
| US-019 | Sprint Velocity Chart with Member Colors on Team Profile | 5 | **Must Have** | Sprint 5 |
| US-020 | Sprint Velocity Chart with Team Colors on Organization Profile | 5 | **Must Have** | Sprint 5 |

### US-018: Sprint Velocity Chart on Developer Profile

| | |
|---|---|
| **Points** | 3 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** see the Sprint Velocity vs LOC chart as the primary chart on Developer Profile **so that** I can understand a developer's velocity in context of their team.

**Acceptance Criteria:**

- [ ] Remove standalone Lines of Code chart from Developer Profile dashboard
- [ ] Add Sprint Velocity vs LOC chart as primary chart (below KPI cards)
- [ ] Chart layout: Developer's story point bars shown as colored segment against team total
- [ ] Developer's contribution highlighted with distinct color; rest of team shown in muted color
- [ ] LOC displayed as trend line overlay (dual-axis)
- [ ] X-axis: Time periods (weekly or monthly based on timeframe)
- [ ] Left Y-axis: Story points
- [ ] Right Y-axis: Lines of code
- [ ] Legend: "Your Contribution", "Team Total", "Lines of Code"
- [ ] Tooltip: Period, developer story points, team total, percentage of team, LOC
- [ ] **Graceful degradation**: When no Jira data, show LOC bars only with message: "Connect Jira to see Sprint Velocity"
- [ ] VS Code theme support (light/dark/high-contrast)

**Chart Structure:**
```
|  SP  |                    LOC Line ----*----*
|      |   ████████████████████░░░░░░░░░░░░░░░
|      |   ████████████████░░░░░░░░░░░░░░░░░░░
|      |   ████████████████████████░░░░░░░░░░░
|______|_____________________________________
         Week 1    Week 2    Week 3    Week 4

████ = Developer's contribution (colored)
░░░░ = Rest of team (muted)
```

---

### US-019: Sprint Velocity Chart with Member Colors on Team Profile

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** see the Sprint Velocity vs LOC chart with team member color coding on Team Profile **so that** I can see each member's velocity contribution.

**Acceptance Criteria:**

- [ ] Remove standalone Lines of Code chart from Team Profile dashboard
- [ ] Add Sprint Velocity vs LOC chart as primary chart (below KPI cards)
- [ ] Chart layout: Stacked colored bars for story points (one color per team member)
- [ ] LOC displayed as single trend line overlay (dual-axis)
- [ ] Team member color palette: Okabe-Ito colorblind-friendly (12 distinct colors)
- [ ] Max members in legend: 10 (remaining grouped as "Other Members")
- [ ] Colors assigned deterministically based on sorted member names
- [ ] Interactive legend: Click to toggle member visibility
- [ ] X-axis: Time periods (weekly or monthly based on timeframe)
- [ ] Left Y-axis: Story points (stacked total)
- [ ] Right Y-axis: Lines of code
- [ ] Tooltip: Period, member name, member story points, percentage of team, total LOC
- [ ] **Graceful degradation**: When no Jira data, show LOC bars only with message: "Connect Jira to see Sprint Velocity"
- [ ] High-contrast mode: Pattern fills as secondary differentiator
- [ ] VS Code theme support

**Chart Structure:**
```
|  SP  |                    LOC Line ----*----*
|      |   ████▓▓▓▓░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
|      |   ████▓▓▓▓▓▓▓▓░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒
|      |   ████████▓▓▓▓▓▓▓▓░░░░░░░░░░▒▒▒▒▒▒▒▒
|______|_____________________________________
         Week 1    Week 2    Week 3    Week 4

Each pattern/color = Different team member
```

---

### US-020: Sprint Velocity Chart with Team Colors on Organization Profile

| | |
|---|---|
| **Points** | 5 |
| **Priority** | Must Have |
| **Sprint** | Sprint 5 |

**As a** user, **I want to** see the Sprint Velocity vs LOC chart with team color coding on Organization Profile **so that** I can see each team's velocity contribution.

**Acceptance Criteria:**

- [ ] Remove standalone Lines of Code chart from Organization Profile dashboard (if added in EPIC-02)
- [ ] Add Sprint Velocity vs LOC chart as primary chart (below KPI cards)
- [ ] Chart layout: Stacked colored bars for story points (one color per team)
- [ ] LOC displayed as single trend line overlay (dual-axis)
- [ ] Team color palette: Okabe-Ito colorblind-friendly (12 distinct colors)
- [ ] Max teams in legend: 10 (remaining grouped as "Other Teams")
- [ ] Colors assigned deterministically based on sorted team names
- [ ] Interactive legend: Click to toggle team visibility
- [ ] X-axis: Time periods (weekly or monthly based on timeframe)
- [ ] Left Y-axis: Story points (stacked total)
- [ ] Right Y-axis: Lines of code
- [ ] Tooltip: Period, team name, team story points, percentage of org, total LOC
- [ ] **Graceful degradation**: When no Jira data, show LOC bars only with message: "Connect Jira to see Sprint Velocity"
- [ ] High-contrast mode: Pattern fills as secondary differentiator
- [ ] VS Code theme support
- [ ] Velocity query uses FIXED join: `COALESCE(tm.jira_name, tm.full_name)`

**Chart Structure:**
```
|  SP  |                    LOC Line ----*----*
|      |   ████████████▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░
|      |   ████████▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░
|      |   ████████████████▓▓▓▓▓▓▓▓▓▓░░░░░░░░
|______|_____________________________________
         Week 1    Week 2    Week 3    Week 4

Each pattern/color = Different team
```

**Dependencies:**
- Blocked by: US-006 (Sprint Velocity query implementation)
- Blocked by: US-007 (Team color palette defined)

---

## Story Dependency Map

| Dependency Chain | Rationale |
|---|---|
| **US-001 -> US-002 -> US-003** | Database schema -> queries -> data service |
| **US-003 -> US-004 -> US-005, US-006, US-007, US-008** | Data service -> panel -> charts |
| **US-007 -> US-009** | Charts -> partial data handling |
| **US-003 -> US-010 -> US-011** | Data service -> TreeView -> commands |
| **US-010 -> US-012** | TreeView -> integration testing |
| **US-014 -> US-015, US-016** | Caching service -> multi-instance panels |
| **US-004 -> US-017** | Organization panel exists -> multi-instance org panels |
| **US-007 -> US-013** | Team color palette defined -> developer color coding |
| **US-006 -> US-018, US-019, US-020** | Velocity query exists -> velocity chart promotion |
| **US-007 -> US-019, US-020** | Team color palette defined -> velocity chart color coding |

---

## Technical Notes & Assumptions

| Topic | Detail |
|---|---|
| **Sprint Duration** | 2 weeks per sprint, solo developer |
| **Story Points** | Fibonacci scale (1, 2, 3, 5, 8, 13). Velocity ~18 pts/sprint. |
| **Pattern Reuse** | Mirrors Team Profile implementation patterns exactly |
| **File Size Limit** | No TypeScript file exceeds 600 lines |
| **SQL Safety** | 100% parameterized queries with $1, $2 placeholders |
| **Schema Design** | Normalized: organizations -> teams -> commit_contributors (via team_id FK) |
| **Validation** | Organization/team names: alphanumeric, spaces, hyphens, underscores, periods, max 100 chars |
| **Aggregation** | Sum: LOC, commits, comments, tests. Average: complexity, hygiene, velocity (weighted) |
| **Velocity Fix** | Join on `COALESCE(jira_name, full_name)` NOT email/login |
| **Color Palette** | Okabe-Ito colorblind-friendly palette for team/developer colors |
| **Tree Levels** | Organization (1) -> Team (2) -> Contributor (3) with proper ARIA |
| **Test Database** | Testcontainers with PostgreSQL 16-alpine |
| **Dashboard Caching** | LRU cache with 5-min TTL, auto-invalidation on pipeline completion |
| **Multi-Panel** | Factory pattern replaces singleton, panels open in ViewColumn.Beside |
| **Panel Memory** | Shared cache service minimizes database queries across panels |
| **Velocity Chart** | Primary chart on all dashboards; stacked bars (SP) + line (LOC) |
| **No Jira Fallback** | Show LOC bars only with "Connect Jira to see Sprint Velocity" message |

---

## Security Considerations

| Risk | Severity | Mitigation |
|---|---|---|
| **SQL Injection via organization name** | MEDIUM | Input validation whitelist + parameterized queries |
| **XSS via organization name in webview** | MEDIUM | HTML escape all user-controlled data before DOM insertion |
| **Database column length** | LOW | VARCHAR(100) constraint + application-layer validation |
| **Log injection** | LOW | Sanitize organization names in logs (remove newlines) |

**Overall Security Risk Level: LOW** (local-only data, single-user, existing security patterns extend cleanly)

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **TreeView refactor breaks existing navigation** | High | Medium | Feature flag option, comprehensive regression tests |
| **Team color collision (>10 teams)** | Medium | Medium | Limit to 10 teams, group rest as "Other" |
| **Query performance with large orgs** | Medium | Low | Composite indexes, EXPLAIN ANALYZE testing |
| **Data quality (inconsistent org assignment)** | Medium | Medium | Explicit organization configuration in settings |
| **Knowledge concentration logic complexity** | Medium | Low | Define acceptance criteria upfront, golden tests |
| **Cache stale data shown after pipeline run** | Medium | Low | Auto-invalidation on pipeline completion event |
| **Multi-panel memory bloat** | Medium | Medium | Shared cache service, dispose listeners, memory monitoring |
| **Panel disposal race conditions** | Medium | Low | State tracking, async cleanup, comprehensive disposal tests |
| **Users without Jira see degraded velocity chart** | Medium | Medium | Clear "Connect Jira" message, LOC-only fallback works correctly |
| **Velocity chart complexity (stacking + line)** | Medium | Low | Chart.js dual-axis pattern, thorough tooltip testing |

---

## Implementation Reality (Anti-Mock Policy)

> **CRITICAL**: All database queries must execute against real PostgreSQL. No mocked database responses in integration tests.

**Stories Requiring Actual Implementation:**

| Story | Operation That Must Actually Work |
|-------|-----------------------------------|
| US-001 | CREATE TABLE migrations for organizations + teams executed on PostgreSQL 16 |
| US-002 | All SQL queries return correct aggregations |
| US-003 | Data service methods query real database |
| US-005 | KPI calculations match manual verification |
| US-006 | Velocity query joins correctly on jira_name |
| US-010 | TreeView queries database for organization hierarchy |
| US-013 | Developer color coding renders correctly in treemap |
| US-014 | Cache service reduces database queries on repeated loads |
| US-015 | Multiple DevProfilePanels open independently |
| US-016 | Multiple TeamProfilePanels open independently |
| US-017 | Multiple OrgProfilePanels open independently |
| US-018 | Developer velocity chart shows team comparison correctly |
| US-019 | Team velocity chart shows stacked member contributions |
| US-020 | Org velocity chart shows stacked team contributions |

**Verification Protocol (Before Marking Done):**

1. Run migration against staging database
2. Populate test data spanning multiple orgs/teams
3. Verify dashboard metrics match SQL query results
4. Confirm TreeView hierarchy renders correctly
5. Test navigation: org click -> panel opens with correct data

---

## Definition of Done

### Code Complete
- [ ] Database migration script written and tested
- [ ] All 15+ organization-level queries implemented
- [ ] OrganizationProfileDataService with validation
- [ ] OrganizationProfilePanel webview manager
- [ ] All chart types rendering with team colors
- [ ] Knowledge Concentration color-coded by developer/team member
- [ ] Dashboard caching service implemented
- [ ] All profile panels converted to multi-instance pattern
- [ ] Sprint Velocity vs LOC as primary chart on all dashboards
- [ ] Velocity charts with contributor/team color coding
- [ ] Graceful degradation when no Jira data
- [ ] TreeView 3-level hierarchy functional
- [ ] Command registration complete
- [ ] No TypeScript files exceed 600 lines
- [ ] All SQL queries parameterized

### Testing Complete
- [ ] Unit test coverage >= 85%
- [ ] Integration tests with Testcontainers
- [ ] All test cases (TC-001 through TC-020) passed
- [ ] Regression tests for Team/Developer Profiles
- [ ] Performance test: dashboard load < 3 seconds
- [ ] Cache hit/miss ratio testing
- [ ] Multi-panel memory leak testing
- [ ] Accessibility: keyboard navigation, ARIA labels

### Documentation Complete
- [ ] Jira ticket updated with implementation details
- [ ] Inline code comments for aggregation formulas
- [ ] Known limitations documented

### Review Complete
- [ ] Code review approved
- [ ] Security audit: no secrets, parameterized SQL
- [ ] QA sign-off on manual testing

### Deployment Ready
- [ ] Feature branch merged via PR
- [ ] CI pipeline passes
- [ ] Migration added to sequence
- [ ] Extension version bumped

---

*Generated by Claude Code with input from 8 specialist agents: pragmatic-shipper, vscode-webview-designer, docker-postgres-engineer, vscode-extension-architect, security-auditor, extension-test-engineer, qa-quality-assurance, ux-design-reviewer*
