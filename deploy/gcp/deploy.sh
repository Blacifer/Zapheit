#!/usr/bin/env bash
# deploy/gcp/deploy.sh
# First-time GCP setup + deploy for Zapheit (synthetic-hr-api + synthetic-hr-runtime)
# Supports production and staging targets.
#
# Usage:
#   export PROJECT_ID=rasisynthetichr
#   export REGION=asia-south1
#   bash deploy/gcp/deploy.sh

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID env var first}"
REGION="${REGION:-asia-south1}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/zapheit"
COMMIT_SHA=$(git rev-parse --short HEAD)
DEPLOY_ENV="${DEPLOY_ENV:-production}"
SERVICE_SUFFIX="${SERVICE_SUFFIX:-}"
SECRET_SUFFIX="${SECRET_SUFFIX:-}"
BUILD_SA_NAME="${BUILD_SA_NAME:-cloudbuild-deployer}"
BUILD_SA_EMAIL="${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BILLING_ACCOUNT=$(gcloud billing projects describe "${PROJECT_ID}" --format="value(billingAccountName)" 2>/dev/null | sed 's|billingAccounts/||' || echo "")

if [ -z "${SERVICE_SUFFIX}" ] && [ "${DEPLOY_ENV}" != "production" ]; then
  SERVICE_SUFFIX="-${DEPLOY_ENV}"
fi

API_SERVICE_NAME="synthetic-hr-api${SERVICE_SUFFIX}"
RUNTIME_SERVICE_NAME="synthetic-hr-runtime${SERVICE_SUFFIX}"
API_SA_NAME="zapheit-api${SERVICE_SUFFIX}"
RUNTIME_SA_NAME="zapheit-runtime${SERVICE_SUFFIX}"
UPTIME_CHECK_NAME="zapheit-api-health${SERVICE_SUFFIX}"

CREATE_BUDGET_ALERT="${CREATE_BUDGET_ALERT:-}"
if [ -z "${CREATE_BUDGET_ALERT}" ]; then
  if [ "${DEPLOY_ENV}" = "production" ]; then
    CREATE_BUDGET_ALERT="true"
  else
    CREATE_BUDGET_ALERT="false"
  fi
fi

build_secret_bindings() {
  local bindings=()
  local env_name
  for env_name in "$@"; do
    bindings+=("${env_name}=${env_name}${SECRET_SUFFIX}:latest")
  done
  local IFS=,
  echo "${bindings[*]}"
}

API_SECRET_BINDINGS=$(build_secret_bindings \
  NODE_ENV \
  SUPABASE_URL \
  SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_KEY \
  JWT_SECRET \
  FRONTEND_URL \
  API_URL \
  CORS_ALLOWED_ORIGINS \
  OPENAI_API_KEY \
  ANTHROPIC_API_KEY \
  RASI_OPENAI_API_KEY \
  RASI_ANTHROPIC_API_KEY \
  RASI_OPENROUTER_API_KEY \
  DATABASE_URL \
  INTEGRATIONS_ENCRYPTION_KEY \
  ERASURE_SIGNING_SALT \
  EMAIL_PROVIDER \
  EMAIL_FROM \
  ALERT_EMAIL_TO \
  RESEND_API_KEY \
  CASHFREE_CLIENT_ID \
  CASHFREE_CLIENT_SECRET \
  CASHFREE_API_VERSION \
  CASHFREE_ENVIRONMENT \
  CASHFREE_WEBHOOK_SECRET \
  GOOGLE_CLIENT_ID \
  GOOGLE_CLIENT_SECRET \
  SLACK_CLIENT_ID \
  SLACK_CLIENT_SECRET \
  SLACK_SIGNING_SECRET \
  MICROSOFT_CLIENT_ID \
  MICROSOFT_CLIENT_SECRET \
  ZOHO_CLIENT_ID \
  ZOHO_CLIENT_SECRET \
  LINKEDIN_CLIENT_ID \
  LINKEDIN_CLIENT_SECRET \
  SALESFORCE_CLIENT_ID \
  SALESFORCE_CLIENT_SECRET \
  INTERCOM_CLIENT_ID \
  INTERCOM_CLIENT_SECRET \
  QUICKBOOKS_CLIENT_ID \
  QUICKBOOKS_CLIENT_SECRET \
  DEEL_CLIENT_ID \
  DEEL_CLIENT_SECRET \
  GUSTO_CLIENT_ID \
  GUSTO_CLIENT_SECRET \
  FLOCK_CLIENT_ID \
  FLOCK_CLIENT_SECRET \
  HUBSPOT_CLIENT_ID \
  HUBSPOT_CLIENT_SECRET \
  CONNECTORS_ENABLED \
  CROSS_BORDER_PII_MASKING \
  SCHEMA_COMPAT_STRICT_OPTIONAL \
  REDTEAM_INTERVAL_MINUTES \
  RECRUITMENT_SCORING_MODEL \
  OTEL_ENABLED \
  OTEL_EXPORTER_OTLP_ENDPOINT \
  OTEL_EXPORTER_OTLP_TIMEOUT \
  OTEL_EXPORTER_OTLP_INSECURE \
  OTEL_TRACES_EXPORTER \
  OTEL_METRICS_EXPORTER)

RUNTIME_SECRET_BINDINGS=$(build_secret_bindings \
  SYNTHETICHR_CONTROL_PLANE_URL \
  SYNTHETICHR_API_KEY \
  SYNTHETICHR_RUNTIME_ID \
  SYNTHETICHR_ENROLLMENT_TOKEN \
  SYNTHETICHR_RUNTIME_SECRET \
  SYNTHETICHR_MODEL)

echo ""
echo "=== Zapheit GCP Deploy ==="
echo "  Env     : ${DEPLOY_ENV}"
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Registry: ${REGISTRY}"
echo "  API Svc : ${API_SERVICE_NAME}"
echo "  Run Svc : ${RUNTIME_SERVICE_NAME}"
echo "  Secret Suffix: ${SECRET_SUFFIX:-<none>}"
echo "  Build SA: ${BUILD_SA_EMAIL}"
echo "  Commit  : ${COMMIT_SHA}"
echo ""

# ── Step 1: Enable required APIs ─────────────────────────────────────────────
echo "[1/8] Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  monitoring.googleapis.com \
  billingbudgets.googleapis.com \
  --project="${PROJECT_ID}"

# ── Step 2: Create Artifact Registry repo ────────────────────────────────────
echo "[2/8] Creating Artifact Registry repository 'zapheit'..."
gcloud artifacts repositories create zapheit \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Zapheit container images" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  (already exists — skipping)"

# ── Step 3: Create dedicated service accounts (least privilege) ───────────────
echo "[3/8] Creating dedicated service accounts..."

# API service account
gcloud iam service-accounts create "${API_SA_NAME}" \
  --display-name="Zapheit API (${DEPLOY_ENV})" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  ${API_SA_NAME} SA already exists"

# Runtime service account
gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
  --display-name="Zapheit Runtime Worker (${DEPLOY_ENV})" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  ${RUNTIME_SA_NAME} SA already exists"

# Dedicated Cloud Build execution service account
gcloud iam service-accounts create "${BUILD_SA_NAME}" \
  --display-name="Zapheit Cloud Build Deployer" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  ${BUILD_SA_NAME} SA already exists"

# Grant both SAs permission to read Secret Manager secrets only
for SA in "${API_SA_NAME}" "${RUNTIME_SA_NAME}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

# ── Step 4: Grant Cloud Build permissions ─────────────────────────────────────
echo "[4/8] Granting Cloud Build IAM permissions..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/run.admin" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/artifactregistry.writer" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/logging.logWriter" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/cloudbuild.builds.builder" --quiet

# Allow Cloud Build to act as the dedicated service accounts during deploy
gcloud iam service-accounts add-iam-policy-binding \
  "${API_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" --quiet

gcloud iam service-accounts add-iam-policy-binding \
  "${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.reader" --quiet

# ── Step 5: Configure Docker auth ────────────────────────────────────────────
echo "[5/8] Configuring Docker credentials for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Step 6: Build & push images ──────────────────────────────────────────────
echo "[6/8] Building and pushing images..."

echo "  Building zapheit-api..."
docker build \
  --platform=linux/amd64 \
  -t "${REGISTRY}/zapheit-api:${COMMIT_SHA}" \
  -t "${REGISTRY}/zapheit-api:latest" \
  ./synthetic-hr-api
docker push --all-tags "${REGISTRY}/zapheit-api"

echo "  Building zapheit-runtime..."
docker build \
  --platform=linux/amd64 \
  -t "${REGISTRY}/zapheit-runtime:${COMMIT_SHA}" \
  -t "${REGISTRY}/zapheit-runtime:latest" \
  ./synthetic-hr-runtime
docker push --all-tags "${REGISTRY}/zapheit-runtime"

# ── Step 7: Deploy to Cloud Run ───────────────────────────────────────────────
echo "[7/8] Deploying to Cloud Run..."

echo "  Deploying ${API_SERVICE_NAME}..."
gcloud run deploy "${API_SERVICE_NAME}" \
  --image="${REGISTRY}/zapheit-api:${COMMIT_SHA}" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=3001 \
  --memory=512Mi \
  --cpu=1 \
  --cpu-boost \
  --min-instances=1 \
  --max-instances=10 \
  --timeout=60 \
  --concurrency=80 \
  --service-account="${API_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="${API_SECRET_BINDINGS}" \
  --project="${PROJECT_ID}"

echo "  Deploying ${RUNTIME_SERVICE_NAME}..."
gcloud run deploy "${RUNTIME_SERVICE_NAME}" \
  --image="${REGISTRY}/zapheit-runtime:${COMMIT_SHA}" \
  --region="${REGION}" \
  --platform=managed \
  --no-allow-unauthenticated \
  --port=3002 \
  --memory=256Mi \
  --cpu=1 \
  --cpu-boost \
  --min-instances=1 \
  --max-instances=1 \
  --timeout=3600 \
  --concurrency=1 \
  --service-account="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="${RUNTIME_SECRET_BINDINGS}" \
  --project="${PROJECT_ID}"

# ── Step 8: Uptime check + budget alert ──────────────────────────────────────
echo "[8/8] Setting up monitoring and budget alert..."

API_URL=$(gcloud run services describe "${API_SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

# Uptime check for the API health endpoint
gcloud monitoring uptime create "${UPTIME_CHECK_NAME}" \
  --display-name="Zapheit API Health (${DEPLOY_ENV})" \
  --http-check-path="/health" \
  --hostname="${API_URL#https://}" \
  --port=443 \
  --use-ssl \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  (uptime check already exists or skipped)"

# Budget alert at ₹2000/month (~$24) — adjust as needed
if [ "${CREATE_BUDGET_ALERT}" = "true" ] && [ -n "${BILLING_ACCOUNT}" ]; then
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT}" \
    --display-name="Zapheit ${DEPLOY_ENV^} Monthly Budget" \
    --budget-amount="2000INR" \
    --threshold-rule=percent=50 \
    --threshold-rule=percent=90 \
    --threshold-rule=percent=100 \
    2>/dev/null || echo "  (budget alert already exists or skipped)"
else
  echo "  (skipping budget alert)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Deploy complete! ==="
echo ""
echo "API URL: ${API_URL}"
echo "Health:  ${API_URL}/health"
echo ""
echo "Service names:"
echo "  API    : ${API_SERVICE_NAME}"
echo "  Runtime: ${RUNTIME_SERVICE_NAME}"
echo ""
echo "Next steps:"
echo "  1. Run the secrets setup: bash deploy/gcp/secrets.sh"
echo "  2. Update API_URL secret with: ${API_URL}"
echo "  3. Update VITE_API_URL on Vercel to: ${API_URL}"
echo "  4. Configure Cloud Build triggers to use: ${BUILD_SA_EMAIL}"
echo "  5. Connect Cloud Build to GitHub — see deploy/gcp/README.md Step 7"
echo "  6. (Optional) Map custom domain api.zapheit.com — see README.md Step 10"
