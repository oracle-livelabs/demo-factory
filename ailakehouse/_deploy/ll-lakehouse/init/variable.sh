#!/bin/bash

#make sure you have .env file stored in opc user home directory
# you need to provide your an placeholder for relevant passwords, and ocids, etc.
#use the demo.env and adjust values
if [[ -f /home/opc/.env ]]; then
  source /home/opc/.env
fi

oci_metadata_value() {
  local key="$1"
  local value

  value="$(curl -fsS --max-time 3 -H "Authorization: Bearer Oracle" -L "http://169.254.169.254/opc/v2/instance/metadata/${key}" 2>/dev/null || true)"
  if [[ -z "${value}" || ${value} =~ '<html>' ]]; then
    return 1
  fi

  printf '%s' "${value}"
}

export_metadata_or_default() {
  local target="$1"
  local key="$2"
  local fallback="$3"
  local value

  value="$(oci_metadata_value "${key}" || true)"
  if [[ -z "${value}" ]]; then
    value="${fallback}"
  fi

  export "${target}=${value}"
}

export PUBLIC_IP=$(curl -s ifconfig.me)
if [[ ${#PUBLIC_IP} -le 5 || ${PUBLIC_IP} =~ '<html>' ]]; then
 export PUBLIC_IP="127.0.0.1"
fi


export vncpwd=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/vncpwd)

if [[ ${#vncpwd} -ne 10 ]]; then
 export vncpwd="${vncpwdlocal:-}"
fi


export DBCONNECTION=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/dbconnection|tr -d ' ')

if [[ ${#DBCONNECTION} -le 5 || ${DBCONNECTION} =~ '<html>' ]]; then
  export DBCONNECTION="${dbconnectionlocal:-}"
fi


export MONGODBAPI=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/mongodbapi|tr -d ' ')

if [[ ${#MONGODBAPI} -le 5 || ${MONGODBAPI} =~ '<html>' ]]; then
 export MONGODBAPI="${mongodbapilocal:-}"
fi


export GRAPHURL=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/graphurl|tr -d ' ')

if [[ ${#GRAPHURL} -le 5 || ${GRAPHURL} =~ '<html>' ]]; then
 export GRAPHURL="${graphurllocal:-}"
fi


DBPASSWORD_FROM_ENV="${DBPASSWORD:-}"
DBPASSWORD_FROM_METADATA="$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/dbpassword)"

if [[ ${#DBPASSWORD_FROM_METADATA} -gt 5 && ! ${DBPASSWORD_FROM_METADATA} =~ '<html>' ]]; then
 export DBPASSWORD="${DBPASSWORD_FROM_METADATA}"
else
 export DBPASSWORD="${DBPASSWORD_FROM_ENV}"
fi

export PEM_KEY=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/pem_key)

if [[ ${#PEM_KEY} -le 5 || ${PEM_KEY} =~ '<html>' ]]; then
 export PEM_KEY="${pem_keylocal:-}"
fi

export PEM_SINGLE_LINE=$(echo "$PEM_KEY" | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')


export PEM_KEY_FINGERPRINT=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/pem_key_fingerprint)

if [[ ${#PEM_KEY_FINGERPRINT} -le 5 || ${PEM_KEY_FINGERPRINT} =~ '<html>' ]]; then
 export PEM_KEY_FINGERPRINT="${pem_key_fingerprintlocal:-}"
fi

export USER_OCID=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/user_ocid)

if [[ ${#USER_OCID} -le 5 || ${USER_OCID} =~ '<html>' ]]; then
 export USER_OCID="${user_ocidlocal:-}"
fi

export TENANCY_OCID=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/tenancy_ocid)

if [[ ${#TENANCY_OCID} -le 5 || ${TENANCY_OCID} =~ '<html>' ]]; then
 export TENANCY_OCID="${tenancy_ocidlocal:-}"
fi

export REGION_IDENTIFIER=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/region_identifier)

if [[ ${#REGION_IDENTIFIER} -le 5 || ${REGION_IDENTIFIER} =~ '<html>' ]]; then
 export REGION_IDENTIFIER="${region_identifierlocal:-}"
fi

export AI_ENDPOINT_REGION=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/ai_endpoint_region)

if [[ ${#AI_ENDPOINT_REGION} -le 5 || ${AI_ENDPOINT_REGION} =~ '<html>' ]]; then
 export AI_ENDPOINT_REGION="${ai_endpoint_regionlocal:-}"
fi

export OCI_AUTH_TYPE=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/oci_auth_type)

if [[ ${#OCI_AUTH_TYPE} -le 3 || ${OCI_AUTH_TYPE} =~ '<html>' ]]; then
 export OCI_AUTH_TYPE="${oci_auth_typelocal:-api_key}"
fi

export OCI_GENAI_MODEL=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/oci_genai_model)

if [[ ${#OCI_GENAI_MODEL} -le 5 || ${OCI_GENAI_MODEL} =~ '<html>' ]]; then
 export OCI_GENAI_MODEL="${oci_genai_modellocal:-cohere.command-a-03-2025}"
fi

export OCI_GENAI_EMBEDDING_MODEL=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/oci_genai_embedding_model)

if [[ ${#OCI_GENAI_EMBEDDING_MODEL} -le 5 || ${OCI_GENAI_EMBEDDING_MODEL} =~ '<html>' ]]; then
 export OCI_GENAI_EMBEDDING_MODEL="${oci_genai_embedding_modellocal:-cohere.embed-v4.0}"
fi

export OCI_AI_PROFILE_NAME=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/oci_ai_profile_name)

if [[ ${#OCI_AI_PROFILE_NAME} -le 5 || ${OCI_AI_PROFILE_NAME} =~ '<html>' ]]; then
 export OCI_AI_PROFILE_NAME="${oci_ai_profile_namelocal:-PG_GENAI_PROFILE}"
fi

export WEBSHOP_RETURN_AGENT_PROFILE_NAME=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/webshop_return_agent_profile_name)

if [[ ${#WEBSHOP_RETURN_AGENT_PROFILE_NAME} -le 5 || ${WEBSHOP_RETURN_AGENT_PROFILE_NAME} =~ '<html>' ]]; then
 # Keep the standalone fallback aligned with the profile created by adb-load.sh
 # and referenced by db/schema/14_webshop_agent_tools.sql.
 export WEBSHOP_RETURN_AGENT_PROFILE_NAME="${webshop_return_agent_profile_namelocal:-PG_RETURN_AGENT_PROFILE}"
fi

export WEBSHOP_RETURN_AGENT_TEAM_NAME=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/webshop_return_agent_team_name)

if [[ ${#WEBSHOP_RETURN_AGENT_TEAM_NAME} -le 5 || ${WEBSHOP_RETURN_AGENT_TEAM_NAME} =~ '<html>' ]]; then
 export WEBSHOP_RETURN_AGENT_TEAM_NAME="${webshop_return_agent_team_namelocal:-RETURN_ADVISOR_TEAM}"
fi

export OCI_GENAI_CREDENTIAL_NAME=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/oci_genai_credential_name)

if [[ ${#OCI_GENAI_CREDENTIAL_NAME} -le 5 || ${OCI_GENAI_CREDENTIAL_NAME} =~ '<html>' ]]; then
 export OCI_GENAI_CREDENTIAL_NAME="${oci_genai_credential_namelocal:-PG_OCI_GENAI_CRED}"
fi

PG_AI_PROFILE_AUTO_SETUP_FROM_ENV="${PG_AI_PROFILE_AUTO_SETUP:-}"
export PG_AI_PROFILE_AUTO_SETUP=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/pg_ai_profile_auto_setup)

if [[ ${#PG_AI_PROFILE_AUTO_SETUP} -le 3 || ${PG_AI_PROFILE_AUTO_SETUP} =~ '<html>' ]]; then
 export PG_AI_PROFILE_AUTO_SETUP="${PG_AI_PROFILE_AUTO_SETUP_FROM_ENV:-false}"
fi


export COMPARTMENT_OCID=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/compartment_ocid)

if [[ ${#COMPARTMENT_OCID} -le 5 || ${COMPARTMENT_OCID} =~ '<html>' ]]; then
 export COMPARTMENT_OCID="${compartment_ocidlocal:-}"
fi

#workshopfiles must be a URL pointing to a zip file
export workshopfiles=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/workshopfiles)

if [[ ${#workshopfiles} -ne 10 ]]; then
 export workshopfiles="https://c4u04.objectstorage.us-ashburn-1.oci.customer-oci.com/p/EcTjWk2IuZPZeNnD_fYMcgUhdNDIDA6rt9gaFj_WZMiL7VvxPBNMY60837hu5hga/n/c4u04/b/livelabsfiles/o/livestack/firebase-killian-green-button.zip"
fi

export ENDPOINT="https://inference.generativeai.${AI_ENDPOINT_REGION}.oci.oraclecloud.com"

if [[ ${#ENDPOINT} -le 5 || "$ENDPOINT" =~ AI_ENDPOINT_REGION ]]; then
 export ENDPOINT="https://inference.generativeai.us-chicago-1.oci.oraclecloud.com"
fi

export ADB_OCID=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/adb_ocid)

if [[ ${#ADB_OCID} -le 5 || ${ADB_OCID} =~ '<html>' ]]; then
 export ADB_OCID="${adb_ocidlocal:-}"
fi

export BUCKET_PAR=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/bucket_par)

if [[ ${#BUCKET_PAR} -le 5 || ${BUCKET_PAR} =~ '<html>' ]]; then
 export BUCKET_PAR="https://par.par.par"
fi

export ORDSURL=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/ordsurl)

if [[ ${#ORDSURL} -le 5 || ${ORDSURL} =~ '<html>' ]]; then
 export ORDSURL="${ordsurllocal:-}"
fi

export DBNAME=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/dbname)

if [[ ${#DBNAME} -le 5 || ${DBNAME} =~ '<html>' ]]; then
 export DBNAME="${dbnamelocal:-}"
fi

export BUCKET_NAME=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/bucket_name)

if [[ ${#BUCKET_NAME} -le 5 || ${BUCKET_NAME} =~ '<html>' ]]; then
 export BUCKET_NAME="bucket_name"
fi

export OBJECT_NAMESPACE=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/object_namespace)

if [[ ${#OBJECT_NAMESPACE} -le 5 || ${OBJECT_NAMESPACE} =~ '<html>' ]]; then
 export OBJECT_NAMESPACE="ocid567890"
fi

GRAVITINO_DEFAULT_S3_ENDPOINT=""
if [[ -n "${OBJECT_NAMESPACE:-}" && -n "${REGION_IDENTIFIER:-}" && "${OBJECT_NAMESPACE}" != "ocid567890" ]]; then
  GRAVITINO_DEFAULT_S3_ENDPOINT="https://${OBJECT_NAMESPACE}.compat.objectstorage.${REGION_IDENTIFIER}.oraclecloud.com"
fi

export_metadata_or_default "GRAVITINO_REST_PORT" "gravitino_rest_port" "1525"
export_metadata_or_default "GRAVITINO_HTTP_PORT" "gravitino_http_port" "1525"

# AI Hub is an immutable custom-image choice. The installer writes this
# non-secret file before image capture; Terraform metadata must not override it.
AIHUB_IMAGE_DEFAULT_FILE="${AIHUB_IMAGE_DEFAULT_FILE:-/home/opc/init/aihub-image-default.env}"
AIHUB=false
if [[ -r "${AIHUB_IMAGE_DEFAULT_FILE}" ]]; then
  source "${AIHUB_IMAGE_DEFAULT_FILE}"
fi

case "${AIHUB,,}" in
  1|true|yes|on) export AIHUB=true ;;
  *) export AIHUB=false ;;
esac

export_metadata_or_default "GRAVITINO_CATALOG_BACKEND_NAME" "gravitino_catalog_backend_name" "${GRAVITINO_CATALOG_BACKEND_NAME:-TEST_ICEBERG}"
export_metadata_or_default "GRAVITINO_JDBC_USER" "gravitino_jdbc_user" "${GRAVITINO_JDBC_USER:-PG}"
export_metadata_or_default "GRAVITINO_JDBC_PASSWORD" "gravitino_jdbc_password" "${GRAVITINO_JDBC_PASSWORD:-${DBPASSWORD:-}}"
export_metadata_or_default "GRAVITINO_JDBC_SERVICE_NAME" "gravitino_jdbc_service_name" "${GRAVITINO_JDBC_SERVICE_NAME:-}"
export_metadata_or_default "GRAVITINO_WAREHOUSE" "gravitino_warehouse" "${GRAVITINO_WAREHOUSE:-}"
export_metadata_or_default "GRAVITINO_OBJECT_STORAGE_BUCKET" "gravitino_object_storage_bucket" "${GRAVITINO_OBJECT_STORAGE_BUCKET:-${BUCKET_NAME}}"
export_metadata_or_default "GRAVITINO_OBJECT_STORAGE_PREFIX" "gravitino_object_storage_prefix" "${GRAVITINO_OBJECT_STORAGE_PREFIX:-iceberg}"
export_metadata_or_default "GRAVITINO_S3_ENDPOINT" "gravitino_s3_endpoint" "${GRAVITINO_S3_ENDPOINT:-${GRAVITINO_DEFAULT_S3_ENDPOINT}}"
export_metadata_or_default "GRAVITINO_S3_REGION" "gravitino_s3_region" "${GRAVITINO_S3_REGION:-${REGION_IDENTIFIER}}"
export_metadata_or_default "GRAVITINO_S3_ACCESS_KEY_ID" "gravitino_s3_access_key_id" "${GRAVITINO_S3_ACCESS_KEY_ID:-${GRAVITINO_S3_ACCESS_KEY:-}}"
export_metadata_or_default "GRAVITINO_S3_SECRET_ACCESS_KEY" "gravitino_s3_secret_access_key" "${GRAVITINO_S3_SECRET_ACCESS_KEY:-${GRAVITINO_S3_SECRET_KEY:-}}"
export_metadata_or_default "GRAVITINO_S3_PATH_STYLE_ACCESS" "gravitino_s3_path_style_access" "${GRAVITINO_S3_PATH_STYLE_ACCESS:-true}"
export_metadata_or_default "DATA_TRANSFORMS_ADB_AUTO_CONFIGURE" "data_transforms_adb_auto_configure" "${DATA_TRANSFORMS_ADB_AUTO_CONFIGURE:-true}"
export_metadata_or_default "DATA_TRANSFORMS_ADB_CONNECTION_NAME" "data_transforms_adb_connection_name" "${DATA_TRANSFORMS_ADB_CONNECTION_NAME:-${DBNAME:-}}"
export_metadata_or_default "DATA_TRANSFORMS_ADB_USERNAME" "data_transforms_adb_username" "${DATA_TRANSFORMS_ADB_USERNAME:-PG}"
export_metadata_or_default "DATA_TRANSFORMS_ICEBERG_AUTO_CREATE" "data_transforms_iceberg_auto_create" "${DATA_TRANSFORMS_ICEBERG_AUTO_CREATE:-true}"
export_metadata_or_default "DATA_TRANSFORMS_ICEBERG_CONNECTION_NAME" "data_transforms_iceberg_connection_name" "${DATA_TRANSFORMS_ICEBERG_CONNECTION_NAME:-pg-iceberg}"
export_metadata_or_default "DATA_TRANSFORMS_ICEBERG_CATALOG_NAME" "data_transforms_iceberg_catalog_name" "${DATA_TRANSFORMS_ICEBERG_CATALOG_NAME:-default}"
export_metadata_or_default "DATA_TRANSFORMS_ICEBERG_CATALOG_PROVIDER" "data_transforms_iceberg_catalog_provider" "${DATA_TRANSFORMS_ICEBERG_CATALOG_PROVIDER:-genericrestcatalog}"
export_metadata_or_default "DATA_TRANSFORMS_ICEBERG_REST_PATH" "data_transforms_iceberg_rest_path" "${DATA_TRANSFORMS_ICEBERG_REST_PATH:-/iceberg}"
export_metadata_or_default "DATA_TRANSFORMS_BASE_URL" "data_transforms_base_url" "${DATA_TRANSFORMS_BASE_URL:-}"
export_metadata_or_default "DATA_TRANSFORMS_ICEBERG_REST_URL" "data_transforms_iceberg_rest_url" "${DATA_TRANSFORMS_ICEBERG_REST_URL:-}"
export_metadata_or_default "DATA_TRANSFORMS_AGENT_NAME" "data_transforms_agent_name" "${DATA_TRANSFORMS_AGENT_NAME:-}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_AUTO_CREATE" "data_transforms_demo_auto_create" "${DATA_TRANSFORMS_DEMO_AUTO_CREATE:-true}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_RESET" "data_transforms_demo_reset" "${DATA_TRANSFORMS_DEMO_RESET:-true}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_PROJECT_NAME" "data_transforms_demo_project_name" "${DATA_TRANSFORMS_DEMO_PROJECT_NAME:-peakgear}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_DATA_FLOW_NAME" "data_transforms_demo_data_flow_name" "${DATA_TRANSFORMS_DEMO_DATA_FLOW_NAME:-dataFlow}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_DATA_FLOW_SOURCE_TABLE" "data_transforms_demo_data_flow_source_table" "${DATA_TRANSFORMS_DEMO_DATA_FLOW_SOURCE_TABLE:-PRODUCT_MASTER_RAW_ICEBERG_EXT}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_DATA_FLOW_TARGET_TABLE" "data_transforms_demo_data_flow_target_table" "${DATA_TRANSFORMS_DEMO_DATA_FLOW_TARGET_TABLE:-GOLD_PRODUCTS}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_DATA_LOAD_NAME" "data_transforms_demo_data_load_name" "${DATA_TRANSFORMS_DEMO_DATA_LOAD_NAME:-dataLoad}"
export_metadata_or_default "DATA_TRANSFORMS_DEMO_DATA_LOAD_SOURCE_TABLE" "data_transforms_demo_data_load_source_table" "${DATA_TRANSFORMS_DEMO_DATA_LOAD_SOURCE_TABLE:-GOLD_PRODUCTS}"
export_metadata_or_default "ICEBERG_SEED_AUTO_CREATE" "iceberg_seed_auto_create" "${ICEBERG_SEED_AUTO_CREATE:-true}"
export_metadata_or_default "ICEBERG_SEED_NAMESPACE" "iceberg_seed_namespace" "${ICEBERG_SEED_NAMESPACE:-bronze}"
export_metadata_or_default "ICEBERG_SEED_TABLE" "iceberg_seed_table" "${ICEBERG_SEED_TABLE:-product_master_raw}"
export_metadata_or_default "ICEBERG_SEED_OVERWRITE" "iceberg_seed_overwrite" "${ICEBERG_SEED_OVERWRITE:-false}"
export_metadata_or_default "ICEBERG_SEED_ADB_METADATA" "iceberg_seed_adb_metadata" "${ICEBERG_SEED_ADB_METADATA:-true}"
export_metadata_or_default "ICEBERG_SEED_ADB_METADATA_PREFIX" "iceberg_seed_adb_metadata_prefix" "${ICEBERG_SEED_ADB_METADATA_PREFIX:-adb_oci}"
export_metadata_or_default "ICEBERG_ADB_EXTERNAL_TABLE" "iceberg_adb_external_table" "${ICEBERG_ADB_EXTERNAL_TABLE:-PRODUCT_MASTER_RAW_ICEBERG_EXT}"
export_metadata_or_default "ICEBERG_ADB_CREDENTIAL_NAME" "iceberg_adb_credential_name" "${ICEBERG_ADB_CREDENTIAL_NAME:-${OCI_GENAI_CREDENTIAL_NAME:-PG_OCI_GENAI_CRED}}"
export_metadata_or_default "ICEBERG_ADB_EXTERNAL_TABLE_RECREATE" "iceberg_adb_external_table_recreate" "${ICEBERG_ADB_EXTERNAL_TABLE_RECREATE:-false}"
export_metadata_or_default "ICEBERG_SEED_CSV_PATH" "iceberg_seed_csv_path" "${ICEBERG_SEED_CSV_PATH:-/workspace/app/demodata/bronze/product_master_raw.csv}"
export_metadata_or_default "ICEBERG_SEED_CSV_URL" "iceberg_seed_csv_url" "${ICEBERG_SEED_CSV_URL:-}"
export_metadata_or_default "ICEBERG_SEED_TABLE_LOCATION" "iceberg_seed_table_location" "${ICEBERG_SEED_TABLE_LOCATION:-}"
export_metadata_or_default "ICEBERG_SEED_FILE_IO" "iceberg_seed_file_io" "${ICEBERG_SEED_FILE_IO:-seed_product_master.OCIS3FsspecFileIO}"
export_metadata_or_default "ICEBERG_REST_CATALOG_URI" "iceberg_rest_catalog_uri" "${ICEBERG_REST_CATALOG_URI:-}"

export BASEURL=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/baseurl)

if [[ ${#BASEURL} -le 5 || ${BASEURL} =~ '<html>' ]]; then
 export BASEURL="${baseurllocal:-}"
fi

export WEBSHOP_UPLOAD_PAR_URL=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/webshop_upload_par_url)

if [[ ${#WEBSHOP_UPLOAD_PAR_URL} -le 5 || ${WEBSHOP_UPLOAD_PAR_URL} =~ '<html>' ]]; then
 export WEBSHOP_UPLOAD_PAR_URL="${webshop_upload_par_url_local:-}"
fi

export WEBSHOP_UPLOAD_OBJECT_PREFIX=$(curl -s -H "Authorization: Bearer Oracle" -L http://169.254.169.254/opc/v2/instance/metadata/webshop_upload_object_prefix)

if [[ ${#WEBSHOP_UPLOAD_OBJECT_PREFIX} -le 1 || ${WEBSHOP_UPLOAD_OBJECT_PREFIX} =~ '<html>' ]]; then
 export WEBSHOP_UPLOAD_OBJECT_PREFIX="${webshop_upload_object_prefix_local:-webshop-uploads}"
fi
