/**
 * Cloud Function Gen 2 - Claude API Proxy
 *
 * Receives filename arrays from VS Code extension via API Gateway,
 * forwards to Claude API, and returns structured mappings.
 *
 * Security:
 * - API Gateway handles API key authentication
 * - Claude API key stored in Secret Manager
 * - No secrets in code or environment variables (except secret name)
 *
 * Observability:
 * - Structured JSON logging
 * - Request/response metrics
 * - Error tracking with context
 */

import { HttpFunction } from '@google-cloud/functions-framework';
import Anthropic from '@anthropic-ai/sdk';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Environment configuration
const NODE_ENV = process.env.NODE_ENV || 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const CLAUDE_API_SECRET_NAME = process.env.CLAUDE_API_SECRET_NAME;

if (!CLAUDE_API_SECRET_NAME) {
  throw new Error('CLAUDE_API_SECRET_NAME environment variable is required');
}

// Secret Manager client (reused across invocations)
const secretClient = new SecretManagerServiceClient();

// Cache for Claude API key (fetched once per container lifecycle)
let claudeApiKeyCache: string | null = null;

/**
 * Logger with structured output
 */
const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (LOG_LEVEL === 'debug') {
      console.log(JSON.stringify({ level: 'debug', message, ...meta, timestamp: new Date().toISOString() }));
    }
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
  },
  error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error?.message,
      stack: error?.stack,
      ...meta,
      timestamp: new Date().toISOString()
    }));
  }
};

/**
 * Fetch Claude API key from Secret Manager
 */
async function getClaudeApiKey(): Promise<string> {
  if (claudeApiKeyCache) {
    logger.debug('Using cached Claude API key');
    return claudeApiKeyCache;
  }

  try {
    logger.info('Fetching Claude API key from Secret Manager', {
      secretName: CLAUDE_API_SECRET_NAME
    });

    const [version] = await secretClient.accessSecretVersion({
      name: `projects/${process.env.GCP_PROJECT}/secrets/${CLAUDE_API_SECRET_NAME}/versions/latest`
    });

    const payload = version.payload?.data?.toString();
    if (!payload) {
      throw new Error('Secret payload is empty');
    }

    claudeApiKeyCache = payload;
    logger.info('Claude API key fetched successfully');
    return payload;

  } catch (error) {
    logger.error('Failed to fetch Claude API key', error as Error);
    throw new Error('Failed to retrieve API credentials');
  }
}

/**
 * Input validation
 */
interface AnalyzeRequest {
  filenames: string[];
  options?: {
    model?: string;
    max_tokens?: number;
  };
}

function validateRequest(body: unknown): AnalyzeRequest {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be a JSON object');
  }

  const req = body as Partial<AnalyzeRequest>;

  if (!Array.isArray(req.filenames)) {
    throw new Error('filenames must be an array');
  }

  if (req.filenames.length === 0) {
    throw new Error('filenames array cannot be empty');
  }

  if (req.filenames.length > 100000) {
    throw new Error('filenames array exceeds maximum size of 100,000 entries');
  }

  // Validate all entries are strings
  if (!req.filenames.every(f => typeof f === 'string')) {
    throw new Error('All filenames must be strings');
  }

  return {
    filenames: req.filenames,
    options: {
      model: req.options?.model || 'claude-sonnet-4-5-20250929',
      max_tokens: req.options?.max_tokens || 16000
    }
  };
}

/**
 * Call Claude API with filename analysis prompt
 */
async function analyzeFilenames(
  client: Anthropic,
  filenames: string[],
  options: { model: string; max_tokens: number }
): Promise<{ extensionMapping: Record<string, string>; filenameMapping: Record<string, string> }> {

  const prompt = `You are analyzing a repository's file structure. Given the following list of ${filenames.length} unique filenames, create two mappings:

1. **extensionMapping**: Map file extensions to their primary category (e.g., ".ts" -> "TypeScript", ".py" -> "Python")
2. **filenameMapping**: Map specific configuration or special filenames to categories (e.g., "package.json" -> "Node.js Config", "Dockerfile" -> "Docker")

Filenames:
${filenames.slice(0, 50000).join('\n')}

Return ONLY a valid JSON object with this exact structure:
{
  "extensionMapping": {
    ".ts": "TypeScript",
    ".js": "JavaScript"
  },
  "filenameMapping": {
    "package.json": "Node.js Config",
    "Dockerfile": "Docker"
  }
}`;

  logger.info('Calling Claude API', {
    model: options.model,
    maxTokens: options.max_tokens,
    filenameCount: filenames.length
  });

  const startTime = Date.now();

  try {
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.max_tokens,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const durationMs = Date.now() - startTime;

    logger.info('Claude API response received', {
      durationMs,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason
    });

    // Extract text content
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }

    // Parse JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in Claude response');
    }

    const result = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!result.extensionMapping || !result.filenameMapping) {
      throw new Error('Invalid response structure from Claude');
    }

    return result;

  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('Claude API call failed', error as Error, { durationMs });
    throw error;
  }
}

/**
 * Health check endpoint
 */
function handleHealthCheck(res: any): void {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  });
}

/**
 * Main HTTP handler
 */
export const claudeProxy: HttpFunction = async (req, res) => {
  const requestId = req.headers['x-request-id'] || Math.random().toString(36).substring(7);
  const startTime = Date.now();

  logger.info('Request received', {
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent']
  });

  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  // Health check endpoint
  if (req.path === '/health' && req.method === 'GET') {
    handleHealthCheck(res);
    return;
  }

  // Only POST allowed for /analyze
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Validate request body
    const validatedRequest = validateRequest(req.body);

    logger.debug('Request validated', {
      requestId,
      filenameCount: validatedRequest.filenames.length,
      model: validatedRequest.options?.model
    });

    // Get Claude API key
    const claudeApiKey = await getClaudeApiKey();
    const anthropic = new Anthropic({ apiKey: claudeApiKey });

    // Call Claude API
    const result = await analyzeFilenames(
      anthropic,
      validatedRequest.filenames,
      validatedRequest.options!
    );

    const durationMs = Date.now() - startTime;

    logger.info('Request completed successfully', {
      requestId,
      durationMs,
      extensionCount: Object.keys(result.extensionMapping).length,
      filenameCount: Object.keys(result.filenameMapping).length
    });

    // Return response
    res.status(200).json({
      extensionMapping: result.extensionMapping,
      filenameMapping: result.filenameMapping,
      metadata: {
        processingTimeMs: durationMs,
        filenameCount: validatedRequest.filenames.length,
        model: validatedRequest.options?.model
      }
    });

  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof Error) {
      // Validation errors
      if (error.message.includes('must be') || error.message.includes('cannot be')) {
        logger.warn('Validation error', { requestId, error: error.message, durationMs });
        res.status(400).json({ error: error.message });
        return;
      }

      // Claude API errors
      if (error.message.includes('Claude')) {
        logger.error('Claude API error', error, { requestId, durationMs });
        res.status(503).json({ error: 'Claude API unavailable', details: error.message });
        return;
      }
    }

    // Generic server error
    logger.error('Unexpected error', error as Error, { requestId, durationMs });
    res.status(500).json({ error: 'Internal server error' });
  }
};
