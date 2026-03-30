#!/bin/bash
# Initial GCP setup script for Claude API Proxy deployment
#
# This script:
# 1. Validates prerequisites (gcloud, terraform)
# 2. Enables required GCP APIs
# 3. Creates Terraform state bucket
# 4. Generates terraform.tfvars from user input
# 5. Initializes Terraform
#
# Usage: ./setup.sh

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Main script
main() {
    log_info "Starting GCP Claude API Proxy setup..."
    echo ""

    # 1. Check prerequisites
    log_info "Checking prerequisites..."

    if ! command_exists gcloud; then
        log_error "gcloud CLI not found. Install from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi

    if ! command_exists terraform; then
        log_error "Terraform not found. Install from: https://www.terraform.io/downloads"
        exit 1
    fi

    log_info "✓ gcloud version: $(gcloud version --format='value(core.version)')"
    log_info "✓ terraform version: $(terraform version -json | jq -r '.terraform_version')"
    echo ""

    # 2. Get GCP project ID
    log_info "Configuring GCP project..."

    # Try to get current project
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")

    if [ -n "$CURRENT_PROJECT" ]; then
        read -p "Use current GCP project '$CURRENT_PROJECT'? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            PROJECT_ID="$CURRENT_PROJECT"
        else
            read -p "Enter GCP project ID: " PROJECT_ID
        fi
    else
        read -p "Enter GCP project ID: " PROJECT_ID
    fi

    # Set project
    gcloud config set project "$PROJECT_ID"
    log_info "✓ Using project: $PROJECT_ID"
    echo ""

    # 3. Check billing enabled
    log_info "Checking if billing is enabled..."
    BILLING_ENABLED=$(gcloud beta billing projects describe "$PROJECT_ID" \
        --format="value(billingEnabled)" 2>/dev/null || echo "false")

    if [ "$BILLING_ENABLED" != "True" ]; then
        log_error "Billing is not enabled for project $PROJECT_ID"
        log_error "Enable billing at: https://console.cloud.google.com/billing/projects"
        exit 1
    fi
    log_info "✓ Billing enabled"
    echo ""

    # 4. Enable required APIs
    log_info "Enabling required GCP APIs (this may take 2-3 minutes)..."

    REQUIRED_APIS=(
        "cloudfunctions.googleapis.com"
        "cloudbuild.googleapis.com"
        "apigateway.googleapis.com"
        "servicemanagement.googleapis.com"
        "servicecontrol.googleapis.com"
        "secretmanager.googleapis.com"
        "run.googleapis.com"
        "logging.googleapis.com"
        "monitoring.googleapis.com"
    )

    for api in "${REQUIRED_APIS[@]}"; do
        log_info "Enabling $api..."
        gcloud services enable "$api" --project="$PROJECT_ID"
    done

    log_info "✓ All APIs enabled"
    echo ""

    # 5. Create Terraform state bucket
    log_info "Creating Terraform state bucket..."

    STATE_BUCKET="${PROJECT_ID}-terraform-state"

    if gsutil ls -b "gs://${STATE_BUCKET}" 2>/dev/null; then
        log_warn "State bucket already exists: gs://${STATE_BUCKET}"
    else
        gsutil mb -p "$PROJECT_ID" -l us-central1 "gs://${STATE_BUCKET}"
        gsutil versioning set on "gs://${STATE_BUCKET}"
        log_info "✓ Created state bucket: gs://${STATE_BUCKET}"
    fi
    echo ""

    # 6. Get Claude API key
    log_info "Claude API key configuration..."
    echo "Obtain your Claude API key from: https://console.anthropic.com/"
    echo "It should start with: sk-ant-api03-"
    echo ""

    read -sp "Enter Claude API key (input hidden): " CLAUDE_API_KEY
    echo ""

    if [ -z "$CLAUDE_API_KEY" ]; then
        log_error "Claude API key cannot be empty"
        exit 1
    fi

    if [[ ! "$CLAUDE_API_KEY" =~ ^sk-ant- ]]; then
        log_warn "Warning: API key doesn't start with 'sk-ant-'. Continuing anyway..."
    fi

    # Export for Terraform
    export TF_VAR_claude_api_key="$CLAUDE_API_KEY"
    log_info "✓ Claude API key configured (exported as TF_VAR_claude_api_key)"
    echo ""

    # 7. Get deployment configuration
    log_info "Deployment configuration..."

    read -p "Environment name (default: production): " ENVIRONMENT
    ENVIRONMENT=${ENVIRONMENT:-production}

    read -p "GCP region (default: us-central1): " REGION
    REGION=${REGION:-us-central1}

    read -p "Rate limit (requests per day per API key, default: 100): " RATE_LIMIT
    RATE_LIMIT=${RATE_LIMIT:-100}

    echo ""
    log_info "Configuration summary:"
    echo "  Project ID:     $PROJECT_ID"
    echo "  Environment:    $ENVIRONMENT"
    echo "  Region:         $REGION"
    echo "  Rate Limit:     $RATE_LIMIT req/day"
    echo "  State Bucket:   gs://${STATE_BUCKET}"
    echo ""

    read -p "Proceed with these settings? (y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_error "Setup cancelled by user"
        exit 1
    fi

    # 8. Create terraform.tfvars
    log_info "Creating terraform.tfvars..."

    cat > terraform.tfvars <<EOF
# Generated by setup.sh on $(date)
# DO NOT commit this file to version control!

project_id         = "$PROJECT_ID"
region             = "$REGION"
environment        = "$ENVIRONMENT"
rate_limit_per_day = $RATE_LIMIT

# Claude API key is set via environment variable: TF_VAR_claude_api_key
# To set: export TF_VAR_claude_api_key="sk-ant-api03-..."
EOF

    log_info "✓ Created terraform.tfvars"
    echo ""

    # 9. Update main.tf with correct bucket name
    log_info "Updating Terraform backend configuration..."

    sed -i.bak "s/bucket = \".*\"/bucket = \"${STATE_BUCKET}\"/" main.tf
    rm -f main.tf.bak

    log_info "✓ Updated backend bucket to: ${STATE_BUCKET}"
    echo ""

    # 10. Initialize Terraform
    log_info "Initializing Terraform..."

    terraform init

    log_info "✓ Terraform initialized"
    echo ""

    # 11. Validate configuration
    log_info "Validating Terraform configuration..."

    terraform validate

    log_info "✓ Configuration is valid"
    echo ""

    # 12. Create shell script to export API key
    log_info "Creating helper script: export-claude-key.sh..."

    cat > export-claude-key.sh <<'EOF'
#!/bin/bash
# Helper script to export Claude API key for Terraform
# Usage: source ./export-claude-key.sh

if [ -z "$1" ]; then
    read -sp "Enter Claude API key: " CLAUDE_API_KEY
    echo ""
else
    CLAUDE_API_KEY="$1"
fi

export TF_VAR_claude_api_key="$CLAUDE_API_KEY"
echo "✓ Exported TF_VAR_claude_api_key"
EOF

    chmod +x export-claude-key.sh
    log_info "✓ Created export-claude-key.sh"
    echo ""

    # Success summary
    echo "========================================"
    log_info "Setup completed successfully!"
    echo "========================================"
    echo ""
    log_info "Next steps:"
    echo ""
    echo "1. Review the deployment plan:"
    echo "   terraform plan"
    echo ""
    echo "2. Deploy the infrastructure:"
    echo "   terraform apply"
    echo ""
    echo "3. After deployment, create API keys for users:"
    echo "   gcloud alpha services api-keys create \\"
    echo "     --display-name=\"User: name@example.com\" \\"
    echo "     --project=${PROJECT_ID}"
    echo ""
    echo "4. Get the API Gateway URL from Terraform outputs:"
    echo "   terraform output api_gateway_url"
    echo ""
    log_warn "IMPORTANT: Keep your Claude API key secure!"
    echo "   - Never commit terraform.tfvars to version control"
    echo "   - Use: export TF_VAR_claude_api_key=\"...\""
    echo "   - Or source: ./export-claude-key.sh"
    echo ""
    log_info "For detailed deployment instructions, see: DEPLOYMENT.md"
    log_info "For cost analysis, see: COST_ANALYSIS.md"
    echo ""
}

# Run main function
main "$@"
