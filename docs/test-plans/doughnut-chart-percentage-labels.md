# Test Plan: Doughnut Chart Percentage Labels

**Feature**: Display percentage labels directly on doughnut chart segments (Technology Stack, Jira Project Distribution)

**Target Charts**:
- Technology Stack Distribution (dashboard)
- Jira Project Distribution (linkage panel)

**Test Framework**: Vitest (unit), @vscode/test-electron (extension), Playwright (visual regression)

---

## Test Scope

### In Scope
- Label rendering for segments above threshold (>5%)
- Label positioning (centroid of arc segment)
- Label text contrast against segment background colors
- Label behavior during chart resize
- Theme compatibility (light/dark)
- ARIA label accessibility
- Edge cases (0%, 100%, equal segments, single segment)

### Out of Scope
- Other chart types (bar, line, stacked)
- Interactive label editing
- Label animation transitions

---

## Critical Test Cases

### TC-001: Visibility Threshold - Labels Appear for Dominant Segments
**Priority**: P0
**Automation**: Unit test in `d3-chart-scripts.test.ts`

**Test Data**:
```javascript
[
  { category: 'TypeScript', fileCount: 500 },    // 50% - should show label
  { category: 'JavaScript', fileCount: 300 },    // 30% - should show label
  { category: 'Python', fileCount: 100 },        // 10% - should show label
  { category: 'SQL', fileCount: 80 },            // 8% - should show label
  { category: 'Shell', fileCount: 20 }           // 2% - should NOT show label
]
```

**Expected Behavior**:
- Segments ≥5% display percentage label (e.g., "50%", "30%", "10%", "8%")
- Segments <5% do not display label (avoid clutter)
- Labels positioned at arc centroid
- Label count = 4 (TypeScript, JavaScript, Python, SQL)

**Verification**:
```javascript
const labels = svg.selectAll('.arc-label');
expect(labels.size()).toBe(4);
expect(labels.filter(d => d.data.category === 'TypeScript').text()).toBe('50%');
expect(labels.filter(d => d.data.category === 'Shell').size()).toBe(0);
```

---

### TC-002: Correct Percentage Calculation
**Priority**: P0
**Automation**: Unit test

**Test Data**:
```javascript
[
  { category: 'A', fileCount: 33 },
  { category: 'B', fileCount: 33 },
  { category: 'C', fileCount: 34 }
]
```

**Expected Behavior**:
- Category A: "33%" (33/100 = 0.33)
- Category B: "33%" (33/100 = 0.33)
- Category C: "34%" (34/100 = 0.34)
- Sum of percentages ≤ 100% (rounding edge case)

**Verification**:
```javascript
const total = data.reduce((sum, d) => sum + d.fileCount, 0);
data.forEach(d => {
  const pct = ((d.fileCount / total) * 100).toFixed(0);
  expect(pct).toMatch(/^\d{1,3}%$/);
});
```

---

### TC-003: Text Contrast - Readable Against Segment Colors
**Priority**: P0
**Automation**: Unit test + visual regression (Playwright)

**Test Scenarios**:
- Dark segment (CHART_COLORS[0] = '#4dc9f6') → white text
- Light segment (CHART_COLORS[11] = '#ffe119') → black text
- Medium segment (CHART_COLORS[4] = '#acc236') → contrast-appropriate text

**Expected Behavior**:
- Label text color auto-adjusts based on segment luminance
- WCAG AA contrast ratio ≥4.5:1 for normal text
- Use WCAG contrast formula: `(L1 + 0.05) / (L2 + 0.05)`

**Implementation Helper** (to be added to `d3-chart-scripts.ts`):
```javascript
function getContrastColor(hexColor) {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate relative luminance (WCAG formula)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Return white for dark colors, black for light colors
  return luminance > 0.5 ? '#000000' : '#ffffff';
}
```

**Verification**:
```javascript
const label = svg.select('.arc-label');
const segmentColor = label.datum().data.color;
const textColor = label.attr('fill');
expect(calculateContrastRatio(segmentColor, textColor)).toBeGreaterThanOrEqual(4.5);
```

---

### TC-004: No Label Overlap
**Priority**: P1
**Automation**: Visual regression (Playwright)

**Test Data**:
```javascript
[
  { category: 'A', fileCount: 200 },  // 40% - large segment
  { category: 'B', fileCount: 150 },  // 30% - large segment
  { category: 'C', fileCount: 100 },  // 20% - medium segment
  { category: 'D', fileCount: 50 }    // 10% - medium segment
]
```

**Expected Behavior**:
- Labels positioned at arc centroids do not overlap each other
- If overlap is detected (bounding box collision), shift label radially outward
- Use D3.js `arc.centroid()` for base positioning

**Verification** (visual):
- Screenshot comparison against golden image
- Manual inspection: no label text is cut off or overlapping

**Automated Check**:
```javascript
// Check label bounding boxes for collision
const labelBoxes = labels.nodes().map(node => node.getBBox());
for (let i = 0; i < labelBoxes.length; i++) {
  for (let j = i + 1; j < labelBoxes.length; j++) {
    expect(boxesOverlap(labelBoxes[i], labelBoxes[j])).toBe(false);
  }
}
```

---

### TC-005: Small Segments Excluded from Labels
**Priority**: P1
**Automation**: Unit test

**Test Data**:
```javascript
[
  { category: 'Dominant', fileCount: 900 },  // 90% - show label
  { category: 'Minor1', fileCount: 40 },     // 4% - no label
  { category: 'Minor2', fileCount: 30 },     // 3% - no label
  { category: 'Minor3', fileCount: 20 },     // 2% - no label
  { category: 'Minor4', fileCount: 10 }      // 1% - no label
]
```

**Expected Behavior**:
- Only "Dominant" (90%) displays label
- All segments still appear in chart and legend
- Tooltip on hover still shows exact percentage for all segments

**Verification**:
```javascript
const labels = svg.selectAll('.arc-label');
expect(labels.size()).toBe(1);
expect(labels.text()).toBe('90%');
```

---

### TC-006: Theme Compatibility - Light and Dark Themes
**Priority**: P0
**Automation**: Visual regression (Playwright)

**Test Scenarios**:
- VS Code Dark+ theme (default dark)
- VS Code Light+ theme (default light)
- High contrast dark theme
- High contrast light theme

**Expected Behavior**:
- Labels remain readable in all themes
- Text color adapts to theme background (uses `chartDefaults.color` as fallback)
- Segment stroke color matches theme background to provide separation

**Verification** (Playwright):
```javascript
test('labels readable in dark theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('dashboard');
  const screenshot = await page.locator('#techStackChart').screenshot();
  expect(screenshot).toMatchSnapshot('tech-stack-dark-theme.png');
});

test('labels readable in light theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('dashboard');
  const screenshot = await page.locator('#techStackChart').screenshot();
  expect(screenshot).toMatchSnapshot('tech-stack-light-theme.png');
});
```

---

### TC-007: Resize Behavior - Labels Adjust on Window Resize
**Priority**: P1
**Automation**: Extension test

**Test Steps**:
1. Render chart at default size (containerWidth = 600px)
2. Verify labels are positioned at arc centroids
3. Resize webview panel to 400px width
4. Verify labels re-render at new centroids
5. Resize to 800px width
6. Verify labels scale proportionally

**Expected Behavior**:
- Labels remain positioned at arc centroid after resize
- Font size is fixed (12px) - does not scale with chart
- Label count remains consistent (threshold % is constant)

**Verification**:
```javascript
// Initial render
const initialLabels = getLabels();
expect(initialLabels.length).toBe(4);

// Resize event
window.dispatchEvent(new Event('resize'));
await waitForChartUpdate();

// Verify labels still present and positioned correctly
const resizedLabels = getLabels();
expect(resizedLabels.length).toBe(4);
expect(resizedLabels[0].getAttribute('transform')).toMatch(/translate\(\d+,\d+\)/);
```

---

### TC-008: Screen Reader Accessibility - ARIA Labels
**Priority**: P0
**Automation**: Unit test

**Expected Behavior**:
- Each arc path includes `aria-label` attribute with percentage (already exists)
- Labels are decorative (visual aid), use `aria-hidden="true"` to avoid double-announcement
- Screen reader announces: "TypeScript: 500 (50%)" when focusing arc segment

**Verification**:
```javascript
const arcPaths = svg.selectAll('path[aria-label]');
expect(arcPaths.size()).toBeGreaterThan(0);

arcPaths.each(function(d) {
  const label = d3.select(this).attr('aria-label');
  expect(label).toMatch(/.*: \d+ \(\d+\.?\d*%\)/);
});

// Percentage labels should be aria-hidden
const percentLabels = svg.selectAll('.arc-label');
percentLabels.each(function() {
  expect(d3.select(this).attr('aria-hidden')).toBe('true');
});
```

---

## Edge Cases

### EC-001: Zero Percentage Segments
**Test Data**:
```javascript
[
  { category: 'A', fileCount: 100 },
  { category: 'B', fileCount: 0 }
]
```

**Expected**: Category B renders with 0% (below threshold), no label shown. Segment may be invisible or very small.

---

### EC-002: Single Segment (100%)
**Test Data**:
```javascript
[{ category: 'OnlyOne', fileCount: 1000 }]
```

**Expected**: Label shows "100%", positioned at center of full circle.

---

### EC-003: All Segments Below Threshold
**Test Data**:
```javascript
[
  { category: 'A', fileCount: 4 },
  { category: 'B', fileCount: 3 },
  { category: 'C', fileCount: 2 },
  { category: 'D', fileCount: 1 }
]
```

**Expected**: No labels displayed (all <5%), chart renders normally, legend and tooltips still functional.

---

### EC-004: Equal Segments Near Threshold
**Test Data**:
```javascript
[
  { category: 'A', fileCount: 60 },  // 6% - show label
  { category: 'B', fileCount: 60 },  // 6% - show label
  ...repeat 16 more times...
]
```

**Expected**: All segments ≥5% show labels, positioned tightly but without overlap (collision detection applies).

---

### EC-005: Floating Point Rounding
**Test Data**:
```javascript
[
  { category: 'A', fileCount: 333 },
  { category: 'B', fileCount: 333 },
  { category: 'C', fileCount: 334 }
]
```

**Expected**:
- A: 33% (333/1000 = 0.333)
- B: 33% (333/1000 = 0.333)
- C: 33% (334/1000 = 0.334)
- Sum displays as 99% due to rounding (acceptable)

---

## Regression Considerations

### Existing Functionality to Preserve
1. **Tooltips**: Hover tooltips still display exact percentage (e.g., "50.0%")
2. **Legend**: Right-side legend remains unchanged, shows category + file count
3. **Arc hover effect**: `arcHover` enlargement on mouseover still works
4. **Accessibility**: Existing `aria-label` attributes on arc paths preserved
5. **Export CSV**: Technology stack CSV export includes all categories regardless of label visibility

### Non-Breaking Changes Required
- Add `.arc-label` CSS class to `media/dashboard.css` for label styling
- Update `renderArcChart()` function signature (backward compatible - new optional param)
- Ensure labels do not interfere with click events on arc segments

---

## Test Automation Summary

### Unit Tests (`src/__tests__/unit/d3-chart-scripts.test.ts`)
- TC-001: Threshold filtering (4 assertions)
- TC-002: Percentage calculation accuracy (3 assertions)
- TC-003: Contrast color calculation (6 assertions)
- TC-005: Small segment exclusion (2 assertions)
- TC-008: ARIA attributes (3 assertions)
- **Total Unit Assertions**: ~18

### Visual Regression Tests (Playwright)
- TC-003: Contrast against all 12 CHART_COLORS (12 snapshots)
- TC-004: No label overlap (4 layout scenarios)
- TC-006: Theme compatibility (4 themes × 2 charts = 8 snapshots)
- **Total Screenshots**: ~24

### Extension Tests (`src/__tests__/extension/dashboard-panel.test.ts`)
- TC-007: Resize behavior (1 test, 3 resize events)
- Integration with existing dashboard panel tests

---

## Test Execution Commands

```bash
# Unit tests only
npm run test -- d3-chart-scripts.test.ts

# Visual regression (requires Playwright setup)
npm run test:visual -- doughnut-labels

# Full test suite
npm run test
npm run test:extension
npm run test:visual
```

---

## Acceptance Criteria Summary

**Feature Complete When**:
1. ✅ Labels render on segments ≥5% (TC-001)
2. ✅ Percentages calculate correctly with ≤1% rounding error (TC-002)
3. ✅ Text contrast meets WCAG AA (4.5:1 ratio) (TC-003)
4. ✅ Labels do not overlap each other (TC-004)
5. ✅ Small segments (<5%) excluded from labels (TC-005)
6. ✅ Readable in VS Code light/dark themes (TC-006)
7. ✅ Labels reposition correctly on resize (TC-007)
8. ✅ ARIA labels present, percentage labels aria-hidden (TC-008)
9. ✅ All edge cases handled without crashes (EC-001 to EC-005)
10. ✅ Zero regression in existing tooltip/legend/export functionality

**Definition of Done**:
- All unit tests passing (18+ assertions)
- Visual regression tests passing (24 snapshots)
- Code review approved (no security issues, follows project patterns)
- Manual testing completed in VS Code extension host
- Documentation updated (CHANGELOG.md entry)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Labels overlap on small charts | Medium | Medium | Collision detection algorithm, minimum chart size threshold |
| Poor contrast in high-contrast themes | Low | High | WCAG contrast formula, theme-specific testing |
| Performance degradation on large datasets | Low | Medium | Limit label count to segments >5%, avoid excessive DOM nodes |
| Label positioning breaks on non-standard DPR | Low | Low | Test on 1x, 1.5x, 2x DPI displays |

---

## Test Data Files

Create fixture files in `src/__tests__/fixtures/`:

**`tech-stack-typical.json`** - Realistic distribution:
```json
[
  { "category": "TypeScript", "extensionCount": 5, "fileCount": 450 },
  { "category": "JavaScript", "extensionCount": 3, "fileCount": 280 },
  { "category": "Python", "extensionCount": 4, "fileCount": 120 },
  { "category": "SQL", "extensionCount": 2, "fileCount": 80 },
  { "category": "Shell", "extensionCount": 3, "fileCount": 40 },
  { "category": "YAML", "extensionCount": 1, "fileCount": 20 },
  { "category": "Markdown", "extensionCount": 1, "fileCount": 10 }
]
```

**`tech-stack-edge-single.json`** - Single category:
```json
[{ "category": "TypeScript", "extensionCount": 1, "fileCount": 1000 }]
```

**`tech-stack-edge-equal.json`** - Equal distribution:
```json
[
  { "category": "A", "extensionCount": 1, "fileCount": 250 },
  { "category": "B", "extensionCount": 1, "fileCount": 250 },
  { "category": "C", "extensionCount": 1, "fileCount": 250 },
  { "category": "D", "extensionCount": 1, "fileCount": 250 }
]
```

---

## Next Steps After Testing

1. **Performance Profiling**: Measure render time for charts with 20+ categories
2. **Internationalization**: Verify percentage format in non-US locales (e.g., "50 %" in French)
3. **User Feedback**: Collect feedback on 5% threshold (make configurable if needed)
4. **Accessibility Audit**: Full screen reader testing with NVDA, JAWS, VoiceOver
5. **Documentation**: Update user guide with screenshot showing labeled chart
