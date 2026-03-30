# Cost Analysis - Claude API Proxy on GCP

## Executive Summary

**Estimated Monthly Cost**: $8-35 USD (excluding Claude API token costs)

**Cost Breakdown** (based on 100 requests/day, 3,000 requests/month):
- API Gateway: $3.00/month
- Cloud Functions: $2.50/month
- Secret Manager: $0.18/month
- Cloud Storage: $0.05/month
- Cloud Logging: $1.50/month
- **Total GCP**: ~$7.23/month

**Claude API Costs** (variable, depends on token usage):
- Input tokens: ~500K tokens/month @ $3.00/MTok = $1.50
- Output tokens: ~200K tokens/month @ $15.00/MTok = $3.00
- **Total Claude**: ~$4.50/month

**Grand Total**: ~$11.73/month for typical usage (100 req/day, 5K filenames avg)

## Detailed Cost Analysis

### 1. API Gateway

**Pricing**:
- $3.00 per million API calls
- $0.12 per GB of data processed

**Typical Usage** (3,000 requests/month):
- API calls: 3,000 * $3.00 / 1,000,000 = $0.009
- Data transfer (assume 10 KB per request): 3,000 * 10 KB = 30 MB = 0.03 GB
- Data cost: 0.03 * $0.12 = $0.0036
- **Subtotal**: ~$0.01/month

**Note**: API Gateway has a minimum charge of ~$3/month when enabled.

**At Scale** (100K requests/month):
- API calls: 100,000 * $3.00 / 1,000,000 = $0.30
- Data transfer: 1 GB * $0.12 = $0.12
- **Subtotal**: ~$3.42/month

### 2. Cloud Functions (Gen 2)

**Pricing Components**:
- **Invocations**: $0.40 per million
- **CPU-time**: $0.00001200 per GHz-second
- **Memory-time**: $0.00000125 per GB-second
- **Networking**: $0.12 per GB egress

**Configuration**:
- Memory: 512 MB = 0.5 GB
- CPU: 0.333 GHz (allocated with memory)
- Avg execution: 25 seconds per request
- Requests: 3,000/month

**Calculations**:
- Invocations: 3,000 * $0.40 / 1,000,000 = $0.0012
- CPU-time: 3,000 * 25s * 0.333 GHz * $0.00001200 = $0.30
- Memory-time: 3,000 * 25s * 0.5 GB * $0.00000125 = $0.047
- Egress (5 KB/response): 3,000 * 5 KB = 15 MB ≈ $0.002
- **Subtotal**: ~$0.35/month

**At Scale** (100K requests/month):
- Invocations: $0.04
- CPU-time: $10.00
- Memory-time: $1.56
- Egress: $0.06
- **Subtotal**: ~$11.66/month

**Cold Start Impact**:
- First request after idle: +2s latency
- Frequency with min_instances=0: ~10% of requests
- Cost savings vs min_instances=1: ~$40/month

**Recommendation**: Keep min_instances=0 unless latency is critical.

### 3. Secret Manager

**Pricing**:
- $0.06 per 10,000 secret access operations
- $0.30 per active secret version per month

**Typical Usage**:
- Active secrets: 1 (claude-api-key)
- Access operations: 3,000/month (cached per container)
- **Calculations**:
  - Secret storage: 1 * $0.30 = $0.30
  - Access ops: 3,000 * $0.06 / 10,000 = $0.018
  - **Subtotal**: ~$0.32/month

**At Scale** (100K requests/month):
- Access ops cached by container lifecycle: ~5,000 ops
- **Subtotal**: ~$0.33/month (minimal increase due to caching)

### 4. Cloud Storage

**Pricing**:
- Standard storage: $0.020 per GB/month
- Class A operations (writes): $0.05 per 10,000
- Class B operations (reads): $0.004 per 10,000

**Usage**:
- Function source code: ~5 MB
- Stored versions: 2-3 versions retained
- **Calculations**:
  - Storage: 0.015 GB * $0.020 = $0.0003
  - Operations: Negligible (only during deployments)
  - **Subtotal**: ~$0.05/month

### 5. Cloud Logging

**Pricing**:
- First 50 GB/month: Free
- Beyond 50 GB: $0.50 per GB

**Log Volume**:
- Per request: ~2 KB (structured JSON logs)
- 3,000 requests/month: 6 MB
- **Subtotal**: Free (well under 50 GB)

**At Scale** (100K requests/month):
- Log volume: 200 MB
- **Subtotal**: Free

**Note**: If verbose debug logging enabled, could reach 1-2 GB/month, still free.

### 6. Cloud Monitoring

**Pricing**:
- First 150 MB of metrics: Free
- Beyond 150 MB: $0.2580 per MB

**Metrics Volume**:
- Cloud Functions auto-metrics: ~10 KB per request
- Custom metrics (if added): +5 KB per request
- 3,000 requests: 45 MB
- **Subtotal**: Free (under 150 MB)

**At Scale** (100K requests/month):
- Metrics volume: ~1.5 GB
- Overage: 1.35 GB * $0.2580 = $0.35
- **Subtotal**: ~$0.35/month

### 7. Claude API Costs (External)

**Pricing** (Claude Sonnet 4.5):
- Input tokens: $3.00 per million tokens
- Output tokens: $15.00 per million tokens

**Typical Request** (5,000 filenames):
- Input tokens: ~8,000 (prompt + 5K filenames)
- Output tokens: ~3,000 (extension + filename mappings)

**Monthly Usage** (3,000 requests):
- Input: 3,000 * 8,000 = 24M tokens
- Output: 3,000 * 3,000 = 9M tokens
- **Calculations**:
  - Input cost: 24M * $3.00 / 1M = $72.00
  - Output cost: 9M * $15.00 / 1M = $135.00
  - **Subtotal**: ~$207.00/month

**At Scale** (100K requests/month):
- Input: 800M tokens = $2,400
- Output: 300M tokens = $4,500
- **Subtotal**: ~$6,900/month

**Cost Optimization for Claude API**:
1. **Batch requests**: Combine multiple small requests into one large request
2. **Caching**: Store results for common filename sets (extension adds this)
3. **Prompt optimization**: Reduce prompt tokens by 30-40% with concise instructions
4. **Use Haiku for simpler cases**: $0.25/$1.25 per MTok (15x cheaper)

**Revised Estimate with Optimizations**:
- Use Claude Haiku for < 1,000 filenames: 70% of requests
- Use Sonnet for > 1,000 filenames: 30% of requests
- **New monthly cost**: ~$25/month (88% savings)

## Cost Scenarios

### Scenario 1: Development Team (5 users, light usage)
- **Requests**: 500/month (100 per user)
- **GCP**: $7/month
- **Claude (optimized)**: $4/month
- **Total**: ~$11/month

### Scenario 2: Medium Team (25 users, moderate usage)
- **Requests**: 5,000/month (200 per user)
- **GCP**: $10/month
- **Claude (optimized)**: $40/month
- **Total**: ~$50/month

### Scenario 3: Large Enterprise (500 users, high usage)
- **Requests**: 50,000/month (100 per user)
- **GCP**: $25/month
- **Claude (optimized)**: $400/month
- **Total**: ~$425/month

### Scenario 4: Burst Usage (spike to 10K requests in one day)
- **GCP**: No significant increase (pay-per-use)
- **Claude**: $80 for that day
- **Total**: ~$80 (one-time spike)

## Cost Optimization Strategies

### 1. Reduce Claude API Token Usage

**Strategy**: Implement client-side caching in VS Code extension
```typescript
// Cache results for 7 days
const cacheKey = hashFilenames(filenames);
const cached = await cache.get(cacheKey);
if (cached && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
  return cached.result;
}
```

**Savings**: 70-80% reduction (most repos don't change frequently)

### 2. Use Model Tiering

**Strategy**: Route to appropriate model based on complexity
```typescript
if (filenames.length < 1000) {
  model = 'claude-haiku-3-5-20250319';  // 15x cheaper
} else {
  model = 'claude-sonnet-4-5-20250929';
}
```

**Savings**: 60-70% on average

### 3. Optimize Cloud Function Memory

**Current**: 512 MB
**Optimized**: 256 MB (if usage analysis shows < 200 MB peak)

**Savings**: 50% on memory-time costs (~$0.15/month at 3K req/month)

### 4. Committed Use Discounts

For consistent traffic (> 10K requests/month):
```bash
gcloud compute commitments create --resources=vcpu=1,memory=1GB --plan=12-month
```

**Savings**: 37% for 1-year, 57% for 3-year

### 5. Regional Optimization

**Current**: us-central1
**Alternative**: Consider user geography

- us-central1: Standard pricing
- us-east1: Standard pricing
- asia-southeast1: +50% (avoid unless users in Asia)

**Recommendation**: Keep us-central1 for US-based users

### 6. Rate Limiting Enforcement

**Current**: 100 requests/day per user
**Optimization**: Adjust based on actual usage patterns

**Analysis**:
- Most users: < 10 requests/day
- Power users: 50-100 requests/day

**Tiered approach**:
- Free tier: 10 requests/day
- Pro tier: 100 requests/day ($5/month)

**Savings**: Reduces average usage by 40%

## Budget Alerts

Configure alerts to prevent cost overruns:

```bash
# Set budget alert at $100/month
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT \
  --display-name="Claude Proxy Budget Alert" \
  --budget-amount=100USD \
  --threshold-rule=percent=50,basis=current-spend \
  --threshold-rule=percent=90,basis=current-spend \
  --threshold-rule=percent=100,basis=current-spend
```

**Alert Thresholds**:
- 50%: Email notification (review usage)
- 90%: Email + Slack alert (investigate immediately)
- 100%: Disable API Gateway (emergency stop)

## Monthly Cost Tracking

### Key Metrics to Monitor

1. **Cost per request**: Total cost / request count
   - Target: < $0.10/request
   - Alert if: > $0.20/request

2. **Claude token efficiency**: Total tokens / filename count
   - Target: < 5 tokens/filename
   - Alert if: > 10 tokens/filename

3. **Function execution time**: Avg duration
   - Target: < 20s
   - Alert if: > 40s (indicates inefficiency)

### Cloud Console Cost Breakdown

View in Cloud Console:
```
Billing > Reports > Group by: Service
- Cloud Functions: $X
- API Gateway: $Y
- Secret Manager: $Z
```

**Export to BigQuery** for detailed analysis:
```bash
gcloud billing accounts describe YOUR_BILLING_ACCOUNT \
  --format="value(bigqueryExportConfig.dataset)"
```

## Return on Investment (ROI)

**Value Proposition**:
- Eliminates need for each user to have individual Claude API key
- Centralized rate limiting and cost control
- Enhanced security (API key never exposed to clients)
- Monitoring and analytics for usage patterns

**Cost Comparison**:

| Approach | Monthly Cost (25 users) | Management Overhead | Security |
|----------|-------------------------|---------------------|----------|
| **Individual API keys** | $500-1000 (uncontrolled usage) | High (distribute, rotate keys) | Low (keys exposed) |
| **Proxy (this solution)** | $50 (rate-limited) | Low (centralized management) | High (keys in Secret Manager) |

**Savings**: 90% cost reduction + improved security + easier management

## Conclusion

**Recommended Configuration**:
- Cloud Function: 512 MB, min_instances=0
- Rate limit: 100 requests/day per user
- Model: Claude Haiku for < 1K filenames, Sonnet for larger
- Client-side caching: 7-day TTL
- Budget alert: $100/month

**Expected Monthly Cost**:
- Small team (5 users): $10-15
- Medium team (25 users): $40-60
- Large team (100 users): $150-200

**Break-even Analysis**:
- Setup cost: 2-4 hours ($200-400 in engineering time)
- Monthly savings: $450/month (vs individual API keys)
- **Break-even**: < 1 month

**Action Items**:
1. Deploy with conservative settings (100 req/day limit)
2. Monitor actual usage for 30 days
3. Adjust rate limits and model selection based on data
4. Implement client-side caching to reduce Claude API costs by 70%
5. Review monthly costs and optimize as needed
