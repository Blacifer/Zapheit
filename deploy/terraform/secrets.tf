# Each secret is created unconditionally so Cloud Run can bind to it.
# Secret *versions* (the actual value) are only written when the variable is non-empty.
# Use secrets.sh to populate values outside Terraform when you prefer not to
# store plaintext in tfvars/state.

locals {
  # Map of secret name → variable value for API secrets
  api_secrets = {
    "NODE_ENV${local.secret_suffix}"                     = var.secret_node_env
    "SUPABASE_URL${local.secret_suffix}"                 = var.secret_supabase_url
    "SUPABASE_ANON_KEY${local.secret_suffix}"            = var.secret_supabase_anon_key
    "SUPABASE_SERVICE_KEY${local.secret_suffix}"         = var.secret_supabase_service_key
    "JWT_SECRET${local.secret_suffix}"                   = var.secret_jwt_secret
    "DATABASE_URL${local.secret_suffix}"                 = var.secret_database_url
    "FRONTEND_URL${local.secret_suffix}"                 = var.secret_frontend_url
    "API_URL${local.secret_suffix}"                      = var.secret_api_url
    "CORS_ALLOWED_ORIGINS${local.secret_suffix}"         = var.secret_cors_allowed_origins
    "INTEGRATIONS_ENCRYPTION_KEY${local.secret_suffix}"  = var.secret_integrations_encryption_key
    "ERASURE_SIGNING_SALT${local.secret_suffix}"         = var.secret_erasure_signing_salt
    "OPENAI_API_KEY${local.secret_suffix}"               = var.secret_openai_api_key
    "ANTHROPIC_API_KEY${local.secret_suffix}"            = var.secret_anthropic_api_key
    "RASI_OPENAI_API_KEY${local.secret_suffix}"          = var.secret_rasi_openai_api_key
    "RASI_ANTHROPIC_API_KEY${local.secret_suffix}"       = var.secret_rasi_anthropic_api_key
    "RASI_OPENROUTER_API_KEY${local.secret_suffix}"      = var.secret_rasi_openrouter_api_key
    "EMAIL_PROVIDER${local.secret_suffix}"               = var.secret_email_provider
    "EMAIL_FROM${local.secret_suffix}"                   = var.secret_email_from
    "ALERT_EMAIL_TO${local.secret_suffix}"               = var.secret_alert_email_to
    "RESEND_API_KEY${local.secret_suffix}"               = var.secret_resend_api_key
    "CASHFREE_CLIENT_ID${local.secret_suffix}"           = var.secret_cashfree_client_id
    "CASHFREE_CLIENT_SECRET${local.secret_suffix}"       = var.secret_cashfree_client_secret
    "CASHFREE_API_VERSION${local.secret_suffix}"         = var.secret_cashfree_api_version
    "CASHFREE_ENVIRONMENT${local.secret_suffix}"         = var.secret_cashfree_environment
    "CASHFREE_WEBHOOK_SECRET${local.secret_suffix}"      = var.secret_cashfree_webhook_secret
    "GOOGLE_CLIENT_ID${local.secret_suffix}"             = var.secret_google_client_id
    "GOOGLE_CLIENT_SECRET${local.secret_suffix}"         = var.secret_google_client_secret
    "SLACK_CLIENT_ID${local.secret_suffix}"              = var.secret_slack_client_id
    "SLACK_CLIENT_SECRET${local.secret_suffix}"          = var.secret_slack_client_secret
    "SLACK_SIGNING_SECRET${local.secret_suffix}"         = var.secret_slack_signing_secret
    "MICROSOFT_CLIENT_ID${local.secret_suffix}"          = var.secret_microsoft_client_id
    "MICROSOFT_CLIENT_SECRET${local.secret_suffix}"      = var.secret_microsoft_client_secret
    "ZOHO_CLIENT_ID${local.secret_suffix}"               = var.secret_zoho_client_id
    "ZOHO_CLIENT_SECRET${local.secret_suffix}"           = var.secret_zoho_client_secret
    "LINKEDIN_CLIENT_ID${local.secret_suffix}"           = var.secret_linkedin_client_id
    "LINKEDIN_CLIENT_SECRET${local.secret_suffix}"       = var.secret_linkedin_client_secret
    "SALESFORCE_CLIENT_ID${local.secret_suffix}"         = var.secret_salesforce_client_id
    "SALESFORCE_CLIENT_SECRET${local.secret_suffix}"     = var.secret_salesforce_client_secret
    "INTERCOM_CLIENT_ID${local.secret_suffix}"           = var.secret_intercom_client_id
    "INTERCOM_CLIENT_SECRET${local.secret_suffix}"       = var.secret_intercom_client_secret
    "QUICKBOOKS_CLIENT_ID${local.secret_suffix}"         = var.secret_quickbooks_client_id
    "QUICKBOOKS_CLIENT_SECRET${local.secret_suffix}"     = var.secret_quickbooks_client_secret
    "DEEL_CLIENT_ID${local.secret_suffix}"               = var.secret_deel_client_id
    "DEEL_CLIENT_SECRET${local.secret_suffix}"           = var.secret_deel_client_secret
    "GUSTO_CLIENT_ID${local.secret_suffix}"              = var.secret_gusto_client_id
    "GUSTO_CLIENT_SECRET${local.secret_suffix}"          = var.secret_gusto_client_secret
    "FLOCK_CLIENT_ID${local.secret_suffix}"              = var.secret_flock_client_id
    "FLOCK_CLIENT_SECRET${local.secret_suffix}"          = var.secret_flock_client_secret
    "HUBSPOT_CLIENT_ID${local.secret_suffix}"            = var.secret_hubspot_client_id
    "HUBSPOT_CLIENT_SECRET${local.secret_suffix}"        = var.secret_hubspot_client_secret
    "CONNECTORS_ENABLED${local.secret_suffix}"           = var.secret_connectors_enabled
    "CROSS_BORDER_PII_MASKING${local.secret_suffix}"     = var.secret_cross_border_pii_masking
    "SCHEMA_COMPAT_STRICT_OPTIONAL${local.secret_suffix}" = var.secret_schema_compat_strict_optional
    "REDTEAM_INTERVAL_MINUTES${local.secret_suffix}"     = var.secret_redteam_interval_minutes
    "RECRUITMENT_SCORING_MODEL${local.secret_suffix}"    = var.secret_recruitment_scoring_model
    "OTEL_ENABLED${local.secret_suffix}"                 = var.secret_otel_enabled
    "OTEL_EXPORTER_OTLP_ENDPOINT${local.secret_suffix}"  = var.secret_otel_exporter_otlp_endpoint
    "OTEL_EXPORTER_OTLP_TIMEOUT${local.secret_suffix}"   = var.secret_otel_exporter_otlp_timeout
    "OTEL_EXPORTER_OTLP_INSECURE${local.secret_suffix}"  = var.secret_otel_exporter_otlp_insecure
    "OTEL_TRACES_EXPORTER${local.secret_suffix}"         = var.secret_otel_traces_exporter
    "OTEL_METRICS_EXPORTER${local.secret_suffix}"        = var.secret_otel_metrics_exporter
  }

  runtime_secrets = {
    "ZAPHEIT_CONTROL_PLANE_URL${local.secret_suffix}" = var.secret_zapheit_control_plane_url
    "ZAPHEIT_API_KEY${local.secret_suffix}"           = var.secret_zapheit_api_key
    "ZAPHEIT_RUNTIME_ID${local.secret_suffix}"        = var.secret_zapheit_runtime_id
    "ZAPHEIT_ENROLLMENT_TOKEN${local.secret_suffix}"  = var.secret_zapheit_enrollment_token
    "ZAPHEIT_RUNTIME_SECRET${local.secret_suffix}"    = var.secret_zapheit_runtime_secret
    "ZAPHEIT_MODEL${local.secret_suffix}"             = var.secret_zapheit_model
  }

  all_secrets = merge(local.api_secrets, local.runtime_secrets)

  # Only write a version when the variable is non-empty
  secrets_with_values = {
    for name, value in local.all_secrets : name => value if value != ""
  }
}

resource "google_secret_manager_secret" "secrets" {
  for_each = local.all_secrets

  secret_id = each.key

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "versions" {
  for_each = local.secrets_with_values

  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value

  lifecycle {
    # Prevent Terraform from overwriting secrets updated outside of Terraform
    # (e.g., via secrets.sh or the GCP console). Remove this if you want
    # Terraform to be the single source of truth for secret values.
    ignore_changes = [secret_data]
  }
}
