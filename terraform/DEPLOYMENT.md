# Claude API Proxy - GCP Deployment Guide

## Architecture Summary

Production-ready GCP deployment with API Gateway for authentication, Cloud Function Gen 2 for serverless compute, and Secret Manager for credential storage.

**Components**:
- **API Gateway**: API key validation, rate limiting (100 req/day per key), OpenAPI spec
- **Cloud Function Gen 2**: Node.js 20, 512MB memory, 300s timeout, auto-scaling (0-10 instances)
- **Secret Manager**: Stores Claude API key with automatic rotation support
- **Cloud Monitoring**: Error rate and latency alerts
- **IAM**: Least privilege service accounts

**Region**: us-central1

## Prerequisites

1. **GCP Project**:
   - Active GCP project with billing enabled
   - Project ID noted

2. **Required Tools**:
   ```bash
   # gcloud CLI
   gcloud version  # Should be 400.0.0+

   # Terraform
   terraform version  # Should be 1.5.0+

   # Node.js (for Cloud Function development)
   node --version  # Should be 20.x
   ```

3. **GCP Authentication**:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   gcloud auth application-default login
   ```

4. **Claude API Key**:
   - Obtain from https://console.anthropic.com/
   - Should start with `sk-ant-api03-`

## Initial Setup

### 1. Create Terraform State Bucket

```bash
# Create bucket for Terraform remote state
export PROJECT_ID="your-gcp-project-id"
gsutil mb -p ${PROJECT_ID} -l us-central1 gs://${PROJECT_ID}-terraform-state

# Enable versioning
gsutil versioning set on gs://${PROJECT_ID}-terraform-state
```

### 2. Configure Terraform Variables

```bash
cd terraform

# Copy example variables
cp variables.tfvars.example terraform.tfvars

# Edit with your values
nano terraform.tfvars
```

**terraform.tfvars**:
```hcl
project_id         = "your-gcp-project-id"
region             = "us-central1"
environment        = "production"
rate_limit_per_day = 100

# DO NOT commit this file with real secrets!
# Better: Use environment variable
# export TF_VAR_claude_api_key="sk-ant-api03-..."
```

### 3. Initialize Terraform

```bash
cd terraform

# Initialize (downloads providers, configures backend)
terraform init

# Validate configuration
terraform validate

# Preview changes
terraform plan
```

## Deployment

### Full Infrastructure Deployment

```bash
cd terraform

# Set Claude API key as environment variable (recommended)
export TF_VAR_claude_api_key="sk-ant-api03-YOUR-KEY-HERE"

# Deploy all infrastructure
terraform apply

# Confirm with 'yes' when prompted
```

**Expected deployment time**: 5-10 minutes

**Outputs** (save these):
```
api_gateway_url = "claude-proxy-gateway-production-xxxxx.apigateway.YOUR_PROJECT.cloud.goog"
function_url = "https://us-central1-YOUR_PROJECT.cloudfunctions.net/claude-proxy-production"
```

### Generate API Keys for Users

API Gateway requires API keys for authentication. Create keys for each user/environment:

```bash
# Create API key for a user
gcloud alpha services api-keys create \
  --display-name="VS Code Extension - User 1" \
  --project=${PROJECT_ID}

# List all keys
gcloud alpha services api-keys list --project=${PROJECT_ID}

# Get key value (share with user securely)
gcloud alpha services api-keys get-key-string projects/${PROJECT_ID}/locations/global/keys/YOUR_KEY_ID
```

**Security**: Distribute API keys securely (never via email or chat). Users should store in VS Code SecretStorage.

## Verification

### 1. Health Check

```bash
API_GATEWAY_URL="YOUR_API_GATEWAY_URL_FROM_OUTPUT"

# Should return {"status":"healthy"}
curl https://${API_GATEWAY_URL}/health
```

### 2. Test with API Key

```bash
API_KEY="YOUR_GENERATED_API_KEY"

# Test analyze endpoint
curl -X POST https://${API_GATEWAY_URL}/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{
    "filenames": [
      "src/index.ts",
      "package.json",
      "README.md",
      "Dockerfile"
    ]
  }'
```

**Expected response**:
```json
{
  "extensionMapping": {
    ".ts": "TypeScript",
    ".json": "JSON",
    ".md": "Markdown"
  },
  "filenameMapping": {
    "package.json": "Node.js Config",
    "Dockerfile": "Docker"
  },
  "metadata": {
    "processingTimeMs": 2543,
    "filenameCount": 4,
    "model": "claude-sonnet-4-5-20250929"
  }
}
```

### 3. Test Rate Limiting

```bash
# Make 101 requests quickly (should hit rate limit on 101st)
for i in {1..101}; do
  curl -X POST https://${API_GATEWAY_URL}/analyze \
    -H "X-API-Key: ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"filenames":["test.txt"]}' \
    -w "\nStatus: %{http_code}\n"
done
```

Expected: First 100 succeed (200), 101st returns 429 (Too Many Requests).

## Monitoring

### View Logs

```bash
# Cloud Function logs
gcloud functions logs read claude-proxy-production \
  --region=us-central1 \
  --limit=50

# API Gateway logs
gcloud logging read "resource.type=api AND resource.labels.service=claude-proxy-api-production" \
  --limit=50 \
  --format=json
```

### Cloud Console Dashboards

1. **Cloud Functions**: https://console.cloud.google.com/functions
   - Invocation count, error rate, execution time
   - Active instances, memory usage

2. **API Gateway**: https://console.cloud.google.com/api-gateway
   - Request count, latency percentiles
   - Error rates by status code

3. **Monitoring**: https://console.cloud.google.com/monitoring
   - Pre-configured alerts for error rate and latency
   - Custom dashboards for business metrics

### Key Metrics to Monitor

- **Request success rate**: Should be > 99%
- **P95 latency**: Should be < 30s for typical payloads
- **Error rate**: Alert if > 5% over 5 minutes
- **Cold start frequency**: Monitor for user experience impact
- **Cost per request**: Track Claude API token usage

## VS Code Extension Integration

Update your VS Code extension configuration:

```typescript
// src/config/claude-api.ts
export const CLAUDE_API_CONFIG = {
  endpoint: 'https://claude-proxy-gateway-production-xxxxx.apigateway.YOUR_PROJECT.cloud.goog/analyze',
  // API key stored in SecretStorage, retrieved at runtime
  timeout: 300000, // 5 minutes
  retryAttempts: 3,
  retryDelay: 1000
};
```

**User setup**:
1. Install VS Code extension
2. Run command: `GitR: Configure Claude API`
3. Enter API key (stored securely in SecretStorage)
4. Extension validates key with health check

## Updating

### Update Cloud Function Code

```bash
# Make changes to cloud-function/src/index.ts

cd cloud-function
npm run build

# Redeploy via Terraform (detects source changes)
cd ../terraform
terraform apply
```

### Update API Gateway Configuration

```bash
# Edit openapi.yaml.tpl (rate limits, paths, etc.)
cd terraform

# Redeploy
terraform apply
```

### Rotate Claude API Key

```bash
# Create new secret version
echo -n "sk-ant-api03-NEW-KEY" | gcloud secrets versions add claude-api-key-production --data-file=-

# Destroy function to clear cache
terraform destroy -target=google_cloudfunctions2_function.claude_proxy

# Redeploy
terraform apply
```

## Troubleshooting

### Error: "Failed to retrieve API credentials"

**Cause**: Secret Manager access issue

**Fix**:
```bash
# Verify secret exists
gcloud secrets describe claude-api-key-production

# Check IAM permissions
gcloud secrets get-iam-policy claude-api-key-production

# Grant access to function service account
gcloud secrets add-iam-policy-binding claude-api-key-production \
  --member="serviceAccount:claude-proxy-production-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Error: 401 Unauthorized

**Cause**: Invalid or missing API key

**Fix**:
- Verify API key is correct
- Check key is not deleted in Cloud Console
- Ensure `X-API-Key` header is set

### Error: 429 Too Many Requests

**Cause**: Rate limit exceeded (100 requests/day)

**Fix**:
- Wait until quota resets (daily)
- Increase rate limit in `terraform/main.tf`:
  ```hcl
  variable "rate_limit_per_day" {
    default = 500  # Increase as needed
  }
  ```
- Run `terraform apply`

### Error: 503 Service Unavailable

**Cause**: Claude API error or timeout

**Fix**:
- Check Claude API status: https://status.anthropic.com/
- Review Cloud Function logs for detailed error
- Consider increasing timeout or reducing payload size

### High Latency (> 30s)

**Causes**:
- Large filename arrays (> 50,000 entries)
- Cold starts (first request after idle period)
- Claude API overload

**Optimizations**:
```hcl
# In terraform/main.tf, increase min instances to reduce cold starts
resource "google_cloudfunctions2_function" "claude_proxy" {
  service_config {
    min_instance_count = 1  # Keep 1 instance warm
    available_memory   = "1Gi"  # Increase memory
  }
}
```

## Cost Optimization

### Right-Sizing

**Current configuration**:
- Memory: 512 MB
- Timeout: 300s
- Min instances: 0 (cold start optimization)

**For lower cost**:
```hcl
# Reduce memory if function uses < 256 MB
available_memory = "256Mi"

# Reduce timeout for typical payloads
timeout_seconds = 180
```

### Committed Use Discounts

For consistent daily usage (> 100 requests/day):
```bash
# Purchase 1-year committed use discount for Cloud Run (Cloud Functions use Cloud Run)
# Savings: 37% for 1-year, 57% for 3-year
gcloud compute commitments create claude-proxy-commitment \
  --region=us-central1 \
  --plan=12-month \
  --resources=vcpu=1,memory=1GB
```

### Monitor Costs

```bash
# View current month costs
gcloud billing projects describe ${PROJECT_ID} \
  --format="value(billingAccountName)"

# Enable budget alerts
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT \
  --display-name="Claude Proxy Budget" \
  --budget-amount=100USD \
  --threshold-rule=percent=90
```

## Staging Environment

Deploy a staging environment for testing:

```bash
# Create staging workspace
cd terraform
terraform workspace new staging
terraform workspace select staging

# Deploy with staging variables
terraform apply -var="environment=staging" -var="rate_limit_per_day=1000"
```

**Best practices**:
- Use separate API keys for staging and production
- Test code changes in staging before production deployment
- Use staging for load testing without impacting production quota

## Rollback

If deployment fails or introduces issues:

```bash
cd terraform

# View previous state versions
terraform state list

# Rollback to previous version
terraform apply -var-file=terraform.tfvars.previous

# Or destroy and redeploy from known-good state
terraform destroy -target=google_cloudfunctions2_function.claude_proxy
terraform apply
```

## Security Checklist

- [ ] Claude API key stored in Secret Manager (never in code)
- [ ] API keys distributed securely to users
- [ ] Rate limiting configured (100 req/day default)
- [ ] Service account uses least privilege IAM roles
- [ ] Cloud Function uses private ingress (API Gateway only)
- [ ] Monitoring alerts configured for anomalies
- [ ] Budget alerts set to prevent runaway costs
- [ ] Audit logging enabled (automatic for API Gateway)

## Next Steps

1. **Deploy infrastructure**: Run `terraform apply`
2. **Generate API keys**: Create keys for initial users
3. **Update VS Code extension**: Configure endpoint URL
4. **Test end-to-end**: Verify full workflow from extension to Claude
5. **Monitor for 24 hours**: Ensure stability and performance
6. **Document for users**: Share API key setup instructions

**Support**: For issues, check Cloud Function logs first, then API Gateway logs, then Claude API status.
