/**
 * GCP Infrastructure for VS Code Extension Claude API Proxy
 *
 * This Terraform configuration deploys:
 * - API Gateway for authentication and rate limiting
 * - Cloud Function Gen 2 for Claude API proxy
 * - Secret Manager for API key storage
 * - IAM roles and service accounts
 * - Cloud Monitoring alerts
 */

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "gitr-terraform-state"  # Update with your bucket name
    prefix = "claude-proxy"
  }
}

# Variables
variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (staging or production)"
  type        = string
  default     = "production"
}

variable "claude_api_key" {
  description = "Claude API key (mark as sensitive)"
  type        = string
  sensitive   = true
}

variable "rate_limit_per_day" {
  description = "API requests per day per API key"
  type        = number
  default     = 100
}

# Locals
locals {
  service_name = "claude-proxy"
  function_name = "${local.service_name}-${var.environment}"
  api_gateway_name = "${local.service_name}-gateway-${var.environment}"

  labels = {
    environment = var.environment
    service     = local.service_name
    managed_by  = "terraform"
  }
}

# Provider configuration
provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "cloudfunctions.googleapis.com",
    "cloudbuild.googleapis.com",
    "apigateway.googleapis.com",
    "servicemanagement.googleapis.com",
    "servicecontrol.googleapis.com",
    "secretmanager.googleapis.com",
    "run.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ])

  service = each.key
  disable_on_destroy = false
}

# Storage bucket for Cloud Function source code
resource "google_storage_bucket" "function_source" {
  name          = "${var.project_id}-${local.function_name}-source"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  labels = local.labels

  depends_on = [google_project_service.required_apis]
}

# Service account for Cloud Function
resource "google_service_account" "function_sa" {
  account_id   = "${local.function_name}-sa"
  display_name = "Service Account for ${local.function_name}"
  description  = "Used by Cloud Function to access Claude API and Secret Manager"

  depends_on = [google_project_service.required_apis]
}

# Store Claude API key in Secret Manager
resource "google_secret_manager_secret" "claude_api_key" {
  secret_id = "claude-api-key-${var.environment}"

  replication {
    auto {}
  }

  labels = local.labels

  depends_on = [google_project_service.required_apis]
}

resource "google_secret_manager_secret_version" "claude_api_key_version" {
  secret      = google_secret_manager_secret.claude_api_key.id
  secret_data = var.claude_api_key
}

# Grant Secret Manager access to function service account
resource "google_secret_manager_secret_iam_member" "function_secret_access" {
  secret_id = google_secret_manager_secret.claude_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.function_sa.email}"
}

# Cloud Function Gen 2
resource "google_cloudfunctions2_function" "claude_proxy" {
  name        = local.function_name
  location    = var.region
  description = "Proxy for Claude API with authentication and rate limiting"

  build_config {
    runtime     = "nodejs20"
    entry_point = "claudeProxy"

    source {
      storage_source {
        bucket = google_storage_bucket.function_source.name
        object = google_storage_bucket_object.function_source_archive.name
      }
    }
  }

  service_config {
    max_instance_count    = 10
    min_instance_count    = 0
    available_memory      = "512Mi"
    timeout_seconds       = 300
    max_instance_request_concurrency = 80

    environment_variables = {
      NODE_ENV               = var.environment
      CLAUDE_API_SECRET_NAME = google_secret_manager_secret.claude_api_key.secret_id
      LOG_LEVEL              = var.environment == "production" ? "info" : "debug"
    }

    service_account_email = google_service_account.function_sa.email

    ingress_settings = "ALLOW_INTERNAL_AND_GCLB"
  }

  labels = local.labels

  depends_on = [
    google_project_service.required_apis,
    google_secret_manager_secret_version.claude_api_key_version
  ]
}

# Allow unauthenticated invocations (API Gateway will handle auth)
resource "google_cloud_run_service_iam_member" "function_invoker" {
  project  = google_cloudfunctions2_function.claude_proxy.project
  location = google_cloudfunctions2_function.claude_proxy.location
  service  = google_cloudfunctions2_function.claude_proxy.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# API Gateway API Config (OpenAPI spec)
resource "google_api_gateway_api" "claude_api" {
  provider = google-beta
  api_id   = "${local.service_name}-api-${var.environment}"

  labels = local.labels

  depends_on = [google_project_service.required_apis]
}

resource "google_api_gateway_api_config" "claude_api_config" {
  provider      = google-beta
  api           = google_api_gateway_api.claude_api.api_id
  api_config_id = "${local.service_name}-config-${var.environment}-v1"

  openapi_documents {
    document {
      path     = "openapi.yaml"
      contents = base64encode(templatefile("${path.module}/openapi.yaml.tpl", {
        function_url     = google_cloudfunctions2_function.claude_proxy.service_config[0].uri
        rate_limit       = var.rate_limit_per_day
        service_name     = local.service_name
        environment      = var.environment
      }))
    }
  }

  gateway_config {
    backend_config {
      google_service_account = google_service_account.function_sa.email
    }
  }

  labels = local.labels

  depends_on = [google_cloudfunctions2_function.claude_proxy]
}

# API Gateway
resource "google_api_gateway_gateway" "claude_gateway" {
  provider   = google-beta
  api_config = google_api_gateway_api_config.claude_api_config.id
  gateway_id = local.api_gateway_name
  region     = var.region

  labels = local.labels

  depends_on = [google_api_gateway_api_config.claude_api_config]
}

# Monitoring: Alert on error rate
resource "google_monitoring_alert_policy" "error_rate" {
  display_name = "${local.function_name} Error Rate Alert"
  combiner     = "OR"

  conditions {
    display_name = "Error rate > 5%"

    condition_threshold {
      filter          = "resource.type=\"cloud_function\" AND resource.labels.function_name=\"${local.function_name}\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_count\" AND metric.labels.status!=\"ok\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = []  # Add notification channels here

  alert_strategy {
    auto_close = "1800s"
  }
}

# Monitoring: Alert on high latency
resource "google_monitoring_alert_policy" "high_latency" {
  display_name = "${local.function_name} High Latency Alert"
  combiner     = "OR"

  conditions {
    display_name = "95th percentile latency > 30s"

    condition_threshold {
      filter          = "resource.type=\"cloud_function\" AND resource.labels.function_name=\"${local.function_name}\" AND metric.type=\"cloudfunctions.googleapis.com/function/execution_times\""
      duration        = "300s"
      comparison      = "COMPARISON_GT"
      threshold_value = 30000  # milliseconds

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_DELTA"
        cross_series_reducer = "REDUCE_PERCENTILE_95"
      }
    }
  }

  notification_channels = []  # Add notification channels here

  alert_strategy {
    auto_close = "1800s"
  }
}

# Outputs
output "api_gateway_url" {
  description = "URL of the API Gateway endpoint"
  value       = google_api_gateway_gateway.claude_gateway.default_hostname
}

output "function_url" {
  description = "Direct URL of the Cloud Function (for debugging)"
  value       = google_cloudfunctions2_function.claude_proxy.service_config[0].uri
  sensitive   = true
}

output "function_service_account" {
  description = "Email of the Cloud Function service account"
  value       = google_service_account.function_sa.email
}

output "secret_name" {
  description = "Name of the Secret Manager secret storing Claude API key"
  value       = google_secret_manager_secret.claude_api_key.secret_id
}
