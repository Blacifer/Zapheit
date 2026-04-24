# Build the --set-secrets binding list that Cloud Run expects.
# Format per binding: ENV_VAR_NAME=SECRET_NAME:latest
locals {
  api_secret_env_bindings = [for k, _ in local.api_secrets : {
    name = trimprefix(k, local.secret_suffix)  # env var name without suffix
    value_source = {
      secret_key_ref = {
        secret  = google_secret_manager_secret.secrets[k].secret_id
        version = "latest"
      }
    }
  }]

  runtime_secret_env_bindings = [for k, _ in local.runtime_secrets : {
    name = trimprefix(k, local.secret_suffix)
    value_source = {
      secret_key_ref = {
        secret  = google_secret_manager_secret.secrets[k].secret_id
        version = "latest"
      }
    }
  }]
}

# ── zapheit-api ────────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  name     = local.api_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    timeout = "60s"

    containers {
      image = local.api_image
      name  = "zapheit-api"

      ports {
        container_port = 3001
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = false  # cpu-boost: CPU always allocated during startup
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.api_secret_env_bindings
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.value_source.secret_key_ref.secret
              version = env.value.value_source.secret_key_ref.version
            }
          }
        }
      }
    }

    max_instance_request_concurrency = 80
  }

  depends_on = [
    google_secret_manager_secret.secrets,
    google_project_iam_member.api_secret_accessor,
  ]
}

# Make the API service publicly reachable (unauthenticated)
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── zapheit-runtime ────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "runtime" {
  name     = local.runtime_service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"  # no public traffic

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 1
      max_instance_count = 1  # single worker to avoid concurrent job contention
    }

    timeout = "3600s"

    containers {
      image = local.runtime_image
      name  = "zapheit-runtime"

      ports {
        container_port = 3002
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "256Mi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.runtime_secret_env_bindings
        content {
          name = env.value.name
          value_source {
            secret_key_ref {
              secret  = env.value.value_source.secret_key_ref.secret
              version = env.value.value_source.secret_key_ref.version
            }
          }
        }
      }
    }

    max_instance_request_concurrency = 1
  }

  depends_on = [
    google_secret_manager_secret.secrets,
    google_project_iam_member.runtime_secret_accessor,
  ]
}
