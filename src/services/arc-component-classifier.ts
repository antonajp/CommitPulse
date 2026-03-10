/**
 * Pure classification logic for mapping filenames and extensions
 * to architecture component categories.
 *
 * Classification priority:
 *   1. Filename match (case-sensitive)
 *   2. Extension match (case-insensitive, longest-match-first)
 *   3. Default: "Other" (never NULL)
 *
 * Ticket: IQS-885
 */

import { LoggerService } from '../logging/logger.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ArcComponentClassifier';

/**
 * Valid architecture component category names.
 * Category names must match the regex ^[a-zA-Z0-9 /-]+$ for XSS safety.
 */
export const VALID_CATEGORIES = [
  'Front-End',
  'Back-End',
  'Database',
  'DevOps/CI',
  'Configuration',
  'Documentation',
  'Testing',
  'Build/Tooling',
  'Assets',
  'Other',
] as const;

/**
 * Regex for validating category names before database writes.
 * Prevents potential XSS if values are displayed in webviews.
 * CWE-20: Input Validation.
 */
export const CATEGORY_NAME_REGEX = /^[a-zA-Z0-9 /-]+$/;

/**
 * Classifier for mapping files to architecture component categories.
 * Stateless pure logic — no database or I/O dependencies.
 */
export class ArcComponentClassifier {
  private readonly logger: LoggerService;

  /**
   * Extension mapping: normalized lowercase extension -> category.
   * Multi-dot extensions (e.g., `.test.tsx`) are sorted longest-first.
   */
  private readonly extensionMap: ReadonlyMap<string, string>;

  /**
   * Filename mapping: exact filename -> category (case-sensitive).
   */
  private readonly filenameMap: ReadonlyMap<string, string>;

  /**
   * Sorted extension keys, longest first, for longest-match-first logic.
   */
  private readonly sortedExtKeys: readonly string[];

  /**
   * Create a classifier with the given mappings.
   *
   * @param extensionMapping - Object mapping `.ext` -> category
   * @param filenameMapping - Object mapping filename -> category
   */
  constructor(
    extensionMapping: Readonly<Record<string, string>>,
    filenameMapping: Readonly<Record<string, string>>,
  ) {
    this.logger = LoggerService.getInstance();
    this.logger.debug(CLASS_NAME, 'constructor', 'ArcComponentClassifier created');

    // Build validated extension map (normalize keys to lowercase)
    const extMap = new Map<string, string>();
    for (const [ext, category] of Object.entries(extensionMapping)) {
      if (!this.isValidCategory(category)) {
        this.logger.warn(CLASS_NAME, 'constructor', `Invalid category "${category}" for extension "${ext}", skipping`);
        continue;
      }
      extMap.set(ext.toLowerCase(), category);
    }
    this.extensionMap = extMap;

    // Build validated filename map (case-sensitive keys)
    const fnMap = new Map<string, string>();
    for (const [filename, category] of Object.entries(filenameMapping)) {
      if (!this.isValidCategory(category)) {
        this.logger.warn(CLASS_NAME, 'constructor', `Invalid category "${category}" for filename "${filename}", skipping`);
        continue;
      }
      fnMap.set(filename, category);
    }
    this.filenameMap = fnMap;

    // Sort extension keys longest first for longest-match-first logic
    this.sortedExtKeys = [...extMap.keys()].sort((a, b) => b.length - a.length);

    this.logger.debug(
      CLASS_NAME,
      'constructor',
      `Loaded ${extMap.size} extension mappings, ${fnMap.size} filename mappings`,
    );
  }

  /**
   * Classify a single file into an architecture component category.
   *
   * Priority: filename match -> longest extension match -> "Other".
   *
   * @param filename - The full filename (may include path components)
   * @param fileExtension - The file extension from the database (may be null/empty)
   * @returns The architecture component category (never null)
   */
  classify(filename: string, fileExtension: string | null | undefined): string {
    // Extract the basename from the filename for filename matching
    const basename = this.extractBasename(filename);

    // Priority 1: Filename match (case-sensitive)
    const filenameCategory = this.filenameMap.get(basename);
    if (filenameCategory) {
      this.logger.trace(
        CLASS_NAME,
        'classify',
        `Filename match: "${basename}" -> "${filenameCategory}"`,
      );
      return filenameCategory;
    }

    // Priority 2: Extension match (case-insensitive, longest-match-first)
    // Use the full basename for multi-dot extension matching
    const lowerBasename = basename.toLowerCase();
    for (const extKey of this.sortedExtKeys) {
      if (lowerBasename.endsWith(extKey)) {
        const category = this.extensionMap.get(extKey)!;
        this.logger.trace(
          CLASS_NAME,
          'classify',
          `Extension match: "${basename}" (ext "${extKey}") -> "${category}"`,
        );
        return category;
      }
    }

    // Fallback: try the database-provided file_extension
    if (fileExtension) {
      const normalizedExt = fileExtension.startsWith('.')
        ? fileExtension.toLowerCase()
        : `.${fileExtension.toLowerCase()}`;
      const extCategory = this.extensionMap.get(normalizedExt);
      if (extCategory) {
        this.logger.trace(
          CLASS_NAME,
          'classify',
          `DB extension match: "${basename}" (db ext "${normalizedExt}") -> "${extCategory}"`,
        );
        return extCategory;
      }
    }

    // Default: "Other"
    this.logger.trace(
      CLASS_NAME,
      'classify',
      `No match for "${basename}" (ext: "${fileExtension ?? ''}"): defaulting to "Other"`,
    );
    return 'Other';
  }

  /**
   * Validate that a category name is safe for database storage and
   * potential webview display (CWE-20: Input Validation).
   *
   * @param category - The category name to validate
   * @returns true if the category name is valid
   */
  isValidCategory(category: string): boolean {
    if (!category || typeof category !== 'string') {
      return false;
    }
    return CATEGORY_NAME_REGEX.test(category);
  }

  /**
   * Compute a checksum of the current mappings for smart refresh comparison.
   * Uses a simple JSON-based hash so we can detect when mappings have changed.
   *
   * @returns A string checksum representing the current mapping state
   */
  getMappingChecksum(): string {
    const extEntries = [...this.extensionMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const fnEntries = [...this.filenameMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const raw = JSON.stringify({ ext: extEntries, fn: fnEntries });
    // Simple DJB2-style hash for fast comparison
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash + raw.charCodeAt(i)) & 0x7fffffff;
    }
    return hash.toString(36);
  }

  /**
   * Get the category for a specific extension key (used by smart refresh
   * to determine which rows need re-classification).
   *
   * @param ext - The extension key (lowercase, with dot prefix)
   * @returns The category, or undefined if not mapped
   */
  getCategoryForExtension(ext: string): string | undefined {
    return this.extensionMap.get(ext.toLowerCase());
  }

  /**
   * Get the category for a specific filename key (used by smart refresh).
   *
   * @param filename - The filename (case-sensitive)
   * @returns The category, or undefined if not mapped
   */
  getCategoryForFilename(filename: string): string | undefined {
    return this.filenameMap.get(filename);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Extract the basename (last path component) from a full file path.
   *
   * @param filePath - The full file path (e.g., "src/services/foo.ts")
   * @returns The basename (e.g., "foo.ts")
   */
  private extractBasename(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash >= 0) {
      return filePath.substring(lastSlash + 1);
    }
    const lastBackslash = filePath.lastIndexOf('\\');
    if (lastBackslash >= 0) {
      return filePath.substring(lastBackslash + 1);
    }
    return filePath;
  }
}
