#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APPLICATION_ROOT="${SOURCE_ROOT}/application"
TEMP_APPLICATION_ROOT=""

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TEMP_APPLICATION_ROOT}" && -d "${TEMP_APPLICATION_ROOT}" ]]; then
    rm -rf -- "${TEMP_APPLICATION_ROOT}"
  fi
}
trap cleanup EXIT

if [[ ! -d "${APPLICATION_ROOT}" ]]; then
  command -v unzip >/dev/null 2>&1 ||
    fail "unzip is required to inspect the packaged application payload."
  TEMP_APPLICATION_ROOT="$(mktemp -d)"
  unzip -q "${SOURCE_ROOT}/payload/finance-application.zip" -d "${TEMP_APPLICATION_ROOT}"
  APPLICATION_ROOT="${TEMP_APPLICATION_ROOT}"
fi

require_pattern() {
  local pattern="$1"
  local path="$2"
  grep -Eq -- "${pattern}" "${SOURCE_ROOT}/${path}" ||
    fail "${path} is missing required contract pattern: ${pattern}"
}

require_application_pattern() {
  local pattern="$1"
  local path="$2"
  grep -Eq -- "${pattern}" "${APPLICATION_ROOT}/${path}" ||
    fail "application/${path} is missing required contract pattern: ${pattern}"
}

forbidden_runtime_pattern='olla''ma|llama3[.]2|11434'
if grep -ERin \
  --exclude='check-selectai-platform-contract.sh' \
  --exclude='check-resource-manager-package.py' \
  --exclude='finance-application.zip' \
  --exclude-dir='application' \
  --exclude-dir='.terraform' \
  --exclude-dir='__pycache__' \
  "${forbidden_runtime_pattern}" "${SOURCE_ROOT}" >/dev/null; then
  grep -ERin \
    --exclude='check-selectai-platform-contract.sh' \
    --exclude='check-resource-manager-package.py' \
    --exclude='finance-application.zip' \
    --exclude-dir='application' \
    --exclude-dir='.terraform' \
    --exclude-dir='__pycache__' \
    "${forbidden_runtime_pattern}" "${SOURCE_ROOT}" >&2 || true
  fail "Shipped source still contains a local-model runtime reference."
fi

if grep -ERin "${forbidden_runtime_pattern}" "${APPLICATION_ROOT}" >/dev/null; then
  grep -ERin "${forbidden_runtime_pattern}" "${APPLICATION_ROOT}" >&2 || true
  fail "Packaged application still contains a local-model runtime reference."
fi

if grep -ERn \
  --include='*.tf' \
  --include='*.yaml' \
  --include='*.yml' \
  'BEGIN (RSA )?PRIVATE KEY|private_key(_b64)?[[:space:]]*=' \
  "${SOURCE_ROOT}" >/dev/null; then
  fail "Terraform or metadata contains OCI private-key material or an input path for it."
fi

[[ ! -e "${APPLICATION_ROOT}/scripts/pull_ollama.sh" ]] ||
  fail "The obsolete local-model pull script still exists."

require_pattern 'variable "tenancy_ocid"' "variables.tf"
require_pattern 'variable "current_user_ocid"' "variables.tf"
require_pattern 'variable "identity_domain_ocid"' "variables.tf"
require_pattern 'variable "bootstrap_generation"' "variables.tf"
require_pattern 'version[[:space:]]*=[[:space:]]*"=[[:space:]]*8[.]25[.]0"' "versions.tf"
require_pattern 'version[[:space:]]*=[[:space:]]*"=[[:space:]]*3[.]9[.]0"' "versions.tf"
require_pattern 'payload/finance-application[.]zip' "main.tf"
require_pattern 'filesha256[(]local[.]application_payload_path[)]' "main.tf"
require_pattern 'filesha256[(]"\$\{path[.]module\}/compute-app[.]tf"[)]' "main.tf"
require_pattern 'filesha256[(]"\$\{path[.]module\}/object-storage[.]tf"[)]' "main.tf"
require_pattern 'source[[:space:]]*=[[:space:]]*local[.]application_payload_path' "object-storage.tf"
require_pattern 'for_each[[:space:]]*=[[:space:]]*toset[(]\[local[.]application_payload_sha256\]\)' "object-storage.tf"
require_pattern 'object[[:space:]]*=[[:space:]]*"application/payloads/\$\{each[.]key\}[.]zip"' "object-storage.tf"
require_pattern 'oci_objectstorage_object[.]application\[local[.]application_payload_sha256\][.]object' "object-storage.tf"
require_pattern 'base64gzip[(]local[.]application_cloud_init[)]' "compute-app.tf"
require_pattern 'application_instance_metadata_budget_bytes[[:space:]]*=[[:space:]]*30000' "compute-app.tf"
require_pattern 'application_metadata_size_bytes[[:space:]]*<=' "compute-app.tf"
require_pattern 'maxLength:[[:space:]]*4096' "schema.yaml"
require_pattern 'version:[[:space:]]*"20260904-v12"' "schema.yaml"
require_pattern 'type:[[:space:]]*oci:identity:domains:id' "schema.yaml"
require_pattern 'data "oci_identity_domain" "selected"' "select-ai-key.tf"
require_pattern 'data "oci_identity_domains_my_api_keys" "current"' "select-ai-key.tf"
require_pattern 'resource "oci_identity_domains_my_api_key" "select_ai"' "select-ai-key.tf"
require_pattern 'urn:ietf:params:scim:schemas:oracle:idcs:apikey' "select-ai-key.tf"
require_pattern 'total_results[[:space:]]*<[[:space:]]*3' "select-ai-key.tf"
require_pattern 'selectai_api_key_owner_token[[:space:]]*=[[:space:]]*substr[(]sha256[(]jsonencode' "select-ai-key.tf"
require_pattern 'self[.]user\[0\][.]ocid[[:space:]]*==[[:space:]]*var[.]current_user_ocid' "select-ai-key.tf"
require_pattern 'self[.]domain_ocid[[:space:]]*==[[:space:]]*var[.]identity_domain_ocid' "select-ai-key.tf"
require_pattern 'data "oci_objectstorage_object" "api_key_public_callback"' "select-ai-key.tf"
require_pattern 'EXPECTED_DEPLOYMENT_ID' "select-ai-key.tf"
require_pattern 'EXPECTED_INSTANCE_OCID' "select-ai-key.tf"
require_pattern 'BOOTSTRAP_STATUS_URL' "select-ai-key.tf"
require_pattern 'wait_for_dns "Object Storage callback"' "scripts/bootstrap_app_vm.sh"
require_pattern 'set_bootstrap_phase "selectai_api_key_prerequisites"' "scripts/bootstrap_app_vm.sh"
require_pattern 'retry_dnf_install "minimal Select AI" curl jq openssl' "scripts/bootstrap_app_vm.sh"
require_pattern 'retry_dnf_install "Resource Manager runtime" container-tools unzip python3 python3-pip' "scripts/bootstrap_app_vm.sh"
require_pattern 'java-17-openjdk-headless' "scripts/bootstrap_app_vm.sh"
require_pattern 'sqlcl-latest[.]zip' "scripts/bootstrap_app_vm.sh"
require_pattern "podman-compose>=1[.]2,<2" "scripts/bootstrap_app_vm.sh"
require_pattern 'run_compose up -d --build app' "scripts/bootstrap_app_vm.sh"
require_pattern 'set_bootstrap_phase "application_frontend_check"' "scripts/bootstrap_app_vm.sh"
require_pattern 'bootstrap_status_url' "scripts/wait_for_selectai_api_key_callback.py"
require_pattern 'terraform_data[.]api_key_activation' "bootstrap-wait.tf"
require_application_pattern 'FINANCE_NATIVE_AI_ACCEPTANCE_OK' "deployment/bootstrap-finance-adb.sh"
require_application_pattern 'DBCC CREATE FIN_GENAI_KEY_V1' "deployment/bootstrap-finance-adb.sh"
require_application_pattern 'FROM user_credentials' "deployment/bootstrap-finance-adb.sh"
require_application_pattern 'GRANT EXECUTE ON DBMS_CLOUD TO APP_USER' "deployment/bootstrap-finance-adb.sh"
require_application_pattern 'GRANT EXECUTE ON DBMS_CLOUD_AI TO APP_USER' "deployment/bootstrap-finance-adb.sh"
require_application_pattern 'GRANT EXECUTE ON DBMS_CLOUD_AI_AGENT TO APP_USER' "deployment/bootstrap-finance-adb.sh"
require_pattern 'rm -f "\$\{API_PRIVATE_KEY_FILE\}" "\$\{API_PUBLIC_KEY_FILE\}"' "scripts/bootstrap_app_vm.sh"
require_application_pattern 'FINANCE_SELECTAI_V1' "compose.yml"
require_application_pattern 'FINANCE_OPERATIONS_TEAM' "compose.yml"
require_pattern 'ignore_changes[[:space:]]*=[[:space:]]*\[key\]' "select-ai-key.tf"
require_pattern 'replace_triggered_by[[:space:]]*=[[:space:]]*\[oci_core_instance[.]application[.]id\]' "select-ai-key.tf"
require_pattern 'sha256[(]var[.]model_object_uri[)]' "main.tf"
require_pattern 'finance-livestack-resource-manager-native-selectai-v9[.]zip' "README.md"
require_pattern 'include-agent-chat' "README.md"

if grep -Eqi '(native|supervisor)[[:space:]]+RUN_TEAM[[:space:]]+probes' \
  "${SOURCE_ROOT}/README.md"; then
  fail "README must not claim that bounded Apply acceptance executes RUN_TEAM."
fi

if grep -Eq 'resource[[:space:]]+"oci_identity_api_key"' "${SOURCE_ROOT}"/*.tf; then
  fail "The legacy IAM /20160918 API-key resource must not be shipped."
fi

if grep -Eq 'selectai_api_key_description[[:space:]]*=.*random_id' \
  "${SOURCE_ROOT}/select-ai-key.tf"; then
  fail "The API-key capacity guard must remain fully known during a fresh Plan."
fi

if grep -ERq '^[[:space:]]*(data|resource)[[:space:]]+"archive_file"' \
  "${SOURCE_ROOT}"/*.tf; then
  fail "Terraform must consume the prebuilt payload, not create an archive during a job."
fi

if grep -Eq 'hashicorp/archive' "${SOURCE_ROOT}/versions.tf"; then
  fail "The unused archive provider must not be shipped."
fi

if grep -Eq '^[[:space:]]*podman[[:space:]].*(sqlcl|jdk-21-headless)' \
  "${SOURCE_ROOT}/scripts/bootstrap_app_vm.sh"; then
  fail "Resource Manager bootstrap must not request unavailable package names."
fi

if grep -Eq 'base64encode[[:space:]]*[(][[:space:]]*templatefile[[:space:]]*[(]' \
  "${SOURCE_ROOT}/compute-app.tf"; then
  fail "Cloud-init must be gzip-compressed before Base64 encoding."
fi

par_rotation_count="$(
  grep -Ec 'replace_triggered_by[[:space:]]*=[[:space:]]*\[terraform_data[.]bootstrap_configuration\]' \
    "${SOURCE_ROOT}/object-storage.tf"
)"
[[ "${par_rotation_count}" -eq 8 ]] ||
  fail "Every one of the eight expiring bootstrap PARs must rotate with the bootstrap generation."

if grep -Eq '^[[:space:]]*create_before_destroy[[:space:]]*=' "${SOURCE_ROOT}/select-ai-key.tf"; then
  fail "API-key replacement must free the old key slot before uploading the new public key."
fi

bash -n \
  "${SOURCE_ROOT}/scripts/bootstrap_app_vm.sh" \
  "${SOURCE_ROOT}/scripts/publish_selectai_api_key_activation.sh" \
  "${SOURCE_ROOT}/scripts/wait_for_selectai_api_key_callback.sh" \
  "${SOURCE_ROOT}/scripts/wait_for_bootstrap_callback.sh" \
  "${APPLICATION_ROOT}/deployment/bootstrap-finance-adb.sh"

python3 -c \
  'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))' \
  "${SOURCE_ROOT}/scripts/wait_for_selectai_api_key_callback.py"

python3 "${SOURCE_ROOT}/verification/check-resource-manager-package.py" \
  --source-root "${SOURCE_ROOT}"
python3 "${SOURCE_ROOT}/verification/check-compute-metadata-budget.py"

if command -v terraform >/dev/null 2>&1; then
  terraform -chdir="${SOURCE_ROOT}" fmt -check -recursive >/dev/null
fi

printf 'PASS: Select AI Terraform and bootstrap security contract is intact.\n'
