# Test Strategy: Dashboard Repository Filter Bug Fix

## Bug Description
The repository filter on the All Metrics Dashboard is currently a single-select dropdown, but it should be a multi-select control that allows filtering charts by multiple repositories simultaneously.

## Test Layers

### 1. Unit Tests

#### 1.1 Dashboard HTML Generation Tests
**File**: `src/__tests__/unit/dashboard-html.test.ts`

**Test Cases**:
- `should render repository filter as multi-select control`
  - Verify HTML contains `<select id="repoFilter" multiple>` attribute
  - Verify filter has appropriate aria-label for accessibility

- `should preserve existing single-select filters (team, granularity)`
  - Verify team filter remains single-select
  - Verify granularity filter remains single-select

#### 1.2 Filter State Management Tests
**File**: `src/__tests__/unit/dashboard-filter-state.test.ts` (NEW)

**Test Cases**:
- `getFilters() returns array for repository filter when multiple selected`
  - Mock multi-select with values ['repo1', 'repo2']
  - Verify getFilters() returns `{ repository: ['repo1', 'repo2'] }`

- `getFilters() returns undefined when no repositories selected`
  - Mock empty selection
  - Verify getFilters() returns `{ repository: undefined }`

- `getFilters() handles single repository selection`
  - Mock single value selected
  - Verify getFilters() returns `{ repository: ['repo1'] }` (array with one item)

- `saveFilterState() persists multi-select repository choices`
  - Select multiple repositories
  - Save state
  - Verify VS Code state storage contains array

- `restoreFilterState() restores multi-select selections`
  - Mock saved state with `['repo1', 'repo2']`
  - Restore state
  - Verify both options are marked as selected in DOM

#### 1.3 Dashboard Data Service Tests
**File**: `src/__tests__/unit/dashboard-data-service.test.ts`

**Test Cases**:
- `getCommitVelocity() accepts array of repositories in filters`
  - Call with `filters: { repository: ['repo1', 'repo2'] }`
  - Verify SQL uses `IN ($1, $2)` clause with parameterized values
  - Verify both repositories are in params array

- `getCommitVelocity() accepts single repository (backward compatibility)`
  - Call with `filters: { repository: 'repo1' }`
  - Verify query still works (converts to array internally)

- `getCommitVelocity() accepts undefined repository filter`
  - Call with `filters: {}`
  - Verify WHERE clause omits repository condition

- `getTechStackDistribution() respects repository array filter`
  - Similar tests for multi-repo filtering

- `getScorecard() respects repository array filter`
  - Test team scorecard filtering with multiple repos

- `getScorecardDetail() respects repository array filter`
  - Test detailed scorecard with multi-repo filter

- `getFileComplexityTrends() respects repository array filter`
  - Test complexity data with multiple repos selected

- `validateFilters() accepts repository as array`
  - Verify validation passes for string array
  - Verify validation rejects non-string elements
  - Verify validation rejects arrays exceeding max length

### 2. Integration Tests

#### 2.1 Dashboard Data Service Integration Tests
**File**: `src/__tests__/integration/dashboard-multi-repo-filter.integration.test.ts` (NEW)

**Setup**:
- Use Testcontainers PostgreSQL 16
- Insert test data across 3 repositories: 'repo1', 'repo2', 'repo3'
- Each repo has commits from different teams and dates

**Test Cases**:

**AC1: Multi-repository filter returns combined data**
- Arrange: 3 repos with distinct commits
- Act: Query with `repository: ['repo1', 'repo2']`
- Assert: Results contain data from both repos but not repo3

**AC2: Single repository selection works**
- Arrange: Same dataset
- Act: Query with `repository: ['repo1']`
- Assert: Results contain only repo1 data

**AC3: No repository filter returns all data**
- Arrange: Same dataset
- Act: Query with `repository: undefined`
- Assert: Results contain all 3 repos

**AC4: Empty repository array returns no data**
- Arrange: Same dataset
- Act: Query with `repository: []`
- Assert: Results are empty

**AC5: Repository filter combines with other filters**
- Arrange: Dataset with multiple teams, dates, repos
- Act: Query with `{ repository: ['repo1', 'repo2'], team: 'Platform', startDate: '2025-01-01' }`
- Assert: Results filtered by all criteria (AND logic)

**AC6: All charts respect the multi-repo filter**
Test each chart type:
- Commit Velocity (LOC per Week)
- Technology Stack Distribution
- Team Scorecard
- File Complexity Trends
- LOC Committed
- Top Complex Files
- Top Files by Churn

For each chart:
- Insert data for 2 repos
- Query with `repository: ['repo1']`
- Verify only repo1 data returned

### 3. Webview Integration Tests

#### 3.1 Filter UI State Tests
**File**: `src/__tests__/unit/webview-filter-logic.test.ts` (NEW)

**Approach**: Use JSDOM to simulate webview HTML and test JavaScript logic

**Test Cases**:

- `multi-select enables selection of multiple repositories`
  - Render filter HTML
  - Simulate selecting repo1 and repo2
  - Verify both have selected attribute

- `CMD/CTRL+Click deselects individual repository`
  - Select 3 repos
  - Simulate ctrl+click on repo2
  - Verify repo2 deselected, repo1 and repo3 remain selected

- `SHIFT+Click selects range of repositories`
  - Click repo1
  - Shift+click repo5
  - Verify repos 1-5 all selected

- `Apply Filters button sends correct message format`
  - Select multiple repos
  - Click Apply
  - Verify postMessage called with `repository: ['repo1', 'repo2']`

- `All Repos option deselects individual selections`
  - Select repo1 and repo2
  - Select "All Repos" option
  - Verify repository filter becomes undefined

### 4. End-to-End Acceptance Tests

#### 4.1 Multi-Repository Filter Acceptance Tests
**File**: `src/__tests__/acceptance/dashboard-repo-filter.acceptance.test.ts` (NEW)

**Setup**:
- Real PostgreSQL container
- Seed database with multi-repo dataset
- Create mock webview message channel

**Test Cases**:

**AC1: User can select multiple repositories**
- Given: Dashboard is loaded with 5 repositories available
- When: User selects repo1, repo2, and repo3
- Then: Filter UI shows 3 repositories selected
- And: All charts update to show only data from selected repos

**AC2: Charts update when repository filter changes**
- Given: Dashboard loaded with all repos selected
- When: User changes filter to only repo1
- Then: LOC per Week chart updates within 500ms
- And: Technology Stack chart updates
- And: Team Scorecard updates
- And: Complexity chart updates
- And: LOC Committed chart updates
- And: File Churn chart updates

**AC3: Repository filter combines with date range filter**
- Given: Dashboard with multiple repos and date range 2025-01-01 to 2025-12-31
- When: User selects repo1 and repo2, then narrows date range to Q1
- Then: Charts show data only from repo1/repo2 within Q1 date range

**AC4: Repository filter combines with team filter**
- Given: Dashboard loaded
- When: User selects Platform team AND repo1
- Then: Charts show only Platform team activity in repo1
- And: Other teams and repos are excluded

**AC5: No repositories selected shows empty state**
- Given: Dashboard with multi-select filter
- When: User deselects all repositories (empty selection)
- Then: Charts display "No data available" message
- And: No database queries are made (or return empty)

**AC6: State persists across panel close/reopen**
- Given: User selects repo1 and repo2
- When: User closes the dashboard panel
- And: User reopens the dashboard panel
- Then: Repository filter shows repo1 and repo2 still selected
- And: Charts render with those filters applied

**AC7: CSV export respects repository filter**
- Given: Dashboard filtered to repo1 only
- When: User clicks CSV export on LOC per Week chart
- Then: Exported CSV contains only repo1 data
- And: Other repos are not included

### 5. Edge Cases and Error Scenarios

#### 5.1 Edge Case Tests

**Test Cases**:

- `Repository filter with special characters in repo name`
  - Repo name: `my-app/frontend.v2`
  - Verify filter works correctly
  - Verify no SQL injection vulnerability

- `Repository filter with very long repo names (>200 chars)`
  - Insert repo with 250-char name
  - Verify validation rejects oversized input
  - Verify error logged at WARN level

- `Repository filter with 50+ repositories available`
  - Populate dropdown with 50 repositories
  - Verify multi-select renders without performance issues
  - Verify scrolling works in dropdown

- `Repository filter selection order does not affect results`
  - Select repos in order: repo1, repo2, repo3
  - Select repos in order: repo3, repo1, repo2
  - Verify both produce identical query results (unordered)

- `Repository filter with NULL repository in database`
  - Insert commits with repository = NULL
  - Apply repository filter
  - Verify NULL repos are excluded (or shown as "Unknown")

#### 5.2 Concurrency and Race Condition Tests

**Test Cases**:

- `Rapid filter changes debounce correctly`
  - Change repository filter 10 times in 1 second
  - Verify only final selection triggers query
  - Verify rate limiting prevents server overload

- `Changing repository filter while previous query in flight`
  - Start query with repo1 selected
  - Immediately change to repo2 before first query completes
  - Verify stale response from first query is ignored
  - Verify final charts show repo2 data

### 6. Regression Tests

**Test Cases**:

- `Single-select filters (team, granularity) still work`
  - Verify team filter remains single-select dropdown
  - Verify granularity filter remains single-select
  - Verify these filters combine correctly with multi-repo filter

- `Existing date range filter functionality unchanged`
  - Verify startDate and endDate inputs work
  - Verify date validation still enforces YYYY-MM-DD format
  - Verify date range validation (start <= end) still works

- `Filter bar layout does not break with wider multi-select`
  - Verify filter bar remains on single row (or wraps gracefully)
  - Verify multi-select control fits within card width
  - Verify responsive behavior on narrow viewports

## Test Data Strategy

### Minimal Test Dataset
For fast unit/integration tests, use minimal fixture:
- 3 repositories: repo1, repo2, repo3
- 2 teams: Platform, Backend
- 5 contributors: alice, bob, charlie, diana, eve
- 10 commits per repo (30 total)
- Date range: 2025-01-01 to 2025-01-31

### Realistic Test Dataset
For acceptance/E2E tests, use realistic volume:
- 10 repositories
- 5 teams
- 20 contributors
- 1000 commits across 90 days
- Tests performance and UI rendering at scale

## Acceptance Criteria Traceability

| Acceptance Criterion | Test Coverage |
|---------------------|---------------|
| AC1: Repository filter allows multiple selection | Unit: dashboard-html.test.ts, Integration: dashboard-multi-repo-filter.integration.test.ts, E2E: dashboard-repo-filter.acceptance.test.ts |
| AC2: Selecting multiple repos shows combined data | Integration: AC1 test case, E2E: AC1-AC2 test cases |
| AC3: All charts respond to repository filter | Integration: AC6 test case (all 6 charts), E2E: AC2 test case |
| AC4: Repository filter combines with date/team filters | Integration: AC5 test case, E2E: AC3-AC4 test cases |
| AC5: Empty selection shows appropriate message | Integration: AC4 test case, E2E: AC5 test case |
| AC6: Filter state persists across panel sessions | E2E: AC6 test case |
| AC7: CSV exports respect repository filter | E2E: AC7 test case |

## Security Test Coverage

### SQL Injection Prevention (CWE-89)
- `repository filter uses parameterized queries`
  - Attempt injection: `repository: ["'; DROP TABLE commit_history; --"]`
  - Verify query fails validation before reaching database
  - Verify SQL uses $1, $2 placeholders (never string concatenation)

### Input Validation (CWE-20)
- `repository filter validates string array type`
  - Pass integer array: `repository: [1, 2, 3]`
  - Verify validation rejects with clear error

- `repository filter validates array length`
  - Pass 201-item array
  - Verify validation rejects (max 200 items)

### Rate Limiting (CWE-770)
- `rapid filter changes respect 500ms rate limit`
  - Send 20 filter change messages in 100ms
  - Verify only final message processed
  - Verify intermediate messages dropped (logged at DEBUG)

## Test Execution Strategy

### Phase 1: Unit Tests (Fast)
Run on every commit:
- Dashboard HTML generation
- Filter state management
- Data service query logic
- Estimated time: 5 seconds

### Phase 2: Integration Tests (Medium)
Run on every PR:
- Database service with Testcontainers
- Multi-repo filter across all chart queries
- Estimated time: 45 seconds

### Phase 3: E2E Acceptance Tests (Slow)
Run nightly or pre-release:
- Full webview lifecycle with PostgreSQL
- User interaction simulation
- State persistence verification
- Estimated time: 3 minutes

## Test Implementation Priority

### P0: Critical Path (Implement First)
1. Multi-select HTML rendering test
2. getFilters() returns array test
3. Dashboard data service accepts repository array
4. Integration test: AC1 (multi-repo returns combined data)
5. Integration test: AC6 (all charts respect filter)

### P1: Core Functionality (Implement Next)
1. Filter state save/restore tests
2. Integration test: AC5 (filter combination)
3. E2E: AC1-AC2 (user can select, charts update)
4. E2E: AC3-AC4 (filter combination)

### P2: Edge Cases and Polish (Implement Last)
1. Edge case: special characters, long names, many repos
2. Concurrency: race conditions, debouncing
3. E2E: AC6-AC7 (state persistence, CSV export)
4. Security: SQL injection, input validation

## Manual Testing Checklist

Since automated E2E tests for webview interactions are limited, manual QA should verify:

- [ ] Multi-select UI renders correctly (dropdown with checkboxes or ctrl+click)
- [ ] Visual feedback shows which repos are selected
- [ ] CMD/CTRL+Click works for non-contiguous selection
- [ ] SHIFT+Click works for range selection
- [ ] All 6 charts update when filter changes
- [ ] Loading spinners appear during chart updates
- [ ] Empty state messages appear when no data matches filter
- [ ] Filter bar layout does not break on narrow screens (responsive)
- [ ] Filter persists when switching to another VS Code panel and back
- [ ] CSV export file names reflect filtered data (e.g., "gitr-loc-per-week-repo1-repo2.csv")

## Test Metrics and Coverage Goals

### Code Coverage Targets
- Unit tests: 100% of filter logic, HTML generation
- Integration tests: 100% of data service filter paths
- E2E tests: 100% of acceptance criteria

### Defect Detection Goals
- 0 false positives from filter validation
- 0 SQL injection vulnerabilities (automated security scan)
- 0 race conditions causing stale data display
- < 500ms chart update latency when filter changes

## Appendix: Example Test Code Snippets

### Example Unit Test (Filter State)
```typescript
it('getFilters() returns array for multi-select repository filter', () => {
  // Arrange: Mock DOM with multi-select
  document.body.innerHTML = `
    <select id="repoFilter" multiple>
      <option value="repo1" selected>Repo 1</option>
      <option value="repo2" selected>Repo 2</option>
      <option value="repo3">Repo 3</option>
    </select>
  `;

  // Act
  const filters = getFilters();

  // Assert
  expect(filters.repository).toEqual(['repo1', 'repo2']);
});
```

### Example Integration Test (Data Service)
```typescript
it('should filter commit velocity by multiple repositories', async () => {
  // Arrange: Insert data for 3 repos
  await insertCommit({ sha: 'sha1', repo: 'repo1', loc: 100 });
  await insertCommit({ sha: 'sha2', repo: 'repo2', loc: 200 });
  await insertCommit({ sha: 'sha3', repo: 'repo3', loc: 300 });

  // Act: Filter by repo1 and repo2 only
  const result = await dataService.getCommitVelocity('week', {
    repository: ['repo1', 'repo2']
  });

  // Assert: Only repo1 and repo2 data returned
  const repos = result.map(r => r.repository);
  expect(repos).toContain('repo1');
  expect(repos).toContain('repo2');
  expect(repos).not.toContain('repo3');
});
```

### Example E2E Test (User Interaction)
```typescript
it('AC1: User can select multiple repositories', async () => {
  // Arrange: Dashboard with 5 repos
  await seedDatabase(5);
  const panel = await openDashboard();

  // Act: Select 3 repositories via multi-select
  await panel.selectRepositories(['repo1', 'repo2', 'repo3']);
  await panel.clickApplyFilters();

  // Assert: Charts show only selected repos
  await panel.waitForChartUpdate();
  const chartData = await panel.getVelocityChartData();
  const repos = chartData.map(d => d.repository);

  expect(repos).toEqual(['repo1', 'repo2', 'repo3']);
  expect(repos).not.toContain('repo4');
  expect(repos).not.toContain('repo5');
});
```
