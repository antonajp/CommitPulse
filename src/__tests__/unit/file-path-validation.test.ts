/**
 * Unit tests for file-path-validation.ts
 *
 * Tests the file path validation utilities for security and correctness:
 * - Path traversal prevention (CWE-22)
 * - Null byte injection prevention
 * - Input length limits
 * - Forbidden character rejection
 * - Glob pattern detection
 *
 * Ticket: GITX-128
 */

import { describe, it, expect } from 'vitest';
import {
  validateFilePath,
  validateFilePaths,
  parseFilePathInput,
  containsGlobPattern,
  sanitizeFilenameForDisplay,
  MAX_FILE_PATH_LENGTH,
  MAX_FILE_COUNT,
} from '../../utils/file-path-validation.js';

describe('validateFilePath', () => {
  describe('valid paths', () => {
    it('should accept simple file names', () => {
      const result = validateFilePath('file.ts');
      expect(result.valid).toBe(true);
      expect(result.normalizedPath).toBe('file.ts');
    });

    it('should accept paths with directories', () => {
      const result = validateFilePath('src/services/file.ts');
      expect(result.valid).toBe(true);
      expect(result.normalizedPath).toBe('src/services/file.ts');
    });

    it('should normalize backslashes to forward slashes', () => {
      const result = validateFilePath('src\\services\\file.ts');
      expect(result.valid).toBe(true);
      expect(result.normalizedPath).toBe('src/services/file.ts');
    });

    it('should trim whitespace', () => {
      const result = validateFilePath('  src/file.ts  ');
      expect(result.valid).toBe(true);
      expect(result.normalizedPath).toBe('src/file.ts');
    });

    it('should collapse multiple slashes', () => {
      const result = validateFilePath('src//services///file.ts');
      expect(result.valid).toBe(true);
      expect(result.normalizedPath).toBe('src/services/file.ts');
    });

    it('should reject absolute paths starting with /', () => {
      // Absolute paths starting with / are rejected as path traversal
      const result = validateFilePath('/src/file.ts');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should remove trailing slashes', () => {
      const result = validateFilePath('src/file.ts/');
      expect(result.valid).toBe(true);
      expect(result.normalizedPath).toBe('src/file.ts');
    });
  });

  describe('invalid paths - security', () => {
    it('should reject path traversal with ../', () => {
      const result = validateFilePath('../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject path traversal in middle of path', () => {
      const result = validateFilePath('src/../../../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject path traversal with backslashes', () => {
      const result = validateFilePath('..\\etc\\passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject absolute paths starting with / consistently', () => {
      // Absolute paths starting with / should be rejected for security
      const result = validateFilePath('/etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject null byte injection', () => {
      const result = validateFilePath('file.ts\x00.jpg');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('null byte');
    });
  });

  describe('invalid paths - validation', () => {
    it('should reject empty strings', () => {
      const result = validateFilePath('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject whitespace-only strings', () => {
      const result = validateFilePath('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject paths exceeding max length', () => {
      const longPath = 'a'.repeat(MAX_FILE_PATH_LENGTH + 1);
      const result = validateFilePath(longPath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('maximum length');
    });

    it('should reject paths with forbidden characters', () => {
      const result = validateFilePath('file<name>.ts');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('forbidden characters');
    });

    it('should reject paths with control characters', () => {
      const result = validateFilePath('file\x01name.ts');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('forbidden characters');
    });
  });
});

describe('validateFilePaths', () => {
  it('should validate an array of valid paths', () => {
    const result = validateFilePaths(['file1.ts', 'file2.ts', 'src/file3.ts']);
    expect(result.valid).toBe(true);
    expect(result.paths).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect errors for invalid paths', () => {
    const result = validateFilePaths(['file1.ts', '../etc/passwd', 'file3.ts']);
    expect(result.valid).toBe(false);
    expect(result.paths).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });

  it('should reject too many files', () => {
    const tooManyPaths = Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => `file${i}.ts`);
    const result = validateFilePaths(tooManyPaths);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Too many files');
  });

  it('should reject empty array', () => {
    const result = validateFilePaths([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('At least one');
  });

  it('should deduplicate paths', () => {
    const result = validateFilePaths(['file.ts', 'file.ts', 'FILE.ts']);
    expect(result.valid).toBe(true);
    // Case-sensitive, so file.ts and FILE.ts are different
    expect(result.paths).toHaveLength(2);
  });
});

describe('parseFilePathInput', () => {
  it('should parse newline-separated paths', () => {
    const result = parseFilePathInput('file1.ts\nfile2.ts\nfile3.ts');
    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should parse comma-separated paths', () => {
    const result = parseFilePathInput('file1.ts,file2.ts,file3.ts');
    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should parse mixed delimiters', () => {
    const result = parseFilePathInput('file1.ts,file2.ts\nfile3.ts');
    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should trim whitespace from each path', () => {
    const result = parseFilePathInput('  file1.ts  ,  file2.ts  ');
    expect(result).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should filter out empty entries', () => {
    const result = parseFilePathInput('file1.ts,,file2.ts,\n\nfile3.ts');
    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should return empty array for empty input', () => {
    expect(parseFilePathInput('')).toEqual([]);
    expect(parseFilePathInput('  ')).toEqual([]);
  });
});

describe('containsGlobPattern', () => {
  it('should detect * wildcard', () => {
    expect(containsGlobPattern('*.ts')).toBe(true);
    expect(containsGlobPattern('src/*.ts')).toBe(true);
  });

  it('should detect ** glob pattern', () => {
    expect(containsGlobPattern('src/**/*.ts')).toBe(true);
  });

  it('should detect ? wildcard', () => {
    expect(containsGlobPattern('file?.ts')).toBe(true);
  });

  it('should detect character class patterns', () => {
    expect(containsGlobPattern('file[0-9].ts')).toBe(true);
    expect(containsGlobPattern('file[abc].ts')).toBe(true);
  });

  it('should return false for normal paths', () => {
    expect(containsGlobPattern('file.ts')).toBe(false);
    expect(containsGlobPattern('src/services/file.ts')).toBe(false);
  });
});

describe('sanitizeFilenameForDisplay', () => {
  it('should return short paths unchanged', () => {
    expect(sanitizeFilenameForDisplay('file.ts', 50)).toBe('file.ts');
    expect(sanitizeFilenameForDisplay('src/file.ts', 50)).toBe('src/file.ts');
  });

  it('should truncate long paths with ellipsis', () => {
    const longPath = 'src/very/long/path/to/some/file.ts';
    const result = sanitizeFilenameForDisplay(longPath, 25);
    expect(result.length).toBeLessThanOrEqual(25);
    expect(result).toContain('...');
  });

  it('should preserve first and last parts when possible', () => {
    const path = 'src/middle/part/file.ts';
    const result = sanitizeFilenameForDisplay(path, 20);
    expect(result).toContain('src');
    expect(result).toContain('file.ts');
  });

  it('should handle empty input', () => {
    expect(sanitizeFilenameForDisplay('')).toBe('');
  });

  it('should handle short paths without directories', () => {
    const result = sanitizeFilenameForDisplay('veryverylongfilename.ts', 15);
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result).toContain('...');
  });
});
