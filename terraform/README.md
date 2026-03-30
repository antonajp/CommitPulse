# Claude API Proxy - GCP Infrastructure

Production-ready Terraform configuration for deploying a secure Claude API proxy with API Gateway and Cloud Functions.

## Quick Start

```bash
# 1. Configure GCP project
export PROJECT_ID="your-gcp-project-id"
gcloud config set project ${PROJECT_ID}

# 2. Create state bucket
gsutil mb -l us-central1 gs://${PROJECT_ID}-terraform-state
gsutil versioning set on gs://${PROJECT_ID}-terraform-state

# 3. Set Claude API key
export TF_VAR_claude_api_key="sk-ant-api03-YOUR-KEY"

# 4. Deploy
terraform init
terraform plan
terraform apply
```

## Architecture

```
VS Code Extension
    ↓ (HTTPS + API Key)
API Gateway (authentication, rate limiting)
    ↓
Cloud Function Gen 2 (Node.js 20)
    ↓ (retrieves key from Secret Manager)
Claude API (Anthropic)
```

## Components

- **API Gateway**: OpenAPI 3.0 spec, API key auth, 100 req/day per key
- **Cloud Function**: 512MB, 300s timeout, auto-scaling (0-10 instances)
- **Secret Manager**: Claude API key storage
- **Cloud Monitoring**: Error rate and latency alerts

## Files

- `main.tf` - Core infrastructure (function, gateway, IAM)
- `function-source.tf` - Function source packaging and upload
- `openapi.yaml.tpl` - API Gateway OpenAPI specification
- `variables.tfvars.example` - Example variables
- `DEPLOYMENT.md` - Step-by-step deployment guide
- `COST_ANALYSIS.md` - Detailed cost breakdown

## Configuration

**Required Variables**:
- `project_id` - GCP project ID
- `claude_api_key` - Claude API key (use env var: TF_VAR_claude_api_key)

**Optional Variables**:
- `region` - GCP region (default: us-central1)
- `environment` - Environment name (default: production)
- `rate_limit_per_day` - API requests per key per day (default: 100)

## Outputs

After deployment:
```
api_gateway_url     = "claude-proxy-gateway-production-xxxxx.apigateway.PROJECT.cloud.goog"
function_url        = "https://us-central1-PROJECT.cloudfunctions.net/claude-proxy-production"
```

Use `api_gateway_url` in your VS Code extension configuration.

## Cost Estimate

**Monthly Cost** (3,000 requests/month):
- GCP Services: ~$7/month
- Claude API: ~$4/month (with optimizations)
- **Total**: ~$11/month

See `COST_ANALYSIS.md` for detailed breakdown and optimization strategies.

## Monitoring

**View logs**:
```bash
gcloud functions logs read claude-proxy-production --region=us-central1
```

**Dashboards**:
- Cloud Functions: https://console.cloud.google.com/functions
- API Gateway: https://console.cloud.google.com/api-gateway
- Monitoring: https://console.cloud.google.com/monitoring

## API Key Management

**Create user API key**:
```bash
gcloud alpha services api-keys create \
  --display-name="User: john@example.com" \
  --project=${PROJECT_ID}
```

**Retrieve key value**:
```bash
gcloud alpha services api-keys get-key-string projects/${PROJECT_ID}/locations/global/keys/KEY_ID
```

## Testing

**Health check**:
```bash
curl https://YOUR-API-GATEWAY-URL/health
```

**Analyze filenames**:
```bash
curl -X POST https://YOUR-API-GATEWAY-URL/analyze \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR-API-KEY" \
  -d '{
    "filenames": ["src/index.ts", "package.json", "README.md"]
  }'
```

## Staging Environment

```bash
terraform workspace new staging
terraform workspace select staging
terraform apply -var="environment=staging" -var="rate_limit_per_day=1000"
```

## Troubleshooting

**401 Unauthorized**: Check API key is valid
**429 Too Many Requests**: Rate limit exceeded, wait or increase limit
**503 Service Unavailable**: Claude API error, check status.anthropic.com

See `DEPLOYMENT.md` for detailed troubleshooting guide.

## Security

- ✅ Secrets in Secret Manager (never in code)
- ✅ API Gateway enforces authentication
- ✅ Rate limiting per API key
- ✅ Least privilege IAM roles
- ✅ Private function ingress
- ✅ Audit logging enabled

## Support

For issues:
1. Check Cloud Function logs
2. Check API Gateway logs
3. Review Claude API status
4. See `DEPLOYMENT.md` troubleshooting section
