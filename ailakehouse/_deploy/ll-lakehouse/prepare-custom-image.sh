#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INGESTION_DIR="/home/opc/ingestion"
OPC_HOME="${OPC_HOME:-/home/opc}"
ENV_FILE="${ENV_FILE:-${OPC_HOME}/.env}"

if [[ -d "${DEFAULT_INGESTION_DIR}" ]]; then
  INGESTION_DIR="${INGESTION_DIR:-${DEFAULT_INGESTION_DIR}}"
else
  INGESTION_DIR="${INGESTION_DIR:-${SCRIPT_DIR}/ingestion}"
fi

WALLET_DIR="${INGESTION_DIR}/wallet"
ADB_LOAD_MARKER="${INGESTION_DIR}/.adb_load_done"
OCI_WALLET_REQUIRED_MARKER="${INGESTION_DIR}/.oci_wallet_required"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-${INGESTION_DIR}/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-${INGESTION_DIR}/compose.yml}"
HOME_OCI_DIR="${HOME_OCI_DIR:-${OPC_HOME}/.oci}"
INGESTION_OCI_DIR="${INGESTION_OCI_DIR:-${INGESTION_DIR}/.oci}"
GOLDENGATE_CERT_DIR="${GOLDENGATE_CERT_DIR:-${INGESTION_DIR}/cdc/goldengate/cert}"
APPLICATION_LOG_DIR="${APPLICATION_LOG_DIR:-${INGESTION_DIR}/logs}"
INSTALL_LOG="${INSTALL_LOG:-${OPC_HOME}/inst.log}"
PODMAN_AUTH_FILE="${PODMAN_AUTH_FILE:-${OPC_HOME}/.config/containers/auth.json}"
DOCKER_AUTH_FILE="${DOCKER_AUTH_FILE:-${OPC_HOME}/.docker/config.json}"
PODMAN_BIN="${PODMAN_BIN:-}"
PODMAN_COMPOSE_BIN="${PODMAN_COMPOSE_BIN:-}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-}"
USER_PODMAN_SERVICE="${USER_PODMAN_SERVICE:-user-podman.service}"
PG_ICEBERG_CONNECTION_SERVICE="${PG_ICEBERG_CONNECTION_SERVICE:-pg-iceberg-connection.service}"
ICEBERG_SEED_SERVICE="${ICEBERG_SEED_SERVICE:-iceberg-seed.service}"
COMPOSE_PROJECT=""
PRESERVED_OFFLINE_VOLUME_KEYS=(
  "ollama-models"
  "app-node-modules"
  "frontend-node-modules"
  "signal-generator-node-modules"
)

if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip is required to inspect wallet archives before image capture." >&2
  exit 1
fi

strip_outer_quotes() {
  local value="$1"

  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]] \
      || [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi

  printf '%s' "${value}"
}

read_compose_env_value() {
  local key="$1"
  local default_value="$2"
  local value=""

  if [[ -f "${COMPOSE_ENV_FILE}" ]]; then
    value="$(awk -v key="${key}" '
      $0 ~ "^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=" {
        sub("^[[:space:]]*(export[[:space:]]+)?" key "[[:space:]]*=[[:space:]]*", "")
        value = $0
      }
      END { print value }
    ' "${COMPOSE_ENV_FILE}")"
    value="$(strip_outer_quotes "${value%$'\r'}")"
  fi

  printf '%s' "${value:-${default_value}}"
}

resolve_runtime_commands() {
  if [[ -z "${PODMAN_BIN}" ]]; then
    PODMAN_BIN="$(command -v podman || true)"
  fi
  if [[ -z "${PODMAN_COMPOSE_BIN}" ]]; then
    PODMAN_COMPOSE_BIN="$(command -v podman-compose || true)"
  fi

  if [[ -z "${PODMAN_BIN}" ]]; then
    echo "podman is required to verify and clean the custom image." >&2
    exit 1
  fi
  if [[ -z "${PODMAN_COMPOSE_BIN}" ]]; then
    echo "podman-compose is required to verify and clean the custom image." >&2
    exit 1
  fi
}

resolve_compose_project() {
  local configured_project="${COMPOSE_PROJECT_NAME:-}"
  local compose_dir

  if [[ -z "${configured_project}" ]]; then
    configured_project="$(read_compose_env_value "COMPOSE_PROJECT_NAME" "")"
  fi
  compose_dir="$(cd "$(dirname "${COMPOSE_FILE}")" && pwd -P)"
  COMPOSE_PROJECT="${configured_project:-$(basename "${compose_dir}")}"
}

run_compose() {
  local compose_dir
  local compose_name
  local compose_args=()

  compose_dir="$(cd "$(dirname "${COMPOSE_FILE}")" && pwd -P)"
  compose_name="$(basename "${COMPOSE_FILE}")"
  if [[ -f "${COMPOSE_ENV_FILE}" ]]; then
    compose_args+=(--env-file "${COMPOSE_ENV_FILE}")
  fi
  compose_args+=(-f "${compose_name}")

  (
    cd "${compose_dir}"
    "${PODMAN_COMPOSE_BIN}" "${compose_args[@]}" "$@"
  )
}

project_volume_names() {
  "${PODMAN_BIN}" volume ls \
    --filter "label=io.podman.compose.project=${COMPOSE_PROJECT}" \
    --format '{{.Name}}'
}

project_container_ids() {
  "${PODMAN_BIN}" ps --all \
    --filter "label=io.podman.compose.project=${COMPOSE_PROJECT}" \
    --format '{{.ID}}'
}

preserved_volume_name() {
  printf '%s_%s' "${COMPOSE_PROJECT}" "$1"
}

is_preserved_offline_volume() {
  local volume_name="$1"
  local volume_key

  for volume_key in "${PRESERVED_OFFLINE_VOLUME_KEYS[@]}"; do
    if [[ "${volume_name}" == "$(preserved_volume_name "${volume_key}")" ]]; then
      return 0
    fi
  done
  return 1
}

volume_mountpoint() {
  "${PODMAN_BIN}" volume inspect --format '{{.Mountpoint}}' "$1"
}

ollama_model_is_cached() {
  local manifest_path="$1"
  local blobs_dir="$2"
  local manifest_content
  local digest_pattern='"digest":"(sha256:[[:xdigit:]]+)"'
  local digest
  local matched
  local digest_count=0

  [[ -s "${manifest_path}" && -d "${blobs_dir}" ]] || return 1
  manifest_content="$(tr -d '[:space:]' < "${manifest_path}")"
  while [[ "${manifest_content}" =~ ${digest_pattern} ]]; do
    matched="${BASH_REMATCH[0]}"
    digest="${BASH_REMATCH[1]}"
    digest_count=$((digest_count + 1))
    [[ -s "${blobs_dir}/${digest/:/-}" ]] || return 1
    manifest_content="${manifest_content#*${matched}}"
  done

  [[ "${digest_count}" -gt 0 ]]
}

preflight_offline_artifacts() {
  local seed_config_file
  local aihub_config_file
  local project_volumes_file
  local image
  local image_count=0
  local missing=0
  local seeder_image
  local model_ref
  local model_name
  local model_tag="latest"
  local volume_name
  local mountpoint

  [[ -f "${COMPOSE_FILE}" ]] || {
    echo "Compose file not found: ${COMPOSE_FILE}" >&2
    exit 1
  }

  resolve_runtime_commands
  resolve_compose_project
  seed_config_file="$(mktemp "${TMPDIR:-/tmp}/ll-lakehouse-compose-seed-config.XXXXXX")"
  aihub_config_file="$(mktemp "${TMPDIR:-/tmp}/ll-lakehouse-compose-aihub-config.XXXXXX")"
  project_volumes_file="$(mktemp "${TMPDIR:-/tmp}/ll-lakehouse-project-volumes.XXXXXX")"

  if ! run_compose --profile seed config > "${seed_config_file}" \
    || ! run_compose --profile aihub config > "${aihub_config_file}"; then
    rm -f "${seed_config_file}" "${aihub_config_file}" "${project_volumes_file}"
    echo "Unable to render the compose configuration. No cleanup was performed." >&2
    exit 1
  fi
  project_volume_names > "${project_volumes_file}"

  while IFS= read -r image; do
    image="$(strip_outer_quotes "${image%$'\r'}")"
    [[ -n "${image}" ]] || continue
    image_count=$((image_count + 1))
    if ! "${PODMAN_BIN}" image exists "${image}"; then
      echo "Missing offline container image: ${image}" >&2
      missing=1
    fi
  done < <(awk '$1 == "image:" && !seen[$2]++ { print $2 }' \
    "${seed_config_file}" "${aihub_config_file}")

  if [[ "${image_count}" -eq 0 ]]; then
    echo "No container images were found in the rendered compose configuration." >&2
    missing=1
  fi

  seeder_image="$(read_compose_env_value "ICEBERG_SEED_IMAGE" "localhost/iceberg-seeder:latest")"
  if ! "${PODMAN_BIN}" image exists "${seeder_image}"; then
    echo "Missing prebuilt Iceberg seeder image: ${seeder_image}" >&2
    missing=1
  fi

  for volume_name in "${PRESERVED_OFFLINE_VOLUME_KEYS[@]}"; do
    volume_name="$(preserved_volume_name "${volume_name}")"
    if ! grep -qxF -- "${volume_name}" "${project_volumes_file}"; then
      echo "Missing reusable offline dependency volume: ${volume_name}" >&2
      missing=1
    fi
  done

  volume_name="$(preserved_volume_name "ollama-models")"
  if grep -qxF -- "${volume_name}" "${project_volumes_file}"; then
    mountpoint="$(volume_mountpoint "${volume_name}")"
    model_ref="$(read_compose_env_value "OLLAMA_MODEL_PRIMARY" "llama3.2")"
    model_name="${model_ref}"
    if [[ "${model_ref##*/}" == *:* ]]; then
      model_tag="${model_ref##*:}"
      model_name="${model_ref%:*}"
    fi
    model_name="${model_name#registry.ollama.ai/}"
    model_name="${model_name#library/}"
    if ! ollama_model_is_cached \
      "${mountpoint}/models/manifests/registry.ollama.ai/library/${model_name}/${model_tag}" \
      "${mountpoint}/models/blobs"; then
      echo "Configured Ollama model is not fully cached: ${model_ref}" >&2
      missing=1
    fi
  fi

  volume_name="$(preserved_volume_name "app-node-modules")"
  if grep -qxF -- "${volume_name}" "${project_volumes_file}"; then
    mountpoint="$(volume_mountpoint "${volume_name}")"
    if [[ ! -f "${mountpoint}/oracledb/package.json" ]]; then
      echo "Node dependency cache is missing oracledb: ${volume_name}" >&2
      missing=1
    fi
  fi

  volume_name="$(preserved_volume_name "frontend-node-modules")"
  if grep -qxF -- "${volume_name}" "${project_volumes_file}"; then
    mountpoint="$(volume_mountpoint "${volume_name}")"
    if [[ ! -f "${mountpoint}/vite/package.json" || ! -e "${mountpoint}/.bin/vite" ]]; then
      echo "Node dependency cache is missing Vite: ${volume_name}" >&2
      missing=1
    fi
  fi

  volume_name="$(preserved_volume_name "signal-generator-node-modules")"
  if grep -qxF -- "${volume_name}" "${project_volumes_file}"; then
    mountpoint="$(volume_mountpoint "${volume_name}")"
    if [[ ! -f "${mountpoint}/kafkajs/package.json" ]]; then
      echo "Node dependency cache is missing KafkaJS: ${volume_name}" >&2
      missing=1
    fi
  fi

  rm -f "${seed_config_file}" "${aihub_config_file}" "${project_volumes_file}"
  if [[ "${missing}" -ne 0 ]]; then
    echo "Offline artifact preflight failed. No cleanup was performed." >&2
    exit 1
  fi

  echo "Offline artifact preflight passed for compose project ${COMPOSE_PROJECT}."
}

stop_image_capture_services() {
  local service
  local stopped_any=0

  if [[ -z "${SYSTEMCTL_BIN}" ]]; then
    SYSTEMCTL_BIN="$(command -v systemctl || true)"
  fi

  if [[ -z "${SYSTEMCTL_BIN}" ]]; then
    echo "systemctl is unavailable; continuing without stopping user services."
    return 0
  fi

  for service in "${ICEBERG_SEED_SERVICE}" "${PG_ICEBERG_CONNECTION_SERVICE}" "${USER_PODMAN_SERVICE}"; do
    if ! "${SYSTEMCTL_BIN}" --user cat "${service}" >/dev/null 2>&1; then
      echo "No ${service} user service found; continuing."
      continue
    fi

    "${SYSTEMCTL_BIN}" --user stop "${service}"
    if "${SYSTEMCTL_BIN}" --user is-active --quiet "${service}"; then
      echo "${service} is still active after stop request." >&2
      exit 1
    fi
    stopped_any=1
    echo "Stopped ${service} before removing Compose runtime state."
  done

  [[ "${stopped_any}" -eq 1 ]] || echo "No image-capture user services were installed."
}

run_privileged() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

remove_crowdstrike_sensor() {
  local rpm_bin yum_bin dnf_bin systemctl_bin

  rpm_bin="$(command -v rpm || true)"
  [[ -n "${rpm_bin}" ]] || {
    echo "rpm is unavailable; skipping CrowdStrike sensor check."
    return 0
  }
  if ! "${rpm_bin}" -qa | grep -q '^falcon-sensor'; then
    echo "CrowdStrike falcon-sensor is not installed."
    return 0
  fi

  systemctl_bin="${SYSTEMCTL_BIN:-$(command -v systemctl || true)}"
  if [[ -n "${systemctl_bin}" ]]; then
    run_privileged "${systemctl_bin}" stop falcon-sensor || true
  fi

  yum_bin="$(command -v yum || true)"
  dnf_bin="$(command -v dnf || true)"
  [[ -z "${yum_bin}" ]] || run_privileged "${yum_bin}" remove falcon-sensor -y || true
  [[ -z "${dnf_bin}" ]] || run_privileged "${dnf_bin}" remove falcon-sensor -y || true

  if "${rpm_bin}" -qa | grep -q '^falcon-sensor'; then
    echo "CrowdStrike falcon-sensor remains installed after removal." >&2
    return 1
  fi
  echo "CrowdStrike falcon-sensor has been removed."
  [[ -z "${systemctl_bin}" ]] || "${systemctl_bin}" status falcon-sensor || true
}

is_wallet_archive() {
  local candidate="$1"
  local members

  [[ -f "${candidate}" ]] || return 1
  members="$(unzip -Z1 "${candidate}" 2>/dev/null || true)"
  awk '
    {
      count = split($0, parts, "/")
      name = tolower(parts[count])
      if (name == "tnsnames.ora") has_tns = 1
      if (name == "ewallet.p12" || name == "cwallet.sso") has_wallet = 1
    }
    END { exit !(has_tns && has_wallet) }
  ' <<< "${members}"
}

remove_configured_wallet_archive() {
  local configured_wallet=""
  local canonical_home canonical_wallet wallet_dir

  [[ -f "${ENV_FILE}" ]] || return 0

  configured_wallet="$(awk '
    /^[[:space:]]*(export[[:space:]]+)?adbwallet[[:space:]]*=/ {
      sub(/^[[:space:]]*(export[[:space:]]+)?adbwallet[[:space:]]*=[[:space:]]*/, "")
      value = $0
    }
    END { print value }
  ' "${ENV_FILE}")"
  configured_wallet="$(strip_outer_quotes "${configured_wallet%$'\r'}")"

  if [[ "${configured_wallet}" == /* && -f "${configured_wallet}" ]]; then
    canonical_home="$(cd "${OPC_HOME}" && pwd -P)"
    wallet_dir="$(cd "$(dirname "${configured_wallet}")" && pwd -P)"
    canonical_wallet="${wallet_dir}/$(basename "${configured_wallet}")"
    if [[ "${canonical_wallet}" == "${canonical_home}"/* ]] \
      && is_wallet_archive "${configured_wallet}"; then
      secure_remove_file "${configured_wallet}"
      echo "Removed configured wallet archive ${configured_wallet}"
    else
      echo "Retained configured path because it is not a wallet archive under ${OPC_HOME}: ${configured_wallet}"
    fi
  fi
}

remove_home_wallet_archives() {
  local candidate

  while IFS= read -r -d '' candidate; do
    if is_wallet_archive "${candidate}"; then
      secure_remove_file "${candidate}"
      echo "Removed wallet archive ${candidate}"
    fi
  done < <(find "${OPC_HOME}" -mindepth 1 -maxdepth 1 -type f -iname '*.zip' -print0)
}

secure_remove_file() {
  local path="$1"

  [[ -e "${path}" || -L "${path}" ]] || return 0

  if [[ -f "${path}" && ! -L "${path}" ]]; then
    chmod u+w "${path}" 2>/dev/null || true
    if command -v shred >/dev/null 2>&1; then
      shred --iterations=1 --zero --remove=unlink -- "${path}"
      return 0
    fi
    : > "${path}"
  fi

  rm -f -- "${path}"
}

remove_sensitive_directory() {
  local directory="$1"
  local label="$2"
  local candidate

  [[ -e "${directory}" || -L "${directory}" ]] || return 0
  if [[ -L "${directory}" ]]; then
    echo "Refusing to clean symbolic-link ${label} directory: ${directory}" >&2
    exit 1
  fi
  if [[ ! -d "${directory}" ]]; then
    echo "Refusing to clean non-directory ${label} path: ${directory}" >&2
    exit 1
  fi

  while IFS= read -r -d '' candidate; do
    secure_remove_file "${candidate}"
  done < <(find "${directory}" -type f -print0)
  find "${directory}" -mindepth 1 -depth -delete
  rmdir "${directory}"
  echo "Removed ${label} state from ${directory}"
}

remove_compose_runtime_state() {
  local compose_volumes=()
  local container_id
  local volume_name
  local existing_volume
  local anonymous
  local already_added
  local remaining_containers

  while IFS= read -r volume_name; do
    [[ -n "${volume_name}" ]] || continue
    compose_volumes+=("${volume_name}")
  done < <(project_volume_names)

  while IFS= read -r container_id; do
    [[ -n "${container_id}" ]] || continue
    while IFS= read -r volume_name; do
      [[ -n "${volume_name}" ]] || continue
      anonymous="$("${PODMAN_BIN}" volume inspect --format '{{.Anonymous}}' "${volume_name}" 2>/dev/null || true)"
      [[ "${anonymous}" == "true" ]] || continue
      already_added=0
      for existing_volume in "${compose_volumes[@]}"; do
        if [[ "${existing_volume}" == "${volume_name}" ]]; then
          already_added=1
          break
        fi
      done
      if [[ "${already_added}" -eq 0 ]]; then
        compose_volumes+=("${volume_name}")
      fi
    done < <("${PODMAN_BIN}" inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "${container_id}")
  done < <(project_container_ids)

  run_compose down --remove-orphans

  for volume_name in "${compose_volumes[@]}"; do
    if is_preserved_offline_volume "${volume_name}"; then
      echo "Preserved offline dependency volume ${volume_name}"
      continue
    fi
    if "${PODMAN_BIN}" volume exists "${volume_name}"; then
      "${PODMAN_BIN}" volume rm "${volume_name}"
      echo "Removed runtime volume ${volume_name}"
    fi
  done

  remaining_containers="$(project_container_ids)"
  if [[ -n "${remaining_containers}" ]]; then
    echo "Compose containers remain for project ${COMPOSE_PROJECT}: ${remaining_containers}" >&2
    exit 1
  fi

  for volume_name in "${PRESERVED_OFFLINE_VOLUME_KEYS[@]}"; do
    volume_name="$(preserved_volume_name "${volume_name}")"
    if ! "${PODMAN_BIN}" volume exists "${volume_name}"; then
      echo "Required offline dependency volume was not preserved: ${volume_name}" >&2
      exit 1
    fi
  done

  while IFS= read -r volume_name; do
    [[ -n "${volume_name}" ]] || continue
    if ! is_preserved_offline_volume "${volume_name}"; then
      echo "Unexpected compose volume remains after cleanup: ${volume_name}" >&2
      exit 1
    fi
  done < <(project_volume_names)

  echo "Removed compose containers and sensitive runtime volumes for project ${COMPOSE_PROJECT}"
}

remove_runtime_credentials() {
  secure_remove_file "${INSTALL_LOG}"
  echo "Removed installer log ${INSTALL_LOG}"

  secure_remove_file "${ENV_FILE}"
  echo "Removed build fallback environment ${ENV_FILE}"

  secure_remove_file "${COMPOSE_ENV_FILE}"
  echo "Removed generated compose environment ${COMPOSE_ENV_FILE}"

  secure_remove_file "${PODMAN_AUTH_FILE}"
  echo "Removed Podman registry authentication ${PODMAN_AUTH_FILE}"

  secure_remove_file "${DOCKER_AUTH_FILE}"
  echo "Removed Docker-compatible registry authentication ${DOCKER_AUTH_FILE}"

  remove_sensitive_directory "${HOME_OCI_DIR}" "home OCI credential"
  remove_sensitive_directory "${INGESTION_OCI_DIR}" "ingestion OCI credential"
  remove_sensitive_directory "${GOLDENGATE_CERT_DIR}" "generated GoldenGate TLS credential"
  remove_sensitive_directory "${APPLICATION_LOG_DIR}" "application log"
}

echo "Preparing custom image credential and runtime cleanup."
echo "Ingestion directory: ${INGESTION_DIR}"

if [[ -L "${WALLET_DIR}" ]]; then
  echo "Refusing to clean symbolic-link wallet directory: ${WALLET_DIR}" >&2
  exit 1
fi

preflight_offline_artifacts
remove_crowdstrike_sensor
stop_image_capture_services
remove_compose_runtime_state

mkdir -p "${WALLET_DIR}"
while IFS= read -r -d '' wallet_candidate; do
  secure_remove_file "${wallet_candidate}"
done < <(find "${WALLET_DIR}" -type f -print0)
find "${WALLET_DIR}" -mindepth 1 -depth -delete
chmod 700 "${WALLET_DIR}"
echo "Cleared generated wallet state from ${WALLET_DIR}"

touch "${OCI_WALLET_REQUIRED_MARKER}"
chmod 600 "${OCI_WALLET_REQUIRED_MARKER}"
echo "Marked future boots to require OCI wallet generation"

if [[ -e "${ADB_LOAD_MARKER}" ]]; then
  rm -f "${ADB_LOAD_MARKER}"
  echo "Removed ${ADB_LOAD_MARKER}"
else
  echo "Not present: ${ADB_LOAD_MARKER}"
fi

remove_configured_wallet_archive
remove_home_wallet_archives
remove_runtime_credentials

echo "Done. Offline images and dependency volumes are retained; reusable wallet, environment, registry credential, OCI key, TLS key, container, and sensitive volume state are removed."
