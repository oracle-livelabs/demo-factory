#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

pass() {
  echo "PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

skip() {
  echo "SKIP: $1"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

check_file_exists() {
  local path="$1"
  if [[ -e "$path" ]]; then
    pass "File exists: $path"
  else
    fail "Missing required file: $path"
  fi
}

check_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"
  if rg -Fq "$needle" "$file"; then
    pass "$label"
  else
    fail "$label (expected to find: $needle in $file)"
  fi
}

check_yaml_port_mapping() {
  local file="$1"
  local mapping="$2"
  local label="$3"
  if rg -n "^[[:space:]]*-[[:space:]]*\"${mapping}\"" "$file" >/dev/null; then
    pass "$label"
  else
    fail "$label (missing mapping \"$mapping\" in $file)"
  fi
}

check_service_block() {
  local file="$1"
  local service="$2"
  local label="$3"
  if rg -n "^[[:space:]]{2}${service}:$" "$file" >/dev/null; then
    pass "$label"
  else
    fail "$label (missing service '${service}' in $file)"
  fi
}

check_compose_config() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label"
  fi
}

echo "== Big Star Architecture Validator =="

# Required files
check_file_exists "main.py"
check_file_exists "init.sql"
check_file_exists "seeder.py"
check_file_exists "templates/index.html"
check_file_exists "requirements.txt"
check_file_exists "compose.yaml"
check_file_exists "Containerfile"
check_file_exists "Containerfile.parent"
check_file_exists "rules.md"

# Core service presence in compose (additional optional services are allowed)
check_service_block "compose.yaml" "db" "Core compose service present: db"
check_service_block "compose.yaml" "ords" "Core compose service present: ords"
check_service_block "compose.yaml" "ollama" "Core compose service present: ollama"
check_service_block "compose.yaml" "init-brain" "Core compose service present: init-brain"
check_service_block "compose.yaml" "app" "Core compose service present: app"

# Required canonical host:container port mappings
check_yaml_port_mapping "compose.yaml" "1521:1521" "Port mapping present: DB 1521:1521"
check_yaml_port_mapping "compose.yaml" "8181:8080" "Port mapping present: ORDS 8181:8080"
check_yaml_port_mapping "compose.yaml" "11434:11434" "Port mapping present: Ollama 11434:11434"
check_yaml_port_mapping "compose.yaml" "5500:8000" "Port mapping present: App 5500:8000"

# Compose engine-neutral parsing (Docker + Podman)
if command -v docker >/dev/null 2>&1; then
  check_compose_config "docker compose parses compose.yaml" docker compose -f compose.yaml config
elif command -v docker-compose >/dev/null 2>&1; then
  check_compose_config "docker-compose parses compose.yaml" docker-compose -f compose.yaml config
else
  skip "Docker Compose not installed; skipping docker compose parse check"
fi

if command -v podman >/dev/null 2>&1; then
  check_compose_config "podman compose parses compose.yaml" podman compose -f compose.yaml config
else
  skip "Podman not installed; skipping podman compose parse check"
fi

# Containerfile runtime contract
check_contains "Containerfile" "EXPOSE 8000" "Containerfile exposes port 8000"
check_contains "Containerfile" "\"uvicorn\", \"main:app\", \"--host\", \"0.0.0.0\", \"--port\", \"8000\"" "Containerfile runs uvicorn on 0.0.0.0:8000"
check_contains "Containerfile" "dpkg --print-architecture" "Containerfile detects target architecture at build time"
check_contains "Containerfile" "amd64) ic_arch=\"x64\"" "Containerfile includes Oracle client mapping for amd64"
check_contains "Containerfile" "arm64) ic_arch=\"arm64\"" "Containerfile includes Oracle client mapping for arm64"

# main.py defaults contract
check_contains "main.py" "DB_DSN = os.getenv(\"DB_DSN\", \"localhost:1521/FREEPDB1\")" "main.py default DB_DSN matches strict rule"
check_contains "main.py" "OLLAMA_HOST = os.getenv(\"OLLAMA_HOST\", \"http://localhost:11434\")" "main.py default OLLAMA_HOST matches strict rule"
check_contains "main.py" "ORDS_HOST = os.getenv(\"ORDS_HOST\", \"http://localhost:8181\")" "main.py default ORDS_HOST matches strict rule"

# compose app endpoint contract
check_contains "compose.yaml" 'DB_DSN: db:1521/FREEPDB1' "compose app DB_DSN points to db:1521/FREEPDB1"
check_contains "compose.yaml" 'OLLAMA_HOST: http://ollama:11434' "compose app OLLAMA_HOST points to ollama:11434"
check_contains "compose.yaml" 'ORDS_HOST: http://ords:8080' "compose app ORDS_HOST points to ords:8080"

# Route and helper presence
check_contains "main.py" "@app.get(\"/\", response_class=HTMLResponse)" "main.py serves index route /"
check_contains "main.py" "@app.get(\"/api/health\")" "main.py defines /api/health"
check_contains "main.py" "async def ollama_chat(" "main.py has ollama_chat helper"
check_contains "main.py" 'f"{OLLAMA_HOST}/api/chat"' "main.py uses Ollama /api/chat"
check_contains "main.py" 'f"{OLLAMA_HOST}/api/generate"' "main.py supports Ollama /api/generate fallback"

# Frontend narrator + x-ray contracts
check_contains "templates/index.html" 'id="help"' "index.html contains Presenter Script trigger"
check_contains "templates/index.html" "What's happening here?" "index.html includes non-technical presenter help title"
check_contains "templates/index.html" 'id="xrayToggle"' "index.html contains Database X-Ray toggle"
check_contains "templates/index.html" "toggleXrayMode" "index.html implements Database X-Ray toggle logic"
check_contains "templates/index.html" "xraySceneProfiles" "index.html defines scene-aware X-Ray profiles"
check_contains "templates/index.html" "Priority Transactions" "index.html includes Priority Transactions narrative in Presenter/X-Ray content"
check_contains "templates/index.html" "Oracle SQL Firewall" "index.html includes Oracle SQL Firewall narrative in Presenter/X-Ray content"

# init-brain model pull contract
check_contains "compose.yaml" "http://ollama:11434" "init-brain references Ollama URL"
check_contains "compose.yaml" "gemma:2b" "init-brain references gemma:2b"

# app healthcheck contract
check_contains "compose.yaml" "curl -fsS http://localhost:8000/api/health" "app healthcheck calls /api/health on internal 8000"

# Depends-on contract
check_contains "compose.yaml" "init-brain:" "compose includes init-brain dependency block"
check_contains "compose.yaml" "condition: service_completed_successfully" "app waits for init-brain completion"

# Summary
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo ""
echo "== Validation Summary =="
echo "Total checks: $TOTAL"
echo "Passed:       $PASS_COUNT"
echo "Failed:       $FAIL_COUNT"
echo "Skipped:      $SKIP_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo ""
  echo "Architecture validation FAILED."
  exit 1
fi

echo ""
echo "Architecture validation PASSED."
