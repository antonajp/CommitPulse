# Dashboard Repository Filter Test Summary

## Bug Description
The repository filter on the All Metrics Dashboard needs to be changed from single-select to multi-select to allow filtering by multiple repositories simultaneously.

## Quick Test Strategy Overview

### 1. Unit Tests Needed

**Filter Logic** (`dashboard-filter-state.test.ts` - NEW)
- Multi-select returns array: `{ repository: ['repo1', 'repo2'] }`
- Empty selection returns undefined
- Single selection returns array with one item
- State save/restore handles arrays correctly

**Data Service** (`dashboard-data-service.test.ts` - EXTEND)
- Each chart query accepts `repository: string[]` in filters
- SQL generates correct `IN ($1, $2)` clause with parameterized values
- Backward compatibility: single string still works
- Input validation accepts string arrays, rejects invalid types

**HTML Generation** (`dashboard-html.test.ts` - EXTEND)
- Renders `<select id="repoFilter" multiple>` attribute
- Preserves single-select for team/granularity filters

### 2. Integration Tests Needed

**Multi-Repo Filtering** (`dashboard-multi-repo-filter.integration.test.ts` - NEW)

**Critical Test Cases:**

1. **Multi-repository filter returns combined data**
   - Setup: 3 repos with distinct commits
   - Filter: `repository: ['repo1', 'repo2']`
   - Verify: Only repo1 and repo2 data returned

2. **All six charts respect repository filter**
   - Test each chart type individually:
     - LOC per Week (Commit Velocity)
     - Technology Stack Distribution
     - Team Scorecard
     - File Complexity Trends
     - LOC Committed
     - Top Files by Churn
   - Insert data for multiple repos, filter to one repo
   - Verify each chart returns only filtered repo data

3. **Repository filter combines with other filters**
   - Apply: `{ repository: ['repo1', 'repo2'], team: 'Platform', startDate: '2025-01-01' }`
   - Verify: AND logic applies all filters correctly

4. **Empty repository array returns no data**
   - Filter: `repository: []`
   - Verify: Empty results (or appropriate error)

### 3. Acceptance Tests Needed

**End-to-End User Scenarios** (`dashboard-repo-filter.acceptance.test.ts` - NEW)

**AC1: User can select multiple repositories**
- Given: Dashboard loaded with 5 repos available
- When: User selects repo1, repo2, repo3
- Then: All charts update to show only selected repos

**AC2: Charts update when repository filter changes**
- Given: Dashboard with all repos showing
- When: User changes filter to only repo1
- Then: All 6 charts update within 500ms

**AC3: Repository filter combines with date/team filters**
- Given: Dashboard loaded
- When: User selects repo1 + Platform team + Q1 date range
- Then: Charts show only Platform activity in repo1 during Q1

**AC4: Empty selection shows appropriate message**
- When: User deselects all repositories
- Then: Charts show "No data available" message

**AC5: State persists across panel close/reopen**
- Given: User selects repo1 and repo2
- When: User closes and reopens dashboard panel
- Then: Filter still shows repo1 and repo2 selected

**AC6: CSV export respects repository filter**
- Given: Dashboard filtered to repo1 only
- When: User exports LOC per Week chart
- Then: CSV contains only repo1 data

### 4. Edge Cases to Test

- Repository names with special characters (slashes, dots, hyphens)
- Very long repository names (>200 chars) - should be rejected by validation
- 50+ repositories in dropdown - verify performance
- NULL repositories in database - should be excluded or shown as "Unknown"
- Rapid filter changes - verify rate limiting (500ms debounce) works
- Concurrent queries - verify stale responses are discarded

### 5. Security Tests

**SQL Injection Prevention (CWE-89)**
- Attempt: `repository: ["'; DROP TABLE commit_history; --"]`
- Verify: Validation rejects before reaching database
- Verify: SQL uses $1, $2 placeholders (never string concatenation)

**Input Validation (CWE-20)**
- Pass non-string array: `repository: [1, 2, 3]`
- Verify: Type validation rejects with clear error
- Pass 201-item array
- Verify: Length validation rejects (max 200)

**Rate Limiting (CWE-770)**
- Send 20 filter change messages in 100ms
- Verify: Only final message processed, others dropped

## Test Implementation Priority

### P0: Must Have (Block Release)
1. Unit: getFilters() returns array for multi-select
2. Unit: Data service accepts repository array
3. Integration: Multi-repo filter returns combined data
4. Integration: All 6 charts respect repository filter
5. E2E: AC1 (user can select multiple repos)
6. E2E: AC2 (all charts update)

### P1: Should Have (High Priority)
1. Unit: Filter state save/restore
2. Integration: Filter combination (repo + team + date)
3. E2E: AC3 (filter combination)
4. E2E: AC4 (empty state handling)

### P2: Nice to Have (Lower Priority)
1. Edge cases: special characters, long names, many repos
2. Concurrency: race conditions, debouncing
3. E2E: AC5-AC6 (state persistence, CSV export)
4. Security: SQL injection, input validation tests

## Manual Testing Checklist

Automated webview UI testing is limited, so manual QA must verify:

- [ ] Multi-select UI renders correctly (checkboxes or ctrl+click)
- [ ] Visual feedback shows selected repos clearly
- [ ] CMD/CTRL+Click for non-contiguous selection works
- [ ] SHIFT+Click for range selection works
- [ ] All 6 charts update when filter changes
- [ ] Loading spinners appear during updates
- [ ] Empty state messages appear when no matches
- [ ] Responsive layout works on narrow screens
- [ ] Filter persists when switching VS Code panels
- [ ] CSV filenames reflect filtered repos

## Expected Test Coverage

- **Unit Tests**: 100% of filter logic, HTML generation, data service filter paths
- **Integration Tests**: 100% of all chart queries with multi-repo filter
- **E2E Tests**: 100% of user-facing acceptance criteria

## Test Execution Time Estimates

- **Unit Tests**: ~5 seconds (run on every commit)
- **Integration Tests**: ~45 seconds (run on every PR)
- **E2E Acceptance Tests**: ~3 minutes (run nightly/pre-release)

## Key Files to Modify

### Production Code Changes Required
1. `src/views/webview/dashboard-html.ts` - Add `multiple` attribute to repo filter
2. `src/views/webview/dashboard-html.ts` - Update getFilters() to return array
3. `src/services/dashboard-data-service.ts` - Accept repository as string[] in DashboardFilters
4. `src/services/dashboard-data-service.ts` - Update SQL to use IN clause for arrays
5. `src/services/dashboard-data-types.ts` - Update DashboardFilters type definition

### Test Files to Create/Modify
1. `src/__tests__/unit/dashboard-html.test.ts` - Add multi-select tests
2. `src/__tests__/unit/dashboard-filter-state.test.ts` - NEW: Filter logic tests
3. `src/__tests__/unit/dashboard-data-service.test.ts` - Add array filter tests
4. `src/__tests__/integration/dashboard-multi-repo-filter.integration.test.ts` - NEW
5. `src/__tests__/acceptance/dashboard-repo-filter.acceptance.test.ts` - NEW

## Success Metrics

### Functional
- All 6 charts correctly filter by multiple repositories
- Repository filter combines correctly with team and date filters
- Empty selection handled gracefully (no errors)
- State persists across panel sessions

### Non-Functional
- Chart updates complete within 500ms of filter change
- UI remains responsive with 50+ repos in dropdown
- No SQL injection vulnerabilities (automated security scan passes)
- No race conditions causing stale data display

### Code Quality
- Test coverage: 100% of modified code paths
- 0 linting/type errors
- 0 console errors in webview
- All existing tests pass (no regressions)
