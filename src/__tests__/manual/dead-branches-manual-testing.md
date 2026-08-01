# Dead Branches - Manual Testing Checklist

**Feature**: Dead/stale branch detection with risk categorization and cleanup capabilities

**Test Environment**: Local development (VS Code Extension Host)

**Prerequisites**:
- VS Code with gitr extension installed
- Test repository with multiple branches (mixed states)
- GitHub/Linear account configured (for PR detection)
- Database initialized with gitr schema

---

## Test Setup

### Create Test Repository Structure

```bash
# Create test repo with various branch states
mkdir -p /tmp/gitr-dead-branches-test
cd /tmp/gitr-dead-branches-test
git init
git config user.name "Test User"
git config user.email "test@example.com"

# Create main branch
echo "Initial commit" > README.md
git add README.md
git commit -m "Initial commit"
git branch -M main

# Create merged branch (90+ days old)
git checkout -b feature/merged-old
echo "Feature complete" >> feature.txt
git add feature.txt
git commit -m "feat: Complete feature" --date="2024-01-15 10:00:00"
git checkout main
git merge --no-ff feature/merged-old -m "Merge feature/merged-old"

# Create merged branch (recent)
git checkout -b feature/merged-recent
echo "Recent feature" >> recent.txt
git add recent.txt
git commit -m "feat: Recent feature"
git checkout main
git merge --no-ff feature/merged-recent -m "Merge feature/merged-recent"

# Create unmerged stale branch (120 days)
git checkout -b feature/stale-unmerged
echo "Abandoned work" >> abandoned.txt
git add abandoned.txt
git commit -m "wip: Abandoned feature" --date="2024-02-10 10:00:00"
git checkout main

# Create unmerged recent branch (10 days)
git checkout -b feature/active
echo "Active work" >> active.txt
git add active.txt
git commit -m "feat: Active development" --date="$(date -d '10 days ago' '+%Y-%m-%d %H:%M:%S')"
git checkout main

# Create orphaned local-only branch
git checkout -b feature/local-only
echo "Local experiment" >> local.txt
git add local.txt
git commit -m "experiment: Local work"
git checkout main

# Create protected branch patterns
git checkout -b release/1.2.3
echo "Release notes" >> RELEASE.md
git add RELEASE.md
git commit -m "release: Version 1.2.3"
git checkout main

git checkout -b hotfix/critical-bug
echo "Hotfix" >> hotfix.txt
git add hotfix.txt
git commit -m "hotfix: Critical security patch"
git checkout main

# Create branch with special characters
git checkout -b "feature/JIRA-123-complex-name"
echo "Complex name" >> complex.txt
git add complex.txt
git commit -m "feat: Complex branch name"
git checkout main

# Add remote (simulate GitHub)
git remote add origin https://github.com/test-org/test-repo.git
```

---

## Manual Test Cases

### TC1: Branch Detection Accuracy

#### TC1.1: Detect Merged Branches
**Steps**:
1. Open VS Code with test repository
2. Open Command Palette (`Cmd+Shift+P`)
3. Execute: "gitr: Analyze Dead Branches"
4. Expand "Safe" or "Low Risk" category in TreeView

**Expected**:
- `feature/merged-old` appears with `isMerged: true`
- `feature/merged-recent` appears with `isMerged: true`
- Tooltip shows "Merged into main"

**Result**: [ ] Pass [ ] Fail

**Notes**:
_______________________________________

---

#### TC1.2: Detect Stale Unmerged Branches
**Steps**:
1. In Dead Branches TreeView, expand "Medium Risk" or "High Risk" category
2. Locate `feature/stale-unmerged`
3. Hover over branch to view tooltip

**Expected**:
- `feature/stale-unmerged` shows `daysSinceLastCommit: ~120`
- `isMerged: false`
- Risk level: Medium or High
- Tooltip shows last commit date (Feb 2024)

**Result**: [ ] Pass [ ] Fail

**Notes**:
_______________________________________

---

#### TC1.3: Detect Active Recent Branches
**Steps**:
1. In TreeView, locate `feature/active`
2. Check risk categorization

**Expected**:
- `feature/active` does NOT appear in Critical/High risk
- Appears in Low Risk or excluded (if <90 day threshold)
- `daysSinceLastCommit: ~10`

**Result**: [ ] Pass [ ] Fail

**Notes**:
_______________________________________

---

### TC2: Risk Level Calculation

#### TC2.1: Safe Classification
**Steps**:
1. Identify `feature/merged-recent` in TreeView
2. Verify risk badge/icon

**Expected**:
- Risk level: "Safe" (green)
- Reason: "Merged recently (X days ago)"

**Result**: [ ] Pass [ ] Fail

---

#### TC2.2: Low Risk Classification
**Steps**:
1. Identify `feature/merged-old` in TreeView
2. Verify risk badge

**Expected**:
- Risk level: "Low" (light yellow)
- Reason: "Merged but old (90+ days)"

**Result**: [ ] Pass [ ] Fail

---

#### TC2.3: Medium Risk Classification
**Steps**:
1. Identify `feature/stale-unmerged` in TreeView (120 days old, not merged)
2. Verify risk badge

**Expected**:
- Risk level: "Medium" (orange)
- Reason: "Unmerged, stale (90-180 days)"

**Result**: [ ] Pass [ ] Fail

---

#### TC2.4: Critical Risk Classification
**Steps**:
1. Create a branch with 400+ days age and 50+ commits
2. Refresh Dead Branches view
3. Verify classification

**Expected**:
- Risk level: "Critical" (red)
- Reason: "Unmerged, very old (365+ days), many commits"

**Result**: [ ] Pass [ ] Fail

---

### TC3: Protected Branch Exclusion

#### TC3.1: Standard Protected Branches
**Steps**:
1. Verify `main`, `master`, `develop` do NOT appear in dead branches list
2. Check TreeView for these branches

**Expected**:
- `main` excluded
- Other standard protected branches excluded
- Count excludes protected branches: "Total: X (Y protected, Z analyzed)"

**Result**: [ ] Pass [ ] Fail

---

#### TC3.2: Pattern-Based Protection
**Steps**:
1. Verify `release/1.2.3` is NOT in dead branches list
2. Verify `hotfix/critical-bug` is NOT in list

**Expected**:
- All `release/*` branches excluded
- All `hotfix/*` branches excluded
- Settings respect patterns: `gitr.protectedBranchPatterns`

**Result**: [ ] Pass [ ] Fail

---

#### TC3.3: Custom Protection Configuration
**Steps**:
1. Open VS Code Settings (`Cmd+,`)
2. Search for "gitr.protectedBranchPatterns"
3. Add custom pattern: `qa/*`
4. Create test branch: `git checkout -b qa/automation`
5. Refresh Dead Branches view

**Expected**:
- `qa/automation` excluded from list
- Settings UI shows custom patterns
- Changes take effect immediately

**Result**: [ ] Pass [ ] Fail

---

### TC4: Edge Case Handling

#### TC4.1: Large Repositories (100+ Branches)
**Setup**:
```bash
# Create 150 test branches
for i in {1..150}; do
  git checkout -b "test-branch-$i"
  echo "Test $i" > "test-$i.txt"
  git add "test-$i.txt"
  git commit -m "Test commit $i" --date="2024-03-01 10:00:00"
  git checkout main
done
```

**Steps**:
1. Execute "gitr: Analyze Dead Branches"
2. Measure response time
3. Check UI responsiveness

**Expected**:
- Analysis completes in <5 seconds
- UI remains responsive (no freezing)
- Results paginated or virtualized
- Count shows "150 branches analyzed"

**Result**: [ ] Pass [ ] Fail

**Actual Time**: _______ seconds

---

#### TC4.2: Special Characters in Branch Names
**Steps**:
1. Create branches with edge case names:
   ```bash
   git checkout -b "feature/fix%20space"
   git checkout -b "feature/新功能"  # Unicode
   git checkout -b "bugfix/slash/in/name"
   ```
2. Refresh Dead Branches view
3. Check rendering

**Expected**:
- All branches display correctly
- No encoding issues
- Tooltips show proper characters
- Deletion works for all edge cases

**Result**: [ ] Pass [ ] Fail

---

#### TC4.3: Detached HEAD State
**Steps**:
1. In test repo, detach HEAD:
   ```bash
   git checkout --detach HEAD
   ```
2. Execute "gitr: Analyze Dead Branches"

**Expected**:
- No error thrown
- Analysis completes successfully
- Warning message: "Repository in detached HEAD state"
- All branches still detected

**Result**: [ ] Pass [ ] Fail

---

#### TC4.4: Branches with Open PRs
**Prerequisites**: Configure GitHub token in gitr settings

**Steps**:
1. Create branch: `git checkout -b feature/pr-open`
2. Push to GitHub: `git push -u origin feature/pr-open`
3. Create GitHub PR for branch (via GitHub UI)
4. Refresh Dead Branches view
5. Locate `feature/pr-open`

**Expected**:
- `hasOpenPR: true` indicator shown
- Risk level reduced by 1 tier (e.g., High → Medium)
- Tooltip shows: "Open PR #42 - Do not delete"
- Branch has visual indicator (icon/badge)

**Result**: [ ] Pass [ ] Fail

**PR URL**: _______________________________________

---

### TC5: Deletion Workflow Safety

#### TC5.1: Pre-Deletion Confirmation
**Steps**:
1. Right-click on `feature/merged-old` in TreeView
2. Select "Delete Branch"

**Expected**:
- Confirmation dialog appears
- Dialog shows:
  - Branch name
  - Last commit SHA (for recovery)
  - Risk level
  - Warning if unmerged
- Options: "Delete", "Force Delete", "Cancel"

**Result**: [ ] Pass [ ] Fail

---

#### TC5.2: Protected Branch Prevention
**Steps**:
1. Attempt to delete `main` branch (if it appears somehow)
2. Click "Delete Branch"

**Expected**:
- Error message: "Cannot delete protected branch 'main'"
- Deletion blocked
- No git command executed

**Result**: [ ] Pass [ ] Fail

---

#### TC5.3: Current Branch Prevention
**Steps**:
1. Checkout branch: `git checkout feature/active`
2. In Dead Branches view, right-click `feature/active`
3. Select "Delete Branch"

**Expected**:
- Error message: "Cannot delete current branch. Switch to another branch first."
- Deletion blocked

**Result**: [ ] Pass [ ] Fail

---

#### TC5.4: Batch Deletion
**Steps**:
1. Select multiple branches (Cmd+Click):
   - `feature/merged-old`
   - `feature/local-only`
   - `feature/stale-unmerged`
2. Right-click → "Delete Selected Branches"
3. Confirm in dialog

**Expected**:
- Confirmation shows count: "Delete 3 branches?"
- Lists all selected branches
- Progress indicator during deletion
- Success message: "Deleted 3 branches successfully"
- TreeView refreshes automatically

**Result**: [ ] Pass [ ] Fail

---

#### TC5.5: Force Delete Unmerged
**Steps**:
1. Right-click `feature/stale-unmerged` (unmerged)
2. Select "Delete Branch"
3. Warning appears about unmerged commits
4. Click "Force Delete"

**Expected**:
- Warning: "This branch has unmerged commits. Force delete?"
- Executes: `git branch -D feature/stale-unmerged`
- Success message includes recovery command:
  "Deleted feature/stale-unmerged (recover: git checkout -b feature/stale-unmerged <SHA>)"

**Result**: [ ] Pass [ ] Fail

---

#### TC5.6: Remote Deletion
**Steps**:
1. Push branch: `git push origin feature/merged-old`
2. In Dead Branches view, right-click `feature/merged-old`
3. Select "Delete Branch (Local and Remote)"
4. Confirm

**Expected**:
- Dialog shows: "Delete local and remote branch?"
- Executes:
  1. `git branch -d feature/merged-old`
  2. `git push origin --delete feature/merged-old`
- Both succeed
- Success message: "Deleted local and remote branches"

**Result**: [ ] Pass [ ] Fail

---

### TC6: UI Rendering

#### TC6.1: TreeView Structure
**Steps**:
1. Open Dead Branches TreeView
2. Inspect hierarchy

**Expected Structure**:
```
Dead Branches (8 analyzed, 3 protected)
├─ Critical (0)
├─ High (1)
│  └─ feature/stale-unmerged (120 days ago) [unmerged]
├─ Medium (2)
│  ├─ feature/local-only (90 days ago) [orphaned]
│  └─ ...
├─ Low (3)
│  ├─ feature/merged-old (95 days ago) [merged]
│  └─ ...
└─ Safe (2)
   ├─ feature/merged-recent (5 days ago) [merged]
   └─ ...
```

**Result**: [ ] Pass [ ] Fail

---

#### TC6.2: Tooltips
**Steps**:
1. Hover over `feature/stale-unmerged`
2. Read tooltip content

**Expected Tooltip**:
```
Branch: feature/stale-unmerged
Last Commit: 2024-02-10 10:00:00
Author: Test User
SHA: abc123def
Commits: 1
Status: Unmerged (not in main)
Risk: High
```

**Result**: [ ] Pass [ ] Fail

---

#### TC6.3: Filtering and Sorting
**Steps**:
1. Click filter dropdown in TreeView toolbar
2. Select "Critical + High only"
3. Verify filtered results
4. Click sort dropdown
5. Select "Oldest First"

**Expected**:
- Filter reduces list to high-risk branches only
- Sort reorders by last commit date ascending
- Count updates: "Showing 1 of 8"
- Settings persist across sessions

**Result**: [ ] Pass [ ] Fail

---

#### TC6.4: Search Functionality
**Steps**:
1. Type "stale" in search box
2. Press Enter

**Expected**:
- Only `feature/stale-unmerged` shown
- Other branches hidden
- Clear search button appears
- Count: "1 match"

**Result**: [ ] Pass [ ] Fail

---

### TC7: Cross-Platform Compatibility

#### TC7.1: Windows
**Platform**: Windows 10/11

**Steps**:
1. Test repository path: `C:\Users\test\gitr-test`
2. Run all TC1-TC6 tests

**Expected**:
- All tests pass
- Path separators handled correctly
- Git commands execute properly

**Result**: [ ] Pass [ ] Fail [ ] N/A

---

#### TC7.2: macOS
**Platform**: macOS (Intel/Apple Silicon)

**Steps**:
1. Test repository path: `/Users/test/gitr-test`
2. Run all TC1-TC6 tests

**Expected**:
- All tests pass
- Unicode branch names work
- Git commands execute properly

**Result**: [ ] Pass [ ] Fail [ ] N/A

---

#### TC7.3: Linux
**Platform**: Ubuntu/Debian/Fedora

**Steps**:
1. Test repository path: `/home/test/gitr-test`
2. Run all TC1-TC6 tests

**Expected**:
- All tests pass
- Symbolic links handled correctly
- Git commands execute properly

**Result**: [ ] Pass [ ] Fail [ ] N/A

---

## Regression Testing

### REG1: Existing Git Features Unaffected
**Steps**:
1. Execute existing gitr commands:
   - "gitr: Analyze Repositories"
   - "gitr: View Dashboard"
   - "gitr: Sync GitHub Contributors"
2. Verify all work correctly

**Expected**:
- No regressions introduced
- All existing features functional
- Performance unchanged

**Result**: [ ] Pass [ ] Fail

---

### REG2: Database Schema Integrity
**Steps**:
1. Check database migrations
2. Verify no schema changes for dead branches (uses existing commit_history)
3. Run database tests

**Expected**:
- No new migrations required (or migrations pass cleanly)
- Existing tables/views unaffected
- All integration tests pass

**Result**: [ ] Pass [ ] Fail

---

## Performance Testing

### PERF1: Large Repository Analysis
**Setup**: Repository with 500 branches

**Steps**:
1. Execute "gitr: Analyze Dead Branches"
2. Measure time from start to completion
3. Monitor CPU/memory usage

**Expected**:
- Completion time: <10 seconds
- CPU: <50% sustained
- Memory: <200MB increase
- No UI blocking

**Actual**:
- Time: _______ seconds
- CPU: _______ %
- Memory: _______ MB

**Result**: [ ] Pass [ ] Fail

---

### PERF2: Incremental Refresh
**Steps**:
1. Initial analysis (500 branches)
2. Wait 5 minutes
3. Click "Refresh" button
4. Measure time

**Expected**:
- Refresh time: <3 seconds (uses cached merge status)
- Only checks new/updated branches
- Optimized queries

**Actual Time**: _______ seconds

**Result**: [ ] Pass [ ] Fail

---

## Accessibility Testing

### A11Y1: Keyboard Navigation
**Steps**:
1. Open Dead Branches TreeView
2. Navigate using Tab key
3. Select branch with Enter
4. Open context menu with Shift+F10

**Expected**:
- All interactive elements focusable
- Focus indicator visible
- Keyboard shortcuts work
- Screen reader announces items

**Result**: [ ] Pass [ ] Fail

---

### A11Y2: Screen Reader Compatibility
**Tool**: NVDA (Windows) or VoiceOver (macOS)

**Steps**:
1. Enable screen reader
2. Navigate Dead Branches TreeView
3. Trigger branch deletion

**Expected**:
- Tree structure announced correctly
- Risk levels read aloud
- Confirmation dialogs accessible
- Status updates announced

**Result**: [ ] Pass [ ] Fail

---

## Quality Gate Summary

### Pre-Merge Requirements

**P0 - Critical (Must Pass)**:
- [ ] TC1.1: Merged branch detection
- [ ] TC1.2: Stale branch detection
- [ ] TC2.1-TC2.4: Risk calculations
- [ ] TC3.1: Protected branch exclusion
- [ ] TC5.1: Pre-deletion confirmation
- [ ] TC5.2: Protected branch prevention
- [ ] REG1: No regressions

**P1 - High (Should Pass)**:
- [ ] TC4.1: Large repository handling (100+ branches)
- [ ] TC4.2: Special characters
- [ ] TC5.4: Batch deletion
- [ ] TC6.1: TreeView structure
- [ ] TC6.3: Filtering/sorting
- [ ] PERF1: Performance acceptable

**P2 - Medium (Nice to Have)**:
- [ ] TC4.4: Open PR detection
- [ ] TC5.6: Remote deletion
- [ ] A11Y1: Keyboard navigation
- [ ] Cross-platform (at least 2 of 3 platforms)

---

## Sign-Off

**QA Engineer**: ___________________________  **Date**: __________

**Engineering Lead**: ___________________________  **Date**: __________

**Notes/Blockers**:
________________________________________________________________________
________________________________________________________________________
________________________________________________________________________
