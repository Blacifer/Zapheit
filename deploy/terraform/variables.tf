variable "project_id" {
  description = "GCP project ID (e.g. rasisynthetichr)"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "asia-south1"
}

variable "environment" {
  description = "Deployment environment: production or staging"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "environment must be 'production' or 'staging'."
  }
}

variable "api_image" {
  description = "Full image URI for zapheit-api (e.g. asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-api:abc1234)"
  type        = string
  default     = ""
}

variable "runtime_image" {
  description = "Full image URI for zapheit-runtime"
  type        = string
  default     = ""
}

# ── Secret values (mark sensitive; Terraform writes these into Secret Manager) ──
# Leave blank to skip writing a secret version — create it manually or via secrets.sh.

variable "secret_node_env" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_supabase_url" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_supabase_anon_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_supabase_service_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_jwt_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_database_url" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_frontend_url" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_api_url" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_cors_allowed_origins" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_integrations_encryption_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_erasure_signing_salt" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_rasi_openai_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_rasi_anthropic_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_rasi_openrouter_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_email_provider" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_email_from" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_alert_email_to" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_resend_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_cashfree_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_cashfree_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_cashfree_api_version" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_cashfree_environment" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_cashfree_webhook_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_google_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_slack_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_slack_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_slack_signing_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_microsoft_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_microsoft_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zoho_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zoho_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_linkedin_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_linkedin_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_salesforce_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_salesforce_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_intercom_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_intercom_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_quickbooks_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_quickbooks_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_deel_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_deel_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_gusto_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_gusto_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_flock_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_flock_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_hubspot_client_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_hubspot_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_connectors_enabled" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_cross_border_pii_masking" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_schema_compat_strict_optional" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_redteam_interval_minutes" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_recruitment_scoring_model" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_otel_enabled" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_otel_exporter_otlp_endpoint" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_otel_exporter_otlp_timeout" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_otel_exporter_otlp_insecure" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_otel_traces_exporter" {
  type      = string
  sensitive = false
  default   = ""
}
variable "secret_otel_metrics_exporter" {
  type      = string
  sensitive = false
  default   = ""
}

# ── Runtime secrets (filled after first API deploy) ────────────────────────────
variable "secret_zapheit_control_plane_url" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zapheit_api_key" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zapheit_runtime_id" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zapheit_enrollment_token" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zapheit_runtime_secret" {
  type      = string
  sensitive = true
  default   = ""
}
variable "secret_zapheit_model" {
  type      = string
  sensitive = false
  default   = ""
}
