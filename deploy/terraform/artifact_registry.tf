resource "google_artifact_registry_repository" "zapheit" {
  repository_id = "zapheit"
  format        = "DOCKER"
  location      = var.region
  description   = "Zapheit container images"

  depends_on = [google_project_service.apis]
}
