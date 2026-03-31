import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { LoggerService } from '../logging/logger.js';
import { SecretStorageService, SecretKeys } from '../config/secret-storage.js';

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'ProEditionService';

/**
 * Maximum number of free tech stack refreshes allowed.
 * GITX-140: Freemium model - 3 free refreshes before paywall.
 */
export const FREE_REFRESH_LIMIT = 3;

/**
 * Stripe checkout URL for Pro subscription upgrade.
 * GITX-140: Placeholder URL - replace with actual Stripe checkout link.
 */
export const STRIPE_CHECKOUT_URL = 'https://buy.stripe.com/gitr-pro-upgrade';

/**
 * Features comparison page URL for "Learn More" action.
 * GITX-140: Placeholder URL - replace with actual features page.
 */
export const FEATURES_URL = 'https://gitr.dev/pro-features';

/**
 * Salt used for checksum computation.
 * GITX-140: Obfuscated but not truly secret (client-side).
 * This provides tamper detection, not tamper prevention.
 */
const CHECKSUM_SALT = 'gitrx-pro-2024-v1';

/**
 * Interface for the refresh counter data structure.
 * Stored in SecretStorage as JSON.
 *
 * GITX-140: Counter tracks tech stack refresh usage for freemium model.
 */
export interface RefreshCounter {
  /** Number of refreshes used (0-3 for free tier) */
  count: number;
  /** ISO timestamp of first refresh */
  firstUsedAt: string;
  /** ISO timestamp of most recent refresh */
  lastUsedAt: string;
  /** SHA-256 checksum for tamper detection */
  checksum: string;
}

/**
 * Result from canUseRefresh() check.
 *
 * GITX-140: Indicates whether user can proceed with refresh and why.
 */
export interface RefreshCheckResult {
  /** Whether user can proceed with the refresh */
  canProceed: boolean;
  /** Current refresh count (0 if Pro user) */
  currentCount: number;
  /** Remaining free refreshes (undefined if Pro) */
  remainingFree?: number;
  /** Whether user has Pro subscription */
  isPro: boolean;
  /** Reason if canProceed is false */
  reason?: 'limit_reached' | 'tampered';
}

/**
 * Service for managing Pro edition functionality.
 *
 * GITX-140: Implements freemium model with:
 * - 3 free tech stack refreshes
 * - Counter stored in SecretStorage with tamper-resistant checksum
 * - Stripe checkout URL integration for Pro upgrade
 * - Pro users bypass counter entirely
 *
 * Security notes:
 * - Counter is client-side and can be bypassed by determined users
 * - Checksum provides casual tamper detection, not prevention
 * - Server-side enforcement should be implemented for production
 */
export class ProEditionService implements vscode.Disposable {
  private readonly logger: LoggerService;
  private readonly secretStorage: SecretStorageService;

  /**
   * Create a new ProEditionService.
   *
   * @param secretStorage - SecretStorageService for counter and license key storage
   */
  constructor(secretStorage: SecretStorageService) {
    this.logger = LoggerService.getInstance();
    this.secretStorage = secretStorage;
    this.logger.debug(CLASS_NAME, 'constructor', 'ProEditionService initialized');
  }

  /**
   * Check if the user has a Pro subscription.
   *
   * GITX-140: Pro status is determined by presence of a valid license key.
   * A simple key presence check is used for MVP - server-side validation
   * should be added for production.
   *
   * @returns true if user has Pro subscription
   */
  async isProUser(): Promise<boolean> {
    this.logger.debug(CLASS_NAME, 'isProUser', 'Checking Pro subscription status');

    const licenseKey = await this.secretStorage.getSecret(SecretKeys.PRO_LICENSE_KEY);
    const isPro = licenseKey !== undefined && licenseKey.trim().length > 0;

    this.logger.debug(CLASS_NAME, 'isProUser', `Pro status: ${isPro ? 'PRO' : 'FREE'}`);
    return isPro;
  }

  /**
   * Get the current refresh counter value.
   *
   * GITX-140: Returns the counter from SecretStorage.
   * If counter doesn't exist, returns null (new user).
   * If checksum validation fails, returns null with warning logged.
   *
   * @returns RefreshCounter or null if not set or tampered
   */
  async getRefreshCount(): Promise<RefreshCounter | null> {
    this.logger.debug(CLASS_NAME, 'getRefreshCount', 'Retrieving refresh counter');

    const counterJson = await this.secretStorage.getSecret(SecretKeys.TECH_STACK_REFRESH_COUNT);
    if (!counterJson) {
      this.logger.debug(CLASS_NAME, 'getRefreshCount', 'No counter found - new user');
      return null;
    }

    try {
      const counter = JSON.parse(counterJson) as RefreshCounter;

      // Validate checksum
      if (!this.validateChecksum(counter)) {
        this.logger.warn(CLASS_NAME, 'getRefreshCount', 'Counter checksum validation failed - possible tampering');
        return null;
      }

      this.logger.debug(CLASS_NAME, 'getRefreshCount', `Counter retrieved: count=${counter.count}, lastUsedAt=${counter.lastUsedAt}`);
      return counter;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'getRefreshCount', `Failed to parse counter JSON: ${message}`);
      return null;
    }
  }

  /**
   * Initialize the refresh counter for a new user.
   *
   * GITX-140: Creates a new counter with count=0.
   * Called internally when first refresh is requested.
   *
   * @returns The initialized counter
   */
  async initializeCounter(): Promise<RefreshCounter> {
    this.logger.debug(CLASS_NAME, 'initializeCounter', 'Initializing new refresh counter');

    const now = new Date().toISOString();
    const counter: RefreshCounter = {
      count: 0,
      firstUsedAt: now,
      lastUsedAt: now,
      checksum: '',
    };

    // Compute and set checksum
    counter.checksum = this.computeChecksum(counter.count, counter.firstUsedAt, counter.lastUsedAt);

    await this.saveCounter(counter);
    this.logger.info(CLASS_NAME, 'initializeCounter', 'New refresh counter initialized');
    return counter;
  }

  /**
   * Increment the refresh counter after a successful refresh.
   *
   * GITX-140: Should only be called after the refresh API call completes successfully.
   * Creates counter if it doesn't exist.
   *
   * @returns The updated counter
   */
  async incrementRefreshCount(): Promise<RefreshCounter> {
    this.logger.debug(CLASS_NAME, 'incrementRefreshCount', 'Incrementing refresh counter');

    let counter = await this.getRefreshCount();
    if (!counter) {
      counter = await this.initializeCounter();
    }

    // Increment count and update timestamp
    counter.count += 1;
    counter.lastUsedAt = new Date().toISOString();
    counter.checksum = this.computeChecksum(counter.count, counter.firstUsedAt, counter.lastUsedAt);

    await this.saveCounter(counter);
    this.logger.info(CLASS_NAME, 'incrementRefreshCount', `Counter incremented to ${counter.count}`);
    return counter;
  }

  /**
   * Check if user can perform a refresh.
   *
   * GITX-140: Implements the paywall logic:
   * - Pro users: Always allowed (bypasses counter)
   * - Free users: Allowed if count < FREE_REFRESH_LIMIT
   * - Tampered counter: Blocked
   *
   * @returns RefreshCheckResult with canProceed and current state
   */
  async canUseRefresh(): Promise<RefreshCheckResult> {
    this.logger.debug(CLASS_NAME, 'canUseRefresh', 'Checking refresh eligibility');

    // Check Pro status first
    const isPro = await this.isProUser();
    if (isPro) {
      this.logger.debug(CLASS_NAME, 'canUseRefresh', 'Pro user - refresh allowed');
      return {
        canProceed: true,
        currentCount: 0,
        isPro: true,
      };
    }

    // Get current counter for free user
    const counter = await this.getRefreshCount();

    // Handle counter tamper detection
    if (counter === null) {
      // Could be new user OR tampered counter
      // Check if raw data exists but validation failed
      const rawCounter = await this.secretStorage.getSecret(SecretKeys.TECH_STACK_REFRESH_COUNT);
      if (rawCounter) {
        // Data exists but is invalid - likely tampered
        this.logger.warn(CLASS_NAME, 'canUseRefresh', 'Counter data exists but failed validation - blocking');
        return {
          canProceed: false,
          currentCount: 0,
          remainingFree: 0,
          isPro: false,
          reason: 'tampered',
        };
      }
      // New user - no counter yet
      this.logger.debug(CLASS_NAME, 'canUseRefresh', 'New user - refresh allowed (first use)');
      return {
        canProceed: true,
        currentCount: 0,
        remainingFree: FREE_REFRESH_LIMIT,
        isPro: false,
      };
    }

    // Check if under limit
    const remainingFree = FREE_REFRESH_LIMIT - counter.count;
    if (counter.count < FREE_REFRESH_LIMIT) {
      this.logger.debug(CLASS_NAME, 'canUseRefresh', `Free user with ${remainingFree} refreshes remaining - allowed`);
      return {
        canProceed: true,
        currentCount: counter.count,
        remainingFree,
        isPro: false,
      };
    }

    // Limit reached
    this.logger.debug(CLASS_NAME, 'canUseRefresh', 'Free refresh limit reached - blocked');
    return {
      canProceed: false,
      currentCount: counter.count,
      remainingFree: 0,
      isPro: false,
      reason: 'limit_reached',
    };
  }

  /**
   * Get remaining free refreshes count.
   *
   * GITX-140: Convenience method for UI display.
   *
   * @returns Number of remaining free refreshes (0 if Pro or limit reached)
   */
  async getRemainingRefreshes(): Promise<number> {
    const result = await this.canUseRefresh();
    return result.remainingFree ?? 0;
  }

  /**
   * Show the upgrade prompt when free limit is reached.
   *
   * GITX-140: Shows VS Code information message with upgrade options:
   * - "Upgrade to Pro" - Opens Stripe checkout
   * - "Learn More" - Opens features page
   * - "Not Now" - Dismisses
   *
   * @returns true if user chose to proceed (Pro), false otherwise
   */
  async showUpgradePrompt(): Promise<boolean> {
    this.logger.info(CLASS_NAME, 'showUpgradePrompt', 'Showing upgrade prompt to user');

    const action = await vscode.window.showInformationMessage(
      'Gitr: You\'ve used all 3 free tech stack refreshes. Upgrade to Pro for unlimited AI-powered analysis.',
      'Upgrade to Pro',
      'Learn More',
      'Not Now'
    );

    if (action === 'Upgrade to Pro') {
      this.logger.info(CLASS_NAME, 'showUpgradePrompt', 'User selected Upgrade to Pro - opening Stripe checkout');
      await vscode.env.openExternal(vscode.Uri.parse(STRIPE_CHECKOUT_URL));
      return false; // Don't proceed with command - user needs to complete purchase
    }

    if (action === 'Learn More') {
      this.logger.info(CLASS_NAME, 'showUpgradePrompt', 'User selected Learn More - opening features page');
      await vscode.env.openExternal(vscode.Uri.parse(FEATURES_URL));
      return false;
    }

    this.logger.info(CLASS_NAME, 'showUpgradePrompt', 'User selected Not Now or dismissed prompt');
    return false; // "Not Now" also blocks command execution
  }

  /**
   * Show remaining count in the confirmation dialog.
   *
   * GITX-140: Returns message to display in confirmation dialog.
   *
   * @param remaining - Number of remaining free refreshes
   * @returns Message string for display
   */
  formatRemainingMessage(remaining: number): string {
    if (remaining === 1) {
      return 'This is your last free refresh.';
    }
    return `You have ${remaining} free refresh${remaining === 1 ? '' : 'es'} remaining.`;
  }

  /**
   * Compute SHA-256 checksum for counter validation.
   *
   * GITX-140: Checksum includes count, timestamps, and salt.
   * Uses first 16 characters of hex digest for compact storage.
   *
   * @param count - Current counter value
   * @param firstUsedAt - First usage timestamp
   * @param lastUsedAt - Last usage timestamp
   * @returns 16-character hex checksum
   */
  computeChecksum(count: number, firstUsedAt: string, lastUsedAt: string): string {
    const data = `${count}|${firstUsedAt}|${lastUsedAt}|${CHECKSUM_SALT}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Validate counter checksum.
   *
   * GITX-140: Detects casual tampering attempts.
   *
   * @param counter - Counter to validate
   * @returns true if checksum is valid
   */
  validateChecksum(counter: RefreshCounter): boolean {
    const expected = this.computeChecksum(counter.count, counter.firstUsedAt, counter.lastUsedAt);
    const isValid = counter.checksum === expected;
    this.logger.trace(CLASS_NAME, 'validateChecksum', `Checksum validation: ${isValid ? 'PASS' : 'FAIL'}`);
    return isValid;
  }

  /**
   * Save counter to SecretStorage.
   *
   * @param counter - Counter to save
   */
  private async saveCounter(counter: RefreshCounter): Promise<void> {
    const json = JSON.stringify(counter);
    await this.secretStorage.storeSecret(SecretKeys.TECH_STACK_REFRESH_COUNT, json);
    this.logger.trace(CLASS_NAME, 'saveCounter', 'Counter saved to SecretStorage');
  }

  /**
   * Reset the refresh counter (for testing/support purposes).
   *
   * GITX-140: Clears the counter from SecretStorage.
   * This should only be used for testing or support scenarios.
   */
  async resetCounter(): Promise<void> {
    this.logger.info(CLASS_NAME, 'resetCounter', 'Resetting refresh counter');
    await this.secretStorage.deleteSecret(SecretKeys.TECH_STACK_REFRESH_COUNT);
  }

  /**
   * Dispose of resources held by this service.
   */
  dispose(): void {
    this.logger.debug(CLASS_NAME, 'dispose', 'ProEditionService disposed');
  }
}
