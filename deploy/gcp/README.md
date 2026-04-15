# GCP Cloud Run Deployment Guide

This guide covers the one-time manual setup on GCP, then automated deploys via Cloud Build on every push.

---

## Prerequisites

- Google account with billing enabled
- `gcloud` CLI installed: https://cloud.google.com/sdk/docs/install
- `docker` installed and running
- Access to the GitHub repo

---

## Step 1 — Create a GCP Project

1. Go to https://console.cloud.google.com
2. Click the project selector at the top → **New Project**
3. Name: `zapheit-prod` (or anything you prefer)
4. Note the **Project ID** — you'll use it throughout (e.g. `zapheit-prod-123456`)
5. Wait for the project to be created

---

## Step 2 — Enable Billing

1. In the GCP console, go to **Billing**
2. Link a billing account to your project
3. Cloud Run has a generous free tier — you won't be charged for light traffic

---

## Step 3 — Enable Required APIs

Run this once (replace `YOUR_PROJECT_ID`):

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

Or in the console: go to **APIs & Services** → **Enable APIs** → search and enable each one.

---

## Step 4 — Create Artifact Registry Repository

```bash
gcloud artifacts repositories create zapheit \
  --repository-format=docker \
  --location=asia-south1 \
  --description="Zapheit container images" \
  --project=YOUR_PROJECT_ID
```

---

## Step 5 — Add Secrets to Secret Manager

Each secret is a key → value pair. Add them one by one:

```bash
# Helper function
secret() {
  echo -n "$2" | gcloud secrets create "$1" \
    --data-file=- \
    --project=YOUR_PROJECT_ID \
    --replication-policy=automatic 2>/dev/null \
    || echo -n "$2" | gcloud secrets versions add "$1" \
       --data-file=- \
       --project=YOUR_PROJECT_ID
}
```

### API secrets (synthetic-hr-api)

```bash
secret NODE_ENV            "production"
secret SUPABASE_URL        "https://xxxx.supabase.co"
secret SUPABASE_ANON_KEY   "eyJ..."
secret SUPABASE_SERVICE_KEY "eyJ..."
secret JWT_SECRET          "your-supabase-jwt-secret"
secret FRONTEND_URL        "https://app.zapheit.com"
secret API_URL             "https://api.zapheit.com"   # Cloud Run URL — update after first deploy
secret OPENAI_API_KEY      "sk-..."
secret DATABASE_URL        "postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres"
secret INTEGRATIONS_ENCRYPTION_KEY "$(openssl rand -hex 32)"
```

Optional but recommended:
```bash
secret ANTHROPIC_API_KEY   "sk-ant-..."
secret ERASURE_SIGNING_SALT "$(openssl rand -hex 16)"
secret RESEND_API_KEY      "re_..."
secret EMAIL_FROM          "no-reply@zapheit.com"
```

### Runtime secrets (synthetic-hr-runtime)

```bash
secret SYNTHETICHR_CONTROL_PLANE_URL "https://api.zapheit.com"  # same as API_URL above
secret SYNTHETICHR_API_KEY           "your-runtime-api-key"     # from Zapheit dashboard → Runtime
secret SYNTHETICHR_RUNTIME_ID        "your-runtime-uuid"        # from Zapheit dashboard → Runtime
secret SYNTHETICHR_MODEL             "gpt-4o"
```

> To get `SYNTHETICHR_API_KEY` and `SYNTHETICHR_RUNTIME_ID`: first deploy the API, log into the dashboard, go to **Runtime** settings, and register a runtime instance.

---

## Step 6 — Grant Cloud Build Access to Secrets

Cloud Build runs as a service account. Grant it permission to read Secret Manager secrets and deploy to Cloud Run:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format="value(projectNumber)")

# Allow Cloud Build to access secrets
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Allow Cloud Build to deploy Cloud Run services
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

# Allow Cloud Build to push images to Artifact Registry
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

# Allow Cloud Run to pull images from Artifact Registry
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/artifactregistry.reader"
```

---

## Step 7 — Connect Cloud Build to GitHub

1. Go to **Cloud Build** → **Triggers** in the GCP console
2. Click **Connect Repository**
3. Select **GitHub (Cloud Build GitHub App)**
4. Authenticate with GitHub and choose your repo (`Zapheit`)
5. Click **Connect**

### Create trigger for synthetic-hr-api

1. Click **Create Trigger**
2. Name: `deploy-api`
3. Event: **Push to a branch**
4. Branch: `^main$`
5. Build configuration: **Cloud Build configuration file**
6. Location: `synthetic-hr-api/cloudbuild.yaml`
7. Click **Save**

### Create trigger for synthetic-hr-runtime

Repeat the same steps:
1. Name: `deploy-runtime`
2. Same branch and settings
3. Configuration file: `synthetic-hr-runtime/cloudbuild.yaml`
4. Click **Save**

> By default triggers fire on every push to `main`. If you only want to trigger when those directories change, add an **Included files filter**: `synthetic-hr-api/**` or `synthetic-hr-runtime/**`.

---

## Step 8 — First Deploy (Manual)

For the very first deploy, run the script from the repo root:

```bash
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=asia-south1
bash deploy/gcp/deploy.sh
```

This will:
1. Enable APIs (idempotent)
2. Create the Artifact Registry repo (idempotent)
3. Build and push both Docker images
4. Deploy both Cloud Run services

At the end it prints the **API URL** (looks like `https://synthetic-hr-api-xxxx-el.a.run.app`).

---

## Step 9 — Update API_URL Secrets

After the first deploy you'll have a real URL. Update two secrets:

```bash
API_URL="https://synthetic-hr-api-xxxx-el.a.run.app"  # replace with your URL

echo -n "$API_URL" | gcloud secrets versions add API_URL \
  --data-file=- --project=YOUR_PROJECT_ID

echo -n "$API_URL" | gcloud secrets versions add SYNTHETICHR_CONTROL_PLANE_URL \
  --data-file=- --project=YOUR_PROJECT_ID
```

Then update your Vercel environment variable:
1. Go to **Vercel** → your project → **Settings** → **Environment Variables**
2. Update `VITE_API_URL` to the new API URL
3. Redeploy the frontend

---

## Step 10 — Set Up a Custom Domain (Optional)

1. Go to **Cloud Run** → `synthetic-hr-api` → **Manage Custom Domains**
2. Click **Add Mapping**
3. Enter `api.zapheit.com`
4. GCP will give you a DNS record (CNAME or A) — add it to your domain registrar
5. GCP auto-provisions a TLS certificate

Repeat for the frontend on Vercel: **Vercel** → Settings → Domains → `app.zapheit.com`.

---

## After Setup — Every Deploy is Automatic

Once Cloud Build triggers are connected, every push to `main` automatically:
1. Builds the Docker image
2. Pushes to Artifact Registry
3. Deploys to Cloud Run (zero-downtime rolling update)

No manual action needed after initial setup.

---

## Cost Estimate (asia-south1)

| Service | Config | Est. Monthly Cost |
|---|---|---|
| Cloud Run API | 512MB, 1vCPU, min 1 instance | $3–8 |
| Cloud Run Runtime | 256MB, 1vCPU, min 1 instance | $2–4 |
| Artifact Registry | ~2 images stored | ~$0.10 |
| Secret Manager | <10 secrets, <10K reads | Free |
| Cloud Build | 120 free mins/day | Free |
| **Total** | | **~$5–12/month** |

---

## Troubleshooting

**Build fails with "permission denied" pushing to Artifact Registry**  
→ Re-run Step 6 to ensure the Cloud Build service account has `artifactregistry.writer`.

**Cloud Run service returns 403**  
→ The runtime service is `--no-allow-unauthenticated` by design (internal). The API service should be `--allow-unauthenticated`.

**Runtime not polling / no jobs executing**  
→ Check `SYNTHETICHR_CONTROL_PLANE_URL` and `SYNTHETICHR_API_KEY` secrets are correct. View logs: `gcloud run services logs read synthetic-hr-runtime --region=asia-south1`.

**Environment variable not found at runtime**  
→ The secret may not be in Secret Manager, or the Cloud Run service account lacks `secretmanager.secretAccessor`. Check the Cloud Run logs for the specific secret name.

**Cold starts on the API**  
→ `--min-instances=1` is set, so there should be no cold starts. If you're seeing them, verify the config: `gcloud run services describe synthetic-hr-api --region=asia-south1`.
