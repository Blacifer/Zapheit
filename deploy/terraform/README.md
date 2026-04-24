# Zapheit — Terraform / IaC for GCP

Provisions the complete GCP infrastructure for Zapheit using Terraform.
Supports both **production** and **staging** environments from the same module.

## What this creates

| Resource | Production name | Staging name |
|----------|----------------|--------------|
| Artifact Registry repo | `zapheit` | `zapheit` (shared) |
| Cloud Run service (API) | `zapheit-api` | `zapheit-api-staging` |
| Cloud Run service (Runtime) | `zapheit-runtime` | `zapheit-runtime-staging` |
| Service account (API) | `zapheit-api@…` | `zapheit-api-staging@…` |
| Service account (Runtime) | `zapheit-runtime@…` | `zapheit-runtime-staging@…` |
| Service account (Build) | `cloudbuild-deployer@…` | (same, shared) |
| Secret Manager secrets | `SECRET_NAME` | `SECRET_NAME_STAGING` |
| IAM bindings | least-privilege per SA | same pattern |

## Prerequisites

- Terraform >= 1.7
- `gcloud` CLI authenticated: `gcloud auth application-default login`
- GCP project already created with billing enabled
- Docker installed (for pushing images)

## Quick start

### 1. Create a tfvars file (never commit this)

```bash
cp deploy/terraform/terraform.tfvars.example deploy/terraform/terraform.tfvars
# Edit terraform.tfvars with your project ID and secrets
```

### 2. Initialise Terraform

```bash
cd deploy/terraform
terraform init
```

### 3. Plan

```bash
# Production
terraform plan -var="project_id=rasisynthetichr"

# Staging
terraform plan -var="project_id=rasisynthetichr" -var="environment=staging"
```

### 4. Apply

```bash
terraform apply -var="project_id=rasisynthetichr"
```

## Managing secrets

Terraform creates all Secret Manager secrets but **will not overwrite values
already set** (see `ignore_changes = [secret_data]` in `secrets.tf`).

Two options:

**Option A — via Terraform vars** (values stored in state; use only for non-prod):
```hcl
# terraform.tfvars
secret_supabase_url = "https://xxxx.supabase.co"
secret_openai_api_key = "sk-proj-..."
```

**Option B — via secrets.sh** (recommended for production):
```bash
export PROJECT_ID=rasisynthetichr
bash deploy/gcp/secrets.sh
```

After `terraform apply` creates the secret *containers*, run `secrets.sh` to
populate the values. The Cloud Run services will pick up `latest` automatically.

## State backend (team use)

Uncomment the `backend "gcs"` block in `main.tf` and create the bucket first:

```bash
gsutil mb -p rasisynthetichr -l asia-south1 gs://rasisynthetichr-tf-state
gsutil versioning set on gs://rasisynthetichr-tf-state
```

## Pushing images manually

```bash
gcloud auth configure-docker asia-south1-docker.pkg.dev

docker build --platform=linux/amd64 \
  -t asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-api:latest \
  ./zapheit-api
docker push asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-api:latest

docker build --platform=linux/amd64 \
  -t asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-runtime:latest \
  ./zapheit-runtime
docker push asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-runtime:latest
```

Then re-apply with the new image tag:

```bash
terraform apply \
  -var="project_id=rasisynthetichr" \
  -var="api_image=asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-api:abc1234" \
  -var="runtime_image=asia-south1-docker.pkg.dev/rasisynthetichr/zapheit/zapheit-runtime:abc1234"
```

## Staging environment

```bash
terraform workspace new staging
terraform apply \
  -var="project_id=rasisynthetichr" \
  -var="environment=staging"
```

Staging uses:
- Service names with `-staging` suffix
- Secret names with `_STAGING` suffix (so prod + staging secrets coexist in the same project)
- Internal-only ingress still enforced on the runtime service

## Destroying an environment

```bash
# Staging only
terraform workspace select staging
terraform destroy -var="project_id=rasisynthetichr" -var="environment=staging"

# Production — be careful
terraform workspace select default
terraform destroy -var="project_id=rasisynthetichr"
```

> **Warning:** Destroying production deletes all Secret Manager secrets and
> Cloud Run services. Supabase data is unaffected (managed separately).
