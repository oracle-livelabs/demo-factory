#!/usr/bin/env bash
set -Eeuo pipefail

: "${API_KEY_ACTIVATION_UPLOAD_URL:?API_KEY_ACTIVATION_UPLOAD_URL must be set}"
: "${DEPLOYMENT_ID:?DEPLOYMENT_ID must be set}"
: "${INSTANCE_OCID:?INSTANCE_OCID must be set}"
: "${API_KEY_FINGERPRINT:?API_KEY_FINGERPRINT must be set}"

ACTIVATION_TTL_SECONDS="${ACTIVATION_TTL_SECONDS:-3600}"

[[ "${API_KEY_ACTIVATION_UPLOAD_URL}" == https://* ]] || {
  printf 'Activation callback URL must use HTTPS.\n' >&2
  exit 1
}
[[ "${DEPLOYMENT_ID}" =~ ^[0-9a-f]{8}$ ]] || {
  printf 'Deployment binding is invalid.\n' >&2
  exit 1
}
[[ "${INSTANCE_OCID}" =~ ^ocid1\.instance\.[A-Za-z0-9._-]+$ ]] || {
  printf 'Instance binding is invalid.\n' >&2
  exit 1
}
[[ "${API_KEY_FINGERPRINT}" =~ ^([0-9A-Fa-f]{2}:){15}[0-9A-Fa-f]{2}$ ]] || {
  printf 'OCI returned an invalid API-key fingerprint.\n' >&2
  exit 1
}
[[ "${ACTIVATION_TTL_SECONDS}" =~ ^[0-9]+$ ]] &&
  ((ACTIVATION_TTL_SECONDS >= 300 && ACTIVATION_TTL_SECONDS <= 7200)) || {
  printf 'Activation TTL is outside the supported range.\n' >&2
  exit 1
}

umask 077
activation_file="$(mktemp)"
trap 'rm -f "${activation_file}"' EXIT

activated_epoch="$(date -u +%s)"
expires_epoch=$((activated_epoch + ACTIVATION_TTL_SECONDS))
activated_at="$(date -u -d "@${activated_epoch}" +%Y-%m-%dT%H:%M:%SZ)"
expires_at="$(date -u -d "@${expires_epoch}" +%Y-%m-%dT%H:%M:%SZ)"

printf '%s\n' \
  '{' \
  '  "format": "finance-selectai-api-key-activation/v1",' \
  '  "state": "ACTIVE",' \
  "  \"deployment_id\": \"${DEPLOYMENT_ID}\"," \
  "  \"instance_ocid\": \"${INSTANCE_OCID}\"," \
  "  \"fingerprint\": \"${API_KEY_FINGERPRINT}\"," \
  "  \"activated_at\": \"${activated_at}\"," \
  "  \"expires_at\": \"${expires_at}\"," \
  '  "marker": "SELECTAI_API_KEY_ACTIVATED"' \
  '}' >"${activation_file}"

curl --fail --silent --show-error --retry 8 --retry-delay 3 \
  --connect-timeout 10 --max-time 30 \
  -H 'Content-Type: application/json' \
  --upload-file "${activation_file}" \
  "${API_KEY_ACTIVATION_UPLOAD_URL}" >/dev/null

printf 'Published the instance-bound Select AI API-key activation callback.\n'
