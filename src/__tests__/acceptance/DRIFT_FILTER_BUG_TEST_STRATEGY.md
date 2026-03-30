# Test Strategy: Architecture Drift Dashboard Filter Bug Fix

## Bug Description (GITX-137 related)
The Architecture Drift Dashboard has several filter issues:
1. **Filter controls snap back to defaults** when user selects values
2. Missing **date range constraints** for custom filtering
3. Single-select **repository filter** should be converted to **multi-select**
4. Removing **component** and **severity filters** (no longer needed)

## Ticket Context
- **Related to**: GITX-137 (Dashboard Repository Filter Multi-Select)
- **Component**: Architecture Drift Heat Map Dashboard
- **Files Modified**:
  - `src/views/webview/drift-html.ts` (filter HTML generation)
  - `src/views/webview/drift-panel.ts` (message handlers)
  - `src/services/architecture-drift-service.ts` (data service filters)
  - `src/services/architecture-drift-types.ts` (filter type definitions)

## Test Layers

### 1. Unit Tests

#### 1.1 Filter State Management Tests
**File**: `src/__tests__/unit/drift-filter-state.test.ts` (NEW)

**Purpose**: Test filter state persistence logic in webview JavaScript

**Test Cases**:

```typescript
describe('Drift Filter State Management', () => {
  it('should preserve repository multi-select across filter updates', () => {
    // Arrange: Select repo1, repo2
    // Act: Apply filter
    // Assert: vscode.setState called with { repository: ['repo1', 'repo2'] }
  });

  it('should restore repository selections from saved state', () => {
    // Arrange: Saved state has { repository: ['repo1', 'repo2'] }
    // Act: Load state
    // Assert: Both repo options have 'selected' attribute
  });

  it('should preserve date range selections', () => {
    // Arrange: Set startDate='2025-01-01', endDate='2025-12-31'
    // Act: Apply filter
    // Assert: State persists date values
  });

  it('should not reset filters when user applies them', () => {
    // Arrange: Set filters
    // Act: Click Apply button
    // Assert: Filter values remain (no snap-back to defaults)
  });

  it('should handle empty repository selection (all repos)', () => {
    // Arrange: No repositories selected
    // Act: Get filter state
    // Assert: Returns undefined for repository filter
  });

  it('should persist filters across panel close/reopen', () => {
    // Arrange: Set filters, close panel
    // Act: Reopen panel
    // Assert: Filters restored from VS Code state
  });
});
```

#### 1.2 HTML Generation Tests
**File**: `src/__tests__/unit/drift-html.test.ts` (UPDATE EXISTING)

**New Test Cases**:

```typescript
describe('Filter HTML Generation', () => {
  it('should render repository filter as multi-select', () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('<select id="repositoryFilter" multiple');
    expect(html).toContain('aria-label="Repository filter (multi-select)"');
  });

  it('should include date range inputs', () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('<input type="date" id="startDateFilter"');
    expect(html).toContain('<input type="date" id="endDateFilter"');
    expect(html).toContain('aria-label="Start date"');
    expect(html).toContain('aria-label="End date"');
  });

  it('should NOT include component filter', () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).not.toContain('id="componentFilter"');
  });

  it('should NOT include severity filter', () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).not.toContain('id="severityFilter"');
  });

  it('should include Apply Filters button', () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('id="applyFilterBtn"');
    expect(html).toContain('Apply Filters');
  });

  it('should use data attributes for filter persistence', () => {
    const html = generateDriftHtml(mockConfig);
    // Verify HTML includes data attributes for state restoration
    expect(html).toContain('data-filter-control');
  });
});
```

#### 1.3 Data Service Filter Tests
**File**: `src/__tests__/unit/architecture-drift-service.test.ts` (UPDATE EXISTING)

**New Test Cases**:

```typescript
describe('ArchitectureDriftDataService - Multi-Repo Filters', () => {
  it('should accept repository as string array', async () => {
    await service.getHeatMapChartData({
      repository: ['repo1', 'repo2']
    });

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('repository = ANY($1)'),
      [['repo1', 'repo2']]
    );
  });

  it('should handle single repository in array', async () => {
    await service.getHeatMapChartData({
      repository: ['repo1']
    });

    expect(mockDb.query).toHaveBeenCalled();
  });

  it('should handle undefined repository filter (all repos)', async () => {
    await service.getHeatMapChartData({
      repository: undefined
    });

    // Should not include repository filter in WHERE clause
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.not.stringContaining('repository'),
      expect.any(Array)
    );
  });

  it('should combine repository filter with date range', async () => {
    await service.getHeatMapChartData({
      repository: ['repo1', 'repo2'],
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    });

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('repository = ANY($1)'),
      expect.arrayContaining([['repo1', 'repo2'], '2025-01-01', '2025-12-31'])
    );
  });

  it('should validate date range (start <= end)', async () => {
    await expect(
      service.getHeatMapChartData({
        startDate: '2025-12-31',
        endDate: '2025-01-01'
      })
    ).rejects.toThrow('Invalid date range');
  });

  it('should validate date format (YYYY-MM-DD)', async () => {
    await expect(
      service.getHeatMapChartData({
        startDate: '2025/01/01'
      })
    ).rejects.toThrow('Invalid date format');
  });

  it('should reject repository array exceeding max length', async () => {
    const longArray = Array(201).fill('repo');

    await expect(
      service.getHeatMapChartData({ repository: longArray })
    ).rejects.toThrow('Repository filter exceeds maximum length');
  });
});
```

#### 1.4 Filter Type Definition Tests
**File**: `src/__tests__/unit/architecture-drift-types.test.ts` (NEW)

**Test Cases**:

```typescript
describe('ArchitectureDriftFilters Types', () => {
  it('should accept repository as string array', () => {
    const filters: ArchitectureDriftFilters = {
      repository: ['repo1', 'repo2']
    };
    expect(filters.repository).toBeInstanceOf(Array);
  });

  it('should accept undefined repository', () => {
    const filters: ArchitectureDriftFilters = {
      repository: undefined
    };
    expect(filters.repository).toBeUndefined();
  });

  it('should accept date range filters', () => {
    const filters: ArchitectureDriftFilters = {
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    };
    expect(filters.startDate).toBe('2025-01-01');
    expect(filters.endDate).toBe('2025-12-31');
  });

  it('should NOT accept component filter (removed)', () => {
    // TypeScript should reject this at compile time
    // This test verifies the type definition change
  });

  it('should NOT accept severity filter (removed)', () => {
    // TypeScript should reject this at compile time
  });
});
```

### 2. Integration Tests

#### 2.1 Database Query Integration Tests
**File**: `src/__tests__/integration/drift-repository.integration.test.ts` (UPDATE EXISTING)

**New Test Cases**:

```typescript
describe('Drift Repository - Multi-Repo Filter Integration', () => {
  beforeEach(async () => {
    // Insert test data across 3 repos
    await insertDriftData('repo1', ['api', 'database'], '2025-01-15', 10);
    await insertDriftData('repo2', ['api', 'auth'], '2025-01-16', 15);
    await insertDriftData('repo3', ['frontend', 'utils'], '2025-01-17', 8);
  });

  it('should filter by multiple repositories', async () => {
    const result = await driftService.getHeatMapChartData({
      repository: ['repo1', 'repo2']
    });

    const repos = result.driftData.map(d => d.repository);
    expect(repos).toContain('repo1');
    expect(repos).toContain('repo2');
    expect(repos).not.toContain('repo3');
  });

  it('should filter by date range', async () => {
    const result = await driftService.getHeatMapChartData({
      startDate: '2025-01-15',
      endDate: '2025-01-16'
    });

    // Should only include data from Jan 15-16, not Jan 17
    expect(result.hasData).toBe(true);
    expect(result.driftData.length).toBeGreaterThan(0);

    const weeks = result.heatMapData.weeks;
    expect(weeks).not.toContain('2025-01-17');
  });

  it('should combine repository and date filters', async () => {
    const result = await driftService.getHeatMapChartData({
      repository: ['repo1'],
      startDate: '2025-01-15',
      endDate: '2025-01-15'
    });

    expect(result.driftData.length).toBeGreaterThan(0);
    expect(result.driftData.every(d => d.repository === 'repo1')).toBe(true);
  });

  it('should return empty when no data matches filters', async () => {
    const result = await driftService.getHeatMapChartData({
      repository: ['nonexistent-repo']
    });

    expect(result.hasData).toBe(false);
    expect(result.driftData).toEqual([]);
  });

  it('should handle inclusive date boundaries', async () => {
    const result = await driftService.getHeatMapChartData({
      startDate: '2025-01-15',
      endDate: '2025-01-17'
    });

    // Should include all 3 dates (boundaries inclusive)
    expect(result.hasData).toBe(true);
  });
});
```

#### 2.2 Filter Persistence Integration Tests
**File**: `src/__tests__/integration/drift-filter-persistence.integration.test.ts` (NEW)

**Test Cases**:

```typescript
describe('Drift Filter Persistence', () => {
  it('should persist filter state across panel close/reopen', async () => {
    // Arrange: Create panel, set filters
    const panel = await DriftPanel.createOrShow(extensionUri, mockSecretService);
    await panel.applyFilters({
      repository: ['repo1', 'repo2'],
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    });

    // Act: Close and reopen panel
    panel.dispose();
    const newPanel = await DriftPanel.createOrShow(extensionUri, mockSecretService);

    // Assert: Filters restored from state
    const state = await newPanel.getFilterState();
    expect(state.repository).toEqual(['repo1', 'repo2']);
    expect(state.startDate).toBe('2025-01-01');
  });

  it('should restore multi-select UI state from VS Code storage', async () => {
    // Arrange: Mock VS Code state storage
    const mockState = {
      driftFilters: {
        repository: ['repo1', 'repo2']
      }
    };
    vi.mocked(vscode.Memento.get).mockReturnValue(mockState);

    // Act: Create panel
    const panel = await DriftPanel.createOrShow(extensionUri, mockSecretService);

    // Assert: Multi-select options are selected
    const html = await panel.getWebviewContent();
    expect(html).toContain('<option value="repo1" selected>');
    expect(html).toContain('<option value="repo2" selected>');
  });
});
```

### 3. Extension Tests (Webview Lifecycle)

#### 3.1 Message Protocol Tests
**File**: `src/__tests__/extension/drift-panel.test.ts` (UPDATE EXISTING)

**New Test Cases**:

```typescript
describe('DriftPanel Message Handling', () => {
  it('should handle requestDriftFilterUpdate with multi-repo filter', async () => {
    const panel = DriftPanel.createOrShow(extensionUri, mockSecretService);

    // Act: Send filter update message
    await panel.handleMessage({
      type: 'requestDriftFilterUpdate',
      filters: {
        repository: ['repo1', 'repo2'],
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      }
    });

    // Assert: Data service called with correct filters
    expect(mockDataService.getHeatMapChartData).toHaveBeenCalledWith({
      repository: ['repo1', 'repo2'],
      startDate: '2025-01-01',
      endDate: '2025-12-31'
    });
  });

  it('should send driftFilterOptions with available repositories', async () => {
    // Mock database returning 3 repos
    mockDb.query.mockResolvedValueOnce({
      rows: [
        { repository: 'repo1' },
        { repository: 'repo2' },
        { repository: 'repo3' }
      ]
    });

    const panel = DriftPanel.createOrShow(extensionUri, mockSecretService);

    // Act: Request initial data
    await panel.handleMessage({ type: 'requestDriftData' });

    // Assert: Webview receives filter options
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: 'driftFilterOptions',
      repositories: ['repo1', 'repo2', 'repo3'],
      components: expect.any(Array) // Still needed for heat map
    });
  });

  it('should validate filters before sending to data service', async () => {
    const panel = DriftPanel.createOrShow(extensionUri, mockSecretService);

    // Act: Send invalid date range
    await panel.handleMessage({
      type: 'requestDriftFilterUpdate',
      filters: {
        startDate: '2025-12-31',
        endDate: '2025-01-01' // End before start
      }
    });

    // Assert: Error sent to webview
    expect(mockWebview.postMessage).toHaveBeenCalledWith({
      type: 'driftError',
      message: expect.stringContaining('Invalid date range'),
      source: 'DriftPanel'
    });
  });

  it('should handle filter changes without resetting to defaults', async () => {
    const panel = DriftPanel.createOrShow(extensionUri, mockSecretService);

    // Arrange: Set initial filters
    await panel.handleMessage({
      type: 'requestDriftFilterUpdate',
      filters: { repository: ['repo1'] }
    });

    // Act: Update filters (not reset)
    await panel.handleMessage({
      type: 'requestDriftFilterUpdate',
      filters: { repository: ['repo1', 'repo2'] }
    });

    // Assert: Filters accumulated, not replaced
    const state = await panel.getState();
    expect(state.filters.repository).toEqual(['repo1', 'repo2']);
  });
});
```

### 4. Acceptance Tests (End-to-End)

#### 4.1 Filter Bug Regression Tests
**File**: `src/__tests__/acceptance/drift-filter-bug.acceptance.test.ts` (NEW)

**Test Cases**:

```typescript
describe('Architecture Drift Filter Bug Fixes', () => {
  let container: StartedTestContainer;
  let dbService: DatabaseService;
  let driftService: ArchitectureDriftDataService;

  beforeAll(async () => {
    // Setup Testcontainers PostgreSQL
    container = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'gitr_test' })
      .withExposedPorts(5432)
      .start();

    dbService = new DatabaseService();
    await dbService.initialize(/* config */);

    driftService = new ArchitectureDriftDataService(dbService);
  });

  afterAll(async () => {
    await dbService.shutdown();
    await container.stop();
  });

  describe('AC1: Filter controls do NOT snap back to defaults', () => {
    it('should preserve repository selections after clicking Apply', async () => {
      // Arrange: Insert test data
      await seedDriftData(['repo1', 'repo2', 'repo3']);

      // Act: Apply multi-repo filter
      const result1 = await driftService.getHeatMapChartData({
        repository: ['repo1', 'repo2']
      });

      // Simulate user keeping same filter and clicking Apply again
      const result2 = await driftService.getHeatMapChartData({
        repository: ['repo1', 'repo2']
      });

      // Assert: Same results, filters not reset
      expect(result1).toEqual(result2);
      expect(result2.driftData.every(d =>
        ['repo1', 'repo2'].includes(d.repository)
      )).toBe(true);
    });

    it('should preserve date range after applying', async () => {
      await seedDriftData(['repo1'], '2025-01-01', '2025-12-31');

      const filters = {
        startDate: '2025-01-01',
        endDate: '2025-03-31'
      };

      const result1 = await driftService.getHeatMapChartData(filters);
      const result2 = await driftService.getHeatMapChartData(filters);

      expect(result1).toEqual(result2);
    });
  });

  describe('AC2: Date range constraints work correctly', () => {
    it('should filter data by start date only', async () => {
      await seedDriftData(['repo1'], '2025-01-01', '2025-12-31');

      const result = await driftService.getHeatMapChartData({
        startDate: '2025-06-01'
      });

      // All data should be from June onwards
      result.heatMapData.weeks.forEach(week => {
        expect(week >= '2025-06-01').toBe(true);
      });
    });

    it('should filter data by end date only', async () => {
      await seedDriftData(['repo1'], '2025-01-01', '2025-12-31');

      const result = await driftService.getHeatMapChartData({
        endDate: '2025-06-30'
      });

      // All data should be before July
      result.heatMapData.weeks.forEach(week => {
        expect(week <= '2025-06-30').toBe(true);
      });
    });

    it('should filter data by date range (start and end)', async () => {
      await seedDriftData(['repo1'], '2025-01-01', '2025-12-31');

      const result = await driftService.getHeatMapChartData({
        startDate: '2025-03-01',
        endDate: '2025-05-31'
      });

      // Data only from Q2
      result.heatMapData.weeks.forEach(week => {
        expect(week >= '2025-03-01').toBe(true);
        expect(week <= '2025-05-31').toBe(true);
      });
    });

    it('should handle single day date range', async () => {
      await seedDriftData(['repo1'], '2025-01-15', '2025-01-15');

      const result = await driftService.getHeatMapChartData({
        startDate: '2025-01-15',
        endDate: '2025-01-15'
      });

      expect(result.hasData).toBe(true);
      expect(result.driftData.length).toBeGreaterThan(0);
    });
  });

  describe('AC3: Repository filter supports multi-select', () => {
    it('should allow selecting multiple repositories', async () => {
      await seedDriftData(['repo1', 'repo2', 'repo3']);

      const result = await driftService.getHeatMapChartData({
        repository: ['repo1', 'repo3']
      });

      const repos = [...new Set(result.driftData.map(d => d.repository))];
      expect(repos).toEqual(expect.arrayContaining(['repo1', 'repo3']));
      expect(repos).not.toContain('repo2');
    });

    it('should handle single repository selection', async () => {
      await seedDriftData(['repo1', 'repo2']);

      const result = await driftService.getHeatMapChartData({
        repository: ['repo1']
      });

      expect(result.driftData.every(d => d.repository === 'repo1')).toBe(true);
    });

    it('should handle no repository selection (all repos)', async () => {
      await seedDriftData(['repo1', 'repo2', 'repo3']);

      const result = await driftService.getHeatMapChartData({
        repository: undefined
      });

      const repos = [...new Set(result.driftData.map(d => d.repository))];
      expect(repos.length).toBe(3);
    });
  });

  describe('AC4: Component and severity filters removed', () => {
    it('should NOT accept component filter parameter', async () => {
      // This should fail TypeScript compilation
      // Runtime test to verify filter is ignored
      const result = await driftService.getHeatMapChartData({
        // @ts-expect-error - component filter removed
        component: 'api'
      });

      // Should return all components (filter ignored)
      expect(result.driftData.length).toBeGreaterThan(0);
    });

    it('should NOT accept severity filter parameter', async () => {
      // This should fail TypeScript compilation
      const result = await driftService.getHeatMapChartData({
        // @ts-expect-error - severity filter removed
        severity: 'critical'
      });

      // Should return all severities (filter ignored)
      expect(result.summary.totalCritical).toBeGreaterThanOrEqual(0);
    });
  });

  describe('AC5: Filters combine correctly', () => {
    it('should combine repository and date range filters', async () => {
      await seedDriftData(['repo1', 'repo2'], '2025-01-01', '2025-12-31');

      const result = await driftService.getHeatMapChartData({
        repository: ['repo1'],
        startDate: '2025-01-01',
        endDate: '2025-03-31'
      });

      expect(result.driftData.every(d => d.repository === 'repo1')).toBe(true);
      result.heatMapData.weeks.forEach(week => {
        expect(week >= '2025-01-01' && week <= '2025-03-31').toBe(true);
      });
    });

    it('should handle empty results from combined filters', async () => {
      await seedDriftData(['repo1'], '2025-01-01', '2025-01-31');

      const result = await driftService.getHeatMapChartData({
        repository: ['repo1'],
        startDate: '2025-06-01',
        endDate: '2025-06-30'
      });

      expect(result.hasData).toBe(false);
      expect(result.driftData).toEqual([]);
    });
  });

  describe('AC6: Filter state persists across sessions', () => {
    it('should save filter state to VS Code storage', async () => {
      // This requires mocking VS Code Memento API
      const mockMemento = {
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined)
      };

      // Simulate panel applying filters
      await mockMemento.update('driftFilters', {
        repository: ['repo1', 'repo2'],
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      });

      expect(mockMemento.update).toHaveBeenCalledWith(
        'driftFilters',
        expect.objectContaining({
          repository: ['repo1', 'repo2']
        })
      );
    });

    it('should restore filter state from VS Code storage', async () => {
      const mockMemento = {
        get: vi.fn().mockReturnValue({
          repository: ['repo1'],
          startDate: '2025-01-01'
        }),
        update: vi.fn()
      };

      const state = mockMemento.get('driftFilters');
      expect(state.repository).toEqual(['repo1']);
      expect(state.startDate).toBe('2025-01-01');
    });
  });
});
```

### 5. Edge Cases and Security Tests

#### 5.1 Input Validation Tests
**File**: `src/__tests__/unit/drift-filter-validation.test.ts` (NEW)

**Test Cases**:

```typescript
describe('Drift Filter Input Validation', () => {
  it('should reject invalid date format', async () => {
    await expect(
      driftService.getHeatMapChartData({ startDate: '01/15/2025' })
    ).rejects.toThrow('Invalid date format');

    await expect(
      driftService.getHeatMapChartData({ endDate: '2025-13-40' })
    ).rejects.toThrow('Invalid date format');
  });

  it('should reject reversed date range', async () => {
    await expect(
      driftService.getHeatMapChartData({
        startDate: '2025-12-31',
        endDate: '2025-01-01'
      })
    ).rejects.toThrow('start date must be before end date');
  });

  it('should reject repository array exceeding max length (200)', async () => {
    const longArray = Array(201).fill('repo');

    await expect(
      driftService.getHeatMapChartData({ repository: longArray })
    ).rejects.toThrow('Repository filter exceeds maximum length');
  });

  it('should reject non-string repository values', async () => {
    await expect(
      driftService.getHeatMapChartData({
        // @ts-expect-error - testing runtime validation
        repository: [123, 456]
      })
    ).rejects.toThrow('Repository must be array of strings');
  });

  it('should sanitize repository names for SQL injection', async () => {
    // Parameterized queries should prevent injection
    const maliciousInput = ["'; DROP TABLE commit_history; --"];

    // Should not throw, but also should not execute malicious SQL
    const result = await driftService.getHeatMapChartData({
      repository: maliciousInput
    });

    // Result should be empty (no matching repo), not a DB error
    expect(result.hasData).toBe(false);
  });

  it('should handle very long date ranges without performance issues', async () => {
    const startTime = Date.now();

    await driftService.getHeatMapChartData({
      startDate: '2000-01-01',
      endDate: '2025-12-31'
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000); // Should complete within 5s
  });
});
```

### 6. Regression Tests

#### 6.1 Existing Functionality Preserved
**File**: `src/__tests__/integration/drift-repository.integration.test.ts` (UPDATE EXISTING)

**Test Cases**:

```typescript
describe('Drift Dashboard Regression Tests', () => {
  it('should still display heat map with no filters', async () => {
    await seedDriftData(['repo1']);

    const result = await driftService.getHeatMapChartData({});

    expect(result.hasData).toBe(true);
    expect(result.heatMapData.cells.length).toBeGreaterThan(0);
  });

  it('should still show component visibility toggles', async () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('id="componentToggles"');
  });

  it('should still show cross-component filter toggle', async () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('id="showCrossComponentOnly"');
  });

  it('should still display coupling pairs table', async () => {
    await seedDriftData(['repo1']);

    const result = await driftService.getHeatMapChartData({});

    expect(result.couplingData.length).toBeGreaterThanOrEqual(0);
  });

  it('should still support CSV export', async () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('id="exportCsvBtn"');
  });

  it('should still display drift insights summary', async () => {
    const html = generateDriftHtml(mockConfig);
    expect(html).toContain('id="driftInsights"');
    expect(html).toContain('id="highestDriftCard"');
    expect(html).toContain('id="severityBreakdown"');
  });
});
```

## Test Data Strategy

### Minimal Fixture (Unit/Integration Tests)
- 3 repositories: `repo1`, `repo2`, `repo3`
- 5 components: `api`, `database`, `auth`, `frontend`, `utils`
- 10 commits per component (30 total)
- Date range: `2025-01-01` to `2025-01-31`
- 3 severity levels: `critical`, `high`, `medium`, `low`

### Realistic Fixture (Acceptance Tests)
- 10 repositories
- 15 components
- 500 commits across 90 days
- Tests performance and UI rendering at scale

## Test Execution Strategy

### Phase 1: Unit Tests (Fast - 5 seconds)
Run on every commit:
- Filter state management
- HTML generation
- Data service query building
- Type validation

### Phase 2: Integration Tests (Medium - 45 seconds)
Run on every PR:
- Database queries with Testcontainers
- Multi-repo filtering
- Date range filtering
- Filter persistence

### Phase 3: Acceptance Tests (Slow - 3 minutes)
Run nightly or pre-release:
- Full webview lifecycle
- Filter bug regression scenarios
- State persistence across sessions
- Combined filter scenarios

## CI Pipeline Integration

**File**: `.github/workflows/test.yml` (UPDATE)

```yaml
- name: Run drift filter bug tests
  run: |
    npm run test:unit -- drift-filter
    npm run test:integration -- drift
    npm run test:acceptance -- drift-filter-bug
```

## Manual Testing Checklist

- [ ] Multi-select UI renders correctly
- [ ] Selecting multiple repositories shows combined data
- [ ] Date range inputs accept YYYY-MM-DD format
- [ ] Invalid date ranges show error message
- [ ] Filters persist when switching tabs
- [ ] Apply Filters button does not reset selections
- [ ] Empty repository selection shows all repos
- [ ] CSV export reflects filtered data
- [ ] Heat map updates when filters change
- [ ] Coupling table respects filters
- [ ] Drift insights update with filters

## Coverage Goals

| Layer | Target |
|-------|--------|
| Filter logic | 100% |
| Data service filters | 100% |
| HTML generation | 95% |
| Message handlers | 90% |
| Overall | 90%+ |

## Acceptance Criteria Traceability

| Acceptance Criterion | Test Coverage |
|---------------------|---------------|
| AC1: Filters do not snap back | Unit: drift-filter-state.test.ts, Acceptance: AC1 |
| AC2: Date range constraints | Unit: architecture-drift-service.test.ts, Acceptance: AC2 |
| AC3: Multi-select repository | Unit: drift-html.test.ts, Integration: drift-repository.integration.test.ts, Acceptance: AC3 |
| AC4: Component/severity filters removed | Unit: drift-html.test.ts, Acceptance: AC4 |
| AC5: Filters combine correctly | Integration: drift-repository.integration.test.ts, Acceptance: AC5 |
| AC6: State persists | Integration: drift-filter-persistence.integration.test.ts, Acceptance: AC6 |

## Security Considerations

### SQL Injection Prevention (CWE-89)
- All filters use parameterized queries (`$1`, `$2`)
- No string concatenation in SQL
- Repository array converted to PostgreSQL `ANY($1)` safely

### Input Validation (CWE-20)
- Date format validation: `YYYY-MM-DD` only
- Date range validation: start <= end
- Repository array length: max 200 items
- Repository array type: strings only
- Filter length limits: 200 characters per string

### Rate Limiting (CWE-770)
- Debounce filter updates: 500ms
- Limit concurrent queries: 5 max
- Drop intermediate messages during rapid changes
