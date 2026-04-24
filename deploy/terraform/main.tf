terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Uncomment to use GCS as the state backend (recommended for team use):
  # backend "gcs" {
  #   bucket = "rasisynthetichr-tf-state"
  #   prefix = "zapheit/${var.environment}"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Derive service name suffix: production has none, staging gets "-staging"
locals {
  suffix        = var.environment == "production" ? "" : "-${var.environment}"
  secret_suffix = var.environment == "production" ? "" : "_STAGING"
  registry      = "${var.region}-docker.pkg.dev/${var.project_id}/zapheit"

  api_service_name     = "zapheit-api${local.suffix}"
  runtime_service_name = "zapheit-runtime${local.suffix}"
  api_sa_name          = "zapheit-api${local.suffix}"
  runtime_sa_name      = "zapheit-runtime${local.suffix}"

  api_image     = var.api_image != "" ? var.api_image : "${local.registry}/zapheit-api:latest"
  runtime_image = var.runtime_image != "" ? var.runtime_image : "${local.registry}/zapheit-runtime:latest"
}

data "google_project" "project" {}
