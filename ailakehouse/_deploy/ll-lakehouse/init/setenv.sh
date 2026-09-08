#! /bin/bash
set -euo pipefail
# This script prepares the environment variables (.env) for each app container

# source the variable file
source /home/opc/init/variable.sh

# Every supported wallet is created with DBPASSWORD, so expose one derived
# runtime value instead of accepting a second independently configured secret.
export ADB_WALLET_PASSWORD="${DBPASSWORD}"

export POD_ROOT=/home/opc/ingestion/
APP_DIR="$POD_ROOT"
COMPOSE_ENV="$POD_ROOT/.env"

# Ensure the target app directory exists before writing runtime files.
mkdir -p "$APP_DIR"


# clean up existing things
sudo rm -rf /home/opc/.oci

# (re)create folders
mkdir -p "$APP_DIR/.oci"

GOLDENGATE_CERT_DIR="$APP_DIR/cdc/goldengate/cert"
GOLDENGATE_CERT_UID="${GOLDENGATE_CERT_CONTAINER_UID:-54321}"
mkdir -p "$GOLDENGATE_CERT_DIR"
if ! openssl x509 -in "$GOLDENGATE_CERT_DIR/ogg.pem" -noout >/dev/null 2>&1 || [ ! -s "$GOLDENGATE_CERT_DIR/ogg.key" ]; then
  rm -f "$GOLDENGATE_CERT_DIR/ogg.pem" "$GOLDENGATE_CERT_DIR/ogg.key"
  goldengate_san="DNS:goldengate-cdc,DNS:localhost,IP:127.0.0.1"
  if [[ "${PUBLIC_IP:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    goldengate_san="${goldengate_san},IP:${PUBLIC_IP}"
  fi
  if ! openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$GOLDENGATE_CERT_DIR/ogg.key" \
    -out "$GOLDENGATE_CERT_DIR/ogg.pem" \
    -subj "/CN=goldengate-cdc" \
    -addext "subjectAltName=${goldengate_san}" >/dev/null 2>&1; then
    rm -f "$GOLDENGATE_CERT_DIR/ogg.pem" "$GOLDENGATE_CERT_DIR/ogg.key"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
      -keyout "$GOLDENGATE_CERT_DIR/ogg.key" \
      -out "$GOLDENGATE_CERT_DIR/ogg.pem" \
      -subj "/CN=goldengate-cdc" >/dev/null 2>&1
  fi
fi
chmod 700 "$GOLDENGATE_CERT_DIR"
chmod 600 "$GOLDENGATE_CERT_DIR/ogg.key"
chmod 644 "$GOLDENGATE_CERT_DIR/ogg.pem"
if command -v podman >/dev/null 2>&1 && command -v setfacl >/dev/null 2>&1; then
  podman unshare setfacl -m "u:${GOLDENGATE_CERT_UID}:rx" "$GOLDENGATE_CERT_DIR" || true
  podman unshare setfacl -m "u:${GOLDENGATE_CERT_UID}:r" "$GOLDENGATE_CERT_DIR/ogg.key" "$GOLDENGATE_CERT_DIR/ogg.pem" || true
fi

# #create config
echo "[DEFAULT]" > "$APP_DIR/.oci/config"
echo "user=${USER_OCID}" >> "$APP_DIR/.oci/config"
echo "fingerprint=${PEM_KEY_FINGERPRINT}" >> "$APP_DIR/.oci/config"
echo "tenancy=${TENANCY_OCID}" >> "$APP_DIR/.oci/config"
echo "region=${REGION_IDENTIFIER}" >> "$APP_DIR/.oci/config"
echo "key_file=~/.oci/oci_api_key.pem" >> "$APP_DIR/.oci/config"

echo -e "$PEM_KEY" > "$APP_DIR/.oci/oci_api_key.pem"
chmod 700 "$APP_DIR/.oci"
chmod 600 "$APP_DIR/.oci/config" "$APP_DIR/.oci/oci_api_key.pem"

# # copy keys to ~/.oci/
install -d -m 700 /home/opc/.oci
install -m 600 "$APP_DIR/.oci/config" /home/opc/.oci/config
install -m 600 "$APP_DIR/.oci/oci_api_key.pem" /home/opc/.oci/oci_api_key.pem

#.env file for compose 


# Replace only this script's generated section in the ingestion .env file.
ENV_START_MARKER="# BEGIN ll-lakehouse generated env"
ENV_END_MARKER="# END ll-lakehouse generated env"
TMP_ENV="$(mktemp)"

touch "${COMPOSE_ENV}"
awk -v start="${ENV_START_MARKER}" -v end="${ENV_END_MARKER}" '
  $0 == start { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "${COMPOSE_ENV}" > "${TMP_ENV}"

if [ -s "${TMP_ENV}" ]; then
  printf '\n' >> "${TMP_ENV}"
fi

{
  echo "${ENV_START_MARKER}"
  echo -e "PEM_KEY=\"${PEM_KEY}\""
  echo "USERNAME=admin"
  echo "DBPASSWORD=${DBPASSWORD}"
  echo "PASSWORD=${DBPASSWORD}"
  echo "ORACLE_PWD=${DBPASSWORD}"
  echo "APP_SCHEMA_PASSWORD=${DBPASSWORD}"
  echo "GGSA_OSA_HTTPS_PORT=8085"
  echo "OSA_PUBLIC_URL=https://${PUBLIC_IP}:8085/osa/index.html"
  echo "NETSUITE_DB_PORT=1522"
  echo "NETSUITE_DB_PASSWORD=${DBPASSWORD}"
  echo "NETSUITE_DB_CONNECT_STRING=netsuite-db:1521/FREEPDB1"
  echo "AIHUB=${AIHUB}"
  echo "POSTGRES_SOURCE_IMAGE=${POSTGRES_SOURCE_IMAGE:-docker.io/library/postgres:17.11-bookworm}"
  echo "SOURCE_PUBLIC_HOST=${SOURCE_PUBLIC_HOST:-${PUBLIC_IP}}"
  echo "POSTGRES_SOURCE_PORT=${POSTGRES_SOURCE_PORT:-8504}"
  echo "POSTGRES_SOURCE_DB=${POSTGRES_SOURCE_DB:-sportswear}"
  echo "POSTGRES_SOURCE_USER=${POSTGRES_SOURCE_USER:-PG}"
  echo "LOYALTY_MYSQL_IMAGE=${LOYALTY_MYSQL_IMAGE:-docker.io/library/mysql:8.4.11}"
  echo "LOYALTY_MYSQL_PORT=${LOYALTY_MYSQL_PORT:-8503}"
  echo "LOYALTY_MYSQL_DATABASE=${LOYALTY_MYSQL_DATABASE:-loyalty}"
  echo "LOYALTY_MYSQL_USER=${LOYALTY_MYSQL_USER:-PG}"
  echo "MONGODB_CATALOG_IMAGE=${MONGODB_CATALOG_IMAGE:-docker.io/library/mongo:8.0.29}"
  echo "MONGODB_CATALOG_PORT=${MONGODB_CATALOG_PORT:-27017}"
  echo "MONGODB_CATALOG_DATABASE=${MONGODB_CATALOG_DATABASE:-catalog}"
  echo "MONGODB_CATALOG_ROOT_USERNAME=${MONGODB_CATALOG_ROOT_USERNAME:-PG}"
  echo "GOLDENGATE_HTTP_PORT=8501"
  echo "GOLDENGATE_RUNTIME_HTTP_PORT=8502"
  echo "GOLDENGATE_RUNTIME_BASE_URL=http://goldengate-runtime"
  echo "GOLDENGATE_RUNTIME_HOST=goldengate-runtime"
  echo "GOLDENGATE_RUNTIME_PORT=8080"
  echo "GOLDENGATE_STUDIO_API_BASE=/01012025/v2"
  echo "GOLDENGATE_STUDIO_ADMIN_USER=studioadmin"
  echo "GOLDENGATE_STUDIO_ADMIN_PASSWORD=${DBPASSWORD}"
  echo "GOLDENGATE_ADMIN_USER=studioadmin"
  echo "GOLDENGATE_ADMIN_PASSWORD=${DBPASSWORD}"
  echo "GOLDENGATE_DEPLOYMENT=PeakGearCDC"
  echo "GOLDENGATE_SOURCE_USER=GGADMIN"
  echo "GOLDENGATE_SOURCE_PASSWORD=${DBPASSWORD}"
  echo "GOLDENGATE_TARGET_SCHEMA=PG"
  echo "GOLDENGATE_TARGET_PASSWORD=${DBPASSWORD}"
  echo "GOLDENGATE_STUDIO_SOURCE_CONNECTION=PeakGear_NetSuite_Source"
  echo "GOLDENGATE_STUDIO_TARGET_CONNECTION=PeakGear_ADB_Target"
  echo "GOLDENGATE_STUDIO_DEPLOYMENT_CONNECTION=PeakGear_GoldenGate_Runtime"
  echo "GOLDENGATE_STUDIO_PIPELINE_NAME=PeakGear_NetSuite_Customers_CDC"
  echo "GOLDENGATE_BASE_URL=https://goldengate-cdc:8443"
  echo "GOLDENGATE_PUBLIC_URL=https://${PUBLIC_IP}:8501"
  echo "OGGF_API_SERVER_URL=https://${PUBLIC_IP}:8501"
  echo "OGGF_API_SERVER_SSL_URL=https://${PUBLIC_IP}:8501"
  echo "ADB_STUDIO_WALLET_ZIP=/wallet/goldengate-studio-wallet.zip"
  echo "ADB_WALLET_PASSWORD=${ADB_WALLET_PASSWORD:-}"
  echo "GOLDENGATE_STUDIO_FREE_IMAGE=container-registry.oracle.com/goldengate/goldengate-studio-free:23.9.0.25.09"
  echo "GOLDENGATE_ORACLE_FREE_IMAGE=container-registry.oracle.com/goldengate/goldengate-oracle-free:latest"
  echo "CUSTOMER_CDC_AUTO_SETUP=true"
  echo "CUSTOMER_CDC_DEMO_APPLY=false"
  echo "GRAVITINO_REST_PORT=${GRAVITINO_REST_PORT:-1525}"
  echo "GRAVITINO_HTTP_PORT=${GRAVITINO_HTTP_PORT:-1525}"
  echo "GRAVITINO_CATALOG_BACKEND_NAME=${GRAVITINO_CATALOG_BACKEND_NAME:-TEST_ICEBERG}"
  echo "GRAVITINO_JDBC_USER=${GRAVITINO_JDBC_USER:-PG}"
  # PG is created with the current VM's DBPASSWORD; never carry a JDBC secret
  # forward from the custom-image build environment.
  echo "GRAVITINO_JDBC_PASSWORD=${DBPASSWORD}"
  echo "GRAVITINO_JDBC_URI=${GRAVITINO_JDBC_URI:-}"
  # A provisioned VM must use its own ADB alias, not a value inherited from the
  # custom-image build environment.
  if [[ -n "${DBNAME:-}" ]]; then
    echo "GRAVITINO_JDBC_SERVICE_NAME=${DBNAME}_high"
  elif [[ -n "${GRAVITINO_JDBC_SERVICE_NAME:-}" ]]; then
    echo "GRAVITINO_JDBC_SERVICE_NAME=${GRAVITINO_JDBC_SERVICE_NAME}"
  else
    echo "GRAVITINO_JDBC_SERVICE_NAME="
  fi
  if [[ -n "${BUCKET_NAME:-}" && "${BUCKET_NAME}" != "bucket_name" ]]; then
    echo "GRAVITINO_WAREHOUSE=s3a://${BUCKET_NAME}/${GRAVITINO_OBJECT_STORAGE_PREFIX:-iceberg}"
  else
    echo "GRAVITINO_WAREHOUSE=${GRAVITINO_WAREHOUSE:-}"
  fi
  echo "GRAVITINO_OBJECT_STORAGE_BUCKET=${GRAVITINO_OBJECT_STORAGE_BUCKET:-${BUCKET_NAME}}"
  echo "GRAVITINO_OBJECT_STORAGE_PREFIX=${GRAVITINO_OBJECT_STORAGE_PREFIX:-iceberg}"
  if [[ -n "${GRAVITINO_S3_ENDPOINT:-}" ]]; then
    echo "GRAVITINO_S3_ENDPOINT=${GRAVITINO_S3_ENDPOINT}"
  elif [[ -n "${OBJECT_NAMESPACE:-}" && -n "${REGION_IDENTIFIER:-}" ]]; then
    echo "GRAVITINO_S3_ENDPOINT=https://${OBJECT_NAMESPACE}.compat.objectstorage.${REGION_IDENTIFIER}.oraclecloud.com"
  else
    echo "GRAVITINO_S3_ENDPOINT="
  fi
  echo "GRAVITINO_S3_REGION=${GRAVITINO_S3_REGION:-${REGION_IDENTIFIER}}"
  echo "GRAVITINO_S3_ACCESS_KEY_ID=${GRAVITINO_S3_ACCESS_KEY_ID:-}"
  echo "GRAVITINO_S3_SECRET_ACCESS_KEY=${GRAVITINO_S3_SECRET_ACCESS_KEY:-}"
  echo "GRAVITINO_S3_PATH_STYLE_ACCESS=${GRAVITINO_S3_PATH_STYLE_ACCESS:-true}"
  echo "DATA_TRANSFORMS_ADB_AUTO_CONFIGURE=${DATA_TRANSFORMS_ADB_AUTO_CONFIGURE:-true}"
  echo "DATA_TRANSFORMS_ADB_CONNECTION_NAME=${DATA_TRANSFORMS_ADB_CONNECTION_NAME:-${DBNAME:-}}"
  echo "DATA_TRANSFORMS_ADB_USERNAME=${DATA_TRANSFORMS_ADB_USERNAME:-PG}"
  echo "DATA_TRANSFORMS_ICEBERG_AUTO_CREATE=${DATA_TRANSFORMS_ICEBERG_AUTO_CREATE:-true}"
  echo "DATA_TRANSFORMS_ICEBERG_CONNECTION_NAME=${DATA_TRANSFORMS_ICEBERG_CONNECTION_NAME:-pg-iceberg}"
  echo "DATA_TRANSFORMS_ICEBERG_CATALOG_NAME=${DATA_TRANSFORMS_ICEBERG_CATALOG_NAME:-default}"
  echo "DATA_TRANSFORMS_ICEBERG_CATALOG_PROVIDER=${DATA_TRANSFORMS_ICEBERG_CATALOG_PROVIDER:-genericrestcatalog}"
  echo "DATA_TRANSFORMS_ICEBERG_REST_PATH=${DATA_TRANSFORMS_ICEBERG_REST_PATH:-/iceberg}"
  if [[ -n "${DATA_TRANSFORMS_BASE_URL:-}" ]]; then
    echo "DATA_TRANSFORMS_BASE_URL=${DATA_TRANSFORMS_BASE_URL}"
  fi
  if [[ -n "${DATA_TRANSFORMS_ICEBERG_REST_URL:-}" ]]; then
    echo "DATA_TRANSFORMS_ICEBERG_REST_URL=${DATA_TRANSFORMS_ICEBERG_REST_URL}"
  fi
  if [[ -n "${DATA_TRANSFORMS_AGENT_NAME:-}" ]]; then
    echo "DATA_TRANSFORMS_AGENT_NAME=${DATA_TRANSFORMS_AGENT_NAME}"
  fi
  echo "ICEBERG_SEED_AUTO_CREATE=${ICEBERG_SEED_AUTO_CREATE:-true}"
  echo "ICEBERG_SEED_NAMESPACE=${ICEBERG_SEED_NAMESPACE:-bronze}"
  echo "ICEBERG_SEED_TABLE=${ICEBERG_SEED_TABLE:-product_master_raw}"
  echo "ICEBERG_SEED_OVERWRITE=${ICEBERG_SEED_OVERWRITE:-false}"
  echo "ICEBERG_SEED_ADB_METADATA=${ICEBERG_SEED_ADB_METADATA:-true}"
  echo "ICEBERG_SEED_ADB_METADATA_PREFIX=${ICEBERG_SEED_ADB_METADATA_PREFIX:-adb_oci}"
  echo "ICEBERG_ADB_EXTERNAL_TABLE=${ICEBERG_ADB_EXTERNAL_TABLE:-PRODUCT_MASTER_RAW_ICEBERG_EXT}"
  echo "ICEBERG_ADB_CREDENTIAL_NAME=${ICEBERG_ADB_CREDENTIAL_NAME:-${OCI_GENAI_CREDENTIAL_NAME:-PG_OCI_GENAI_CRED}}"
  echo "ICEBERG_ADB_EXTERNAL_TABLE_RECREATE=${ICEBERG_ADB_EXTERNAL_TABLE_RECREATE:-false}"
  echo "ICEBERG_SEED_CSV_PATH=${ICEBERG_SEED_CSV_PATH:-/workspace/app/demodata/bronze/product_master_raw.csv}"
  echo "ICEBERG_SEED_CSV_URL=${ICEBERG_SEED_CSV_URL:-}"
  echo "ICEBERG_SEED_TABLE_LOCATION=${ICEBERG_SEED_TABLE_LOCATION:-}"
  echo "ICEBERG_SEED_FILE_IO=${ICEBERG_SEED_FILE_IO:-seed_product_master.OCIS3FsspecFileIO}"
  if [[ -n "${ICEBERG_REST_CATALOG_URI:-}" ]]; then
    echo "ICEBERG_REST_CATALOG_URI=${ICEBERG_REST_CATALOG_URI}"
  else
    echo "ICEBERG_REST_CATALOG_URI=http://gravitino:${GRAVITINO_HTTP_PORT:-1525}/iceberg"
  fi
  echo "APP_DB_ADMIN_PWD=${DBPASSWORD}"
  echo "DBCONNECTION=\"${DBCONNECTION}\""
  echo "MONGODBAPI=\"${MONGODBAPI}\""
  echo "GRAPHURL=${GRAPHURL}"
  echo "PUBLIC_IP=${PUBLIC_IP}"
  echo "COMPARTMENT_OCID=${COMPARTMENT_OCID}"
  echo "ENDPOINT=${ENDPOINT}"
  echo "ADB_OCID=${ADB_OCID}"
  echo "user=${USER_OCID}"
  echo "fingerprint=${PEM_KEY_FINGERPRINT}"
  echo "tenancy=${TENANCY_OCID}"
  echo "region=${REGION_IDENTIFIER}"
  echo "key_file=~/.oci/oci_api_key.pem"
  echo "dbname=${DBNAME}"
  echo "ORDSURL=${ORDSURL}"
  if [[ -n "${DBNAME:-}" ]]; then
    echo "SERVICE_NAME=${DBNAME}_high"
  else
    # Let wallet-aware consumers select the first valid *_high alias instead of
    # emitting the invalid placeholder "_high" when no database name is given.
    echo "SERVICE_NAME="
  fi
  echo "BUCKET_PAR=${BUCKET_PAR}"
  echo "BUCKET_NAME=${BUCKET_NAME}"
  echo "OBJECT_NAMESPACE=${OBJECT_NAMESPACE}"
  echo "BASEURL=${BASEURL}"
  echo "OJDBC_PATH=/wallet"
  echo "AI_ENDPOINT_REGION=${AI_ENDPOINT_REGION}"
  echo "OCI_AUTH_TYPE=${OCI_AUTH_TYPE}"
  echo "OCI_GENAI_MODEL=${OCI_GENAI_MODEL}"
  echo "OCI_GENAI_EMBEDDING_MODEL=${OCI_GENAI_EMBEDDING_MODEL}"
  echo "OCI_AI_PROFILE_NAME=${OCI_AI_PROFILE_NAME}"
  echo "WEBSHOP_RETURN_AGENT_PROFILE_NAME=${WEBSHOP_RETURN_AGENT_PROFILE_NAME}"
  echo "WEBSHOP_RETURN_AGENT_TEAM_NAME=${WEBSHOP_RETURN_AGENT_TEAM_NAME}"
  echo "OCI_GENAI_CREDENTIAL_NAME=${OCI_GENAI_CREDENTIAL_NAME}"
  echo "PG_AI_PROFILE_AUTO_SETUP=${PG_AI_PROFILE_AUTO_SETUP}"
  echo "APP_AI_PROFILE_AUTO_SETUP=${PG_AI_PROFILE_AUTO_SETUP}"
  echo "OCI_REGION=${AI_ENDPOINT_REGION}"
  echo "OCI_COMPARTMENT_ID=${COMPARTMENT_OCID}"
  echo "OCI_USER_OCID=${USER_OCID}"
  echo "OCI_TENANCY_OCID=${TENANCY_OCID}"
  echo "OCI_FINGERPRINT=${PEM_KEY_FINGERPRINT}"
  echo "OCI_PRIVATE_KEY=\"${PEM_SINGLE_LINE}\""
  echo "WEBSHOP_UPLOAD_PAR_URL=${WEBSHOP_UPLOAD_PAR_URL}"
  echo "WEBSHOP_UPLOAD_OBJECT_PREFIX=${WEBSHOP_UPLOAD_OBJECT_PREFIX}"
  echo "USER_OCID=${USER_OCID}"
  echo "TENANCY_OCID=${TENANCY_OCID}"
  echo "PEM_KEY_FINGERPRINT=${PEM_KEY_FINGERPRINT}"
  echo "PEM_SINGLE_LINE=\"${PEM_SINGLE_LINE}\""
  echo "workshopfiles=${workshopfiles}"
  echo "${ENV_END_MARKER}"
} >> "${TMP_ENV}"

mv "${TMP_ENV}" "${COMPOSE_ENV}"
chmod 600 "${COMPOSE_ENV}"


# Tighten app permissions: owner-access only.
#chmod -R u=rwX,go= "$POD_ROOT/app/"

#JupyterLab default settings
# mkdir -p $POD_ROOT/app/lab/$APP_TYPE/.jupyter
# cp -r $POD_ROOT/jl_config/* $POD_ROOT/app/lab/$APP_TYPE/.jupyter
