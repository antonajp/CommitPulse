import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, statSync, realpathSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateRepositoryPath,
  findValidRepository,
  type PathValidationResult,
} from '../../utils/repository-path-validator.js';
import type { RepositoryEntry } from '../../config/settings.js';

/**
 * Unit tests for repository path validation (GITX-130).
 * Tests security validations for path traversal, whitelist enforcement,
 * and git repository verification.
 */
describe('repository-path-validator', () => {
  let testTmpDir: string;
  let validRepoPath: string;
  let validConfiguredRepos: RepositoryEntry[];

  beforeEach(() => {
    // Create a temporary directory for testing
    testTmpDir = join(tmpdir(), `gitr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testTmpDir, { recursive: true });

    // Create a mock git repository
    validRepoPath = join(testTmpDir, 'valid-repo');
    mkdirSync(validRepoPath, { recursive: true });
    mkdirSync(join(validRepoPath, '.git'), { recursive: true });
    writeFileSync(join(validRepoPath, '.git', 'config'), '[core]\n');

    // Configure the "allowed" repositories
    validConfiguredRepos = [
      {
        path: validRepoPath,
        name: 'valid-repo',
        organization: 'test-org',
        trackerType: 'jira',
      },
    ];
  });

  afterEach(() => {
    // Clean up temporary directory
    if (existsSync(testTmpDir)) {
      rmSync(testTmpDir, { recursive: true, force: true });
    }
  });

  describe('validateRepositoryPath', () => {
    describe('valid paths', () => {
      it('should accept a valid git repository in the whitelist', () => {
        const result = validateRepositoryPath(validRepoPath, validConfiguredRepos);
        expect(result.isValid).toBe(true);
        expect(result.canonicalPath).toBe(realpathSync(validRepoPath));
        expect(result.reason).toBeUndefined();
      });

      it('should resolve symlinks to canonical paths', () => {
        // Skip symlink test on Windows if it's not supported
        const symlinkPath = join(testTmpDir, 'symlink-to-repo');
        try {
          // Try to create symlink - may fail on Windows without admin rights
          const fs = require('node:fs');
          fs.symlinkSync(validRepoPath, symlinkPath, 'dir');
        } catch (err) {
          // Skip test if symlink creation fails (Windows without admin)
          console.log('Skipping symlink test: symlink creation failed');
          return;
        }

        // Add symlink path to configured repos
        const reposWithSymlink: RepositoryEntry[] = [
          ...validConfiguredRepos,
          {
            path: symlinkPath,
            name: 'symlink-repo',
            organization: 'test-org',
            trackerType: 'jira',
          },
        ];

        const result = validateRepositoryPath(symlinkPath, reposWithSymlink);
        expect(result.isValid).toBe(true);
        // Both the symlink and the real path should resolve to the same canonical path
        expect(result.canonicalPath).toBe(realpathSync(validRepoPath));
      });
    });

    describe('invalid input types', () => {
      it('should reject empty string', () => {
        const result = validateRepositoryPath('', validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Empty path');
      });

      it('should reject whitespace-only string', () => {
        const result = validateRepositoryPath('   ', validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Empty path');
      });

      it('should reject null', () => {
        const result = validateRepositoryPath(null as unknown as string, validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Invalid path type');
      });

      it('should reject undefined', () => {
        const result = validateRepositoryPath(undefined as unknown as string, validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Invalid path type');
      });

      it('should reject non-string types', () => {
        const result = validateRepositoryPath(123 as unknown as string, validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Invalid path type');
      });
    });

    describe('security: relative path rejection (CWE-22)', () => {
      it('should reject relative paths starting with ./', () => {
        const result = validateRepositoryPath('./some-repo', validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Relative paths not allowed');
      });

      it('should reject relative paths starting with ../', () => {
        const result = validateRepositoryPath('../some-repo', validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Relative paths not allowed');
      });

      it('should reject relative paths without leading ./', () => {
        const result = validateRepositoryPath('some-repo', validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Relative paths not allowed');
      });

      it('should reject paths with path traversal sequences', () => {
        const result = validateRepositoryPath('folder/../../../etc', validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Relative paths not allowed');
      });
    });

    describe('security: non-existent paths (CWE-20)', () => {
      it('should reject paths that do not exist', () => {
        const nonExistentPath = join(testTmpDir, 'does-not-exist');
        const result = validateRepositoryPath(nonExistentPath, validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Path does not exist or is inaccessible');
      });

      it('should reject paths that are not directories', () => {
        const filePath = join(testTmpDir, 'file.txt');
        writeFileSync(filePath, 'content');

        const configWithFile: RepositoryEntry[] = [
          {
            path: filePath,
            name: 'file-repo',
            organization: 'test-org',
            trackerType: 'jira',
          },
        ];

        const result = validateRepositoryPath(filePath, configWithFile);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Path is not a directory');
      });
    });

    describe('security: git repository verification', () => {
      it('should reject directories without .git subdirectory', () => {
        const nonGitPath = join(testTmpDir, 'not-a-git-repo');
        mkdirSync(nonGitPath, { recursive: true });

        const configWithNonGit: RepositoryEntry[] = [
          {
            path: nonGitPath,
            name: 'non-git',
            organization: 'test-org',
            trackerType: 'jira',
          },
        ];

        const result = validateRepositoryPath(nonGitPath, configWithNonGit);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Not a git repository');
      });
    });

    describe('security: whitelist enforcement (CWE-284)', () => {
      it('should reject paths not in the configured repositories', () => {
        const unauthorizedPath = join(testTmpDir, 'unauthorized-repo');
        mkdirSync(unauthorizedPath, { recursive: true });
        mkdirSync(join(unauthorizedPath, '.git'), { recursive: true });

        // Path exists and is a git repo, but not in the whitelist
        const result = validateRepositoryPath(unauthorizedPath, validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Path is not in the list of configured repositories');
      });

      it('should only accept paths that match configured repos exactly', () => {
        const similarPath = validRepoPath + '-different';
        mkdirSync(similarPath, { recursive: true });
        mkdirSync(join(similarPath, '.git'), { recursive: true });

        const result = validateRepositoryPath(similarPath, validConfiguredRepos);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Path is not in the list of configured repositories');
      });

      it('should handle empty configured repos list', () => {
        const result = validateRepositoryPath(validRepoPath, []);
        expect(result.isValid).toBe(false);
        expect(result.reason).toBe('Path is not in the list of configured repositories');
      });

      it('should skip configured repos with invalid paths during whitelist check', () => {
        const configWithInvalidEntry: RepositoryEntry[] = [
          {
            path: '/nonexistent/invalid/path',
            name: 'invalid-repo',
            organization: 'test-org',
            trackerType: 'jira',
          },
          ...validConfiguredRepos,
        ];

        // Should still validate successfully if the valid repo is in the list
        const result = validateRepositoryPath(validRepoPath, configWithInvalidEntry);
        expect(result.isValid).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle paths with trailing slashes', () => {
        const pathWithSlash = validRepoPath + '/';
        const result = validateRepositoryPath(pathWithSlash, validConfiguredRepos);
        // Should succeed after normalization
        expect(result.isValid).toBe(true);
      });

      it('should handle paths with extra whitespace', () => {
        const pathWithWhitespace = `  ${validRepoPath}  `;
        const result = validateRepositoryPath(pathWithWhitespace, validConfiguredRepos);
        // Should succeed after trimming
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('findValidRepository', () => {
    describe('valid repository lookups', () => {
      it('should find a repository by exact name match', () => {
        const repo = findValidRepository('valid-repo', validConfiguredRepos);
        expect(repo).not.toBeNull();
        expect(repo?.name).toBe('valid-repo');
        expect(repo?.path).toBe(validRepoPath);
      });

      it('should return null for non-existent repository names', () => {
        const repo = findValidRepository('does-not-exist', validConfiguredRepos);
        expect(repo).toBeNull();
      });
    });

    describe('invalid input types', () => {
      it('should return null for empty string', () => {
        const repo = findValidRepository('', validConfiguredRepos);
        expect(repo).toBeNull();
      });

      it('should return null for null', () => {
        const repo = findValidRepository(null as unknown as string, validConfiguredRepos);
        expect(repo).toBeNull();
      });

      it('should return null for undefined', () => {
        const repo = findValidRepository(undefined as unknown as string, validConfiguredRepos);
        expect(repo).toBeNull();
      });

      it('should return null for non-string types', () => {
        const repo = findValidRepository(123 as unknown as string, validConfiguredRepos);
        expect(repo).toBeNull();
      });
    });

    describe('security: path validation enforcement', () => {
      it('should return null if repository path fails validation', () => {
        // Create a config with an invalid path
        const invalidConfig: RepositoryEntry[] = [
          {
            path: '/nonexistent/invalid/path',
            name: 'invalid-repo',
            organization: 'test-org',
            trackerType: 'jira',
          },
        ];

        const repo = findValidRepository('invalid-repo', invalidConfig);
        expect(repo).toBeNull();
      });

      it('should return null if repository is not a git directory', () => {
        const nonGitPath = join(testTmpDir, 'not-git');
        mkdirSync(nonGitPath, { recursive: true });

        const configWithNonGit: RepositoryEntry[] = [
          {
            path: nonGitPath,
            name: 'non-git',
            organization: 'test-org',
            trackerType: 'jira',
          },
        ];

        const repo = findValidRepository('non-git', configWithNonGit);
        expect(repo).toBeNull();
      });
    });

    describe('case sensitivity', () => {
      it('should use exact case-sensitive name matching', () => {
        const repo = findValidRepository('Valid-Repo', validConfiguredRepos);
        expect(repo).toBeNull(); // 'Valid-Repo' !== 'valid-repo'
      });

      it('should not match partial names', () => {
        const repo = findValidRepository('valid', validConfiguredRepos);
        expect(repo).toBeNull();
      });
    });
  });
});
