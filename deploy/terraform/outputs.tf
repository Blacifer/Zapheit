output "api_url" {
  description = "Public URL of the zapheit-api Cloud Run service"
  value       = google_cloud_run_v2_service.api.uri
}

output "runtime_url" {
  description = "Internal URL of the zapheit-runtime Cloud Run service"
  value       = google_cloud_run_v2_service.runtime.uri
}

output "artifact_registry" {
  description = "Artifact Registry hostname for docker push/pull"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/zapheit"
}

output "api_service_account" {
  description = "Email of the zapheit-api service account"
  value       = google_service_account.api.email
}

output "runtime_service_account" {
  description = "Email of the zapheit-runtime service account"
  value       = google_service_account.runtime.email
}

output "cloudbuild_service_account" {
  description = "Email of the Cloud Build deployer service account — set this in Cloud Build trigger settings"
  value       = google_service_account.cloudbuild.email
}

output "next_steps" {
  description = "Post-apply checklist"
  value       = <<-EOT
    ✅ Infrastructure ready. Next steps:

    1. Push images to Artifact Registry:
         docker build --platform=linux/amd64 -t ${var.region}-docker.pkg.dev/${var.project_id}/zapheit/zapheit-api:latest ./zapheit-api
         docker push ${var.region}-docker.pkg.dev/${var.project_id}/zapheit/zapheit-api:latest

    2. Populate secrets (if not passed as tfvars):
         PROJECT_ID=${var.project_id} bash deploy/gcp/secrets.sh

    3. After first deploy, set API_URL secret to:
         ${google_cloud_run_v2_service.api.uri}

    4. Update VITE_API_URL on Vercel to:
         ${google_cloud_run_v2_service.api.uri}

    5. Set Cloud Build trigger service account to:
         ${google_service_account.cloudbuild.email}

    6. (Optional) Map custom domain api.zapheit.com via Cloud Run domain mappings.
  EOT
}
