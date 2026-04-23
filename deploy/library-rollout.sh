#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[library-rollout] %s\n' "$*" >&2
}

MONITORING_ENV_FILE="${LIBRARY_ROLLOUT_MONITORING_ENV_FILE:-/etc/default/library-monitoring}"

load_monitoring_env_if_present() {
  if [[ -f "$MONITORING_ENV_FILE" ]]; then
    log "loading monitoring env file: $MONITORING_ENV_FILE"
    set -a
    # shellcheck disable=SC1090
    source "$MONITORING_ENV_FILE"
    set +a
  fi
}

load_monitoring_env_if_present

APP_DIR="${APP_DIR:-/opt/library/app}"
ALLOWED_APP_DIR="${LIBRARY_ROLLOUT_ALLOWED_APP_DIR:-/opt/library/app}"
HEALTH_URL="${LIBRARY_ROLLOUT_HEALTH_URL:-https://ai.irbistech.com/api/health}"
HEALTH_TIMEOUT_SECONDS="${LIBRARY_ROLLOUT_HEALTH_TIMEOUT_SECONDS:-60}"
HEALTH_RETRY_DELAY_SECONDS="${LIBRARY_ROLLOUT_HEALTH_RETRY_DELAY_SECONDS:-2}"
ACCEPTANCE_BASE_URL="${AI_ANALYSIS_ACCEPTANCE_HEALTH_BASE_URL:-http://127.0.0.1:8090}"
ACCEPTANCE_STATE_FILE="${AI_ANALYSIS_ACCEPTANCE_HEALTH_STATE_FILE:-/var/lib/library/ai-analysis-acceptance-health-state.json}"
ACCEPTANCE_ARTIFACT_DIR="${AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR:-/var/lib/library/ai-analysis-acceptance-health}"
UI_SMOKE_BASE_URL="${AI_ANALYSIS_UI_SMOKE_HEALTH_BASE_URL:-http://127.0.0.1:8090}"
UI_SMOKE_STATE_FILE="${AI_ANALYSIS_UI_SMOKE_HEALTH_STATE_FILE:-/var/lib/library/ai-analysis-ui-smoke-health-state.json}"
UI_SMOKE_ARTIFACT_DIR="${AI_ANALYSIS_UI_SMOKE_HEALTH_ARTIFACT_DIR:-/var/lib/library/ai-analysis-ui-smoke-health}"
UI_SMOKE_MODE="${LIBRARY_ROLLOUT_UI_SMOKE_MODE:-auto}"
UI_QA_BASE_URL="${AI_ANALYSIS_UI_QA_BASE_URL:-http://127.0.0.1:8090}"
UI_QA_ARTIFACT_DIR="${AI_ANALYSIS_UI_QA_ARTIFACT_DIR:-/var/lib/library/ai-analysis-ui-qa}"
UI_QA_MODE="${LIBRARY_ROLLOUT_UI_QA_MODE:-auto}"
SERVICES_RAW="${LIBRARY_ROLLOUT_SERVICES:-library.service library-system-healthcheck.timer ai-analysis-acceptance-healthcheck.timer ai-analysis-ui-smoke-healthcheck.timer ai-analysis-ui-qa-healthcheck.timer}"
INSTALL_SYSTEMD_MODE="${LIBRARY_ROLLOUT_INSTALL_SYSTEMD:-auto}"
SKIP_GIT_PULL="${LIBRARY_ROLLOUT_SKIP_GIT_PULL:-0}"
SKIP_INSTALL="${LIBRARY_ROLLOUT_SKIP_INSTALL:-0}"
SKIP_TESTS="${LIBRARY_ROLLOUT_SKIP_TESTS:-0}"
SKIP_BUILD="${LIBRARY_ROLLOUT_SKIP_BUILD:-0}"
SKIP_SMOKE="${LIBRARY_ROLLOUT_SKIP_SMOKE:-0}"

read -r -a SERVICES <<< "$SERVICES_RAW"
MANAGED_SERVICES=()
services_stopped=0

run() {
  log "+ $*"
  "$@"
}

run_shell() {
  log "+ $*"
  bash -lc "$*"
}

wait_for_url() {
  local url="$1"
  local timeout_seconds="$2"
  local retry_delay_seconds="$3"
  local attempt=1
  local deadline=$((SECONDS + timeout_seconds))

  while true; do
    log "+ curl -fsS $url (attempt $attempt)"
    if curl -fsS "$url"; then
      printf '\n'
      return 0
    fi

    if (( SECONDS >= deadline )); then
      log "URL did not become ready within ${timeout_seconds}s: $url"
      return 1
    fi

    sleep "$retry_delay_seconds"
    attempt=$((attempt + 1))
  done
}

playwright_browser_ready() {
  node - <<'NODE'
const fs = require('node:fs');

try {
  const { chromium } = require('playwright');
  const executablePath = chromium.executablePath();
  if (!executablePath) {
    process.exit(1);
  }
  fs.accessSync(executablePath, fs.constants.X_OK);
} catch (error) {
  process.exit(1);
}
NODE
}

ui_qa_credentials_ready() {
  local login="${AI_ANALYSIS_UI_QA_LOGIN:-${AI_ANALYSIS_UI_SMOKE_LOGIN:-}}"
  local password="${AI_ANALYSIS_UI_QA_PASSWORD:-${AI_ANALYSIS_UI_SMOKE_PASSWORD:-}}"
  [[ -n "$login" && -n "$password" ]]
}

service_requires_browser() {
  case "$1" in
    ai-analysis-ui-smoke-healthcheck.service|ai-analysis-ui-smoke-healthcheck.timer|ai-analysis-ui-qa-healthcheck.service|ai-analysis-ui-qa-healthcheck.timer)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

service_requires_ui_qa_credentials() {
  case "$1" in
    ai-analysis-ui-qa-healthcheck.service|ai-analysis-ui-qa-healthcheck.timer)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

service_is_ready() {
  local unit="$1"

  if service_requires_browser "$unit" && ! playwright_browser_ready; then
    log "skipping optional systemd unit until Playwright Chromium is available: $unit"
    return 1
  fi

  if service_requires_ui_qa_credentials "$unit" && ! ui_qa_credentials_ready; then
    log "skipping optional systemd unit until worker credentials are configured: $unit"
    return 1
  fi

  return 0
}

run_optional_ui_smoke() {
  case "$UI_SMOKE_MODE" in
    never)
      log "skipping browser smoke because LIBRARY_ROLLOUT_UI_SMOKE_MODE=never"
      return 0
      ;;
    always)
      ;;
    auto)
      if ! playwright_browser_ready; then
        log "skipping browser smoke because Playwright Chromium is not available"
        return 0
      fi
      ;;
    *)
      log "unsupported LIBRARY_ROLLOUT_UI_SMOKE_MODE=$UI_SMOKE_MODE (expected: auto|always|never)"
      return 2
      ;;
  esac

  run npm run ui:smoke:healthcheck -- \
    --base-url "$UI_SMOKE_BASE_URL" \
    --state-file "$UI_SMOKE_STATE_FILE" \
    --artifact-dir "$UI_SMOKE_ARTIFACT_DIR" \
    --json
}

run_optional_ui_qa() {
  case "$UI_QA_MODE" in
    never)
      log "skipping browser UI QA because LIBRARY_ROLLOUT_UI_QA_MODE=never"
      return 0
      ;;
    always)
      if ! playwright_browser_ready; then
        log "browser UI QA requires Playwright Chromium, but it is not available"
        return 2
      fi
      if ! ui_qa_credentials_ready; then
        log "browser UI QA requires AI_ANALYSIS_UI_QA_LOGIN/PASSWORD or AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD"
        return 2
      fi
      ;;
    auto)
      if ! playwright_browser_ready; then
        log "skipping browser UI QA because Playwright Chromium is not available"
        return 0
      fi
      if ! ui_qa_credentials_ready; then
        log "skipping browser UI QA because worker credentials are not configured"
        return 0
      fi
      ;;
    *)
      log "unsupported LIBRARY_ROLLOUT_UI_QA_MODE=$UI_QA_MODE (expected: auto|always|never)"
      return 2
      ;;
  esac

  run env \
    AI_ANALYSIS_UI_QA_BASE_URL="$UI_QA_BASE_URL" \
    AI_ANALYSIS_UI_QA_ARTIFACT_DIR="$UI_QA_ARTIFACT_DIR" \
    npm run test:ui:qa
}

resolve_existing_services() {
  MANAGED_SERVICES=()

  if (( ${#SERVICES[@]} == 0 )); then
    return
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    local unit
    for unit in "${SERVICES[@]}"; do
      if service_is_ready "$unit"; then
        MANAGED_SERVICES+=("$unit")
      fi
    done
    return
  fi

  local unit
  for unit in "${SERVICES[@]}"; do
    if ! service_is_ready "$unit"; then
      continue
    fi
    if systemctl cat "$unit" >/dev/null 2>&1; then
      MANAGED_SERVICES+=("$unit")
    else
      log "skipping missing systemd unit: $unit"
    fi
  done
}

start_services_best_effort() {
  if (( ${#MANAGED_SERVICES[@]} == 0 )); then
    return
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start "${MANAGED_SERVICES[@]}" || true
  fi
}

install_systemd_units_if_needed() {
  local installer_script="deploy/install-library-systemd-units.sh"

  case "$INSTALL_SYSTEMD_MODE" in
    never)
      log "skipping systemd unit install because LIBRARY_ROLLOUT_INSTALL_SYSTEMD=never"
      return 0
      ;;
    auto)
      if ! command -v systemctl >/dev/null 2>&1; then
        log "skipping systemd unit install because systemctl is not available"
        return 0
      fi
      if [[ ! -f "$installer_script" ]]; then
        log "skipping systemd unit install because installer script is missing: $installer_script"
        return 0
      fi
      if [[ "${EUID:-$(id -u)}" != "0" ]]; then
        log "skipping systemd unit install because rollout is not running as root"
        return 0
      fi
      ;;
    always)
      if ! command -v systemctl >/dev/null 2>&1; then
        log "systemd unit install requires systemctl, but it is not available"
        return 2
      fi
      if [[ ! -f "$installer_script" ]]; then
        log "systemd unit installer script is missing: $installer_script"
        return 2
      fi
      if [[ "${EUID:-$(id -u)}" != "0" ]]; then
        log "systemd unit install requires root privileges"
        return 2
      fi
      ;;
    *)
      log "unsupported LIBRARY_ROLLOUT_INSTALL_SYSTEMD=$INSTALL_SYSTEMD_MODE (expected: auto|always|never)"
      return 2
      ;;
  esac

  run bash "$installer_script"
}

cleanup() {
  local exit_code=$?
  if (( exit_code != 0 && services_stopped == 1 )); then
    log "rollout failed, starting services back best-effort"
    start_services_best_effort
  fi
  exit "$exit_code"
}
trap cleanup EXIT

cd "$APP_DIR"
APP_REALPATH="$(pwd -P)"

if [[ "$APP_REALPATH" != "$ALLOWED_APP_DIR" ]]; then
  log "refusing to run outside $ALLOWED_APP_DIR, got $APP_REALPATH"
  exit 2
fi

if [[ ! -f package.json || ! -f package-lock.json || ! -d .git ]]; then
  log "package.json, package-lock.json, and .git are required in $APP_REALPATH"
  exit 2
fi

APP_NAME="$(node -e "console.log(require('./package.json').name)" 2>/dev/null || true)"
if [[ "$APP_NAME" != "library-postgresql-browser" ]]; then
  log "unexpected package name: ${APP_NAME:-empty}"
  exit 2
fi

log "starting rollout in $APP_REALPATH"
run git status --short

if [[ "$SKIP_GIT_PULL" != "1" ]]; then
  run git pull --ff-only origin main
fi

install_systemd_units_if_needed
resolve_existing_services

if (( ${#MANAGED_SERVICES[@]} > 0 )) && command -v systemctl >/dev/null 2>&1; then
  run systemctl stop "${MANAGED_SERVICES[@]}"
  services_stopped=1
fi

if [[ "$SKIP_INSTALL" != "1" ]]; then
  run rm -rf node_modules

  install_cmd='env -u NODE_ENV npm ci --include=dev --ignore-scripts --no-audit --no-fund --prefer-online'
  if ! run_shell "$install_cmd"; then
    log "npm ci failed, cleaning npm cache and retrying once"
    run npm cache clean --force
    run rm -rf node_modules
    run_shell "$install_cmd"
  fi
fi

run test -f node_modules/tsx/dist/cli.mjs
run test -x node_modules/.bin/tsx
run test -f node_modules/next/dist/bin/next
run node node_modules/tsx/dist/cli.mjs --version
run node node_modules/next/dist/bin/next --version
run node -p "require('./node_modules/caniuse-lite/package.json').version"

if [[ "$SKIP_TESTS" != "1" ]]; then
  run npm test
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  run npm run build
fi

if (( ${#MANAGED_SERVICES[@]} > 0 )) && command -v systemctl >/dev/null 2>&1; then
  run systemctl start "${MANAGED_SERVICES[@]}"
  services_stopped=0
  run systemctl is-active "${MANAGED_SERVICES[@]}"
fi

if [[ "$SKIP_SMOKE" != "1" ]]; then
  wait_for_url "$HEALTH_URL" "$HEALTH_TIMEOUT_SECONDS" "$HEALTH_RETRY_DELAY_SECONDS"
  run npm run acceptance:healthcheck -- \
    --base-url "$ACCEPTANCE_BASE_URL" \
    --state-file "$ACCEPTANCE_STATE_FILE" \
    --artifact-dir "$ACCEPTANCE_ARTIFACT_DIR" \
    --json
  run_optional_ui_smoke
  run_optional_ui_qa
fi

run git status --short
log "rollout completed successfully"
