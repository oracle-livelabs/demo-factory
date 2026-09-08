#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ll-lakehouse-image-prep-test.XXXXXX")"

cleanup() {
  rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_exists() {
  [[ -f "$1" ]] || fail "Expected file to exist: $1"
}

assert_file_absent() {
  [[ ! -e "$1" ]] || fail "Expected path to be absent: $1"
}

assert_dir_empty() {
  [[ -d "$1" ]] || fail "Expected directory to exist: $1"
  [[ -z "$(find "$1" -mindepth 1 -print -quit)" ]] || fail "Expected directory to be empty: $1"
}

make_wallet() {
  local zip_path="$1"
  local wallet_source

  wallet_source="$(mktemp -d "${TEST_ROOT}/wallet-source.XXXXXX")"
  printf '%s\n' 'oldadb_high = (DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=example.invalid)(PORT=1522)))' \
    > "${wallet_source}/tnsnames.ora"
  printf '%s\n' 'wallet-data' > "${wallet_source}/ewallet.p12"
  (
    cd "${wallet_source}"
    zip -q "${zip_path}" tnsnames.ora ewallet.p12
  )
}

make_runtime_stubs() {
  local case_dir="$1"

  cat > "${case_dir}/podman-compose" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${TEST_COMPOSE_ARGS_FILE:?}"
case " $* " in
  *" config "*)
    cat <<'CONFIG'
services:
  app:
    image: docker.io/node:20-bookworm
  gravitino:
    image: localhost/gravitino-iceberg-rest:adw
  iceberg-seeder:
    image: localhost/iceberg-seeder:latest
  postgres-source:
    image: docker.io/library/postgres:17.11-bookworm
  loyalty-mysql:
    image: docker.io/library/mysql:8.4.11
  mongodb-catalog:
    image: docker.io/library/mongo:8.0.29
CONFIG
    ;;
  *" down --remove-orphans "*)
    touch "${TEST_PODMAN_STATE_DIR:?}/down"
    ;;
esac
EOF

  cat > "${case_dir}/podman" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
state="${TEST_PODMAN_STATE_DIR:?}"
command_name="${1:-}"
shift || true

case "${command_name}" in
  image)
    [[ "${1:-}" == "exists" ]] || exit 2
    image_name="${2:-}"
    [[ "${image_name}" != "${TEST_MISSING_IMAGE:-}" ]]
    ;;
  volume)
    action="${1:-}"
    shift || true
    case "${action}" in
      ls)
        cat "${state}/project-volumes"
        ;;
      inspect)
        volume_name=""
        for arg in "$@"; do
          volume_name="${arg}"
        done
        if [[ "$*" == *"Anonymous"* ]]; then
          if [[ -f "${state}/anonymous/${volume_name}" ]]; then
            printf '%s\n' true
          else
            printf '%s\n' false
          fi
        else
          printf '%s\n' "${state}/mounts/${volume_name}"
        fi
        ;;
      exists)
        [[ -d "${state}/mounts/${1:-}" ]]
        ;;
      rm)
        volume_name="${1:-}"
        rm -rf "${state}/mounts/${volume_name}" "${state}/anonymous/${volume_name}"
        awk -v volume="${volume_name}" '$0 != volume' "${state}/project-volumes" \
          > "${state}/project-volumes.tmp"
        mv "${state}/project-volumes.tmp" "${state}/project-volumes"
        printf '%s\n' "${volume_name}" >> "${state}/removed-volumes"
        ;;
      *)
        exit 2
        ;;
    esac
    ;;
  ps)
    if [[ ! -f "${state}/down" ]]; then
      printf '%s\n' compose-container
    fi
    ;;
  inspect)
    cat "${state}/attached-volumes"
    ;;
  *)
    exit 2
    ;;
esac
EOF

  cat > "${case_dir}/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${TEST_SYSTEMCTL_ARGS_FILE:?}"
case " $* " in
  *" cat "*)
    exit 0
    ;;
  *" stop "*)
    service="${*: -1}"
    touch "${TEST_PODMAN_STATE_DIR:?}/${service}-stopped"
    ;;
  *" is-active "*)
    service="${*: -1}"
    [[ ! -f "${TEST_PODMAN_STATE_DIR:?}/${service}-stopped" ]]
    ;;
esac
EOF

  chmod +x "${case_dir}/podman-compose" "${case_dir}/podman" "${case_dir}/systemctl"
}

setup_case() {
  local name="$1"
  local case_dir="${TEST_ROOT}/${name}"
  local state_dir="${case_dir}/podman-state"
  local volume_name

  mkdir -p "${case_dir}/ingestion/wallet"
  mkdir -p "${case_dir}/ingestion/.oci"
  mkdir -p "${case_dir}/ingestion/cdc/goldengate/cert"
  mkdir -p "${case_dir}/ingestion/logs"
  mkdir -p "${case_dir}/ingestion/gravitino/dist"
  mkdir -p "${case_dir}/ingestion/ggsa"
  mkdir -p "${case_dir}/init"
  mkdir -p "${case_dir}/home/.oci"
  mkdir -p "${case_dir}/home/.config/containers"
  mkdir -p "${case_dir}/home/.docker"
  mkdir -p "${case_dir}/home/staged"
  mkdir -p "${state_dir}/mounts" "${state_dir}/anonymous"

  printf 'services: {}\n' > "${case_dir}/ingestion/compose.yml"
  printf 'DBPASSWORD=base-image-secret\nOLLAMA_MODEL_PRIMARY=llama3.2\n' \
    > "${case_dir}/ingestion/.env"
  touch "${case_dir}/ingestion/wallet/.wallet_done"
  touch "${case_dir}/ingestion/wallet/tnsnames.ora"
  touch "${case_dir}/ingestion/wallet/ewallet.p12"
  touch "${case_dir}/ingestion/.adb_load_done"
  touch "${case_dir}/ingestion/keep-me"
  printf 'private-key\n' > "${case_dir}/ingestion/.oci/oci_api_key.pem"
  printf 'private-key\n' > "${case_dir}/home/.oci/oci_api_key.pem"
  printf '{"auths":{"registry":{"auth":"secret"}}}\n' \
    > "${case_dir}/home/.config/containers/auth.json"
  printf '{"auths":{"registry":{"auth":"secret"}}}\n' \
    > "${case_dir}/home/.docker/config.json"
  printf 'tls-private-key\n' > "${case_dir}/ingestion/cdc/goldengate/cert/ogg.key"
  printf 'DBPASSWORD=base-image-secret\n' > "${case_dir}/ingestion/logs/adb-load.log"
  printf 'download https://example.invalid/private-par-token\n' > "${case_dir}/home/inst.log"
  printf 'AIHUB=true\n' > "${case_dir}/init/aihub-image-default.env"
  printf 'staged-gravitino-archive\n' > "${case_dir}/ingestion/gravitino/dist/gravitino.zip"
  printf 'staged-osa-archive\n' > "${case_dir}/ingestion/ggsa/osa.zip"

  make_wallet "${case_dir}/home/staged/Wallet_oldadb.zip"
  make_wallet "${case_dir}/home/unreferenced-adb.zip"
  printf 'keep this archive\n' > "${case_dir}/home/readme.txt"
  (
    cd "${case_dir}/home"
    zip -q unrelated.zip readme.txt
  )
  printf 'DBPASSWORD="keep-this-value"\nadbwallet="%s"\n' \
    "${case_dir}/home/staged/Wallet_oldadb.zip" > "${case_dir}/home/.env"

  cat > "${state_dir}/project-volumes" <<'EOF'
ingestion_ollama-models
ingestion_app-node-modules
ingestion_frontend-node-modules
ingestion_signal-generator-node-modules
ingestion_oracle-data
ingestion_frontend-dist
ingestion_gravitino-logs
ingestion_postgres-source-data
ingestion_loyalty-mysql-data
ingestion_mongodb-catalog-data
EOF
  cat > "${state_dir}/attached-volumes" <<'EOF'
ingestion_app-node-modules
anonymous-runtime-volume
EOF

  while IFS= read -r volume_name; do
    mkdir -p "${state_dir}/mounts/${volume_name}"
  done < "${state_dir}/project-volumes"
  mkdir -p "${state_dir}/mounts/anonymous-runtime-volume"
  touch "${state_dir}/anonymous/anonymous-runtime-volume"

  mkdir -p "${state_dir}/mounts/ingestion_ollama-models/models/manifests/registry.ollama.ai/library/llama3.2"
  mkdir -p "${state_dir}/mounts/ingestion_ollama-models/models/blobs"
  printf '%s\n' '{"schemaVersion":2,"config":{"digest":"sha256:abc123"},"layers":[{"digest":"sha256:def456"}]}' \
    > "${state_dir}/mounts/ingestion_ollama-models/models/manifests/registry.ollama.ai/library/llama3.2/latest"
  printf 'config-blob\n' > "${state_dir}/mounts/ingestion_ollama-models/models/blobs/sha256-abc123"
  printf 'model-blob\n' > "${state_dir}/mounts/ingestion_ollama-models/models/blobs/sha256-def456"
  mkdir -p "${state_dir}/mounts/ingestion_app-node-modules/oracledb"
  printf '{}\n' > "${state_dir}/mounts/ingestion_app-node-modules/oracledb/package.json"
  mkdir -p "${state_dir}/mounts/ingestion_frontend-node-modules/vite"
  mkdir -p "${state_dir}/mounts/ingestion_frontend-node-modules/.bin"
  printf '{}\n' > "${state_dir}/mounts/ingestion_frontend-node-modules/vite/package.json"
  touch "${state_dir}/mounts/ingestion_frontend-node-modules/.bin/vite"
  mkdir -p "${state_dir}/mounts/ingestion_signal-generator-node-modules/kafkajs"
  printf '{}\n' > "${state_dir}/mounts/ingestion_signal-generator-node-modules/kafkajs/package.json"

  make_runtime_stubs "${case_dir}"
  printf '%s\n' "${case_dir}"
}

run_prepare() {
  local case_dir="$1"
  local missing_image="${2:-}"

  INGESTION_DIR="${case_dir}/ingestion" \
  OPC_HOME="${case_dir}/home" \
  PODMAN_BIN="${case_dir}/podman" \
  PODMAN_COMPOSE_BIN="${case_dir}/podman-compose" \
  TEST_PODMAN_STATE_DIR="${case_dir}/podman-state" \
  TEST_COMPOSE_ARGS_FILE="${case_dir}/compose-args.log" \
  TEST_SYSTEMCTL_ARGS_FILE="${case_dir}/systemctl-args.log" \
  TEST_MISSING_IMAGE="${missing_image}" \
  SYSTEMCTL_BIN="${case_dir}/systemctl" \
  bash "${PROJECT_ROOT}/prepare-custom-image.sh"
}

assert_preflight_did_not_clean() {
  local case_dir="$1"

  assert_file_exists "${case_dir}/home/.env"
  assert_file_exists "${case_dir}/ingestion/.env"
  assert_file_exists "${case_dir}/ingestion/wallet/ewallet.p12"
  [[ -d "${case_dir}/podman-state/mounts/ingestion_oracle-data" ]] \
    || fail "Preflight failure removed a runtime volume"
  [[ ! -f "${case_dir}/podman-state/down" ]] \
    || fail "Preflight failure stopped compose resources"
  if grep -q -- ' down ' "${case_dir}/compose-args.log"; then
    fail "Preflight failure invoked compose down"
  fi
}

command -v zip >/dev/null 2>&1 || fail "zip is required"

echo "Test: missing seeder image aborts before cleanup"
missing_image_dir="$(setup_case missing-image)"
if run_prepare "${missing_image_dir}" "localhost/iceberg-seeder:latest" \
  > "${missing_image_dir}/prepare.log" 2>&1; then
  fail "Image preparation accepted a missing Iceberg seeder image"
fi
grep -q 'Offline artifact preflight failed' "${missing_image_dir}/prepare.log" \
  || fail "Missing-image failure did not identify the offline preflight"
assert_preflight_did_not_clean "${missing_image_dir}"

echo "Test: incomplete Ollama model aborts before cleanup"
missing_model_dir="$(setup_case missing-model)"
rm -f "${missing_model_dir}/podman-state/mounts/ingestion_ollama-models/models/blobs/sha256-def456"
if run_prepare "${missing_model_dir}" > "${missing_model_dir}/prepare.log" 2>&1; then
  fail "Image preparation accepted an incomplete Ollama model cache"
fi
grep -q 'Ollama model is not fully cached' "${missing_model_dir}/prepare.log" \
  || fail "Missing-model failure did not identify the Ollama cache"
assert_preflight_did_not_clean "${missing_model_dir}"

echo "Test: missing source database image aborts before cleanup"
missing_source_image_dir="$(setup_case missing-source-image)"
if run_prepare "${missing_source_image_dir}" "docker.io/library/postgres:17.11-bookworm" \
  > "${missing_source_image_dir}/prepare.log" 2>&1; then
  fail "Image preparation accepted a missing PostgreSQL source image"
fi
grep -q 'Offline artifact preflight failed' "${missing_source_image_dir}/prepare.log" \
  || fail "Missing source image failure did not identify the offline preflight"
assert_preflight_did_not_clean "${missing_source_image_dir}"

echo "Test: missing Node dependency aborts before cleanup"
missing_dependency_dir="$(setup_case missing-dependency)"
rm -f "${missing_dependency_dir}/podman-state/mounts/ingestion_signal-generator-node-modules/kafkajs/package.json"
if run_prepare "${missing_dependency_dir}" > "${missing_dependency_dir}/prepare.log" 2>&1; then
  fail "Image preparation accepted a missing KafkaJS dependency cache"
fi
grep -q 'missing KafkaJS' "${missing_dependency_dir}/prepare.log" \
  || fail "Missing-dependency failure did not identify KafkaJS"
assert_preflight_did_not_clean "${missing_dependency_dir}"

echo "Test: cleanup preserves only reusable offline dependency volumes"
prepare_dir="$(setup_case success)"
run_prepare "${prepare_dir}" > "${prepare_dir}/prepare.log"

assert_dir_empty "${prepare_dir}/ingestion/wallet"
assert_file_absent "${prepare_dir}/ingestion/.adb_load_done"
assert_file_exists "${prepare_dir}/ingestion/.oci_wallet_required"
assert_file_exists "${prepare_dir}/ingestion/keep-me"
assert_file_absent "${prepare_dir}/ingestion/.env"
assert_file_absent "${prepare_dir}/home/.env"
assert_file_exists "${prepare_dir}/init/aihub-image-default.env"
grep -qxF 'AIHUB=true' "${prepare_dir}/init/aihub-image-default.env" \
  || fail "Image AI Hub default was not preserved"
assert_file_absent "${prepare_dir}/home/inst.log"
assert_file_absent "${prepare_dir}/ingestion/.oci"
assert_file_absent "${prepare_dir}/home/.oci"
assert_file_absent "${prepare_dir}/home/.config/containers/auth.json"
assert_file_absent "${prepare_dir}/home/.docker/config.json"
assert_file_absent "${prepare_dir}/ingestion/cdc/goldengate/cert"
assert_file_absent "${prepare_dir}/ingestion/logs"
assert_file_exists "${prepare_dir}/ingestion/gravitino/dist/gravitino.zip"
assert_file_exists "${prepare_dir}/ingestion/ggsa/osa.zip"
assert_file_absent "${prepare_dir}/home/staged/Wallet_oldadb.zip"
assert_file_absent "${prepare_dir}/home/unreferenced-adb.zip"
assert_file_exists "${prepare_dir}/home/unrelated.zip"

for preserved_volume in \
  ingestion_ollama-models \
  ingestion_app-node-modules \
  ingestion_frontend-node-modules \
  ingestion_signal-generator-node-modules; do
  [[ -d "${prepare_dir}/podman-state/mounts/${preserved_volume}" ]] \
    || fail "Expected preserved volume: ${preserved_volume}"
  grep -qxF -- "${preserved_volume}" "${prepare_dir}/podman-state/project-volumes" \
    || fail "Preserved volume lost its project registration: ${preserved_volume}"
done

[[ "$(wc -l < "${prepare_dir}/podman-state/project-volumes" | tr -d ' ')" == "4" ]] \
  || fail "Unexpected compose project volumes remain"
assert_file_absent "${prepare_dir}/podman-state/mounts/ingestion_oracle-data"
assert_file_absent "${prepare_dir}/podman-state/mounts/ingestion_frontend-dist"
assert_file_absent "${prepare_dir}/podman-state/mounts/ingestion_gravitino-logs"
assert_file_absent "${prepare_dir}/podman-state/mounts/ingestion_postgres-source-data"
assert_file_absent "${prepare_dir}/podman-state/mounts/ingestion_loyalty-mysql-data"
assert_file_absent "${prepare_dir}/podman-state/mounts/ingestion_mongodb-catalog-data"
assert_file_absent "${prepare_dir}/podman-state/mounts/anonymous-runtime-volume"
for service in iceberg-seed.service pg-iceberg-connection.service user-podman.service; do
  assert_file_exists "${prepare_dir}/podman-state/${service}-stopped"
  grep -q -- "stop ${service}" "${prepare_dir}/systemctl-args.log" \
    || fail "Image preparation did not stop ${service}"
done
if grep -q -- 'disable user-podman.service' "${prepare_dir}/systemctl-args.log"; then
  fail "Image preparation disabled user-podman.service"
fi
grep -q -- 'down --remove-orphans' "${prepare_dir}/compose-args.log" \
  || fail "Image preparation did not remove compose containers"
grep -q -- '--profile aihub config' "${prepare_dir}/compose-args.log" \
  || fail "Image preparation did not preflight the AI Hub compose profile"
if grep -q -- 'down --volumes' "${prepare_dir}/compose-args.log"; then
  fail "Image preparation removed reusable dependency volumes"
fi
if grep -q -- '--rmi' "${prepare_dir}/compose-args.log"; then
  fail "Image preparation removed reusable container images"
fi

printf 'adbwallet="%s"\n' "${prepare_dir}/home/unrelated.zip" > "${prepare_dir}/home/.env"
run_prepare "${prepare_dir}" >/dev/null
assert_file_exists "${prepare_dir}/home/unrelated.zip"
assert_file_absent "${prepare_dir}/home/.env"

echo "Custom image preparation tests passed."
