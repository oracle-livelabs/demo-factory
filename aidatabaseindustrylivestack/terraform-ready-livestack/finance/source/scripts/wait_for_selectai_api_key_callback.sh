#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resource Manager currently provides Python 3, whose parser performs the
# strongest callback validation. The validator needs Python 3.6 or newer;
# retain a curl/coreutils fallback for older or absent worker runtimes so the
# stack does not rely on an undocumented host detail.
if command -v python3 >/dev/null 2>&1 &&
  python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 6))' 2>/dev/null; then
  exec python3 "${SCRIPT_DIR}/wait_for_selectai_api_key_callback.py"
fi

: "${API_KEY_PUBLIC_CALLBACK_URL:?API_KEY_PUBLIC_CALLBACK_URL must be set}"
: "${BOOTSTRAP_STATUS_URL:?BOOTSTRAP_STATUS_URL must be set}"
: "${EXPECTED_DEPLOYMENT_ID:?EXPECTED_DEPLOYMENT_ID must be set}"
: "${EXPECTED_INSTANCE_OCID:?EXPECTED_INSTANCE_OCID must be set}"

WAIT_TIMEOUT_SECONDS="${WAIT_TIMEOUT_SECONDS:-1800}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"
MAX_CALLBACK_AGE_SECONDS="${MAX_CALLBACK_AGE_SECONDS:-1800}"

command -v curl >/dev/null 2>&1 || {
  printf 'The Resource Manager worker has neither Python 3 nor curl.\n' >&2
  exit 1
}
command -v base64 >/dev/null 2>&1 || {
  printf 'The Resource Manager worker has neither Python 3 nor base64.\n' >&2
  exit 1
}
[[ "${API_KEY_PUBLIC_CALLBACK_URL}" == https://* ]] || {
  printf 'API_KEY_PUBLIC_CALLBACK_URL must use HTTPS.\n' >&2
  exit 1
}
[[ "${BOOTSTRAP_STATUS_URL}" == https://* ]] || {
  printf 'BOOTSTRAP_STATUS_URL must use HTTPS.\n' >&2
  exit 1
}
[[ "${EXPECTED_DEPLOYMENT_ID}" =~ ^[0-9a-f]{8}$ ]] || {
  printf 'EXPECTED_DEPLOYMENT_ID is invalid.\n' >&2
  exit 1
}
[[ "${EXPECTED_INSTANCE_OCID}" == ocid1.instance.* ]] || {
  printf 'EXPECTED_INSTANCE_OCID is invalid.\n' >&2
  exit 1
}

json_string_field() {
  local field="$1"
  local document="$2"
  sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" <<<"${document}" |
    head -n 1
}

bootstrap_status_field() {
  local field="$1"
  local status="$2"

  awk -F= -v field="${field}" '$1 == field { print substr($0, index($0, "=") + 1); exit }' <<<"${status}"
}

fetch_bootstrap_status() {
  curl --fail --silent --show-error \
    --connect-timeout 10 --max-time 30 \
    -H 'Cache-Control: no-cache' \
    "${BOOTSTRAP_STATUS_URL}" 2>/dev/null || true
}

deadline=$(( $(date -u +%s) + WAIT_TIMEOUT_SECONDS ))
last_notice=""

printf "Waiting up to %s minutes for the VM's bound Select AI public-key callback.\n" \
  "$((WAIT_TIMEOUT_SECONDS / 60))"

while (( $(date -u +%s) < deadline )); do
  bootstrap_status="$(fetch_bootstrap_status)"
  bootstrap_state="$(bootstrap_status_field state "${bootstrap_status}")"
  bootstrap_deployment_id="$(bootstrap_status_field deployment_id "${bootstrap_status}")"
  bootstrap_instance_ocid="$(bootstrap_status_field instance_ocid "${bootstrap_status}")"
  if [[
    "${bootstrap_state}" == "FAILED" &&
      "${bootstrap_deployment_id}" == "${EXPECTED_DEPLOYMENT_ID}" &&
      "${bootstrap_instance_ocid}" == "${EXPECTED_INSTANCE_OCID}"
  ]]; then
    bootstrap_phase="$(bootstrap_status_field phase "${bootstrap_status}")"
    printf 'The VM reported bootstrap failure during phase: %s. Use bootstrap_log_command from the stack outputs.\n' \
      "${bootstrap_phase:-unknown}" >&2
    exit 1
  fi

  callback="$(
    curl --fail --silent --show-error \
      --connect-timeout 10 --max-time 30 \
      -H 'Cache-Control: no-cache' \
      "${API_KEY_PUBLIC_CALLBACK_URL}" 2>/dev/null || true
  )"

  state="$(json_string_field state "${callback}")"
  if [[ "${state}" == "PENDING" ]]; then
    notice="Waiting for the VM to generate its stack-specific public key."
  elif [[
    "$(json_string_field format "${callback}")" == "finance-selectai-api-key-public/v1" &&
      "${state}" == "READY" &&
      "$(json_string_field marker "${callback}")" == "SELECTAI_API_KEY_PUBLIC_READY" &&
      "$(json_string_field deployment_id "${callback}")" == "${EXPECTED_DEPLOYMENT_ID}" &&
      "$(json_string_field instance_ocid "${callback}")" == "${EXPECTED_INSTANCE_OCID}"
  ]]; then
    issued_at="$(json_string_field issued_at "${callback}")"
    issued_epoch="$(date -u -d "${issued_at}" +%s 2>/dev/null || true)"
    now="$(date -u +%s)"
    public_key_b64="$(json_string_field public_key_b64 "${callback}")"
    public_key="$(printf '%s' "${public_key_b64}" | base64 --decode 2>/dev/null || true)"

    if [[
      "${issued_epoch}" =~ ^[0-9]+$ &&
        "${public_key}" == "-----BEGIN PUBLIC KEY-----"* &&
        "${public_key}" == *"-----END PUBLIC KEY-----"
    ]] && ((
      issued_epoch <= now + 300 &&
        now - issued_epoch <= MAX_CALLBACK_AGE_SECONDS
    )); then
      printf 'Validated a fresh public-only callback for this deployment and VM.\n'
      exit 0
    fi
    notice="Waiting for a complete, fresh public-key callback."
  elif [[ -n "${callback}" ]]; then
    notice="Ignoring a stale or unsupported public-key callback."
  else
    notice="Waiting for the public-key callback object to become readable."
  fi

  if [[ "${notice}" != "${last_notice}" ]]; then
    printf '%s\n' "${notice}"
    last_notice="${notice}"
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
done

printf "Timed out waiting for the VM's fresh Select AI public-key callback. Use bootstrap_log_command from the stack outputs.\n" >&2
exit 1
