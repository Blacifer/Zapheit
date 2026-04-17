#!/usr/bin/env bash
# deploy/gcp/deploy-staging.sh
# Safe staging wrapper around deploy/gcp/deploy.sh

set -euo pipefail

export DEPLOY_ENV="${DEPLOY_ENV:-staging}"
export SERVICE_SUFFIX="${SERVICE_SUFFIX:--staging}"
export SECRET_SUFFIX="${SECRET_SUFFIX:-_STAGING}"
export BUILD_SA_NAME="${BUILD_SA_NAME:-cloudbuild-deployer-staging}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "${SCRIPT_DIR}/deploy.sh"
