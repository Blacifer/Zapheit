#!/usr/bin/env bash
# deploy/gcp/deploy.sh
# First-time GCP setup + deploy for Zapheit (synthetic-hr-api + synthetic-hr-runtime)
# Run ONCE after completing the manual steps in README.md
#
# Usage:
#   export PROJECT_ID=rasisynthetichr
#   export REGION=asia-south1
#   bash deploy/gcp/deploy.sh

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID env var first}"
REGION="${REGION:-asia-south1}"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/rasi"
COMMIT_SHA=$(git rev-parse --short HEAD)
BILLING_ACCOUNT=$(gcloud billing projects describe "${PROJECT_ID}" --format="value(billingAccountName)" 2>/dev/null | sed 's|billingAccounts/||' || echo "")

echo ""
echo "=== Zapheit GCP Production Deploy ==="
echo "  Project : ${PROJECT_ID}"
echo "  Region  : ${REGION}"
echo "  Registry: ${REGISTRY}"
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
echo "[2/8] Creating Artifact Registry repository 'rasi'..."
gcloud artifacts repositories create rasi \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Zapheit container images" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  (already exists — skipping)"

# ── Step 3: Create dedicated service accounts (least privilege) ───────────────
echo "[3/8] Creating dedicated service accounts..."

# API service account
gcloud iam service-accounts create zapheit-api \
  --display-name="Zapheit API (Cloud Run)" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  zapheit-api SA already exists"

# Runtime service account
gcloud iam service-accounts create zapheit-runtime \
  --display-name="Zapheit Runtime Worker (Cloud Run)" \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  zapheit-runtime SA already exists"

# Grant both SAs permission to read Secret Manager secrets only
for SA in zapheit-api zapheit-runtime; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

# ── Step 4: Grant Cloud Build permissions ─────────────────────────────────────
echo "[4/8] Granting Cloud Build IAM permissions..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/artifactregistry.writer" --quiet

# Allow Cloud Build to act as the dedicated service accounts during deploy
gcloud iam service-accounts add-iam-policy-binding \
  "zapheit-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" --quiet

gcloud iam service-accounts add-iam-policy-binding \
  "zapheit-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" --quiet

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/artifactregistry.reader" --quiet

# ── Step 5: Configure Docker auth ────────────────────────────────────────────
echo "[5/8] Configuring Docker credentials for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Step 6: Build & push images ──────────────────────────────────────────────
echo "[6/8] Building and pushing images..."

echo "  Building synthetic-hr-api..."
docker build \
  --platform=linux/amd64 \
  -t "${REGISTRY}/synthetic-hr-api:${COMMIT_SHA}" \
  -t "${REGISTRY}/synthetic-hr-api:latest" \
  ./synthetic-hr-api
docker push --all-tags "${REGISTRY}/synthetic-hr-api"

echo "  Building synthetic-hr-runtime..."
docker build \
  --platform=linux/amd64 \
  -t "${REGISTRY}/synthetic-hr-runtime:${COMMIT_SHA}" \
  -t "${REGISTRY}/synthetic-hr-runtime:latest" \
  ./synthetic-hr-runtime
docker push --all-tags "${REGISTRY}/synthetic-hr-runtime"

# ── Step 7: Deploy to Cloud Run ───────────────────────────────────────────────
echo "[7/8] Deploying to Cloud Run..."

echo "  Deploying synthetic-hr-api..."
gcloud run deploy synthetic-hr-api \
  --image="${REGISTRY}/synthetic-hr-api:${COMMIT_SHA}" \
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
  --service-account="zapheit-api@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="NODE_ENV=NODE_ENV:latest,\
SUPABASE_URL=SUPABASE_URL:latest,\
SUPABASE_ANON_KEY=SUPABASE_ANON_KEY:latest,\
SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,\
JWT_SECRET=JWT_SECRET:latest,\
FRONTEND_URL=FRONTEND_URL:latest,\
API_URL=API_URL:latest,\
CORS_ALLOWED_ORIGINS=CORS_ALLOWED_ORIGINS:latest,\
OPENAI_API_KEY=OPENAI_API_KEY:latest,\
ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,\
RASI_OPENAI_API_KEY=RASI_OPENAI_API_KEY:latest,\
RASI_ANTHROPIC_API_KEY=RASI_ANTHROPIC_API_KEY:latest,\
RASI_OPENROUTER_API_KEY=RASI_OPENROUTER_API_KEY:latest,\
DATABASE_URL=DATABASE_URL:latest,\
INTEGRATIONS_ENCRYPTION_KEY=INTEGRATIONS_ENCRYPTION_KEY:latest,\
ERASURE_SIGNING_SALT=ERASURE_SIGNING_SALT:latest,\
EMAIL_PROVIDER=EMAIL_PROVIDER:latest,\
EMAIL_FROM=EMAIL_FROM:latest,\
ALERT_EMAIL_TO=ALERT_EMAIL_TO:latest,\
RESEND_API_KEY=RESEND_API_KEY:latest,\
CASHFREE_CLIENT_ID=CASHFREE_CLIENT_ID:latest,\
CASHFREE_CLIENT_SECRET=CASHFREE_CLIENT_SECRET:latest,\
CASHFREE_API_VERSION=CASHFREE_API_VERSION:latest,\
CASHFREE_ENVIRONMENT=CASHFREE_ENVIRONMENT:latest,\
CASHFREE_WEBHOOK_SECRET=CASHFREE_WEBHOOK_SECRET:latest,\
GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,\
GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,\
SLACK_CLIENT_ID=SLACK_CLIENT_ID:latest,\
SLACK_CLIENT_SECRET=SLACK_CLIENT_SECRET:latest,\
SLACK_SIGNING_SECRET=SLACK_SIGNING_SECRET:latest,\
CONNECTORS_ENABLED=CONNECTORS_ENABLED:latest,\
CROSS_BORDER_PII_MASKING=CROSS_BORDER_PII_MASKING:latest,\
SCHEMA_COMPAT_STRICT_OPTIONAL=SCHEMA_COMPAT_STRICT_OPTIONAL:latest,\
REDTEAM_INTERVAL_MINUTES=REDTEAM_INTERVAL_MINUTES:latest,\
RECRUITMENT_SCORING_MODEL=RECRUITMENT_SCORING_MODEL:latest,\
OTEL_ENABLED=OTEL_ENABLED:latest" \
  --project="${PROJECT_ID}"

echo "  Deploying synthetic-hr-runtime..."
gcloud run deploy synthetic-hr-runtime \
  --image="${REGISTRY}/synthetic-hr-runtime:${COMMIT_SHA}" \
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
  --service-account="zapheit-runtime@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-secrets="SYNTHETICHR_CONTROL_PLANE_URL=SYNTHETICHR_CONTROL_PLANE_URL:latest,\
SYNTHETICHR_API_KEY=SYNTHETICHR_API_KEY:latest,\
SYNTHETICHR_RUNTIME_ID=SYNTHETICHR_RUNTIME_ID:latest,\
SYNTHETICHR_ENROLLMENT_TOKEN=SYNTHETICHR_ENROLLMENT_TOKEN:latest,\
SYNTHETICHR_RUNTIME_SECRET=SYNTHETICHR_RUNTIME_SECRET:latest,\
SYNTHETICHR_MODEL=SYNTHETICHR_MODEL:latest" \
  --project="${PROJECT_ID}"

# ── Step 8: Uptime check + budget alert ──────────────────────────────────────
echo "[8/8] Setting up monitoring and budget alert..."

API_URL=$(gcloud run services describe synthetic-hr-api \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

# Uptime check for the API health endpoint
gcloud monitoring uptime create zapheit-api-health \
  --display-name="Zapheit API Health" \
  --http-check-path="/health" \
  --hostname="${API_URL#https://}" \
  --port=443 \
  --use-ssl \
  --project="${PROJECT_ID}" \
  2>/dev/null || echo "  (uptime check already exists or skipped)"

# Budget alert at ₹2000/month (~$24) — adjust as needed
if [ -n "${BILLING_ACCOUNT}" ]; then
  gcloud billing budgets create \
    --billing-account="${BILLING_ACCOUNT}" \
    --display-name="Zapheit Monthly Budget" \
    --budget-amount="2000INR" \
    --threshold-rule=percent=50 \
    --threshold-rule=percent=90 \
    --threshold-rule=percent=100 \
    2>/dev/null || echo "  (budget alert already exists or skipped)"
else
  echo "  (skipping budget alert — billing account not found)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== Deploy complete! ==="
echo ""
echo "API URL: ${API_URL}"
echo "Health:  ${API_URL}/health"
echo ""
echo "Next steps:"
echo "  1. Run the secrets setup: bash deploy/gcp/secrets.sh"
echo "  2. Update API_URL secret with: ${API_URL}"
echo "  3. Update VITE_API_URL on Vercel to: ${API_URL}"
echo "  4. Connect Cloud Build to GitHub — see deploy/gcp/README.md Step 7"
echo "  5. (Optional) Map custom domain api.zapheit.com — see README.md Step 10"
