#!/usr/bin/env bash
set -Eeuo pipefail

FINANCE_SOURCE_DIR="${FINANCE_SOURCE_DIR:-/opt/finance-livestack/application}"
LOADER_PATH="${FINANCE_SOURCE_DIR}/deployment/finance-platform-handoff-loader.sql"
NATIVE_AI_BOOTSTRAP_PATH="${FINANCE_SOURCE_DIR}/deployment/finance-native-ai-bootstrap.sql"
READY_MARKER="${FINANCE_SOURCE_DIR}/.database-ready"
LOG_ROOT="/var/log"
OCI_CREDENTIAL_NAME="FIN_GENAI_KEY_V1"

log() {
  printf '[finance-adb] %s\n' "$*"
}

fail() {
  log "FAILED: $*"
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Required value ${name} is missing."
}

valid_adb_admin_password() {
  local password="$1"
  local password_lower

  [[ ${#password} -ge 12 && ${#password} -le 30 ]] || return 1
  [[ "${password}" =~ [[:upper:]] ]] || return 1
  [[ "${password}" =~ [[:lower:]] ]] || return 1
  [[ "${password}" =~ [[:digit:]] ]] || return 1
  [[ "${password}" != *[[:space:]]* ]] || return 1
  [[ "${password}" != *"'"* && "${password}" != *'"'* ]] || return 1
  password_lower="$(printf '%s' "${password}" | tr '[:upper:]' '[:lower:]')"
  [[ "${password_lower}" != *admin* ]] || return 1
}

for name in \
  ADB_CONNECT_STRING \
  ADB_ADMIN_PASSWORD \
  APP_SCHEMA_PASSWORD \
  WALLET_ARCHIVE \
  MODEL_OBJECT_URI \
  OCI_TENANCY_OCID \
  OCI_USER_OCID \
  OCI_COMPARTMENT_OCID \
  OCI_GENAI_REGION \
  OCI_GENAI_MODEL_ID \
  OCI_API_KEY_FINGERPRINT \
  OCI_API_PRIVATE_KEY_FILE; do
  require_value "${name}"
done

[[ -s "${WALLET_ARCHIVE}" ]] || fail "Generated ADB wallet is missing."
[[ -s "${LOADER_PATH}" ]] || fail "Finance handoff loader is missing."
[[ -s "${NATIVE_AI_BOOTSTRAP_PATH}" ]] || fail "Finance native Select AI bootstrap is missing."
[[ -s "${OCI_API_PRIVATE_KEY_FILE}" ]] || fail "The transient OCI API private key is missing."
[[ "${OCI_API_PRIVATE_KEY_FILE}" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
  fail "The transient OCI API private-key path contains unsupported characters."
valid_adb_admin_password "${ADB_ADMIN_PASSWORD}" || fail "ADB ADMIN password is invalid. It must meet the Autonomous Database password requirements."
[[ "${APP_SCHEMA_PASSWORD}" =~ ^[A-Za-z0-9]{12,30}$ ]] || fail "APP_USER password is invalid."
[[ "${ADB_CONNECT_STRING}" =~ ^[A-Za-z][A-Za-z0-9_]{0,63}$ ]] || fail "ADB service name is invalid."
[[ "${MODEL_OBJECT_URI}" == https://* ]] || fail "Embedding model URI must use HTTPS."
[[ "${MODEL_OBJECT_URI}" != *"'"* && "${MODEL_OBJECT_URI}" != *'"'* ]] || fail "Embedding model URI contains an unsupported quote."
[[ "${OCI_TENANCY_OCID}" =~ ^ocid1\.tenancy\.[A-Za-z0-9._-]+$ ]] || fail "OCI tenancy OCID is invalid."
[[ "${OCI_USER_OCID}" =~ ^ocid1\.user\.[A-Za-z0-9._-]+$ ]] || fail "OCI user OCID is invalid."
[[ "${OCI_COMPARTMENT_OCID}" =~ ^ocid1\.(compartment|tenancy)\.[A-Za-z0-9._-]+$ ]] ||
  fail "OCI Generative AI compartment OCID is invalid."
[[ "${OCI_API_KEY_FINGERPRINT}" =~ ^([0-9a-f]{2}:){15}[0-9a-f]{2}$ ]] ||
  fail "OCI API-key fingerprint is invalid."
case "${OCI_GENAI_REGION}" in
  ap-hyderabad-1 | ap-osaka-1 | eu-frankfurt-1 | me-riyadh-1 | sa-saopaulo-1 | uk-london-1 | us-chicago-1) ;;
  *) fail "OCI Generative AI region is unsupported for Cohere Command A on-demand." ;;
esac
[[ "${OCI_GENAI_MODEL_ID}" == "cohere.command-a-03-2025" ]] || fail "OCI Generative AI model is unsupported."
command -v sql >/dev/null 2>&1 || fail "SQLcl is not installed."
command -v openssl >/dev/null 2>&1 || fail "OpenSSL is not installed."
openssl pkey -in "${OCI_API_PRIVATE_KEY_FILE}" -passin pass: -noout -check >/dev/null 2>&1 ||
  fail "The transient OCI API private key is invalid or passphrase-protected."

umask 077
work_dir="$(mktemp -d /tmp/finance-adb.XXXXXX)"
trap 'rm -rf "${work_dir}"' EXIT

is_transient_genai_authorization_failure() {
  local output="$1"

  # DBMS_CLOUD_AI can render the authorization URI on the ORA-20401 line or
  # wrap it onto the immediately following line. Accept exactly one error for
  # the selected region and chat endpoint, with only ORA-06512 call-stack lines
  # alongside it. Oracle-internal and public endpoint spellings are both
  # recognized, but lookalike suffixes, other paths, duplicate ORA-20401
  # records, and every additional ORA/PLS/SP2 failure are rejected.
  awk -v region="${OCI_GENAI_REGION}" '
    function inspect_error(line, internal_error, public_error) {
      internal_error = "ORA-20401: Authorization failed for URI - " \
        "https://inference.generativeai." region \
        ".oci.my$cloud_domain/20231130/actions/chat"
      public_error = "ORA-20401: Authorization failed for URI - " \
        "https://inference.generativeai." region \
        ".oci.oraclecloud.com/20231130/actions/chat"

      if (line ~ /^ORA-[0-9]{5}:/) {
        if (line ~ /^ORA-20401:/) {
          transient_count++
          if (line != internal_error && line != public_error) {
            unexpected = 1
          }
        } else if (line !~ /^ORA-06512:/) {
          unexpected = 1
        }
      } else if (line ~ /^(PLS-[0-9]{5}|SP2-[0-9]{4}):/) {
        unexpected = 1
      }

      if (line ~ /(SQLcl:[[:space:]]*Error|SEVERE .*SqlCli|Identity (conversion|reseed) warning|Skipped .*ORA-[0-9]{5})/) {
        unexpected = 1
      }
    }

    /^ORA-20401: Authorization failed for URI -[[:space:]]*$/ {
      prefix = $0
      if (getline uri) {
        inspect_error(prefix " " uri)
        next
      }
      inspect_error(prefix)
      next
    }

    {
      inspect_error($0)
    }

    END {
      exit (transient_count == 1 && unexpected == 0) ? 0 : 1
    }
  ' "${output}"
}

is_transient_adb_connectivity_failure() {
  local output="$1"

  # A newly provisioned VM can reach Object Storage before its resolver has a
  # route for the regional Autonomous Database endpoint. Retry only Oracle's
  # explicit unknown-host error; credentials, schema errors, and every other
  # database failure must remain immediately fatal.
  awk '
    {
      if ($0 ~ /ORA-17868: Unknown host specified\./) {
        transient_count++
        next
      }

      if ($0 ~ /ORA-[0-9]{5}:/ || $0 ~ /^(PLS-[0-9]{5}|SP2-[0-9]{4}):/) {
        unexpected = 1
      }
    }

    END {
      exit (transient_count == 1 && unexpected == 0) ? 0 : 1
    }
  ' "${output}"
}

run_sql_phase() {
  local phase="$1"
  local driver="$2"
  local marker="$3"
  local retry_mode="${4:-none}"
  local output="${LOG_ROOT}/finance-adb-${phase}.log"
  local exit_code
  local attempt=1
  local max_attempts=1
  local retry_delay_seconds=0
  local retry_database_connectivity=0
  local retry_genai_authorization=0

  case "${retry_mode}" in
    none) ;;
    adb_connectivity)
      # Match the tested Media stack: allow the new VM resolver about ten
      # minutes to discover the regional ADB endpoint, while retrying only the
      # exact ORA-17868 unknown-host condition.
      max_attempts=61
      retry_delay_seconds=10
      retry_database_connectivity=1
      ;;
    genai_api_key_propagation)
      # Identity Domains can return the new fingerprint before the uploaded
      # signing key has propagated to every OCI Generative AI authorization
      # path. Retry only the exact transient inference authorization failure;
      # every other SQL, loader, or Oracle error remains immediately fatal.
      max_attempts=31
      retry_delay_seconds=30
      retry_genai_authorization=1
      ;;
    adb_connectivity_or_genai_api_key_propagation)
      max_attempts=31
      retry_delay_seconds=30
      retry_database_connectivity=1
      retry_genai_authorization=1
      ;;
    *) fail "Unsupported SQLcl retry mode for phase ${phase}." ;;
  esac

  chmod 0600 "${driver}"
  while true; do
    set +e
    sql -S -cloudconfig "${WALLET_ARCHIVE}" /nolog < "${driver}" > "${output}" 2>&1
    exit_code=$?
    set -e
    chmod 0600 "${output}"

    if [[ "${exit_code}" -eq 0 ]] &&
       ! grep -Eiq '(ORA-[0-9]{5}|PLS-[0-9]{5}|SP2-[0-9]{4}|SQLcl:[[:space:]]*Error|Error starting at line|SEVERE .*SqlCli|Identity (conversion|reseed) warning|Skipped .*ORA-[0-9]{5})' "${output}" &&
       grep -Fq "${marker}" "${output}"; then
      log "${marker}"
      return 0
    fi

    if [[ "${retry_database_connectivity}" -eq 1 &&
          "${attempt}" -lt "${max_attempts}" ]] &&
       is_transient_adb_connectivity_failure "${output}"; then
      log "Autonomous Database DNS is not ready; retrying SQLcl phase ${phase} in ${retry_delay_seconds}s (attempt ${attempt}/${max_attempts})."
      attempt=$((attempt + 1))
      sleep "${retry_delay_seconds}"
      continue
    fi

    if [[ "${retry_genai_authorization}" -eq 1 &&
          "${attempt}" -lt "${max_attempts}" ]] &&
       is_transient_genai_authorization_failure "${output}"; then
      log "The new OCI API signing key is still propagating to Generative AI; retrying native acceptance in ${retry_delay_seconds}s (attempt ${attempt}/${max_attempts})."
      attempt=$((attempt + 1))
      sleep "${retry_delay_seconds}"
      continue
    fi

    if [[ "${exit_code}" -ne 0 ]]; then
      tail -n 120 "${output}" >&2
      fail "SQLcl phase ${phase} exited with code ${exit_code}."
    fi

    if grep -Eiq '(ORA-[0-9]{5}|PLS-[0-9]{5}|SP2-[0-9]{4}|SQLcl:[[:space:]]*Error|Error starting at line|SEVERE .*SqlCli|Identity (conversion|reseed) warning|Skipped .*ORA-[0-9]{5})' "${output}"; then
      tail -n 120 "${output}" >&2
      fail "SQLcl phase ${phase} reported an Oracle or loader error."
    fi

    tail -n 120 "${output}" >&2
    fail "SQLcl phase ${phase} did not print ${marker}."
  done
}

bootstrap_driver="${work_dir}/bootstrap.sql"
cat > "${bootstrap_driver}" <<SQL
SET ECHO OFF
SET VERIFY OFF
SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
CONNECT ADMIN/"${ADB_ADMIN_PASSWORD}"@${ADB_CONNECT_STRING}

DECLARE
  l_user_count PLS_INTEGER;
BEGIN
  SELECT COUNT(*) INTO l_user_count FROM dba_users WHERE username = 'APP_USER';
  IF l_user_count = 0 THEN
    -- Terraform passwords may legitimately begin with a digit. Quote the
    -- password in the generated DDL so Oracle does not parse it as an
    -- unquoted identifier/token (ORA-00922).
    EXECUTE IMMEDIATE
      'CREATE USER APP_USER IDENTIFIED BY "${APP_SCHEMA_PASSWORD}" ' ||
      'DEFAULT TABLESPACE USERS TEMPORARY TABLESPACE TEMP QUOTA UNLIMITED ON USERS';
    DBMS_OUTPUT.PUT_LINE('Created APP_USER.');
  ELSE
    -- A retry uses the same generated password. Altering to that value causes
    -- ORA-28007 when the tenancy enforces password-history rules.
    DBMS_OUTPUT.PUT_LINE('APP_USER already exists; retaining its generated password.');
  END IF;
END;
/

DECLARE
  l_model_count PLS_INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO l_model_count
    FROM user_mining_models
   WHERE model_name = 'ALL_MINILM_L12_V2';

  IF l_model_count = 0 THEN
    BEGIN
      DBMS_CLOUD.DELETE_FILE(
        directory_name => 'DATA_PUMP_DIR',
        file_name      => 'all_MiniLM_L12_v2.onnx'
      );
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;

    DBMS_CLOUD.GET_OBJECT(
      object_uri     => '${MODEL_OBJECT_URI}',
      directory_name => 'DATA_PUMP_DIR',
      file_name      => 'all_MiniLM_L12_v2.onnx'
    );

    DBMS_VECTOR.LOAD_ONNX_MODEL(
      directory  => 'DATA_PUMP_DIR',
      file_name  => 'all_MiniLM_L12_v2.onnx',
      model_name => 'ALL_MINILM_L12_V2'
    );
    DBMS_OUTPUT.PUT_LINE('Loaded ADMIN.ALL_MINILM_L12_V2.');
  ELSE
    DBMS_OUTPUT.PUT_LINE('ADMIN.ALL_MINILM_L12_V2 already exists.');
  END IF;
END;
/

GRANT EXECUTE ON DBMS_CLOUD TO APP_USER;
GRANT EXECUTE ON DBMS_CLOUD_AI TO APP_USER;
GRANT EXECUTE ON DBMS_CLOUD_AI_AGENT TO APP_USER;

PROMPT FINANCE_BOOTSTRAP_COMPLETE
EXIT SUCCESS
SQL
run_sql_phase \
  "bootstrap" \
  "${bootstrap_driver}" \
  "FINANCE_BOOTSTRAP_COMPLETE" \
  "adb_connectivity"

loader_driver="${work_dir}/loader.sql"
cat > "${loader_driver}" <<SQL
SET ECHO OFF
SET VERIFY OFF
SET DEFINE OFF
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
CONNECT ADMIN/"${ADB_ADMIN_PASSWORD}"@${ADB_CONNECT_STRING}
@"${LOADER_PATH}" "${APP_SCHEMA_PASSWORD}" "${ADB_CONNECT_STRING}"
SQL
run_sql_phase \
  "loader" \
  "${loader_driver}" \
  "FINANCE_HANDOFF_LOADER_COMPLETE" \
  "adb_connectivity"

utf8_hex() {
  LC_ALL=C printf '%s' "$1" | od -An -tx1 | tr -d ' \n'
}

region_hex="$(utf8_hex "${OCI_GENAI_REGION}")"
model_hex="$(utf8_hex "${OCI_GENAI_MODEL_ID}")"
compartment_hex="$(utf8_hex "${OCI_COMPARTMENT_OCID}")"

native_ai_driver="${work_dir}/native-ai.sql"
cat > "${native_ai_driver}" <<SQL
SET ECHO OFF
SET VERIFY OFF
SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
CONNECT APP_USER/"${APP_SCHEMA_PASSWORD}"@${ADB_CONNECT_STRING}

DECLARE
  l_credential_count PLS_INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO l_credential_count
    FROM user_credentials
   WHERE credential_name = '${OCI_CREDENTIAL_NAME}';

  IF l_credential_count > 0 THEN
    DBMS_CLOUD.DROP_CREDENTIAL(
      credential_name => '${OCI_CREDENTIAL_NAME}'
    );
  END IF;
END;
/

DBCC CREATE FIN_GENAI_KEY_V1 fingerprint ${OCI_API_KEY_FINGERPRINT} user_ocid ${OCI_USER_OCID} tenancy_ocid ${OCI_TENANCY_OCID} private_path ${OCI_API_PRIVATE_KEY_FILE}

DECLARE
  l_credential_count PLS_INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO l_credential_count
    FROM user_credentials
   WHERE credential_name = '${OCI_CREDENTIAL_NAME}';

  IF l_credential_count <> 1 THEN
    RAISE_APPLICATION_ERROR(-20301, 'OCI native credential was not created for APP_USER.');
  END IF;
  DBMS_OUTPUT.PUT_LINE('FINANCE_OCI_CREDENTIAL_READY');
END;
/

SET DEFINE ON
@"${NATIVE_AI_BOOTSTRAP_PATH}" "${region_hex}" "${model_hex}" "${compartment_hex}"
SQL
run_sql_phase \
  "native-ai" \
  "${native_ai_driver}" \
  "FINANCE_NATIVE_AI_ACCEPTANCE_OK" \
  "adb_connectivity_or_genai_api_key_propagation"

validation_driver="${work_dir}/validation.sql"
cat > "${validation_driver}" <<SQL
SET ECHO OFF
SET VERIFY OFF
SET DEFINE OFF
SET SERVEROUTPUT ON SIZE UNLIMITED
WHENEVER OSERROR EXIT FAILURE ROLLBACK
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
CONNECT APP_USER/"${APP_SCHEMA_PASSWORD}"@${ADB_CONNECT_STRING}

DECLARE
  l_count PLS_INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO l_count
    FROM user_objects
   WHERE object_name = 'SC_SECURITY_CTX'
     AND object_type IN ('PACKAGE', 'PACKAGE BODY')
     AND status = 'VALID';
  IF l_count <> 2 THEN
    RAISE_APPLICATION_ERROR(-20204, 'SC_SECURITY_CTX is missing or invalid.');
  END IF;
END;
/

BEGIN
  sc_security_ctx.set_user_context('admin_jess');
END;
/

DECLARE
  l_count PLS_INTEGER;

  PROCEDURE require_exact_rows(
    p_table_name IN VARCHAR2,
    p_expected    IN PLS_INTEGER
  ) IS
  BEGIN
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || DBMS_ASSERT.SIMPLE_SQL_NAME(p_table_name) INTO l_count;
    IF l_count <> p_expected THEN
      RAISE_APPLICATION_ERROR(
        -20201,
        p_table_name || ' expected ' || p_expected || ' rows but found ' || l_count || '.'
      );
    END IF;
  END;
BEGIN
  SELECT COUNT(*)
    INTO l_count
    FROM user_tables
   WHERE table_name IN (
     'APP_USERS', 'PRODUCTS', 'ORDERS', 'ORDER_ITEMS', 'SOCIAL_POSTS',
     'FRAUD_ENTITIES', 'PRODUCT_EMBEDDINGS', 'SIGNAL_EMBEDDINGS', 'SEMANTIC_MATCHES'
   );
  IF l_count <> 9 THEN
    RAISE_APPLICATION_ERROR(-20202, 'One or more required Finance tables are missing.');
  END IF;

  SELECT COUNT(*)
    INTO l_count
    FROM user_views
   WHERE view_name IN (
     'FINANCE_INSTITUTIONS_V', 'FINANCE_PRODUCTS_V', 'RISK_SIGNALS_V',
     'SIGNAL_SOURCES_V', 'CLIENT_TRANSACTIONS_V', 'SERVICE_CENTERS_V',
     'SERVICE_CAPACITY_V', 'SERVICE_ROUTES_V'
   );
  IF l_count <> 8 THEN
    RAISE_APPLICATION_ERROR(-20203, 'One or more required Finance semantic views are missing.');
  END IF;

  require_exact_rows('APP_USERS', 7);
  require_exact_rows('PRODUCTS', 79);
  require_exact_rows('ORDERS', 3000);
  require_exact_rows('ORDER_ITEMS', 8913);
  require_exact_rows('SOCIAL_POSTS', 5000);
  require_exact_rows('FRAUD_ENTITIES', 25);
  require_exact_rows('PRODUCT_EMBEDDINGS', 79);
  require_exact_rows('SIGNAL_EMBEDDINGS', 5000);
  require_exact_rows('SEMANTIC_MATCHES', 1599);

  SELECT COUNT(*)
    INTO l_count
    FROM all_mining_models
   WHERE owner = 'ADMIN'
     AND model_name = 'ALL_MINILM_L12_V2';
  IF l_count = 0 THEN
    RAISE_APPLICATION_ERROR(-20205, 'ADMIN.ALL_MINILM_L12_V2 is not accessible to APP_USER.');
  END IF;

  SELECT COUNT(*)
    INTO l_count
    FROM user_objects
   WHERE status <> 'VALID';
  IF l_count <> 0 THEN
    RAISE_APPLICATION_ERROR(-20206, 'Finance schema contains invalid objects.');
  END IF;

  sc_security_ctx.clear_user_context;
  DBMS_OUTPUT.PUT_LINE('FINANCE_ADB_ACCEPTANCE_OK');
EXCEPTION
  WHEN OTHERS THEN
    sc_security_ctx.clear_user_context;
    RAISE;
END;
/
EXIT SUCCESS
SQL
run_sql_phase \
  "validation" \
  "${validation_driver}" \
  "FINANCE_ADB_ACCEPTANCE_OK" \
  "adb_connectivity"

touch "${READY_MARKER}"
chmod 0600 "${READY_MARKER}"
log "FINANCE_ADB_PROVISIONING_OK"
