resource "google_service_account" "api" {
  account_id   = local.api_sa_name
  display_name = "Zapheit API (${var.environment})"
  description  = "Runtime identity for the zapheit-api Cloud Run service"
}

resource "google_service_account" "runtime" {
  account_id   = local.runtime_sa_name
  display_name = "Zapheit Runtime Worker (${var.environment})"
  description  = "Runtime identity for the zapheit-runtime Cloud Run service"
}

resource "google_service_account" "cloudbuild" {
  account_id   = "cloudbuild-deployer"
  display_name = "Zapheit Cloud Build Deployer"
  description  = "Dedicated SA used by Cloud Build triggers to deploy Zapheit services"
}
