#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ROUTE_FILE="${PROJECT_ROOT}/ingestion/backend/routes/awsGlue.js"
SERVER_FILE="${PROJECT_ROOT}/ingestion/backend/server.js"
API_FILE="${PROJECT_ROOT}/ingestion/frontend/src/utils/api.js"
PAGE_FILE="${PROJECT_ROOT}/ingestion/frontend/src/pages/AIDataLakehouse.jsx"
APP_FILE="${PROJECT_ROOT}/ingestion/frontend/src/App.jsx"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_text() {
  local file="$1"
  local expected="$2"
  grep -qF -- "${expected}" "${file}" || fail "Missing expected text in ${file}: ${expected}"
}

reject_text() {
  local file="$1"
  local unexpected="$2"
  if grep -qF -- "${unexpected}" "${file}"; then
    fail "Unexpected text in ${file}: ${unexpected}"
  fi
}

node --check "${ROUTE_FILE}"
require_text "${SERVER_FILE}" "const awsGlueRoutes = require('./routes/awsGlue');"
require_text "${SERVER_FILE}" "app.use('/api/aws-glue', awsGlueRoutes);"
reject_text "${ROUTE_FILE}" "AI Hub AWS Glue integration is not enabled."
reject_text "${ROUTE_FILE}" "function aiHubEnabled()"
require_text "${ROUTE_FILE}" "requireAdminDemoUser"
require_text "${ROUTE_FILE}" "res.set('Cache-Control', 'no-store');"
require_text "${ROUTE_FILE}" "host       => :s3Host"
require_text "${ROUTE_FILE}" "host       => '*.amazonaws.com'"
require_text "${ROUTE_FILE}" "DBMS_CLOUD.CREATE_CREDENTIAL"
require_text "${ROUTE_FILE}" "DBMS_CATALOG.MOUNT_DATA_CATALOG"
require_text "${ROUTE_FILE}" "data_catalog_type       => 'AWS_GLUE'"
require_text "${ROUTE_FILE}" "accessKeyId,"
require_text "${ROUTE_FILE}" "secretAccessKey,"
reject_text "${ROUTE_FILE}" "console.error('AWS Glue catalog configuration failed:', err.message)"
require_text "${API_FILE}" "awsGlue:"
require_text "${API_FILE}" "apiFetch('/aws-glue'"
require_text "${PAGE_FILE}" "AWS Glue Data Catalog"
require_text "${PAGE_FILE}" "AWS Region"
require_text "${PAGE_FILE}" "setSecretAccessKey('');"
require_text "${PAGE_FILE}" "<button type=\"submit\" className=\"btn-primary\" disabled={submitting}>"
require_text "${PAGE_FILE}" "<AwsGlueCatalogSection />"
reject_text "${APP_FILE}" "aiHubEnabled,"

echo "AWS Glue catalog checks passed."
