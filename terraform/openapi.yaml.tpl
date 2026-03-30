# OpenAPI 3.0 specification for Claude API Gateway
# This template is rendered by Terraform with dynamic values

swagger: "2.0"
info:
  title: "${service_name} API"
  description: "Proxy API for Claude with authentication and rate limiting"
  version: "1.0.0"
host: "${service_name}-gateway-${environment}.apigateway.${project_id}.cloud.goog"
schemes:
  - "https"

# API Key security definition
securityDefinitions:
  api_key:
    type: "apiKey"
    name: "X-API-Key"
    in: "header"

# Global security requirement
security:
  - api_key: []

# Rate limiting quota configuration
x-google-management:
  metrics:
    - name: "request-count"
      valueType: INT64
      metricKind: DELTA
  quota:
    limits:
      - name: "requests-per-day-per-key"
        metric: "request-count"
        unit: "1/d/{api_key}"
        values:
          STANDARD: ${rate_limit}

paths:
  /analyze:
    post:
      summary: "Analyze filenames with Claude API"
      operationId: "analyzeFilenames"
      x-google-backend:
        address: "${function_url}"
        protocol: "h2"
        deadline: 300.0
      x-google-quota:
        metricCosts:
          request-count: 1
      consumes:
        - "application/json"
      produces:
        - "application/json"
      parameters:
        - in: body
          name: body
          description: "Payload containing array of filenames"
          required: true
          schema:
            type: object
            required:
              - filenames
            properties:
              filenames:
                type: array
                items:
                  type: string
                minItems: 1
                maxItems: 100000
                description: "Array of unique filenames to analyze"
              options:
                type: object
                description: "Optional processing options"
                properties:
                  model:
                    type: string
                    default: "claude-sonnet-4-5-20250929"
                    description: "Claude model to use"
                  max_tokens:
                    type: integer
                    default: 16000
                    description: "Maximum tokens in response"
      responses:
        200:
          description: "Successful response with mappings"
          schema:
            type: object
            properties:
              extensionMapping:
                type: object
                additionalProperties:
                  type: string
                description: "Map of file extensions to categories"
              filenameMapping:
                type: object
                additionalProperties:
                  type: string
                description: "Map of specific filenames to categories"
              metadata:
                type: object
                properties:
                  processingTimeMs:
                    type: integer
                  filenameCount:
                    type: integer
                  model:
                    type: string
        400:
          description: "Bad request - invalid payload"
          schema:
            type: object
            properties:
              error:
                type: string
              details:
                type: string
        401:
          description: "Unauthorized - invalid or missing API key"
          schema:
            type: object
            properties:
              error:
                type: string
        429:
          description: "Too many requests - rate limit exceeded"
          schema:
            type: object
            properties:
              error:
                type: string
              retryAfter:
                type: integer
                description: "Seconds until quota resets"
        500:
          description: "Internal server error"
          schema:
            type: object
            properties:
              error:
                type: string
        503:
          description: "Service unavailable - Claude API error"
          schema:
            type: object
            properties:
              error:
                type: string

  /health:
    get:
      summary: "Health check endpoint"
      operationId: "healthCheck"
      x-google-backend:
        address: "${function_url}/health"
        protocol: "h2"
        deadline: 5.0
      security: []  # No authentication required for health check
      responses:
        200:
          description: "Service is healthy"
          schema:
            type: object
            properties:
              status:
                type: string
                example: "healthy"
              timestamp:
                type: string
                format: date-time
