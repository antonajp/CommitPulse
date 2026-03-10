/**
 * TypeScript interfaces and parse functions for the Jira-GitHub dev status
 * API response data model.
 *
 * Maps from Python JiraGitHub.py (107 lines) — all 7 classes:
 *   Repository, Author, Commit, Branch, PullRequest, Detail,
 *   JiraGitHubDataDeserializer
 *
 * Python uses class-based deserialization (from_json classmethod).
 * TypeScript uses interfaces + parse functions for runtime validation.
 *
 * Each parse function:
 * - Validates input is a non-null object
 * - Coerces fields to expected types with sensible defaults
 * - Recursively deserializes nested objects (matching Python from_json)
 * - Throws descriptive errors on invalid input
 *
 * Ticket: IQS-858
 */

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Validate that input is a non-null, non-array object.
 * Throws a descriptive error if validation fails.
 *
 * @param input - The value to validate
 * @param typeName - Human-readable type name for error messages
 * @returns The input cast to Record<string, unknown>
 */
function assertObject(input: unknown, typeName: string): Record<string, unknown> {
  if (input === null || input === undefined) {
    throw new TypeError(`${typeName}: expected object, got ${input === null ? 'null' : 'undefined'}`);
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`${typeName}: expected object, got ${typeof input}`);
  }
  return input as Record<string, unknown>;
}

/**
 * Safely coerce a value to string, returning a default on null/undefined.
 *
 * @param value - The value to coerce
 * @param defaultValue - Default if value is null/undefined
 * @returns The coerced string value
 */
function toString(value: unknown, defaultValue: string = ''): string {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  return String(value);
}

/**
 * Safely coerce a value to number, returning a default on null/undefined/NaN.
 *
 * @param value - The value to coerce
 * @param defaultValue - Default if value is null/undefined/NaN
 * @returns The coerced number value
 */
function toNumber(value: unknown, defaultValue: number = 0): number {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  const n = Number(value);
  return Number.isNaN(n) ? defaultValue : n;
}

/**
 * Safely coerce a value to boolean, returning a default on null/undefined.
 *
 * @param value - The value to coerce
 * @param defaultValue - Default if value is null/undefined
 * @returns The coerced boolean value
 */
function toBoolean(value: unknown, defaultValue: boolean = false): boolean {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  return Boolean(value);
}

/**
 * Safely extract an array from a value, returning empty array on null/undefined.
 *
 * @param value - The value to extract
 * @returns An array (empty if input was not an array)
 */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

// ============================================================================
// IJiraRepository — maps from Python Repository class
// ============================================================================

/**
 * Jira dev status API repository reference.
 * Maps from Python JiraGitHub.py Repository class.
 *
 * Python fields: id, name, url
 */
export interface IJiraRepository {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/**
 * Parse raw JSON data into an IJiraRepository.
 * Equivalent to Python Repository.from_json(data).
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraRepository instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraRepository(input: unknown): IJiraRepository {
  const data = assertObject(input, 'IJiraRepository');

  return {
    id: toString(data['id']),
    name: toString(data['name']),
    url: toString(data['url']),
  };
}

// ============================================================================
// IJiraAuthor — maps from Python Author class
// ============================================================================

/**
 * Jira dev status API author reference.
 * Maps from Python JiraGitHub.py Author class.
 *
 * Python fields: name, avatar
 */
export interface IJiraAuthor {
  readonly name: string;
  readonly avatar: string;
}

/**
 * Parse raw JSON data into an IJiraAuthor.
 * Equivalent to Python Author.from_json(data).
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraAuthor instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraAuthor(input: unknown): IJiraAuthor {
  const data = assertObject(input, 'IJiraAuthor');

  return {
    name: toString(data['name']),
    avatar: toString(data['avatar']),
  };
}

// ============================================================================
// IJiraCommit — maps from Python Commit class
// ============================================================================

/**
 * Jira dev status API commit reference.
 * Maps from Python JiraGitHub.py Commit class.
 *
 * Python fields: id, displayId, authorTimestamp, url, author (Author),
 *                fileCount, merge, message, files
 *
 * Note: Python Commit.__init__ deserializes author via Author.from_json(author).
 * The TypeScript parse function does the same via parseJiraAuthor().
 */
export interface IJiraCommit {
  readonly id: string;
  readonly displayId: string;
  readonly authorTimestamp: number;
  readonly url: string;
  readonly author: IJiraAuthor;
  readonly fileCount: number;
  readonly merge: boolean;
  readonly message: string;
  readonly files: unknown[];
}

/**
 * Parse raw JSON data into an IJiraCommit.
 * Equivalent to Python Commit.from_json(data).
 *
 * Recursively deserializes the nested author field via parseJiraAuthor(),
 * matching the Python behavior: data['author'] = Author.from_json(data['author'])
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraCommit instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraCommit(input: unknown): IJiraCommit {
  const data = assertObject(input, 'IJiraCommit');

  return {
    id: toString(data['id']),
    displayId: toString(data['displayId']),
    authorTimestamp: toNumber(data['authorTimestamp']),
    url: toString(data['url']),
    author: parseJiraAuthor(data['author']),
    fileCount: toNumber(data['fileCount']),
    merge: toBoolean(data['merge']),
    message: toString(data['message']),
    files: toArray(data['files']),
  };
}

// ============================================================================
// IJiraBranch — maps from Python Branch class
// ============================================================================

/**
 * Jira dev status API branch reference.
 * Maps from Python JiraGitHub.py Branch class.
 *
 * Python fields: name, url, createPullRequestUrl, repository (Repository),
 *                lastCommit (Commit)
 *
 * Note: Python Branch.__init__ deserializes repository and lastCommit:
 *   self.repository = Repository.from_json(repository)
 *   self.lastCommit = Commit.from_json(lastCommit)
 */
export interface IJiraBranch {
  readonly name: string;
  readonly url: string;
  readonly createPullRequestUrl: string;
  readonly repository: IJiraRepository;
  readonly lastCommit: IJiraCommit;
}

/**
 * Parse raw JSON data into an IJiraBranch.
 * Equivalent to Python Branch.from_json(data).
 *
 * Recursively deserializes nested repository and lastCommit fields,
 * matching the Python behavior.
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraBranch instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraBranch(input: unknown): IJiraBranch {
  const data = assertObject(input, 'IJiraBranch');

  return {
    name: toString(data['name']),
    url: toString(data['url']),
    createPullRequestUrl: toString(data['createPullRequestUrl']),
    repository: parseJiraRepository(data['repository']),
    lastCommit: parseJiraCommit(data['lastCommit']),
  };
}

// ============================================================================
// IJiraPullRequest — maps from Python PullRequest class
// ============================================================================

/**
 * Jira dev status API pull request reference.
 * Maps from Python JiraGitHub.py PullRequest class.
 *
 * Python fields: author (Author), id, name, commentCount, source, destination,
 *                reviewers (Author[]), status, url, lastUpdate,
 *                repositoryId, repositoryName, repositoryUrl
 *
 * Note: Python PullRequest.__init__ deserializes:
 *   self.author = Author.from_json(author)
 *   self.reviewers = [Author.from_json(reviewer) for reviewer in reviewers]
 *
 * source/destination are kept as opaque objects since the Python code
 * stores them as-is (dict).
 */
export interface IJiraPullRequest {
  readonly author: IJiraAuthor;
  readonly id: string;
  readonly name: string;
  readonly commentCount: number;
  readonly source: unknown;
  readonly destination: unknown;
  readonly reviewers: IJiraAuthor[];
  readonly status: string;
  readonly url: string;
  readonly lastUpdate: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly repositoryUrl: string;
}

/**
 * Parse raw JSON data into an IJiraPullRequest.
 * Equivalent to Python PullRequest.from_json(data).
 *
 * Recursively deserializes:
 * - author via parseJiraAuthor()
 * - reviewers array via parseJiraAuthor() for each element
 *
 * Matches the Python behavior:
 *   data['author'] = Author.from_json(data['author'])
 *   data['reviewers'] = [Author.from_json(r) for r in data.get('reviewers', [])]
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraPullRequest instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraPullRequest(input: unknown): IJiraPullRequest {
  const data = assertObject(input, 'IJiraPullRequest');

  const rawReviewers = toArray(data['reviewers']);
  const reviewers = rawReviewers.map((r) => parseJiraAuthor(r));

  return {
    author: parseJiraAuthor(data['author']),
    id: toString(data['id']),
    name: toString(data['name']),
    commentCount: toNumber(data['commentCount']),
    source: data['source'] ?? null,
    destination: data['destination'] ?? null,
    reviewers,
    status: toString(data['status']),
    url: toString(data['url']),
    lastUpdate: toString(data['lastUpdate']),
    repositoryId: toString(data['repositoryId']),
    repositoryName: toString(data['repositoryName']),
    repositoryUrl: toString(data['repositoryUrl']),
  };
}

// ============================================================================
// IJiraDevStatusDetail — maps from Python Detail class
// ============================================================================

/**
 * Jira dev status API detail section containing branches, PRs, and repos.
 * Maps from Python JiraGitHub.py Detail class.
 *
 * Python fields: branches (Branch[]), pullRequests (PullRequest[]),
 *                repositories (Repository[]), _instance (dict)
 *
 * Note: Python Detail.__init__ deserializes all arrays:
 *   self.branches = [Branch.from_json(b) for b in branches]
 *   self.pullRequests = [PullRequest.from_json(pr) for pr in pullRequests]
 *   self.repositories = [Repository.from_json(r) for r in repositories]
 */
export interface IJiraDevStatusDetail {
  readonly branches: IJiraBranch[];
  readonly pullRequests: IJiraPullRequest[];
  readonly repositories: IJiraRepository[];
  readonly instance: unknown;
}

/**
 * Parse raw JSON data into an IJiraDevStatusDetail.
 * Equivalent to Python Detail.from_json(data).
 *
 * Recursively deserializes all nested arrays, matching the Python behavior:
 *   data['branches'] = [Branch.from_json(b) for b in data.get('branches', [])]
 *   data['pullRequests'] = [PullRequest.from_json(pr) for pr in data.get('pullRequests', [])]
 *   data['repositories'] = [Repository.from_json(r) for r in data.get('repositories', [])]
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraDevStatusDetail instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraDevStatusDetail(input: unknown): IJiraDevStatusDetail {
  const data = assertObject(input, 'IJiraDevStatusDetail');

  const rawBranches = toArray(data['branches']);
  const rawPRs = toArray(data['pullRequests']);
  const rawRepos = toArray(data['repositories']);

  return {
    branches: rawBranches.map((b) => parseJiraBranch(b)),
    pullRequests: rawPRs.map((pr) => parseJiraPullRequest(pr)),
    repositories: rawRepos.map((r) => parseJiraRepository(r)),
    instance: data['_instance'] ?? null,
  };
}

// ============================================================================
// IJiraDevStatusResponse — maps from Python JiraGitHubDataDeserializer class
// ============================================================================

/**
 * Top-level Jira dev status API response.
 * Maps from Python JiraGitHub.py JiraGitHubDataDeserializer class.
 *
 * Python fields: errors (list[str]), detail (Detail[]), errorMessages
 *
 * Note: Python JiraGitHubDataDeserializer.__init__ deserializes detail:
 *   self.detail = [Detail.from_json(det) for det in detail]
 */
export interface IJiraDevStatusResponse {
  readonly errors: unknown[];
  readonly detail: IJiraDevStatusDetail[];
  readonly errorMessages: unknown[];
}

/**
 * Parse raw JSON data into an IJiraDevStatusResponse.
 * Equivalent to Python JiraGitHubDataDeserializer.from_json(data).
 *
 * Recursively deserializes the detail array, matching the Python behavior:
 *   data['detail'] = [Detail.from_json(det) for det in data.get('detail', [])]
 *
 * @param input - Raw JSON object (e.g., from Jira dev status API)
 * @returns Validated IJiraDevStatusResponse instance
 * @throws TypeError if input is null, undefined, or not an object
 */
export function parseJiraDevStatusResponse(input: unknown): IJiraDevStatusResponse {
  const data = assertObject(input, 'IJiraDevStatusResponse');

  const rawErrors = toArray(data['errors']);
  const rawDetail = toArray(data['detail']);
  const rawErrorMessages = toArray(data['errorMessages']);

  return {
    errors: rawErrors,
    detail: rawDetail.map((d) => parseJiraDevStatusDetail(d)),
    errorMessages: rawErrorMessages,
  };
}
