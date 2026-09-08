#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v python3 >/dev/null 2>&1 || {
  echo "Python 3 is required to build and verify the Resource Manager archive." >&2
  exit 1
}

exec python3 "${ROOT_DIR}/scripts/build_resource_manager_package.py" "$@"
