import { describe, it, expect } from 'vitest';

import {
  type IJiraRepository,
  type IJiraAuthor,
  type IJiraCommit,
  type IJiraBranch,
  type IJiraPullRequest,
  type IJiraDevStatusDetail,
  type IJiraDevStatusResponse,
  parseJiraRepository,
  parseJiraAuthor,
  parseJiraCommit,
  parseJiraBranch,
  parseJiraPullRequest,
  parseJiraDevStatusDetail,
  parseJiraDevStatusResponse,
} from '../../models/jira-github.js';

/**
 * Unit tests for Jira-GitHub data model interfaces and parse functions.
 *
 * Maps from Python JiraGitHub.py (107 lines) — all 7 classes:
 *   Repository, Author, Commit, Branch, PullRequest, Detail, JiraGitHubDataDeserializer
 *
 * Tests verify:
 * - Parse functions produce correct TypeScript interfaces from raw JSON data
 * - Nested deserialization (e.g., Commit.author -> IJiraAuthor) works correctly
 * - Array fields (e.g., PullRequest.reviewers) are deserialized recursively
 * - Missing optional fields use defaults (empty arrays, empty strings)
 * - Invalid input throws descriptive errors
 * - Round-trip: Python from_json() behavior is preserved in TypeScript parse functions
 *
 * Ticket: IQS-858
 */

// ============================================================================
// Test data factories
// ============================================================================

function createRawRepository(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'repo-1',
    name: 'my-repo',
    url: 'https://github.com/org/my-repo',
    ...overrides,
  };
}

function createRawAuthor(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'John Doe',
    avatar: 'https://avatars.example.com/johndoe',
    ...overrides,
  };
}

function createRawCommit(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'abc123def456',
    displayId: 'abc123d',
    authorTimestamp: 1700000000000,
    url: 'https://github.com/org/repo/commit/abc123def456',
    author: createRawAuthor(),
    fileCount: 3,
    merge: false,
    message: 'feat: add new feature',
    files: [{ path: 'src/index.ts', changeType: 'MODIFIED' }],
    ...overrides,
  };
}

function createRawBranch(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'feature/IQS-100',
    url: 'https://github.com/org/repo/tree/feature/IQS-100',
    createPullRequestUrl: 'https://github.com/org/repo/compare/feature/IQS-100',
    repository: createRawRepository(),
    lastCommit: createRawCommit(),
    ...overrides,
  };
}

function createRawPullRequest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    author: createRawAuthor(),
    id: 'pr-42',
    name: 'Feature IQS-100',
    commentCount: 5,
    source: { branch: 'feature/IQS-100', url: 'https://github.com/org/repo/tree/feature/IQS-100' },
    destination: { branch: 'main', url: 'https://github.com/org/repo/tree/main' },
    reviewers: [createRawAuthor({ name: 'Jane Smith', avatar: 'https://avatars.example.com/janesmith' })],
    status: 'MERGED',
    url: 'https://github.com/org/repo/pull/42',
    lastUpdate: '2024-02-15T10:00:00Z',
    repositoryId: 'repo-1',
    repositoryName: 'my-repo',
    repositoryUrl: 'https://github.com/org/my-repo',
    ...overrides,
  };
}

function createRawDetail(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    branches: [createRawBranch()],
    pullRequests: [createRawPullRequest()],
    repositories: [createRawRepository()],
    _instance: { type: 'GitHub' },
    ...overrides,
  };
}

function createRawDevStatusResponse(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    errors: [],
    detail: [createRawDetail()],
    errorMessages: [],
    ...overrides,
  };
}

// ============================================================================
// IJiraRepository
// ============================================================================

describe('parseJiraRepository', () => {
  it('should parse a valid repository object', () => {
    const raw = createRawRepository();
    const result: IJiraRepository = parseJiraRepository(raw);

    expect(result.id).toBe('repo-1');
    expect(result.name).toBe('my-repo');
    expect(result.url).toBe('https://github.com/org/my-repo');
  });

  it('should handle string coercion for all fields', () => {
    const raw = createRawRepository({ id: 123, name: 456, url: 789 });
    const result = parseJiraRepository(raw);

    expect(result.id).toBe('123');
    expect(result.name).toBe('456');
    expect(result.url).toBe('789');
  });

  it('should throw on null input', () => {
    expect(() => parseJiraRepository(null)).toThrow();
  });

  it('should throw on undefined input', () => {
    expect(() => parseJiraRepository(undefined)).toThrow();
  });

  it('should throw on non-object input', () => {
    expect(() => parseJiraRepository('not-an-object')).toThrow();
  });

  it('should handle missing fields with defaults', () => {
    const result = parseJiraRepository({});
    expect(result.id).toBe('');
    expect(result.name).toBe('');
    expect(result.url).toBe('');
  });
});

// ============================================================================
// IJiraAuthor
// ============================================================================

describe('parseJiraAuthor', () => {
  it('should parse a valid author object', () => {
    const raw = createRawAuthor();
    const result: IJiraAuthor = parseJiraAuthor(raw);

    expect(result.name).toBe('John Doe');
    expect(result.avatar).toBe('https://avatars.example.com/johndoe');
  });

  it('should handle missing avatar field', () => {
    const result = parseJiraAuthor({ name: 'Author' });
    expect(result.name).toBe('Author');
    expect(result.avatar).toBe('');
  });

  it('should throw on null input', () => {
    expect(() => parseJiraAuthor(null)).toThrow();
  });

  it('should throw on undefined input', () => {
    expect(() => parseJiraAuthor(undefined)).toThrow();
  });
});

// ============================================================================
// IJiraCommit
// ============================================================================

describe('parseJiraCommit', () => {
  it('should parse a valid commit with nested author', () => {
    const raw = createRawCommit();
    const result: IJiraCommit = parseJiraCommit(raw);

    expect(result.id).toBe('abc123def456');
    expect(result.displayId).toBe('abc123d');
    expect(result.authorTimestamp).toBe(1700000000000);
    expect(result.url).toBe('https://github.com/org/repo/commit/abc123def456');
    expect(result.author.name).toBe('John Doe');
    expect(result.author.avatar).toBe('https://avatars.example.com/johndoe');
    expect(result.fileCount).toBe(3);
    expect(result.merge).toBe(false);
    expect(result.message).toBe('feat: add new feature');
    expect(result.files).toHaveLength(1);
  });

  it('should deserialize nested author object from raw JSON', () => {
    const raw = createRawCommit({
      author: { name: 'Nested Author', avatar: 'https://avatar.test/nested' },
    });
    const result = parseJiraCommit(raw);

    expect(result.author.name).toBe('Nested Author');
    expect(result.author.avatar).toBe('https://avatar.test/nested');
  });

  it('should handle missing optional files as empty array', () => {
    const raw = createRawCommit();
    delete (raw as Record<string, unknown>).files;
    const result = parseJiraCommit(raw);
    expect(result.files).toEqual([]);
  });

  it('should handle merge flag as true', () => {
    const result = parseJiraCommit(createRawCommit({ merge: true }));
    expect(result.merge).toBe(true);
  });

  it('should throw on null input', () => {
    expect(() => parseJiraCommit(null)).toThrow();
  });
});

// ============================================================================
// IJiraBranch
// ============================================================================

describe('parseJiraBranch', () => {
  it('should parse a valid branch with nested repository and lastCommit', () => {
    const raw = createRawBranch();
    const result: IJiraBranch = parseJiraBranch(raw);

    expect(result.name).toBe('feature/IQS-100');
    expect(result.url).toBe('https://github.com/org/repo/tree/feature/IQS-100');
    expect(result.createPullRequestUrl).toBe('https://github.com/org/repo/compare/feature/IQS-100');
    expect(result.repository.name).toBe('my-repo');
    expect(result.lastCommit.id).toBe('abc123def456');
    expect(result.lastCommit.author.name).toBe('John Doe');
  });

  it('should deeply deserialize nested objects', () => {
    const raw = createRawBranch({
      repository: { id: 'repo-2', name: 'other-repo', url: 'https://github.com/org/other' },
      lastCommit: createRawCommit({ id: 'xyz789', message: 'fix: bug' }),
    });
    const result = parseJiraBranch(raw);

    expect(result.repository.id).toBe('repo-2');
    expect(result.repository.name).toBe('other-repo');
    expect(result.lastCommit.id).toBe('xyz789');
    expect(result.lastCommit.message).toBe('fix: bug');
  });

  it('should throw on null input', () => {
    expect(() => parseJiraBranch(null)).toThrow();
  });
});

// ============================================================================
// IJiraPullRequest
// ============================================================================

describe('parseJiraPullRequest', () => {
  it('should parse a valid pull request with nested author and reviewers', () => {
    const raw = createRawPullRequest();
    const result: IJiraPullRequest = parseJiraPullRequest(raw);

    expect(result.author.name).toBe('John Doe');
    expect(result.id).toBe('pr-42');
    expect(result.name).toBe('Feature IQS-100');
    expect(result.commentCount).toBe(5);
    expect(result.status).toBe('MERGED');
    expect(result.url).toBe('https://github.com/org/repo/pull/42');
    expect(result.lastUpdate).toBe('2024-02-15T10:00:00Z');
    expect(result.repositoryId).toBe('repo-1');
    expect(result.repositoryName).toBe('my-repo');
    expect(result.repositoryUrl).toBe('https://github.com/org/my-repo');
  });

  it('should deserialize reviewers array recursively', () => {
    const raw = createRawPullRequest({
      reviewers: [
        { name: 'Reviewer A', avatar: 'https://avatar.test/a' },
        { name: 'Reviewer B', avatar: 'https://avatar.test/b' },
      ],
    });
    const result = parseJiraPullRequest(raw);

    expect(result.reviewers).toHaveLength(2);
    expect(result.reviewers[0]!.name).toBe('Reviewer A');
    expect(result.reviewers[1]!.name).toBe('Reviewer B');
  });

  it('should handle empty reviewers array', () => {
    const raw = createRawPullRequest({ reviewers: [] });
    const result = parseJiraPullRequest(raw);
    expect(result.reviewers).toEqual([]);
  });

  it('should handle missing reviewers with default empty array', () => {
    const raw = createRawPullRequest();
    delete (raw as Record<string, unknown>).reviewers;
    const result = parseJiraPullRequest(raw);
    expect(result.reviewers).toEqual([]);
  });

  it('should preserve source and destination as opaque objects', () => {
    const raw = createRawPullRequest();
    const result = parseJiraPullRequest(raw);

    expect(result.source).toEqual({ branch: 'feature/IQS-100', url: 'https://github.com/org/repo/tree/feature/IQS-100' });
    expect(result.destination).toEqual({ branch: 'main', url: 'https://github.com/org/repo/tree/main' });
  });

  it('should throw on null input', () => {
    expect(() => parseJiraPullRequest(null)).toThrow();
  });
});

// ============================================================================
// IJiraDevStatusDetail
// ============================================================================

describe('parseJiraDevStatusDetail', () => {
  it('should parse a valid detail with nested branches, PRs, and repositories', () => {
    const raw = createRawDetail();
    const result: IJiraDevStatusDetail = parseJiraDevStatusDetail(raw);

    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]!.name).toBe('feature/IQS-100');
    expect(result.branches[0]!.repository.name).toBe('my-repo');
    expect(result.branches[0]!.lastCommit.author.name).toBe('John Doe');

    expect(result.pullRequests).toHaveLength(1);
    expect(result.pullRequests[0]!.id).toBe('pr-42');
    expect(result.pullRequests[0]!.author.name).toBe('John Doe');

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]!.id).toBe('repo-1');

    expect(result.instance).toEqual({ type: 'GitHub' });
  });

  it('should handle empty arrays for branches, pullRequests, repositories', () => {
    const raw = createRawDetail({ branches: [], pullRequests: [], repositories: [] });
    const result = parseJiraDevStatusDetail(raw);

    expect(result.branches).toEqual([]);
    expect(result.pullRequests).toEqual([]);
    expect(result.repositories).toEqual([]);
  });

  it('should handle missing array fields with defaults', () => {
    const raw: Record<string, unknown> = { _instance: {} };
    const result = parseJiraDevStatusDetail(raw);

    expect(result.branches).toEqual([]);
    expect(result.pullRequests).toEqual([]);
    expect(result.repositories).toEqual([]);
  });

  it('should handle multiple branches and PRs', () => {
    const raw = createRawDetail({
      branches: [createRawBranch(), createRawBranch({ name: 'feature/IQS-200' })],
      pullRequests: [createRawPullRequest(), createRawPullRequest({ id: 'pr-43' })],
      repositories: [createRawRepository(), createRawRepository({ id: 'repo-2' })],
    });
    const result = parseJiraDevStatusDetail(raw);

    expect(result.branches).toHaveLength(2);
    expect(result.pullRequests).toHaveLength(2);
    expect(result.repositories).toHaveLength(2);
  });

  it('should throw on null input', () => {
    expect(() => parseJiraDevStatusDetail(null)).toThrow();
  });
});

// ============================================================================
// IJiraDevStatusResponse
// ============================================================================

describe('parseJiraDevStatusResponse', () => {
  it('should parse a full response with nested detail', () => {
    const raw = createRawDevStatusResponse();
    const result: IJiraDevStatusResponse = parseJiraDevStatusResponse(raw);

    expect(result.errors).toEqual([]);
    expect(result.errorMessages).toEqual([]);
    expect(result.detail).toHaveLength(1);
    expect(result.detail[0]!.branches).toHaveLength(1);
    expect(result.detail[0]!.pullRequests).toHaveLength(1);
    expect(result.detail[0]!.repositories).toHaveLength(1);
  });

  it('should handle response with errors', () => {
    const raw = createRawDevStatusResponse({
      errors: [{ message: 'API rate limit exceeded' }],
      errorMessages: ['Rate limit reached'],
      detail: [],
    });
    const result = parseJiraDevStatusResponse(raw);

    expect(result.errors).toHaveLength(1);
    expect(result.errorMessages).toHaveLength(1);
    expect(result.detail).toEqual([]);
  });

  it('should handle missing fields with defaults', () => {
    const raw = {};
    const result = parseJiraDevStatusResponse(raw);

    expect(result.errors).toEqual([]);
    expect(result.detail).toEqual([]);
    expect(result.errorMessages).toEqual([]);
  });

  it('should handle multiple detail entries', () => {
    const raw = createRawDevStatusResponse({
      detail: [createRawDetail(), createRawDetail()],
    });
    const result = parseJiraDevStatusResponse(raw);

    expect(result.detail).toHaveLength(2);
  });

  it('should throw on null input', () => {
    expect(() => parseJiraDevStatusResponse(null)).toThrow();
  });

  it('should throw on undefined input', () => {
    expect(() => parseJiraDevStatusResponse(undefined)).toThrow();
  });

  it('should throw on non-object input', () => {
    expect(() => parseJiraDevStatusResponse('string')).toThrow();
  });
});

// ============================================================================
// Python from_json equivalence tests
// ============================================================================

describe('Python from_json equivalence', () => {
  it('should match Python Repository.from_json behavior', () => {
    // Python: Repository.from_json({"id": "1", "name": "test", "url": "http://example.com"})
    const raw = { id: '1', name: 'test', url: 'http://example.com' };
    const result = parseJiraRepository(raw);
    expect(result).toEqual({ id: '1', name: 'test', url: 'http://example.com' });
  });

  it('should match Python Author.from_json behavior', () => {
    // Python: Author.from_json({"name": "Developer", "avatar": "http://avatar.com/dev"})
    const raw = { name: 'Developer', avatar: 'http://avatar.com/dev' };
    const result = parseJiraAuthor(raw);
    expect(result).toEqual({ name: 'Developer', avatar: 'http://avatar.com/dev' });
  });

  it('should match Python Commit.from_json nested author deserialization', () => {
    // Python: data['author'] = Author.from_json(data['author']) before constructing
    const raw = createRawCommit();
    const result = parseJiraCommit(raw);
    // Verify author is a proper IJiraAuthor, not raw dict
    expect(result.author).toEqual({ name: 'John Doe', avatar: 'https://avatars.example.com/johndoe' });
  });

  it('should match Python Branch.from_json nested deserialization', () => {
    // Python: data['repository'] = Repository.from_json(data['repository'])
    // Python: data['lastCommit'] = Commit.from_json(data['lastCommit'])
    const raw = createRawBranch();
    const result = parseJiraBranch(raw);
    expect(result.repository).toEqual({ id: 'repo-1', name: 'my-repo', url: 'https://github.com/org/my-repo' });
    expect(result.lastCommit.author).toEqual({ name: 'John Doe', avatar: 'https://avatars.example.com/johndoe' });
  });

  it('should match Python PullRequest.from_json reviewer deserialization', () => {
    // Python: data['reviewers'] = [Author.from_json(reviewer) for reviewer in data.get('reviewers', [])]
    const raw = createRawPullRequest({
      reviewers: [
        { name: 'R1', avatar: 'a1' },
        { name: 'R2', avatar: 'a2' },
      ],
    });
    const result = parseJiraPullRequest(raw);
    expect(result.reviewers).toEqual([
      { name: 'R1', avatar: 'a1' },
      { name: 'R2', avatar: 'a2' },
    ]);
  });

  it('should match Python Detail.from_json array deserialization', () => {
    // Python: data['branches'] = [Branch.from_json(b) for b in data.get('branches', [])]
    // Python: data['pullRequests'] = [PullRequest.from_json(pr) for pr in data.get('pullRequests', [])]
    // Python: data['repositories'] = [Repository.from_json(r) for r in data.get('repositories', [])]
    const raw = createRawDetail();
    const result = parseJiraDevStatusDetail(raw);
    expect(result.branches).toHaveLength(1);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.repositories).toHaveLength(1);
  });

  it('should match Python JiraGitHubDataDeserializer.from_json behavior', () => {
    // Python: data['detail'] = [Detail.from_json(det) for det in data.get('detail', [])]
    const raw = createRawDevStatusResponse();
    const result = parseJiraDevStatusResponse(raw);
    expect(result.detail).toHaveLength(1);
    expect(result.detail[0]!.branches[0]!.lastCommit.author.name).toBe('John Doe');
  });
});
