/**
 * Fixture data for BitBucket PR sync service tests (GITX-228).
 * Includes sample API responses for both BitBucket Cloud and BitBucket Server.
 */

// ============================================================================
// BitBucket Cloud Fixtures
// ============================================================================

/**
 * BitBucket Cloud PR response (paginated).
 * Cloud uses { next: 'url' } for pagination.
 */
export const BITBUCKET_CLOUD_PR_RESPONSE = {
  values: [
    {
      id: 1,
      title: 'Add new feature',
      author: {
        display_name: 'Test User',
        account_id: 'user123',
      },
      state: 'MERGED',
      created_on: '2024-06-01T10:00:00.000000+00:00',
      updated_on: '2024-06-05T14:00:00.000000+00:00',
      merge_commit: { hash: 'abc123def456' },
      source: { branch: { name: 'feature/PROJ-123-new-feature' } },
      destination: { branch: { name: 'main' } },
    },
  ],
  page: 1,
  pagelen: 50,
  size: 1,
};

/**
 * BitBucket Cloud PR response with pagination next link.
 */
export const BITBUCKET_CLOUD_PR_RESPONSE_WITH_NEXT = {
  values: [
    {
      id: 1,
      title: 'First PR',
      author: {
        display_name: 'User One',
        account_id: 'user1',
      },
      state: 'OPEN',
      created_on: '2024-06-01T10:00:00.000000+00:00',
      updated_on: '2024-06-01T10:00:00.000000+00:00',
      merge_commit: null,
      source: { branch: { name: 'feature/IQS-100-first' } },
      destination: { branch: { name: 'main' } },
    },
  ],
  page: 1,
  pagelen: 1,
  size: 1,
  next: 'https://api.bitbucket.org/2.0/repositories/workspace/repo/pullrequests?page=2',
};

/**
 * BitBucket Cloud PR response - page 2.
 */
export const BITBUCKET_CLOUD_PR_RESPONSE_PAGE_2 = {
  values: [
    {
      id: 2,
      title: 'Second PR',
      author: {
        display_name: 'User Two',
        account_id: 'user2',
      },
      state: 'MERGED',
      created_on: '2024-06-02T10:00:00.000000+00:00',
      updated_on: '2024-06-05T10:00:00.000000+00:00',
      merge_commit: { hash: 'def456ghi789' },
      source: { branch: { name: 'feature/IQS-101-second' } },
      destination: { branch: { name: 'main' } },
    },
  ],
  page: 2,
  pagelen: 1,
  size: 1,
};

/**
 * BitBucket Cloud activity feed with approval.
 */
export const BITBUCKET_CLOUD_ACTIVITY_WITH_APPROVAL = {
  values: [
    {
      approval: {
        date: '2024-06-03T10:00:00.000000+00:00',
        user: {
          display_name: 'Reviewer One',
          account_id: 'reviewer1',
        },
      },
    },
  ],
};

/**
 * BitBucket Cloud activity feed with changes requested (unapproval).
 */
export const BITBUCKET_CLOUD_ACTIVITY_WITH_UNAPPROVAL = {
  values: [
    {
      update: {
        date: '2024-06-02T10:00:00.000000+00:00',
        author: {
          display_name: 'Reviewer One',
          account_id: 'reviewer1',
        },
        state: 'UNAPPROVED',
      },
    },
  ],
};

/**
 * BitBucket Cloud PR with additions/deletions (detailed view).
 */
export const BITBUCKET_CLOUD_PR_DETAILED = {
  id: 1,
  title: 'Add new feature',
  author: {
    display_name: 'Test User',
    account_id: 'user123',
  },
  state: 'MERGED',
  created_on: '2024-06-01T10:00:00.000000+00:00',
  updated_on: '2024-06-05T14:00:00.000000+00:00',
  merge_commit: { hash: 'abc123def456' },
  source: { branch: { name: 'feature/PROJ-123-new-feature' } },
  destination: { branch: { name: 'main' } },
};

/**
 * BitBucket Cloud diffstat response (for additions/deletions).
 */
export const BITBUCKET_CLOUD_DIFFSTAT = {
  values: [
    {
      type: 'diffstat',
      status: 'modified',
      lines_added: 100,
      lines_removed: 20,
      old: { path: 'src/file1.ts' },
      new: { path: 'src/file1.ts' },
    },
    {
      type: 'diffstat',
      status: 'added',
      lines_added: 50,
      lines_removed: 0,
      old: null,
      new: { path: 'src/file2.ts' },
    },
  ],
  page: 1,
  size: 2,
};

// ============================================================================
// BitBucket Server Fixtures
// ============================================================================

/**
 * BitBucket Server PR response (paginated).
 * Server uses { isLastPage: false, start: N, limit: L } for pagination.
 */
export const BITBUCKET_SERVER_PR_RESPONSE = {
  values: [
    {
      id: 1,
      title: 'Add new feature',
      author: {
        user: {
          displayName: 'Test User',
          name: 'testuser',
        },
      },
      state: 'MERGED',
      createdDate: 1717236000000, // 2024-06-01T10:00:00Z
      updatedDate: 1717592400000, // 2024-06-05T14:00:00Z
      fromRef: { displayId: 'feature/PROJ-123-new-feature' },
      toRef: { displayId: 'main' },
    },
  ],
  start: 0,
  limit: 25,
  isLastPage: true,
};

/**
 * BitBucket Server PR response with pagination.
 */
export const BITBUCKET_SERVER_PR_RESPONSE_PAGE_1 = {
  values: [
    {
      id: 1,
      title: 'First PR',
      author: {
        user: {
          displayName: 'User One',
          name: 'user1',
        },
      },
      state: 'OPEN',
      createdDate: 1717236000000,
      updatedDate: 1717236000000,
      fromRef: { displayId: 'feature/IQS-100-first' },
      toRef: { displayId: 'main' },
    },
  ],
  start: 0,
  limit: 1,
  isLastPage: false,
  nextPageStart: 1,
};

/**
 * BitBucket Server PR response - page 2.
 */
export const BITBUCKET_SERVER_PR_RESPONSE_PAGE_2 = {
  values: [
    {
      id: 2,
      title: 'Second PR',
      author: {
        user: {
          displayName: 'User Two',
          name: 'user2',
        },
      },
      state: 'MERGED',
      createdDate: 1717322400000,
      updatedDate: 1717581600000,
      fromRef: { displayId: 'feature/IQS-101-second' },
      toRef: { displayId: 'main' },
    },
  ],
  start: 1,
  limit: 1,
  isLastPage: true,
};

/**
 * BitBucket Server activity feed with approval.
 */
export const BITBUCKET_SERVER_ACTIVITY_WITH_APPROVAL = {
  values: [
    {
      action: 'APPROVED',
      createdDate: 1717408800000, // 2024-06-03T10:00:00Z
      user: {
        displayName: 'Reviewer One',
        name: 'reviewer1',
      },
    },
  ],
  start: 0,
  limit: 25,
  isLastPage: true,
};

/**
 * BitBucket Server activity feed with changes requested.
 */
export const BITBUCKET_SERVER_ACTIVITY_WITH_CHANGES_REQUESTED = {
  values: [
    {
      action: 'UNAPPROVED',
      createdDate: 1717322400000, // 2024-06-02T10:00:00Z
      user: {
        displayName: 'Reviewer One',
        name: 'reviewer1',
      },
    },
  ],
  start: 0,
  limit: 25,
  isLastPage: true,
};

/**
 * BitBucket Server PR with detailed diff stats.
 */
export const BITBUCKET_SERVER_PR_DETAILED = {
  id: 1,
  title: 'Add new feature',
  author: {
    user: {
      displayName: 'Test User',
      name: 'testuser',
    },
  },
  state: 'MERGED',
  createdDate: 1717236000000,
  updatedDate: 1717592400000,
  fromRef: { displayId: 'feature/PROJ-123-new-feature' },
  toRef: { displayId: 'main' },
  properties: {
    mergeCommit: {
      displayId: 'abc123def456',
    },
  },
};

/**
 * BitBucket Server diff response (for additions/deletions/changed files).
 */
export const BITBUCKET_SERVER_DIFF = {
  diffs: [
    {
      source: { toString: 'src/file1.ts' },
      destination: { toString: 'src/file1.ts' },
      hunks: [
        {
          segments: [
            { type: 'ADDED', lines: [{ line: 1 }, { line: 2 }] }, // 2 additions
            { type: 'REMOVED', lines: [{ line: 1 }] }, // 1 deletion
          ],
        },
      ],
    },
    {
      source: null,
      destination: { toString: 'src/file2.ts' },
      hunks: [
        {
          segments: [
            { type: 'ADDED', lines: [{ line: 1 }, { line: 2 }, { line: 3 }] }, // 3 additions
          ],
        },
      ],
    },
  ],
};

// ============================================================================
// State Mapping Fixtures
// ============================================================================

/**
 * All possible PR states for BitBucket Cloud/Server.
 */
export const BITBUCKET_PR_STATES = {
  OPEN: 'OPEN',
  MERGED: 'MERGED',
  DECLINED: 'DECLINED',
  SUPERSEDED: 'SUPERSEDED',
} as const;

/**
 * Expected state mappings to our internal PR states.
 */
export const EXPECTED_STATE_MAPPINGS = {
  OPEN: 'open',
  MERGED: 'merged',
  DECLINED: 'closed',
  SUPERSEDED: 'closed',
} as const;
