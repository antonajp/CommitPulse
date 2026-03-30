# Architecture Documentation - Claude API Proxy

## System Overview

This document provides detailed architecture documentation for the GCP-based Claude API proxy serving the GitR VS Code extension.

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    VS Code Extension (GitR)                       │  │
│  │                                                                   │  │
│  │  - User workspace analysis                                       │  │
│  │  - File collection (5K-50K filenames)                           │  │
│  │  - API key stored in SecretStorage (encrypted)                  │  │
│  │  - Local caching layer (7-day TTL)                              │  │
│  │  - Retry logic with exponential backoff                         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ HTTPS POST
                             │ Header: X-API-Key: <user-api-key>
                             │ Body: {"filenames": [...]}
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      GCP INFRASTRUCTURE                                 │
│                         Region: us-central1                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                    API Gateway                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐ │   │
│  │  │ OpenAPI 3.0 Specification                                 │ │   │
│  │  │ - Endpoints: /analyze, /health                            │ │   │
│  │  │ - Security: API key validation (X-API-Key header)         │ │   │
│  │  │ - Rate limiting: 100 requests/day per key                 │ │   │
│  │  │ - Quota enforcement: Reject at limit                      │ │   │
│  │  │ - Request validation: Schema enforcement                  │ │   │
│  │  └──────────────────────────────────────────────────────────┘ │   │
│  │                                                                 │   │
│  │  Rate Limiting Configuration:                                  │   │
│  │  - Metric: request-count                                       │   │
│  │  - Unit: 1/d/{api_key} (per key, per day)                     │   │
│  │  - Limit: Configurable (default: 100)                         │   │
│  │  - Response: 429 Too Many Requests + Retry-After header       │   │
│  └────────────────────────┬───────────────────────────────────────┘   │
│                           │ Validated request forwarded                │
│                           ▼                                             │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │              Cloud Function Gen 2 (claude-proxy)                │   │
│  │  ┌──────────────────────────────────────────────────────────┐ │   │
│  │  │ Runtime Configuration                                     │ │   │
│  │  │ - Runtime: Node.js 20                                     │ │   │
│  │  │ - Memory: 512 MB                                          │ │   │
│  │  │ - CPU: 0.333 GHz (allocated with memory)                 │ │   │
│  │  │ - Timeout: 300 seconds (5 minutes)                        │ │   │
│  │  │ - Concurrency: 80 requests/instance                       │ │   │
│  │  │ - Min instances: 0 (cold start on first request)          │ │   │
│  │  │ - Max instances: 10 (auto-scaling)                        │ │   │
│  │  │ - Ingress: ALLOW_INTERNAL_AND_GCLB (API Gateway only)     │ │   │
│  │  └──────────────────────────────────────────────────────────┘ │   │
│  │                                                                 │   │
│  │  Request Processing Pipeline:                                  │   │
│  │  1. Validate request body (array of filenames)                │   │
│  │  2. Fetch Claude API key from Secret Manager (cached)         │   │
│  │  3. Construct Claude API prompt                               │   │
│  │  4. Call Anthropic Claude API                                 │   │
│  │  5. Parse JSON response                                       │   │
│  │  6. Return structured mappings                                │   │
│  │                                                                 │   │
│  │  Observability:                                                │   │
│  │  - Structured JSON logging (Cloud Logging)                    │   │
│  │  - Request metrics (Cloud Monitoring)                         │   │
│  │  - Distributed tracing (Cloud Trace)                          │   │
│  │  - Error reporting (Error Reporting)                          │   │
│  └────────────┬────────────────────────────┬────────────────────────┘ │
│               │                             │                          │
│               │ Fetch secret               │ Call Claude API          │
│               ▼                             ▼                          │
│  ┌─────────────────────────┐   ┌──────────────────────────────────┐  │
│  │   Secret Manager        │   │  Anthropic Claude API             │  │
│  │                         │   │  (External Service)               │  │
│  │ - Claude API key        │   │                                   │  │
│  │ - Auto-rotation support │   │  Model: claude-sonnet-4-5         │  │
│  │ - Version history       │   │  Input: Filename array + prompt   │  │
│  │ - IAM-based access      │   │  Output: JSON mappings            │  │
│  │ - Audit logging         │   │                                   │  │
│  └─────────────────────────┘   │  Token Pricing:                   │  │
│                                 │  - Input: $3.00/MTok              │  │
│                                 │  - Output: $15.00/MTok            │  │
│                                 └──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                    SUPPORTING SERVICES                                  │
│                                                                          │
│  Cloud Monitoring         Cloud Logging         IAM & Security          │
│  - Dashboards            - Structured logs      - Service accounts      │
│  - Alerting policies     - Log-based metrics    - Least privilege       │
│  - SLO tracking          - 30-day retention     - Audit logs            │
│                                                                          │
│  Cloud Storage           Budget Alerts          VPC (Optional)          │
│  - Function source       - Cost thresholds      - Private networking    │
│  - Terraform state       - Email/SMS alerts     - Firewall rules        │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. VS Code Extension (Client)

**Purpose**: User interface for repository analysis with Claude AI

**Key Features**:
- Collects filenames from workspace
- Manages API key securely in VS Code SecretStorage
- Implements client-side caching (7-day TTL)
- Handles retries with exponential backoff
- Provides user feedback on progress and errors

**Configuration**:
```typescript
{
  endpoint: "https://API-GATEWAY-URL/analyze",
  timeout: 300000,  // 5 minutes
  retryAttempts: 3,
  enableCaching: true,
  cacheExpirationDays: 7
}
```

**Security**:
- API key stored in OS-level encrypted storage (SecretStorage)
- Never logged or exposed in UI
- HTTPS-only communication

### 2. API Gateway

**Purpose**: Entry point for all API requests with authentication and rate limiting

**Technology**: GCP API Gateway (managed service)

**Configuration**: OpenAPI 3.0 specification

**Key Features**:

#### Authentication
- API key validation (X-API-Key header)
- Keys managed via `gcloud alpha services api-keys`
- Per-key quotas and restrictions

#### Rate Limiting
```yaml
x-google-management:
  quota:
    limits:
      - name: "requests-per-day-per-key"
        metric: "request-count"
        unit: "1/d/{api_key}"
        values:
          STANDARD: 100  # Configurable
```

#### Endpoints

**POST /analyze**
- Accepts filename array
- Enforces schema validation
- Returns Claude analysis

**GET /health**
- No authentication required
- Returns service status
- Used for monitoring

**Error Responses**:
- 400: Bad request (invalid payload)
- 401: Unauthorized (invalid API key)
- 429: Too Many Requests (rate limit)
- 500: Internal server error
- 503: Service unavailable (Claude API down)

### 3. Cloud Function Gen 2

**Purpose**: Serverless compute for Claude API proxy logic

**Technology**: Cloud Functions Gen 2 (built on Cloud Run)

**Runtime**: Node.js 20

**Memory Allocation**:
```
512 MB memory → 0.333 GHz CPU
```

**Scaling Configuration**:
```
Min instances: 0 (cold start optimization)
Max instances: 10
Concurrency: 80 requests/instance
```

**Cold Start Performance**:
- First request after idle: ~2-3 seconds
- Subsequent requests: <100ms overhead
- Frequency: ~10% of requests (with min=0)

**Request Flow**:

1. **Input Validation**
   - Check filenames array exists
   - Validate array length (1-100,000)
   - Ensure all entries are strings

2. **Secret Retrieval** (cached per container)
   ```typescript
   const [version] = await secretClient.accessSecretVersion({
     name: `projects/${PROJECT}/secrets/claude-api-key/versions/latest`
   });
   ```

3. **Claude API Call**
   - Construct prompt with filenames
   - Set max_tokens (default: 16,000)
   - Send to Claude API with timeout

4. **Response Processing**
   - Extract text content
   - Parse JSON from response
   - Validate structure
   - Add metadata (processing time, token usage)

5. **Error Handling**
   - Validation errors → 400
   - Claude API errors → 503
   - Timeout errors → 504
   - Unexpected errors → 500

**Logging**:
```json
{
  "level": "info",
  "message": "Request completed successfully",
  "requestId": "abc123",
  "durationMs": 2543,
  "extensionCount": 15,
  "filenameCount": 5000,
  "timestamp": "2026-03-29T12:00:00Z"
}
```

### 4. Secret Manager

**Purpose**: Secure storage for Claude API key

**Configuration**:
```
Secret: claude-api-key-production
Replication: Automatic (all regions)
Access: IAM-based (function service account only)
```

**Rotation**:
```bash
# Manual rotation
echo -n "NEW_KEY" | gcloud secrets versions add claude-api-key-production --data-file=-

# Function cache cleared on next cold start
```

**Access Pattern**:
- Fetched once per container lifecycle
- Cached in function memory
- Average 1 fetch per 100-500 requests

### 5. IAM & Security

**Service Account**: `claude-proxy-production-sa@PROJECT.iam.gserviceaccount.com`

**Permissions** (Least Privilege):
```
roles/secretmanager.secretAccessor  # Access Claude API key
roles/logging.logWriter              # Write logs
roles/monitoring.metricWriter        # Write metrics
roles/cloudtrace.agent               # Write traces
```

**Security Features**:
- No public endpoints (API Gateway only)
- Ingress: `ALLOW_INTERNAL_AND_GCLB`
- Secrets never in environment variables or code
- Audit logs for all secret access
- API keys managed centrally

### 6. Observability

#### Cloud Logging

**Log Types**:
- Request logs (all requests)
- Error logs (failures only)
- Audit logs (IAM, secret access)

**Retention**: 30 days (default)

**Query Examples**:
```sql
-- All errors in last hour
resource.type="cloud_function"
resource.labels.function_name="claude-proxy-production"
severity>=ERROR
timestamp>"2026-03-29T11:00:00Z"

-- High latency requests
resource.type="cloud_function"
jsonPayload.durationMs>30000
```

#### Cloud Monitoring

**Auto-Metrics** (no code changes):
- `cloudfunctions.googleapis.com/function/execution_count`
- `cloudfunctions.googleapis.com/function/execution_times`
- `cloudfunctions.googleapis.com/function/active_instances`
- `cloudfunctions.googleapis.com/function/user_memory_bytes`

**Custom Metrics** (optional):
- Token usage per request
- Cache hit rate
- File count distribution

**Alerting Policies**:

1. **Error Rate Alert**
   - Condition: Error rate > 5% over 5 minutes
   - Action: Email notification
   - Auto-close: 30 minutes

2. **High Latency Alert**
   - Condition: P95 latency > 30 seconds
   - Action: Email notification
   - Auto-close: 30 minutes

#### Dashboards

**Key Metrics to Display**:
- Request rate (req/min)
- Success rate (%)
- P50/P95/P99 latency
- Active instances
- Error rate by type
- Cost per request

### 7. Networking

**Current Configuration**: Public internet

```
VS Code Extension → API Gateway (HTTPS) → Cloud Function → Claude API
```

**Optional: Private Networking** (for enhanced security):

```
VS Code Extension → Cloud VPN/Interconnect → VPC → API Gateway → Cloud Function
```

**Benefits**:
- Traffic never leaves Google network
- Enhanced security for enterprise
- Lower latency (potentially)

**Trade-offs**:
- Additional setup complexity
- Higher cost (~$50/month for VPN)
- Requires on-premises VPN gateway

## Request/Response Flow

### Successful Request

```
1. User triggers analysis in VS Code
   └─> Extension collects 5,000 filenames

2. Extension checks cache
   └─> Cache miss (first time)

3. Extension makes HTTPS POST to API Gateway
   └─> Headers: X-API-Key, Content-Type: application/json
   └─> Body: {"filenames": [...5000 items...]}
   └─> Timeout: 300 seconds

4. API Gateway validates request
   └─> Check API key: Valid
   └─> Check quota: 45/100 requests used today
   └─> Validate schema: Passed
   └─> Forward to Cloud Function

5. Cloud Function starts (cold start: ~2s)
   └─> Validate request body: OK
   └─> Fetch Claude API key from Secret Manager (cached): 50ms
   └─> Construct prompt with 5,000 filenames

6. Call Claude API
   └─> Model: claude-sonnet-4-5-20250929
   └─> Input tokens: ~8,000
   └─> Processing time: 20 seconds
   └─> Output tokens: ~3,000

7. Parse Claude response
   └─> Extract extensionMapping: 25 entries
   └─> Extract filenameMapping: 10 entries
   └─> Add metadata

8. Return to API Gateway
   └─> Status: 200
   └─> Body: JSON with mappings + metadata

9. API Gateway returns to extension
   └─> Total time: ~22 seconds

10. Extension caches result
    └─> Cache key: hash(sorted filenames)
    └─> Expiration: 7 days
    └─> Display results to user
```

### Failed Request (Rate Limit)

```
1. User triggers analysis (101st request today)

2. Extension makes HTTPS POST to API Gateway

3. API Gateway validates quota
   └─> Check: 100/100 requests used today
   └─> Action: Reject request
   └─> Response: 429 Too Many Requests
   └─> Header: Retry-After: 43200 (12 hours)

4. Extension receives 429
   └─> Parse Retry-After header
   └─> Show user: "Rate limit exceeded. Try again in 12 hours."
   └─> Log error to output channel
```

## Scaling Characteristics

### Horizontal Scaling (Instances)

**Configuration**: Auto-scaling based on request load

```
Min instances: 0
Max instances: 10
Concurrency: 80 requests/instance

Formula:
Active instances = ceil(concurrent_requests / 80)

Examples:
- 10 concurrent requests → 1 instance
- 100 concurrent requests → 2 instances
- 500 concurrent requests → 7 instances
- 800 concurrent requests → 10 instances (max)
```

**Cold Start Impact**:
```
If min_instances = 0:
  First request after idle → +2-3s latency
  Subsequent requests → Normal latency

If min_instances = 1:
  All requests → Normal latency
  Additional cost: ~$40/month
```

### Vertical Scaling (Memory)

**Current**: 512 MB memory

**Scaling Options**:
```
256 MB → 0.167 GHz CPU → 50% cheaper, 30% slower
512 MB → 0.333 GHz CPU → Balanced (current)
1 GB  → 0.583 GHz CPU → 2x cost, 10% faster
2 GB  → 1.000 GHz CPU → 4x cost, 15% faster
```

**Recommendation**: Keep at 512 MB unless profiling shows need

### Request Throughput

**Single Instance Capacity**:
```
Concurrency: 80 requests
Avg request time: 25 seconds
Throughput: 80 / 25 = 3.2 req/sec per instance
```

**Max Cluster Capacity**:
```
Max instances: 10
Max throughput: 10 * 3.2 = 32 req/sec
Max daily: 32 * 86400 = 2.76M requests/day
```

**Practical Limits** (with rate limiting):
```
Users: 500
Rate limit: 100 req/day per user
Max daily: 500 * 100 = 50K requests/day
Peak throughput: ~5-10 req/sec (well within capacity)
```

## Cost Model

### Cost Breakdown (3,000 requests/month)

```
GCP Services:
- API Gateway:      $3.00  (minimum charge)
- Cloud Functions:  $0.35  (invocations, CPU, memory)
- Secret Manager:   $0.32  (storage + access)
- Cloud Storage:    $0.05  (function source)
- Cloud Logging:    $0.00  (under 50 GB free tier)
- Cloud Monitoring: $0.00  (under 150 MB free tier)
Total GCP:          $3.72/month

External Services:
- Claude API:       Variable (token-based)
  * Input tokens:   24M * $3.00/MTok = $72.00
  * Output tokens:  9M * $15.00/MTok = $135.00
  Total Claude:     $207.00/month

Grand Total:        $210.72/month
```

### Cost Optimization

**With Caching (70% cache hit rate)**:
```
Actual Claude API calls: 3,000 * 0.30 = 900/month
Claude cost: 900/3000 * $207 = $62.10
Total: $65.82/month (69% savings)
```

**With Model Tiering** (Haiku for small requests):
```
< 1K filenames → Haiku (70% of requests): $2.00
> 1K filenames → Sonnet (30% of requests): $62.00
Total: $64.00/month (69% savings)
```

**Combined Optimizations**:
```
Caching (70%) + Model tiering + Right-sizing
Estimated: $25-35/month (85% savings)
```

## Disaster Recovery

### Backup Strategy

**State Management**:
- Terraform state: Versioned in Cloud Storage
- Claude API key: Versioned in Secret Manager
- Function code: Git repository

**Recovery Scenarios**:

1. **Function Deletion**
   ```bash
   terraform apply  # Recreates function
   ```

2. **Secret Deletion**
   ```bash
   # Restore from version history
   gcloud secrets versions access VERSION --secret=claude-api-key-production
   ```

3. **Complete Infrastructure Loss**
   ```bash
   # Full rebuild from Terraform
   terraform init
   terraform apply
   # RTO: ~10 minutes
   ```

### High Availability

**Current Configuration**:
- Regional deployment (us-central1)
- Auto-scaling with health checks
- API Gateway: Managed HA (99.95% SLA)
- Cloud Functions: Managed HA (99.95% SLA)

**SLA**:
```
Combined availability: 99.95% * 99.95% = 99.90%
Max downtime per month: ~43 minutes
```

**Multi-Region** (optional for 99.99%):
```
Deploy identical infrastructure in:
- us-central1 (primary)
- us-east1 (failover)

Use Cloud Load Balancer for automatic failover
Additional cost: 2x infrastructure + LB
```

## Security Considerations

### Threat Model

**Threats Mitigated**:
- ✅ API key theft (keys in SecretStorage, HTTPS-only)
- ✅ Rate limit bypass (enforced at API Gateway)
- ✅ Unauthorized access (API key required)
- ✅ Secret exposure (Secret Manager, never in logs)
- ✅ MITM attacks (HTTPS with certificate pinning)

**Residual Risks**:
- ⚠️ Compromised user machine (API key could be extracted)
- ⚠️ Insider threat (GCP admin access)
- ⚠️ Claude API key theft (requires GCP project access)

### Security Hardening

**Current**:
- Least privilege IAM
- Private function ingress
- Audit logging enabled
- Secrets in Secret Manager

**Additional Options**:

1. **VPC Service Controls** (prevent data exfiltration)
   ```bash
   gcloud access-context-manager perimeters create claude-proxy \
     --resources=projects/PROJECT_ID \
     --restricted-services=cloudfunctions.googleapis.com
   ```

2. **Binary Authorization** (verify function integrity)
   ```bash
   # Require signed container images
   gcloud container binauthz policy import policy.yaml
   ```

3. **API Key Restrictions** (limit to specific IPs/services)
   ```bash
   gcloud alpha services api-keys update KEY_ID \
     --restrictions=http-referrers=https://vscode-extension-domain
   ```

## Monitoring & Alerting

### Key Performance Indicators

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Success rate | > 99% | < 98% |
| P95 latency | < 30s | > 45s |
| Error rate | < 1% | > 5% |
| Cost per request | < $0.10 | > $0.20 |
| Cache hit rate | > 60% | < 40% |

### Alert Configuration

**Error Rate Alert**:
```bash
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="Claude Proxy Error Rate" \
  --condition-threshold-value=0.05 \
  --condition-threshold-duration=300s
```

**Budget Alert**:
```bash
gcloud billing budgets create \
  --billing-account=ACCOUNT_ID \
  --display-name="Claude Proxy Budget" \
  --budget-amount=100USD \
  --threshold-rule=percent=90
```

## Future Enhancements

### Near-Term (1-3 months)

1. **Batch Request Support**
   - Combine multiple small requests
   - Reduce overhead and cost
   - Implementation: Queue + batch processor

2. **Enhanced Caching**
   - Semantic caching (similar requests)
   - Shared cache across users
   - Implementation: Redis via Memorystore

3. **Usage Analytics Dashboard**
   - Per-user token usage
   - Cost breakdown
   - Trend analysis

### Long-Term (3-6 months)

1. **Multi-Region Deployment**
   - Active-active architecture
   - Global load balancing
   - 99.99% availability

2. **Model Router**
   - Automatic model selection
   - Cost optimization
   - A/B testing framework

3. **Self-Service Portal**
   - User API key management
   - Usage reports
   - Billing integration

## Appendices

### A. Terraform Resources Created

```
google_project_service (9x)               # Enable APIs
google_storage_bucket                     # Function source
google_storage_bucket_object              # Function source archive
google_service_account                    # Function SA
google_secret_manager_secret              # Claude API key
google_secret_manager_secret_version      # Claude API key value
google_secret_manager_secret_iam_member   # SA access to secret
google_cloudfunctions2_function           # Main function
google_cloud_run_service_iam_member       # Allow invocations
google_api_gateway_api                    # API definition
google_api_gateway_api_config             # OpenAPI config
google_api_gateway_gateway                # Gateway instance
google_monitoring_alert_policy (2x)       # Error rate, latency alerts
```

### B. Required GCP APIs

```
cloudfunctions.googleapis.com
cloudbuild.googleapis.com
apigateway.googleapis.com
servicemanagement.googleapis.com
servicecontrol.googleapis.com
secretmanager.googleapis.com
run.googleapis.com
logging.googleapis.com
monitoring.googleapis.com
```

### C. Useful Commands

**View logs**:
```bash
gcloud functions logs read claude-proxy-production --region=us-central1 --limit=50
```

**Test endpoint**:
```bash
curl -X POST https://API-GATEWAY-URL/analyze \
  -H "X-API-Key: YOUR-KEY" \
  -H "Content-Type: application/json" \
  -d '{"filenames":["test.ts"]}'
```

**Monitor costs**:
```bash
gcloud billing projects describe PROJECT_ID --format="value(billingAccountName)"
```

**Create API key**:
```bash
gcloud alpha services api-keys create --display-name="User: name@example.com"
```
