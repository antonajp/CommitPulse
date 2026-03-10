import { describe, it, expect, beforeEach, vi } from 'vitest';

// Must import mocks before the module under test
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { ArcComponentClassifier, CATEGORY_NAME_REGEX, VALID_CATEGORIES } from '../../services/arc-component-classifier.js';

/**
 * Unit tests for ArcComponentClassifier.
 *
 * Tests classification priority, multi-dot extensions, case sensitivity,
 * edge cases, and category validation.
 *
 * Ticket: IQS-885
 */

// Default mappings for most tests
const DEFAULT_EXT_MAPPING: Record<string, string> = {
  '.ts': 'Back-End',
  '.js': 'Back-End',
  '.py': 'Back-End',
  '.jsx': 'Front-End',
  '.html': 'Front-End',
  '.css': 'Front-End',
  '.sql': 'Database',
  '.yaml': 'DevOps/CI',
  '.yml': 'DevOps/CI',
  '.sh': 'DevOps/CI',
  '.json': 'Configuration',
  '.md': 'Documentation',
  '.test.ts': 'Testing',
  '.test.tsx': 'Testing',
  '.spec.ts': 'Testing',
  '.spec.js': 'Testing',
  '.map': 'Build/Tooling',
  '.png': 'Assets',
  '.jpg': 'Assets',
};

const DEFAULT_FN_MAPPING: Record<string, string> = {
  'Dockerfile': 'DevOps/CI',
  '.gitignore': 'Configuration',
  'LICENSE': 'Documentation',
  'Makefile': 'Build/Tooling',
  'package.json': 'Build/Tooling',
  'vitest.config.ts': 'Testing',
  'jest.config.js': 'Testing',
};

describe('ArcComponentClassifier', () => {
  let classifier: ArcComponentClassifier;

  beforeEach(() => {
    classifier = new ArcComponentClassifier(DEFAULT_EXT_MAPPING, DEFAULT_FN_MAPPING);
  });

  // ==========================================================================
  // Extension-based classification
  // ==========================================================================

  describe('extension-based classification', () => {
    it('should classify .ts files as Back-End', () => {
      expect(classifier.classify('src/services/foo.ts', '.ts')).toBe('Back-End');
    });

    it('should classify .js files as Back-End', () => {
      expect(classifier.classify('lib/utils.js', '.js')).toBe('Back-End');
    });

    it('should classify .py files as Back-End', () => {
      expect(classifier.classify('scripts/main.py', '.py')).toBe('Back-End');
    });

    it('should classify .jsx files as Front-End', () => {
      expect(classifier.classify('components/Button.jsx', '.jsx')).toBe('Front-End');
    });

    it('should classify .html files as Front-End', () => {
      expect(classifier.classify('views/index.html', '.html')).toBe('Front-End');
    });

    it('should classify .css files as Front-End', () => {
      expect(classifier.classify('styles/main.css', '.css')).toBe('Front-End');
    });

    it('should classify .sql files as Database', () => {
      expect(classifier.classify('migrations/001.sql', '.sql')).toBe('Database');
    });

    it('should classify .yaml files as DevOps/CI', () => {
      expect(classifier.classify('.github/workflows/ci.yaml', '.yaml')).toBe('DevOps/CI');
    });

    it('should classify .json files as Configuration', () => {
      expect(classifier.classify('config/settings.json', '.json')).toBe('Configuration');
    });

    it('should classify .md files as Documentation', () => {
      expect(classifier.classify('docs/README.md', '.md')).toBe('Documentation');
    });

    it('should classify .map files as Build/Tooling', () => {
      expect(classifier.classify('dist/bundle.js.map', '.map')).toBe('Build/Tooling');
    });

    it('should classify .png files as Assets', () => {
      expect(classifier.classify('media/icon.png', '.png')).toBe('Assets');
    });
  });

  // ==========================================================================
  // Filename-based classification (priority over extension)
  // ==========================================================================

  describe('filename-based classification', () => {
    it('should classify Dockerfile as DevOps/CI (filename match)', () => {
      expect(classifier.classify('docker/Dockerfile', '')).toBe('DevOps/CI');
    });

    it('should classify .gitignore as Configuration (filename match)', () => {
      expect(classifier.classify('.gitignore', '')).toBe('Configuration');
    });

    it('should classify LICENSE as Documentation (filename match)', () => {
      expect(classifier.classify('LICENSE', '')).toBe('Documentation');
    });

    it('should classify Makefile as Build/Tooling (filename match)', () => {
      expect(classifier.classify('Makefile', '')).toBe('Build/Tooling');
    });

    it('should give filename match priority over extension match', () => {
      // package.json has filename mapping -> Build/Tooling
      // .json has extension mapping -> Configuration
      // Filename should win
      expect(classifier.classify('package.json', '.json')).toBe('Build/Tooling');
    });

    it('should give filename match priority for vitest.config.ts', () => {
      // vitest.config.ts -> Testing (filename), .ts -> Back-End (extension)
      expect(classifier.classify('vitest.config.ts', '.ts')).toBe('Testing');
    });

    it('should give filename match priority for jest.config.js', () => {
      expect(classifier.classify('jest.config.js', '.js')).toBe('Testing');
    });

    it('should match filename from full path', () => {
      expect(classifier.classify('some/deep/path/Dockerfile', '')).toBe('DevOps/CI');
    });
  });

  // ==========================================================================
  // Multi-dot extension matching (longest-match-first)
  // ==========================================================================

  describe('multi-dot extension matching', () => {
    it('should match .test.ts before .ts (longest-match-first)', () => {
      expect(classifier.classify('src/__tests__/foo.test.ts', '.ts')).toBe('Testing');
    });

    it('should match .test.tsx before other patterns', () => {
      expect(classifier.classify('src/components/Button.test.tsx', '.tsx')).toBe('Testing');
    });

    it('should match .spec.ts as Testing', () => {
      expect(classifier.classify('src/utils.spec.ts', '.ts')).toBe('Testing');
    });

    it('should match .spec.js as Testing', () => {
      expect(classifier.classify('src/helpers.spec.js', '.js')).toBe('Testing');
    });

    it('should match regular .ts when no multi-dot pattern matches', () => {
      expect(classifier.classify('src/services/main.ts', '.ts')).toBe('Back-End');
    });
  });

  // ==========================================================================
  // Case sensitivity
  // ==========================================================================

  describe('case sensitivity', () => {
    it('should match extensions case-insensitively', () => {
      expect(classifier.classify('README.MD', '.MD')).toBe('Documentation');
    });

    it('should match extensions case-insensitively (uppercase)', () => {
      expect(classifier.classify('STYLE.CSS', '.CSS')).toBe('Front-End');
    });

    it('should match filenames case-sensitively', () => {
      // "Dockerfile" matches, "dockerfile" does not
      expect(classifier.classify('Dockerfile', '')).toBe('DevOps/CI');
      expect(classifier.classify('dockerfile', '')).toBe('Other');
    });

    it('should match LICENSE case-sensitively', () => {
      expect(classifier.classify('LICENSE', '')).toBe('Documentation');
      expect(classifier.classify('license', '')).toBe('Other');
    });
  });

  // ==========================================================================
  // Default to "Other"
  // ==========================================================================

  describe('default to Other', () => {
    it('should default unknown extensions to Other', () => {
      expect(classifier.classify('file.xyz', '.xyz')).toBe('Other');
    });

    it('should default files with no extension and no filename match to Other', () => {
      expect(classifier.classify('randomfile', '')).toBe('Other');
    });

    it('should default files with null file_extension to Other when no other match', () => {
      expect(classifier.classify('unknownfile', null)).toBe('Other');
    });

    it('should default files with undefined file_extension to Other', () => {
      expect(classifier.classify('unknownfile', undefined)).toBe('Other');
    });

    it('should never return null or empty string', () => {
      const result = classifier.classify('', '');
      expect(result).toBeTruthy();
      expect(result).toBe('Other');
    });

    it('should classify git rename artifacts as Other', () => {
      expect(classifier.classify('file.ts}', '.ts}')).toBe('Other');
      expect(classifier.classify('file.disabled}', '.disabled}')).toBe('Other');
    });
  });

  // ==========================================================================
  // DB file_extension fallback
  // ==========================================================================

  describe('DB file_extension fallback', () => {
    it('should use DB file_extension when basename has no match', () => {
      // File with no extension in basename but DB says .ts
      const c = new ArcComponentClassifier(
        { '.ts': 'Back-End' },
        {},
      );
      expect(c.classify('somefile', '.ts')).toBe('Back-End');
    });

    it('should handle DB file_extension without dot prefix', () => {
      const c = new ArcComponentClassifier(
        { '.ts': 'Back-End' },
        {},
      );
      expect(c.classify('somefile', 'ts')).toBe('Back-End');
    });
  });

  // ==========================================================================
  // Category validation
  // ==========================================================================

  describe('category validation', () => {
    it('should accept all valid categories', () => {
      for (const cat of VALID_CATEGORIES) {
        expect(classifier.isValidCategory(cat)).toBe(true);
      }
    });

    it('should reject empty string', () => {
      expect(classifier.isValidCategory('')).toBe(false);
    });

    it('should reject category with script tags', () => {
      expect(classifier.isValidCategory('<script>alert(1)</script>')).toBe(false);
    });

    it('should reject category with special characters', () => {
      expect(classifier.isValidCategory('Cat@gory!')).toBe(false);
    });

    it('should accept category with spaces', () => {
      expect(classifier.isValidCategory('Custom Category')).toBe(true);
    });

    it('should accept category with forward slash', () => {
      expect(classifier.isValidCategory('DevOps/CI')).toBe(true);
    });

    it('should accept category with hyphen', () => {
      expect(classifier.isValidCategory('Build-Tooling')).toBe(true);
    });

    it('should skip invalid categories during construction', () => {
      const c = new ArcComponentClassifier(
        { '.ts': '<script>bad</script>', '.js': 'Back-End' },
        { 'Dockerfile': 'Valid Category' },
      );
      // .ts mapping should be skipped, .js should work
      expect(c.classify('file.ts', '.ts')).toBe('Other');
      expect(c.classify('file.js', '.js')).toBe('Back-End');
      expect(c.classify('Dockerfile', '')).toBe('Valid Category');
    });
  });

  // ==========================================================================
  // CATEGORY_NAME_REGEX
  // ==========================================================================

  describe('CATEGORY_NAME_REGEX', () => {
    it('should match valid category names', () => {
      expect(CATEGORY_NAME_REGEX.test('Front-End')).toBe(true);
      expect(CATEGORY_NAME_REGEX.test('Back-End')).toBe(true);
      expect(CATEGORY_NAME_REGEX.test('DevOps/CI')).toBe(true);
      expect(CATEGORY_NAME_REGEX.test('Build/Tooling')).toBe(true);
      expect(CATEGORY_NAME_REGEX.test('Other')).toBe(true);
    });

    it('should reject HTML', () => {
      expect(CATEGORY_NAME_REGEX.test('<b>Bold</b>')).toBe(false);
    });

    it('should reject special chars', () => {
      expect(CATEGORY_NAME_REGEX.test('cat;DROP TABLE')).toBe(false);
    });
  });

  // ==========================================================================
  // Checksum
  // ==========================================================================

  describe('getMappingChecksum', () => {
    it('should return consistent checksums for same mappings', () => {
      const c1 = new ArcComponentClassifier({ '.ts': 'Back-End' }, { 'Dockerfile': 'DevOps/CI' });
      const c2 = new ArcComponentClassifier({ '.ts': 'Back-End' }, { 'Dockerfile': 'DevOps/CI' });
      expect(c1.getMappingChecksum()).toBe(c2.getMappingChecksum());
    });

    it('should return different checksums for different mappings', () => {
      const c1 = new ArcComponentClassifier({ '.ts': 'Back-End' }, {});
      const c2 = new ArcComponentClassifier({ '.ts': 'Front-End' }, {});
      expect(c1.getMappingChecksum()).not.toBe(c2.getMappingChecksum());
    });

    it('should return a non-empty string', () => {
      const checksum = classifier.getMappingChecksum();
      expect(checksum).toBeTruthy();
      expect(typeof checksum).toBe('string');
    });
  });

  // ==========================================================================
  // Getter methods
  // ==========================================================================

  describe('getCategoryForExtension', () => {
    it('should return category for known extension', () => {
      expect(classifier.getCategoryForExtension('.ts')).toBe('Back-End');
    });

    it('should return undefined for unknown extension', () => {
      expect(classifier.getCategoryForExtension('.xyz')).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      expect(classifier.getCategoryForExtension('.TS')).toBe('Back-End');
    });
  });

  describe('getCategoryForFilename', () => {
    it('should return category for known filename', () => {
      expect(classifier.getCategoryForFilename('Dockerfile')).toBe('DevOps/CI');
    });

    it('should return undefined for unknown filename', () => {
      expect(classifier.getCategoryForFilename('unknown')).toBeUndefined();
    });

    it('should be case-sensitive', () => {
      expect(classifier.getCategoryForFilename('dockerfile')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty filename', () => {
      expect(classifier.classify('', '')).toBe('Other');
    });

    it('should handle filename with Windows-style backslash path', () => {
      expect(classifier.classify('src\\services\\foo.ts', '.ts')).toBe('Back-End');
    });

    it('should handle filename with multiple dots', () => {
      expect(classifier.classify('src/config.prod.json', '.json')).toBe('Configuration');
    });

    it('should handle file with only a dot', () => {
      expect(classifier.classify('.', '')).toBe('Other');
    });

    it('should handle deeply nested paths', () => {
      expect(classifier.classify('a/b/c/d/e/f/g/h/main.py', '.py')).toBe('Back-End');
    });

    it('should handle empty mappings', () => {
      const c = new ArcComponentClassifier({}, {});
      expect(c.classify('anything.ts', '.ts')).toBe('Other');
    });
  });
});
