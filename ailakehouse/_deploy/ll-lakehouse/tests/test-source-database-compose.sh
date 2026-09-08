#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/ingestion/compose.yml"
SETENV_FILE="${PROJECT_ROOT}/init/setenv.sh"
VARIABLE_FILE="${PROJECT_ROOT}/init/variable.sh"
PODMAN_SERVICE_FILE="${PROJECT_ROOT}/init/user-podman.service"
APP_FILE="${PROJECT_ROOT}/ingestion/frontend/src/App.jsx"
API_FILE="${PROJECT_ROOT}/ingestion/frontend/src/utils/api.js"
PAGE_FILE="${PROJECT_ROOT}/ingestion/frontend/src/pages/DataSources.jsx"
ROUTE_FILE="${PROJECT_ROOT}/ingestion/backend/routes/dataSources.js"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_text() {
  local file="$1"
  local expected="$2"

  grep -qF -- "${expected}" "${file}" || fail "Missing expected text in ${file}: ${expected}"
}

service_block() {
  local service_name="$1"

  awk -v service="${service_name}:" '
    $0 == "  " service { in_service = 1; next }
    in_service && /^  [A-Za-z0-9_-]+:$/ { exit }
    in_service { print }
  ' "${COMPOSE_FILE}"
}

require_service_text() {
  local service_name="$1"
  local expected="$2"
  local block

  block="$(service_block "${service_name}")"
  grep -qF -- "${expected}" <<< "${block}" \
    || fail "Missing expected text in ${service_name} service: ${expected}"
}

for volume in postgres-source-data loyalty-mysql-data mongodb-catalog-data; do
  require_text "${COMPOSE_FILE}" "  ${volume}:"
done

require_service_text "postgres-source" "hostname: postgres-source"
require_service_text "postgres-source" 'image: ${POSTGRES_SOURCE_IMAGE:-docker.io/library/postgres:17.11-bookworm}'
if grep -qF -- "profiles:" <<< "$(service_block "postgres-source")"; then
  fail "PostgreSQL must be included in every image, not gated by AIHUB"
fi
require_service_text "postgres-source" '"${POSTGRES_SOURCE_PORT:-8504}:5432"'
require_service_text "postgres-source" "postgres-source-data:/var/lib/postgresql/data"
require_service_text "postgres-source" 'POSTGRES_USER: ${POSTGRES_SOURCE_USER:-PG}'
require_service_text "postgres-source" 'POSTGRES_PASSWORD: ${DBPASSWORD:-peakgear}'
require_service_text "postgres-source" "pg_isready -U"

require_service_text "loyalty-mysql" "hostname: loyalty-mysql"
require_service_text "loyalty-mysql" 'image: ${LOYALTY_MYSQL_IMAGE:-docker.io/library/mysql:8.4.11}'
if grep -qF -- "profiles:" <<< "$(service_block "loyalty-mysql")"; then
  fail "Loyalty MySQL must be included in every image, not gated by AIHUB"
fi
require_service_text "loyalty-mysql" '"${LOYALTY_MYSQL_PORT:-8503}:3306"'
require_service_text "loyalty-mysql" "loyalty-mysql-data:/var/lib/mysql"
require_service_text "loyalty-mysql" 'MYSQL_USER: ${LOYALTY_MYSQL_USER:-PG}'
require_service_text "loyalty-mysql" 'MYSQL_PASSWORD: ${DBPASSWORD:-peakgear}'
require_service_text "loyalty-mysql" 'MYSQL_ROOT_PASSWORD: ${DBPASSWORD:-peakgear}'
require_service_text "loyalty-mysql" "mysqladmin ping"

require_service_text "mongodb-catalog" "hostname: mongodb-catalog"
require_service_text "mongodb-catalog" 'image: ${MONGODB_CATALOG_IMAGE:-docker.io/library/mongo:8.0.29}'
require_service_text "mongodb-catalog" "profiles:"
require_service_text "mongodb-catalog" "- aihub"
require_service_text "mongodb-catalog" '"${MONGODB_CATALOG_PORT:-27017}:27017"'
require_service_text "mongodb-catalog" "mongodb-catalog-data:/data/db"
require_service_text "mongodb-catalog" 'MONGO_INITDB_ROOT_USERNAME: ${MONGODB_CATALOG_ROOT_USERNAME:-PG}'
require_service_text "mongodb-catalog" 'MONGO_INITDB_ROOT_PASSWORD: ${DBPASSWORD:-peakgear}'
require_service_text "mongodb-catalog" "mongosh --quiet"

require_service_text "goldengate-runtime" '"${GOLDENGATE_RUNTIME_HTTP_PORT:-8502}:8080"'
require_service_text "ggsa" '"${GGSA_MYSQL_PORT:-3306}:3306"'

for removed_variable in POSTGRES_SOURCE_PASSWORD LOYALTY_MYSQL_PASSWORD LOYALTY_MYSQL_ROOT_PASSWORD MONGODB_CATALOG_ROOT_PASSWORD; do
  if grep -qF -- "${removed_variable}" "${COMPOSE_FILE}" "${SETENV_FILE}"; then
    fail "Source database credentials must use DBPASSWORD, not ${removed_variable}"
  fi
done

for expected in \
  'AIHUB=${AIHUB}' \
  'POSTGRES_SOURCE_PORT=${POSTGRES_SOURCE_PORT:-8504}' \
  'LOYALTY_MYSQL_PORT=${LOYALTY_MYSQL_PORT:-8503}' \
  'MONGODB_CATALOG_PORT=${MONGODB_CATALOG_PORT:-27017}' \
  'SOURCE_PUBLIC_HOST=${SOURCE_PUBLIC_HOST:-${PUBLIC_IP}}' \
  'POSTGRES_SOURCE_USER=${POSTGRES_SOURCE_USER:-PG}' \
  'LOYALTY_MYSQL_USER=${LOYALTY_MYSQL_USER:-PG}' \
  'MONGODB_CATALOG_ROOT_USERNAME=${MONGODB_CATALOG_ROOT_USERNAME:-PG}'; do
  require_text "${SETENV_FILE}" "${expected}"
done

app_block="$(service_block "app")"
for expected in \
  'DBPASSWORD: ${DBPASSWORD:-}' \
  'AIHUB: ${AIHUB:-false}' \
  'SOURCE_PUBLIC_HOST: ${SOURCE_PUBLIC_HOST:-}' \
  'POSTGRES_SOURCE_PORT: ${POSTGRES_SOURCE_PORT:-8504}' \
  'LOYALTY_MYSQL_PORT: ${LOYALTY_MYSQL_PORT:-8503}' \
  'MONGODB_CATALOG_PORT: ${MONGODB_CATALOG_PORT:-27017}'; do
  grep -qF -- "${expected}" <<< "${app_block}" \
    || fail "Application service must expose source runtime configuration: ${expected}"
done

require_text "${VARIABLE_FILE}" '1|true|yes|on) export AIHUB=true ;'
require_text "${VARIABLE_FILE}" 'AIHUB_IMAGE_DEFAULT_FILE="${AIHUB_IMAGE_DEFAULT_FILE:-/home/opc/init/aihub-image-default.env}"'
require_text "${VARIABLE_FILE}" 'source "${AIHUB_IMAGE_DEFAULT_FILE}"'
if grep -qF -- '"AIHUB" "aihub"' "${VARIABLE_FILE}"; then
  fail "AIHUB must be selected by the custom image, not Terraform metadata"
fi
require_text "${PROJECT_ROOT}/inst.sh" 'AIHUB_IMAGE_DEFAULT_FILE="/home/opc/init/aihub-image-default.env"'
require_text "${PROJECT_ROOT}/inst.sh" 'AIHUB_IMAGE_DEFAULT=true'
require_text "${PODMAN_SERVICE_FILE}" 'podman-compose --profile aihub up'
require_text "${PODMAN_SERVICE_FILE}" 'podman-compose up'

AIHUB_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ll-lakehouse-aihub-default.XXXXXX")"
trap 'rm -rf "${AIHUB_TEST_DIR}"' EXIT
mkdir -p "${AIHUB_TEST_DIR}/bin"
cat > "${AIHUB_TEST_DIR}/bin/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"metadata/aihub"*) printf 'true\n' ;;
esac
EOF
chmod +x "${AIHUB_TEST_DIR}/bin/curl"

aihub_from_image_default() {
  local default_value="$1"
  local output

  printf 'AIHUB=%s\n' "${default_value}" > "${AIHUB_TEST_DIR}/aihub-image-default.env"
  output="$(PATH="${AIHUB_TEST_DIR}/bin:${PATH}" \
    AIHUB_IMAGE_DEFAULT_FILE="${AIHUB_TEST_DIR}/aihub-image-default.env" \
    bash -c 'source "$1"; printf "%s" "$AIHUB"' _ "${VARIABLE_FILE}")"
  [[ "${output}" == "${default_value}" ]] \
    || fail "Image AI Hub default ${default_value} was not preserved; got ${output}"
}

aihub_from_image_default true
aihub_from_image_default false

require_text "${APP_FILE}" "label: 'Data Sources'"
require_text "${APP_FILE}" "[DATA_SOURCES_PAGE_ID]: DataSources"
require_text "${APP_FILE}" "items.push(DATA_SOURCES_NAV_ITEM);"
if grep -qF -- "api.features.get()" "${APP_FILE}" "${API_FILE}"; then
  fail "Data Sources must not depend on the MongoDB feature flag"
fi
require_text "${PAGE_FILE}" "PostgreSQL and MySQL use the PG account and the shared DBPASSWORD."
require_text "${ROUTE_FILE}" "router.get('/', (req, res) =>"
require_text "${ROUTE_FILE}" "function mongoDbEnabled()"
require_text "${ROUTE_FILE}" "if (mongoDbEnabled())"
if grep -qF -- "AI Hub data sources are not enabled." "${ROUTE_FILE}"; then
  fail "PostgreSQL and MySQL Data Sources must remain available without AIHUB"
fi
require_text "${ROUTE_FILE}" 'postgresql://${host}'
require_text "${ROUTE_FILE}" 'mysql://${host}'
require_text "${ROUTE_FILE}" 'mongodb://${host}'

echo "Source database Compose checks passed."
