/**
 * Claude API Configuration for VS Code Extension
 *
 * This file demonstrates how to integrate the GCP Claude API proxy
 * into your VS Code extension.
 *
 * Configuration Management:
 * - API endpoint URL stored in VS Code settings (workspace or user)
 * - API key stored in VS Code SecretStorage (encrypted, per-machine)
 * - Optional caching layer to reduce API calls and costs
 */

import * as vscode from 'vscode';

/**
 * Claude API Configuration Interface
 */
export interface ClaudeApiConfig {
    endpoint: string;
    timeout: number;
    retryAttempts: number;
    retryDelay: number;
    enableCaching: boolean;
    cacheExpirationDays: number;
}

/**
 * Get Claude API configuration from VS Code settings
 */
export function getClaudeApiConfig(): ClaudeApiConfig {
    const config = vscode.workspace.getConfiguration('gitr');

    return {
        endpoint: config.get<string>(
            'claudeApi.endpoint',
            'https://claude-proxy-gateway-production-xxxxx.apigateway.YOUR_PROJECT.cloud.goog/analyze'
        ),
        timeout: config.get<number>('claudeApi.timeout', 300000), // 5 minutes
        retryAttempts: config.get<number>('claudeApi.retryAttempts', 3),
        retryDelay: config.get<number>('claudeApi.retryDelay', 1000), // 1 second
        enableCaching: config.get<boolean>('claudeApi.enableCaching', true),
        cacheExpirationDays: config.get<number>('claudeApi.cacheExpirationDays', 7),
    };
}

/**
 * Claude API Request/Response Types
 */
export interface ClaudeAnalyzeRequest {
    filenames: string[];
    options?: {
        model?: string;
        max_tokens?: number;
    };
}

export interface ClaudeAnalyzeResponse {
    extensionMapping: Record<string, string>;
    filenameMapping: Record<string, string>;
    metadata: {
        processingTimeMs: number;
        filenameCount: number;
        model: string;
    };
}

/**
 * Claude API Client
 *
 * Handles communication with GCP Claude API proxy, including:
 * - API key management via SecretStorage
 * - Request retry logic with exponential backoff
 * - Response caching to reduce costs
 * - Error handling and user notifications
 */
export class ClaudeApiClient {
    private static readonly SECRET_KEY = 'gitr.claudeApiKey';
    private static readonly CACHE_KEY_PREFIX = 'gitr.claudeCache';

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {}

    /**
     * Check if API key is configured
     */
    async hasApiKey(): Promise<boolean> {
        const apiKey = await this.context.secrets.get(ClaudeApiClient.SECRET_KEY);
        return apiKey !== undefined;
    }

    /**
     * Prompt user to configure API key
     */
    async configureApiKey(): Promise<boolean> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Claude API key',
            placeHolder: 'API key from GCP admin',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API key cannot be empty';
                }
                return null;
            }
        });

        if (!apiKey) {
            return false;
        }

        // Store in SecretStorage (encrypted)
        await this.context.secrets.store(ClaudeApiClient.SECRET_KEY, apiKey.trim());

        // Validate by testing connection
        try {
            await this.testConnection();
            void vscode.window.showInformationMessage('Claude API key configured successfully!');
            return true;
        } catch (error) {
            // Remove invalid key
            await this.context.secrets.delete(ClaudeApiClient.SECRET_KEY);
            void vscode.window.showErrorMessage(`Invalid API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    /**
     * Test connection to Claude API proxy
     */
    private async testConnection(): Promise<void> {
        const config = getClaudeApiConfig();
        const healthUrl = config.endpoint.replace('/analyze', '/health');

        const response = await fetch(healthUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000) // 5 second timeout for health check
        });

        if (!response.ok) {
            throw new Error(`Health check failed: ${response.statusText}`);
        }

        const health = await response.json() as { status: string };
        if (health.status !== 'healthy') {
            throw new Error('Service is not healthy');
        }
    }

    /**
     * Analyze filenames using Claude API
     *
     * @param filenames - Array of unique filenames to analyze
     * @param useCache - Whether to use cached results (default: true)
     * @returns Extension and filename mappings
     */
    async analyzeFilenames(
        filenames: string[],
        useCache: boolean = true
    ): Promise<ClaudeAnalyzeResponse> {
        // Check cache first
        if (useCache) {
            const cached = await this.getCachedResult(filenames);
            if (cached) {
                this.outputChannel.appendLine('[Cache] Using cached result');
                return cached;
            }
        }

        // Get API key
        const apiKey = await this.context.secrets.get(ClaudeApiClient.SECRET_KEY);
        if (!apiKey) {
            throw new Error('Claude API key not configured. Run "GitR: Configure Claude API" first.');
        }

        // Make request with retry logic
        const config = getClaudeApiConfig();
        const result = await this.makeRequestWithRetry(apiKey, filenames, config);

        // Cache result
        if (config.enableCaching) {
            await this.cacheResult(filenames, result);
        }

        return result;
    }

    /**
     * Make API request with exponential backoff retry
     */
    private async makeRequestWithRetry(
        apiKey: string,
        filenames: string[],
        config: ClaudeApiConfig
    ): Promise<ClaudeAnalyzeResponse> {
        let lastError: Error | null = null;

        for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
            try {
                this.outputChannel.appendLine(`[Request] Attempt ${attempt}/${config.retryAttempts}`);

                const response = await fetch(config.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey,
                    },
                    body: JSON.stringify({
                        filenames: filenames,
                    } as ClaudeAnalyzeRequest),
                    signal: AbortSignal.timeout(config.timeout),
                });

                // Handle rate limiting
                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '3600');
                    throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(retryAfter / 3600)} hours.`);
                }

                // Handle authentication errors
                if (response.status === 401) {
                    // Clear invalid API key
                    await this.context.secrets.delete(ClaudeApiClient.SECRET_KEY);
                    throw new Error('Invalid API key. Please reconfigure.');
                }

                // Handle other errors
                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
                    throw new Error(`API error (${response.status}): ${error.error || 'Unknown error'}`);
                }

                // Success
                const result = await response.json() as ClaudeAnalyzeResponse;
                this.outputChannel.appendLine(`[Success] Processed ${result.metadata.filenameCount} filenames in ${result.metadata.processingTimeMs}ms`);
                return result;

            } catch (error) {
                lastError = error as Error;
                this.outputChannel.appendLine(`[Error] Attempt ${attempt} failed: ${lastError.message}`);

                // Don't retry on authentication or rate limit errors
                if (lastError.message.includes('Rate limit') || lastError.message.includes('Invalid API key')) {
                    throw lastError;
                }

                // Wait before retry (exponential backoff)
                if (attempt < config.retryAttempts) {
                    const delay = config.retryDelay * Math.pow(2, attempt - 1);
                    this.outputChannel.appendLine(`[Retry] Waiting ${delay}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        // All retries failed
        throw lastError || new Error('Unknown error');
    }

    /**
     * Get cached result for given filenames
     */
    private async getCachedResult(filenames: string[]): Promise<ClaudeAnalyzeResponse | null> {
        const config = getClaudeApiConfig();
        if (!config.enableCaching) {
            return null;
        }

        const cacheKey = this.getCacheKey(filenames);
        const cached = this.context.globalState.get<{
            result: ClaudeAnalyzeResponse;
            timestamp: number;
        }>(cacheKey);

        if (!cached) {
            return null;
        }

        // Check expiration
        const ageMs = Date.now() - cached.timestamp;
        const maxAgeMs = config.cacheExpirationDays * 24 * 60 * 60 * 1000;

        if (ageMs > maxAgeMs) {
            // Cache expired, delete it
            await this.context.globalState.update(cacheKey, undefined);
            return null;
        }

        return cached.result;
    }

    /**
     * Cache result for given filenames
     */
    private async cacheResult(filenames: string[], result: ClaudeAnalyzeResponse): Promise<void> {
        const cacheKey = this.getCacheKey(filenames);
        await this.context.globalState.update(cacheKey, {
            result,
            timestamp: Date.now(),
        });

        this.outputChannel.appendLine(`[Cache] Stored result for ${filenames.length} filenames`);
    }

    /**
     * Generate cache key from filenames
     */
    private getCacheKey(filenames: string[]): string {
        // Create deterministic hash from sorted filenames
        const sorted = [...filenames].sort();
        const hash = this.simpleHash(JSON.stringify(sorted));
        return `${ClaudeApiClient.CACHE_KEY_PREFIX}.${hash}`;
    }

    /**
     * Simple string hash function (for cache keys)
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Clear all cached results
     */
    async clearCache(): Promise<void> {
        const keys = this.context.globalState.keys();
        let clearedCount = 0;

        for (const key of keys) {
            if (key.startsWith(ClaudeApiClient.CACHE_KEY_PREFIX)) {
                await this.context.globalState.update(key, undefined);
                clearedCount++;
            }
        }

        this.outputChannel.appendLine(`[Cache] Cleared ${clearedCount} cached results`);
        void vscode.window.showInformationMessage(`Cleared ${clearedCount} cached Claude API results`);
    }
}

/**
 * Register Claude API commands
 */
export function registerClaudeApiCommands(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
): void {
    const client = new ClaudeApiClient(context, outputChannel);

    // Command: Configure API key
    context.subscriptions.push(
        vscode.commands.registerCommand('gitr.configureClaudeApi', async () => {
            await client.configureApiKey();
        })
    );

    // Command: Clear cache
    context.subscriptions.push(
        vscode.commands.registerCommand('gitr.clearClaudeCache', async () => {
            await client.clearCache();
        })
    );

    // Command: Test connection
    context.subscriptions.push(
        vscode.commands.registerCommand('gitr.testClaudeApi', async () => {
            if (!await client.hasApiKey()) {
                void vscode.window.showWarningMessage('Claude API key not configured. Please configure first.');
                return;
            }

            try {
                // Test with small payload
                const result = await client.analyzeFilenames(['test.txt'], false);
                void vscode.window.showInformationMessage(
                    `Claude API connection successful! Response time: ${result.metadata.processingTimeMs}ms`
                );
            } catch (error) {
                void vscode.window.showErrorMessage(
                    `Claude API test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        })
    );
}
