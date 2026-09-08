#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ZIP_PATH="${PROJECT_ROOT}/build_dev.zip"
RUN_BUILD=1
KEEP_TEMP=0

usage() {
  cat <<'USAGE'
Usage: scripts/verify-rc-zip.sh [--zip PATH] [--skip-build] [--keep-temp]

Validates the RC deployment archive and, by default, proves that the frontend
can build from a clean extracted copy of build_dev.zip.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip)
      shift
      [[ $# -gt 0 ]] || { echo "Missing value for --zip" >&2; exit 2; }
      ZIP_PATH="$1"
      ;;
    --skip-build)
      RUN_BUILD=0
      ;;
    --keep-temp)
      KEEP_TEMP=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "${ZIP_PATH}" != /* ]]; then
  ZIP_PATH="${PROJECT_ROOT}/${ZIP_PATH}"
fi

[[ -f "${ZIP_PATH}" ]] || { echo "Archive not found: ${ZIP_PATH}" >&2; exit 1; }

hash_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

ZIP_ENTRIES="$(unzip -Z1 "${ZIP_PATH}")"

require_entry() {
  local entry="$1"
  if ! grep -qxF "${entry}" <<< "${ZIP_ENTRIES}"; then
    echo "Missing archive entry: ${entry}" >&2
    exit 1
  fi
}

require_text() {
  local entry="$1"
  local text="$2"
  local content
  content="$(unzip -p "${ZIP_PATH}" "${entry}")"
  if ! grep -qF -- "${text}" <<< "${content}"; then
    echo "Missing expected text in ${entry}: ${text}" >&2
    exit 1
  fi
}

reject_text() {
  local entry="$1"
  local text="$2"
  local content
  content="$(unzip -p "${ZIP_PATH}" "${entry}")"
  if grep -qF -- "${text}" <<< "${content}"; then
    echo "Unexpected text in ${entry}: ${text}" >&2
    exit 1
  fi
}

echo "Testing compressed archive data..."
unzip -tq "${ZIP_PATH}"

echo "Checking required entries..."
require_entry "ingestion/frontend/package.json"
require_entry "ingestion/frontend/scripts/prepare-jet-assets.mjs"
require_entry "ingestion/frontend/src/components/ImportanceModal.jsx"
require_entry "ingestion/frontend/src/content/importanceContent.js"
require_entry "ingestion/frontend/src/styles/index.css"
require_entry "ingestion/frontend/src/pages/BronzeDataLoadGuide.jsx"
require_entry "ingestion/backend/routes/awsGlue.js"
require_entry "ingestion/gravitino/Dockerfile"
require_entry "ingestion/gravitino/entrypoint.sh"
require_entry "ingestion/iceberg-seeder/Dockerfile"
require_entry "ingestion/iceberg-seeder/seed_product_master.py"
require_entry "init/create-pg-iceberg-connection.sh"
require_entry "init/create-iceberg-adb-external-table.sh"
require_entry "init/adb-wallet.sh"
require_entry "init/pg-iceberg-connection.service"
require_entry "init/iceberg-seed.service"
require_entry "prepare-custom-image.sh"
require_entry "scripts/build-rc-zip.sh"
require_entry "scripts/verify-rc-zip.sh"
require_entry "tests/test-custom-image-preparation.sh"
require_entry "tests/test-source-database-compose.sh"
require_entry "tests/test-aws-glue-catalog.sh"
require_entry "tests/test-data-transforms-connection-provisioning.sh"
require_entry "tests/test-wallet-hardening.sh"
require_entry "tests/test-osa-streaming-restart-safety.sh"

echo "Checking excluded runtime/build artifacts..."
forbidden_entries="$(
  grep -Ei '(^|/)(node_modules|__pycache__|\.git|\.omx|tmp|output)/|^ingestion/frontend/dist/|^ingestion/dist/|\.pyc$|\.done$|oradata|build_dev\.zip|\.bak-|(^|/)(Wallet[^/]*\.zip|wallet\.zip|goldengate-studio-wallet\.zip|cwallet\.sso|ewallet\.p12|ewallet\.pem|ojdbc\.properties|tnsnames\.ora|sqlnet\.ora|keystore\.jks|truststore\.jks)$' <<< "${ZIP_ENTRIES}" || true
)"
if [[ -n "${forbidden_entries}" ]]; then
  echo "Forbidden archive entries found:" >&2
  echo "${forbidden_entries}" >&2
  exit 1
fi

echo "Checking release-critical frontend content..."
require_text "ingestion/frontend/src/components/ImportanceModal.jsx" "Business outcome for"
require_text "ingestion/frontend/src/components/ImportanceModal.jsx" "Built by"
require_text "ingestion/frontend/src/content/importanceContent.js" "Oracle Autonomous AI Lakehouse"
require_text "ingestion/frontend/src/content/importanceContent.js" "without copying data"
require_text "ingestion/frontend/src/styles/index.css" "z-index: 12000"
require_text "ingestion/frontend/src/styles/index.css" "streaming-importance-personas"
require_text "ingestion/frontend/src/pages/BronzeDataLoadGuide.jsx" "LiveLabs Batch and File Loading guide"
reject_text "ingestion/frontend/src/pages/BronzeDataLoadGuide.jsx" "DEMAND_SIGNALS_RAW"
reject_text "ingestion/frontend/src/pages/BronzeDataLoadGuide.jsx" "demand_signals_raw"

echo "Checking deployment health-check configuration..."
require_text "ingestion/compose.yml" "hostname: gravitino"
reject_text "ingestion/compose.yml" "GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL:"
require_text "ingestion/compose.yml" 'http://127.0.0.1:$${GRAVITINO_HTTP_PORT:-1525}/iceberg/v1/config'
require_text "ingestion/compose.yml" 'GRAVITINO_JDBC_USER: ${GRAVITINO_JDBC_USER:-PG}'
require_text "ingestion/compose.yml" "hostname: iceberg-seeder"
require_text "ingestion/compose.yml" 'ICEBERG_SEED_NAMESPACE: ${ICEBERG_SEED_NAMESPACE:-bronze}'
require_text "ingestion/compose.yml" 'ICEBERG_SEED_TABLE: ${ICEBERG_SEED_TABLE:-product_master_raw}'
require_text "ingestion/compose.yml" 'ICEBERG_SEED_FILE_IO: ${ICEBERG_SEED_FILE_IO:-seed_product_master.OCIS3FsspecFileIO}'
require_text "ingestion/compose.yml" 'ICEBERG_SEED_ADB_METADATA: ${ICEBERG_SEED_ADB_METADATA:-true}'
require_text "inst.sh" "pg-iceberg-connection.service"
require_text "inst.sh" "iceberg-seed.service"
require_text "inst.sh" "create-iceberg-adb-external-table.sh"
require_text "inst.sh" "/usr/local/bin/podman-compose -f compose.yml --profile seed build iceberg-seeder"
require_text "inst.sh" "sudo pip3.11 install oracledb dotenv requests"
require_text "inst.sh" "OCI metadata key build_archive_url"
reject_text "inst.sh" 'BUILD_ARCHIVE_URL="https://'
require_text "prepare-custom-image.sh" "Cleared generated wallet state"
require_text "prepare-custom-image.sh" "remove_configured_wallet_archive"
require_text "prepare-custom-image.sh" "remove_home_wallet_archives"
require_text "prepare-custom-image.sh" ".oci_wallet_required"
require_text "prepare-custom-image.sh" "Offline artifact preflight failed. No cleanup was performed."
require_text "prepare-custom-image.sh" "label=io.podman.compose.project="
require_text "prepare-custom-image.sh" 'run_compose down --remove-orphans'
require_text "prepare-custom-image.sh" '"ollama-models"'
require_text "prepare-custom-image.sh" '"app-node-modules"'
require_text "prepare-custom-image.sh" '"frontend-node-modules"'
require_text "prepare-custom-image.sh" '"signal-generator-node-modules"'
require_text "prepare-custom-image.sh" '"${PODMAN_BIN}" volume rm "${volume_name}"'
reject_text "prepare-custom-image.sh" "down --volumes"
require_text "prepare-custom-image.sh" "Removed build fallback environment"
require_text "prepare-custom-image.sh" "Removed generated compose environment"
require_text "prepare-custom-image.sh" "Removed installer log"
require_text "prepare-custom-image.sh" "home OCI credential"
require_text "prepare-custom-image.sh" "generated GoldenGate TLS credential"
require_text "init/adb-wallet.sh" "refusing to install the static fallback wallet"
require_text "init/adb-wallet.sh" "validate_wallet_password"
require_text "scripts/build-rc-zip.sh" "ewallet.p12"
require_text "scripts/build-rc-zip.sh" "ojdbc.properties"
require_text "scripts/build-rc-zip.sh" "BUILD_ARCHIVE_UPLOAD_URL_PREFIX"
reject_text "scripts/build-rc-zip.sh" 'BUILD_ARCHIVE_UPLOAD_URL_PREFIX="https://'
require_text "inst.sh" 'CON_USER'
require_text "inst.sh" 'CON_TOK'
require_text "inst.sh" '--password-stdin'
require_text "inst.sh" 'podman login container-registry.oracle.com'
reject_text "inst.sh" '--password "${CON_TOK}"'
reject_text "inst.sh" '-p "${CON_TOK}"'
require_text "init/variable.sh" 'export_metadata_or_default "GRAVITINO_REST_PORT" "gravitino_rest_port" "1525"'
require_text "init/variable.sh" 'export_metadata_or_default "DATA_TRANSFORMS_ADB_AUTO_CONFIGURE"'
require_text "init/variable.sh" 'export_metadata_or_default "DATA_TRANSFORMS_ADB_USERNAME"'
require_text "init/variable.sh" 'export_metadata_or_default "ICEBERG_SEED_NAMESPACE" "iceberg_seed_namespace"'
require_text "init/variable.sh" 'export_metadata_or_default "ICEBERG_ADB_EXTERNAL_TABLE" "iceberg_adb_external_table"'
require_text "init/setenv.sh" 'echo "GRAVITINO_JDBC_PASSWORD=${DBPASSWORD}"'
require_text "init/setenv.sh" 'echo "GRAVITINO_JDBC_SERVICE_NAME=${DBNAME}_high"'
require_text "init/setenv.sh" 'echo "GRAVITINO_WAREHOUSE=s3a://${BUCKET_NAME}/${GRAVITINO_OBJECT_STORAGE_PREFIX:-iceberg}"'
require_text "init/setenv.sh" 'echo "DATA_TRANSFORMS_ADB_CONNECTION_NAME=${DATA_TRANSFORMS_ADB_CONNECTION_NAME:-${DBNAME:-}}"'
require_text "init/setenv.sh" 'echo "DATA_TRANSFORMS_ADB_USERNAME=${DATA_TRANSFORMS_ADB_USERNAME:-PG}"'
require_text "init/pg-iceberg-connection.service" "After=network-online.target adb-wallet.service adb-load.service user-podman.service"
require_text "init/iceberg-seed.service" "--profile seed"
require_text "init/iceberg-seed.service" "--profile seed run --rm iceberg-seeder"
reject_text "init/iceberg-seed.service" "build iceberg-seeder"
require_text "init/iceberg-seed.service" "create-iceberg-adb-external-table.sh"
require_text "init/create-pg-iceberg-connection.sh" "DEFAULT_CONNECTION_NAME=\"pg-iceberg\""
require_text "init/create-pg-iceberg-connection.sh" "build_adb_connection_payload"
require_text "init/create-pg-iceberg-connection.sh" 'properties["password"] = base64.b64encode('
require_text "init/create-pg-iceberg-connection.sh" 'configure_adb_connection "${api_prefix}"'
require_text "init/create-pg-iceberg-connection.sh" "import requests"
require_text "init/create-pg-iceberg-connection.sh" "jobs/test_connection"
require_text "init/create-pg-iceberg-connection.sh" '"enableCredentialVending": "true"'
require_text "init/create-pg-iceberg-connection.sh" '"s3AccessID": os.environ["S3_ACCESS_ID"]'
require_text "init/create-pg-iceberg-connection.sh" '"s3Region": os.environ["S3_REGION"]'
require_text "init/create-pg-iceberg-connection.sh" '"azureAccountKey": None'
require_text "init/create-pg-iceberg-connection.sh" '"s3SecretKey": os.environ["S3_SECRET_KEY"]'
reject_text "init/create-pg-iceberg-connection.sh" "continuing with the persisted Iceberg connection"
require_text "init/create-iceberg-adb-external-table.sh" "DBMS_CLOUD.CREATE_EXTERNAL_TABLE"
require_text "init/create-iceberg-adb-external-table.sh" "PG_OCI_GENAI_CRED"
require_text "init/create-iceberg-adb-external-table.sh" "set +u"
require_text "ingestion/gravitino/entrypoint.sh" "org.apache.iceberg.adw.ADWCatalog"
require_text "ingestion/gravitino/Dockerfile" "Provide a staged Gravitino ZIP in ingestion/gravitino/dist."
reject_text "ingestion/gravitino/Dockerfile" "ARG GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL"
require_text "ingestion/iceberg-seeder/Dockerfile" "pyiceberg[pyarrow,s3fs]==0.11.1"
require_text "ingestion/iceberg-seeder/seed_product_master.py" "OCIS3FsspecFileIO"
require_text "ingestion/iceberg-seeder/seed_product_master.py" "request_checksum_calculation"
require_text "ingestion/iceberg-seeder/seed_product_master.py" "publish_adb_metadata"
require_text "ingestion/iceberg-seeder/seed_product_master.py" "oci://"
require_text "ingestion/iceberg-seeder/seed_product_master.py" "table.append"
require_text "ingestion/demodata/bronze/product_master_raw.csv" "Databricks,BRZ-PROD-20260520-01"
reject_text "ingestion/demodata/bronze/product_master_raw.csv" "NETSUITE,BRZ-PROD-20260520-01"
require_text "ingestion/compose.yml" 'curl -fsS -u \"$${OGG_ADMIN}:$${OGG_ADMIN_PWD}\"'
require_text "ingestion/compose.yml" 'services/$${OGG_DEPLOYMENT:-PeakGearCDC}/adminsrvr/v2/config/health'
require_text "ingestion/compose.yml" '"${GGSA_OSA_HTTPS_PORT:-8085}:${GGSA_OSA_HTTPS_PORT:-8085}"'
reject_text "ingestion/compose.yml" 'curl -fsS http://127.0.0.1:8080/services/${GOLDENGATE_DEPLOYMENT:-PeakGearCDC}'
require_text "ingestion/cdc/goldengate-runtime/ensure-pmsrvr.sh" '-u "${admin}:${password}"'
require_text "ingestion/cdc/goldengate-runtime/start-goldengate-runtime.sh" "-name '*-config.dat' -delete"
require_text "ingestion/cdc/goldengate-runtime/start-goldengate-runtime.sh" '"${service_manager_run_dir}/session.dat"'
require_text "ingestion/compose.yml" "hostname: postgres-source"
require_text "ingestion/compose.yml" '"${POSTGRES_SOURCE_PORT:-8504}:5432"'
require_text "ingestion/compose.yml" "hostname: loyalty-mysql"
require_text "ingestion/compose.yml" '"${LOYALTY_MYSQL_PORT:-8503}:3306"'
require_text "ingestion/compose.yml" "hostname: mongodb-catalog"
require_text "ingestion/compose.yml" '"${MONGODB_CATALOG_PORT:-27017}:27017"'
require_text "init/setenv.sh" 'POSTGRES_SOURCE_PORT=${POSTGRES_SOURCE_PORT:-8504}'
require_text "init/setenv.sh" 'LOYALTY_MYSQL_PORT=${LOYALTY_MYSQL_PORT:-8503}'
require_text "init/setenv.sh" 'MONGODB_CATALOG_PORT=${MONGODB_CATALOG_PORT:-27017}'
require_text "init/setenv.sh" 'SOURCE_PUBLIC_HOST=${SOURCE_PUBLIC_HOST:-${PUBLIC_IP}}'
require_text "ingestion/frontend/src/pages/DataSources.jsx" "Data Sources"
require_text "ingestion/backend/routes/dataSources.js" 'postgresql://${host}'
require_text "ingestion/backend/routes/awsGlue.js" "DBMS_CATALOG.MOUNT_DATA_CATALOG"
require_text "ingestion/backend/routes/awsGlue.js" "data_catalog_type       => 'AWS_GLUE'"
require_text "ingestion/backend/lib/customerCdcSetup.js" 'const STUDIO_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000'
require_text "ingestion/backend/lib/customerCdcSetup.js" 'activeToken = await studioLogin(config, { force: true })'

if [[ "${RUN_BUILD}" -eq 1 ]]; then
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/ll-lakehouse-rc-verify-XXXXXX")"
  cleanup() {
    if [[ "${KEEP_TEMP}" -eq 1 ]]; then
      echo "Kept extracted archive at ${tmp_dir}"
    else
      rm -rf "${tmp_dir}"
    fi
  }
  trap cleanup EXIT

  echo "Testing clean extracted archive..."
  unzip -q "${ZIP_PATH}" -d "${tmp_dir}"
  bash "${tmp_dir}/tests/test-custom-image-preparation.sh"
  bash "${tmp_dir}/tests/test-source-database-compose.sh"
  bash "${tmp_dir}/tests/test-aws-glue-catalog.sh"
  bash "${tmp_dir}/tests/test-data-transforms-connection-provisioning.sh"
  bash "${tmp_dir}/tests/test-wallet-hardening.sh"
  bash "${tmp_dir}/tests/test-osa-streaming-restart-safety.sh"
  echo "Building frontend from clean extracted archive..."
  cd "${tmp_dir}/ingestion/frontend"
  npm_config_cache="${tmp_dir}/.npm-cache" npm ci --include=dev
  npm run build
fi

echo "RC archive verified: ${ZIP_PATH}"
echo "sha256=$(hash_file "${ZIP_PATH}")"
