import * as vscode from 'vscode';
import { LoggerService } from '../logging/logger.js';

/**
 * Known secret key identifiers for the Gitr extension.
 * These keys are used to store and retrieve secrets from VS Code SecretStorage.
 * Maps from the legacy PropertiesReader.py + classified.properties approach
 * to VS Code's built-in encrypted secret storage.
 */
export const SecretKeys = {
  /** PostgreSQL database password */
  DATABASE_PASSWORD: 'gitrx.db.password',
  /** PostgreSQL migration user password (IQS-880) */
  MIGRATION_PASSWORD: 'gitrx.db.migration.password',
  /** Jira API token for authentication */
  JIRA_TOKEN: 'gitrx.jira.token',
  /** GitHub Personal Access Token */
  GITHUB_TOKEN: 'gitrx.github.token',
  /** Linear API key for authentication */
  LINEAR_TOKEN: 'gitrx.linear.token',
  /** Bitbucket Repository/Workspace Access Token (GITX-2) */
  BITBUCKET_TOKEN: 'gitrx.bitbucket.token',
} as const;

/**
 * Type representing valid secret key values.
 */
export type SecretKey = (typeof SecretKeys)[keyof typeof SecretKeys];

/**
 * Human-readable labels for each secret, used in prompts and messages.
 */
const SecretLabels: Record<SecretKey, string> = {
  [SecretKeys.DATABASE_PASSWORD]: 'Database Password',
  [SecretKeys.MIGRATION_PASSWORD]: 'Migration Database Password',
  [SecretKeys.JIRA_TOKEN]: 'Jira API Token',
  [SecretKeys.GITHUB_TOKEN]: 'GitHub Personal Access Token',
  [SecretKeys.LINEAR_TOKEN]: 'Linear API Token',
  [SecretKeys.BITBUCKET_TOKEN]: 'Bitbucket Access Token',
};

/**
 * Prompt placeholders for each secret type.
 */
const SecretPrompts: Record<SecretKey, string> = {
  [SecretKeys.DATABASE_PASSWORD]: 'Enter your PostgreSQL database password',
  [SecretKeys.MIGRATION_PASSWORD]: 'Enter the password for the migration database user',
  [SecretKeys.JIRA_TOKEN]: 'Enter your Jira API token',
  [SecretKeys.GITHUB_TOKEN]: 'Enter your GitHub personal access token',
  [SecretKeys.LINEAR_TOKEN]: 'Enter your Linear API key (starts with lin_api_)',
  [SecretKeys.BITBUCKET_TOKEN]: 'Enter your Bitbucket Repository or Workspace Access Token',
};

/**
 * Class name constant for structured logging context.
 */
const CLASS_NAME = 'SecretStorageService';

/**
 * Service wrapping VS Code's SecretStorage API for secure credential management.
 *
 * Replaces the legacy Python PropertiesReader.py + classified.properties approach.
 * All secrets are stored encrypted by VS Code's platform-specific credential store
 * (e.g., macOS Keychain, Windows Credential Locker, Linux libsecret).
 *
 * This service:
 * - Never logs secret values (only logs key names and operations)
 * - Prompts the user with password-masked input when setting secrets
 * - Offers to prompt the user when a required secret is not found
 * - Provides typed retrieval methods for each credential type
 */
export class SecretStorageService implements vscode.Disposable {
  private readonly logger: LoggerService;
  private readonly secretStorage: vscode.SecretStorage;

  /**
   * Session-level rate limiter for secret prompt dialogs.
   * Tracks which secret keys have already been prompted during this session
   * to prevent modal dialog spam from retry loops. (IQS-881)
   */
  private readonly promptedThisSession: Set<SecretKey> = new Set();

  /**
   * Create a new SecretStorageService.
   *
   * @param secretStorage - The VS Code SecretStorage instance from ExtensionContext.secrets
   */
  constructor(secretStorage: vscode.SecretStorage) {
    this.logger = LoggerService.getInstance();
    this.secretStorage = secretStorage;
    this.logger.debug(CLASS_NAME, 'constructor', 'SecretStorageService initialized');
  }

  /**
   * Retrieve the database password from secure storage.
   * If the secret is not set, prompts the user to enter it.
   *
   * @returns The database password, or undefined if the user cancels the prompt
   */
  async getDatabasePassword(): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'getDatabasePassword', 'Retrieving database password');
    return this.getSecretOrPrompt(SecretKeys.DATABASE_PASSWORD);
  }

  /**
   * Retrieve the migration database password from secure storage.
   * Returns undefined silently if not set (does NOT prompt), since this
   * credential is optional and falls back to the main database password. (IQS-880)
   *
   * @returns The migration password, or undefined if not configured
   */
  async getMigrationPassword(): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'getMigrationPassword', 'Retrieving migration database password');
    try {
      const value = await this.secretStorage.get(SecretKeys.MIGRATION_PASSWORD);
      if (value !== undefined) {
        this.logger.debug(CLASS_NAME, 'getMigrationPassword', 'Migration password found in SecretStorage');
      } else {
        this.logger.debug(CLASS_NAME, 'getMigrationPassword', 'No migration password configured (will fall back to main DB password)');
      }
      return value;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'getMigrationPassword', `Error retrieving migration password: ${message}`);
      return undefined;
    }
  }

  /**
   * Retrieve the Jira API token from secure storage.
   * If the secret is not set, prompts the user to enter it.
   *
   * @returns The Jira API token, or undefined if the user cancels the prompt
   */
  async getJiraToken(): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'getJiraToken', 'Retrieving Jira token');
    return this.getSecretOrPrompt(SecretKeys.JIRA_TOKEN);
  }

  /**
   * Retrieve the GitHub personal access token from secure storage.
   * If the secret is not set, prompts the user to enter it.
   *
   * @returns The GitHub PAT, or undefined if the user cancels the prompt
   */
  async getGitHubToken(): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'getGitHubToken', 'Retrieving GitHub token');
    return this.getSecretOrPrompt(SecretKeys.GITHUB_TOKEN);
  }

  /**
   * Retrieve the Linear API key from secure storage.
   * If the secret is not set, prompts the user to enter it.
   *
   * @returns The Linear API key, or undefined if the user cancels the prompt
   */
  async getLinearToken(): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'getLinearToken', 'Retrieving Linear API key');
    this.logger.info(CLASS_NAME, 'getLinearToken', 'Credential access: LINEAR_TOKEN requested');
    return this.getSecretOrPrompt(SecretKeys.LINEAR_TOKEN);
  }

  /**
   * Retrieve the Bitbucket access token from secure storage.
   * If the secret is not set, prompts the user to enter it.
   *
   * Supports:
   * - Bitbucket Cloud: Repository Access Tokens or Workspace Access Tokens
   * - Bitbucket Server/Data Center: Personal Access Tokens
   *
   * Note: App Passwords are deprecated for Bitbucket Cloud. Use access tokens instead.
   *
   * @returns The Bitbucket access token, or undefined if the user cancels the prompt
   * @ticket GITX-2
   */
  async getBitbucketToken(): Promise<string | undefined> {
    this.logger.debug(CLASS_NAME, 'getBitbucketToken', 'Retrieving Bitbucket access token');
    this.logger.info(CLASS_NAME, 'getBitbucketToken', 'Credential access: BITBUCKET_TOKEN requested');
    return this.getSecretOrPrompt(SecretKeys.BITBUCKET_TOKEN);
  }

  /**
   * Store a secret value in VS Code's secure storage.
   * Used by command handlers to persist user-provided credentials.
   *
   * @param key - The secret key identifier
   * @param value - The secret value to store (NEVER logged)
   */
  async storeSecret(key: SecretKey, value: string): Promise<void> {
    this.logger.debug(CLASS_NAME, 'storeSecret', `Storing secret for key '${key}'`);
    try {
      await this.secretStorage.store(key, value);
      this.logger.info(CLASS_NAME, 'storeSecret', `Secret stored successfully for key '${key}'`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'storeSecret', `Failed to store secret for key '${key}': ${message}`);
      throw error;
    }
  }

  /**
   * Delete a secret from VS Code's secure storage.
   *
   * @param key - The secret key identifier to delete
   */
  async deleteSecret(key: SecretKey): Promise<void> {
    this.logger.debug(CLASS_NAME, 'deleteSecret', `Deleting secret for key '${key}'`);
    try {
      await this.secretStorage.delete(key);
      this.logger.info(CLASS_NAME, 'deleteSecret', `Secret deleted for key '${key}'`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'deleteSecret', `Failed to delete secret for key '${key}': ${message}`);
      throw error;
    }
  }

  /**
   * Check whether a specific secret has been set.
   *
   * @param key - The secret key identifier to check
   * @returns true if the secret exists in storage
   */
  async hasSecret(key: SecretKey): Promise<boolean> {
    this.logger.trace(CLASS_NAME, 'hasSecret', `Checking existence of key '${key}'`);
    const value = await this.secretStorage.get(key);
    const exists = value !== undefined;
    this.logger.trace(CLASS_NAME, 'hasSecret', `Key '${key}' exists=${exists}`);
    return exists;
  }

  /**
   * Prompt the user to enter a secret value via a password-masked input box.
   * If the user provides a value, it is stored in SecretStorage.
   *
   * @param key - The secret key identifier
   * @returns The entered value, or undefined if the user cancelled
   */
  async promptAndStore(key: SecretKey): Promise<string | undefined> {
    const label = SecretLabels[key];
    const prompt = SecretPrompts[key];
    this.logger.debug(CLASS_NAME, 'promptAndStore', `Prompting user for '${label}'`);

    const value = await vscode.window.showInputBox({
      prompt,
      placeHolder: label,
      password: true,
      ignoreFocusOut: true,
      validateInput: (input: string) => {
        if (!input.trim()) {
          return `${label} cannot be empty`;
        }
        // Validate Linear API key format: must start with 'lin_api_'
        if (key === SecretKeys.LINEAR_TOKEN && !input.startsWith('lin_api_')) {
          return 'Linear API key must start with "lin_api_"';
        }
        return undefined;
      },
    });

    if (value === undefined) {
      this.logger.debug(CLASS_NAME, 'promptAndStore', `User cancelled prompt for '${label}'`);
      return undefined;
    }

    await this.storeSecret(key, value);
    void vscode.window.showInformationMessage(`Gitr: ${label} saved securely.`);
    return value;
  }

  /**
   * Dispose of resources held by this service.
   * Currently a no-op since SecretStorage is managed by VS Code,
   * but implements Disposable for consistent resource management.
   */
  dispose(): void {
    this.promptedThisSession.clear();
    this.logger.debug(CLASS_NAME, 'dispose', 'SecretStorageService disposed (session prompt cache cleared)');
  }

  /**
   * Retrieve a secret from storage, or prompt the user if not found.
   * When a secret is not set, shows a warning and asks the user whether
   * they want to set it now.
   *
   * @param key - The secret key identifier
   * @returns The secret value, or undefined if not set and user declines/cancels
   */
  private async getSecretOrPrompt(key: SecretKey): Promise<string | undefined> {
    const label = SecretLabels[key];
    this.logger.trace(CLASS_NAME, 'getSecretOrPrompt', `Looking up key '${key}'`);

    try {
      const value = await this.secretStorage.get(key);

      if (value !== undefined) {
        this.logger.debug(CLASS_NAME, 'getSecretOrPrompt', `Secret found for key '${key}'`);
        return value;
      }

      // Rate-limit prompts: only ask once per session per key (IQS-881)
      if (this.promptedThisSession.has(key)) {
        this.logger.debug(CLASS_NAME, 'getSecretOrPrompt', `Skipping prompt for '${key}' (already prompted this session)`);
        return undefined;
      }

      this.logger.debug(CLASS_NAME, 'getSecretOrPrompt', `No secret found for key '${key}', prompting user`);
      this.promptedThisSession.add(key);
      this.logger.debug(CLASS_NAME, 'getSecretOrPrompt', `Marked key '${key}' as prompted for this session`);

      const action = await vscode.window.showWarningMessage(
        `Gitr: ${label} is not configured. Would you like to set it now?`,
        'Set Now',
        'Cancel'
      );

      if (action === 'Set Now') {
        const storedValue = await this.promptAndStore(key);
        // If the user successfully stored a value, clear the rate-limit
        // so future retrievals can find it in storage (IQS-881)
        if (storedValue !== undefined) {
          this.promptedThisSession.delete(key);
          this.logger.debug(CLASS_NAME, 'getSecretOrPrompt', `Cleared rate-limit for '${key}' after successful store`);
        }
        return storedValue;
      }

      this.logger.debug(CLASS_NAME, 'getSecretOrPrompt', `User declined to set '${label}'`);
      return undefined;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(CLASS_NAME, 'getSecretOrPrompt', `Error retrieving secret for key '${key}': ${message}`);
      void vscode.window.showErrorMessage(
        `Gitr: Failed to access ${label}. Please try again.`
      );
      return undefined;
    }
  }
}
