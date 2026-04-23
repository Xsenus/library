#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/library/app}"
HEALTH_URL="${LIBRARY_ROLLOUT_HEALTH_URL:-https://ai.irbistech.com/api/health}"
HEALTH_TIMEOUT_SECONDS="${LIBRARY_ROLLOUT_HEALTH_TIMEOUT_SECONDS:-60}"
HEALTH_RETRY_DELAY_SECONDS="${LIBRARY_ROLLOUT_HEALTH_RETRY_DELAY_SECONDS:-2}"
ACCEPTANCE_BASE_URL="${AI_ANALYSIS_ACCEPTANCE_HEALTH_BASE_URL:-http://127.0.0.1:8090}"
ACCEPTANCE_STATE_FILE="${AI_ANALYSIS_ACCEPTANCE_HEALTH_STATE_FILE:-/var/lib/library/ai-analysis-acceptance-health-state.json}"
ACCEPTANCE_ARTIFACT_DIR="${AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR:-/var/lib/library/ai-analysis-acceptance-health}"
SERVICES_RAW="${LIBRARY_ROLLOUT_SERVICES:-library.service library-system-healthcheck.timer ai-analysis-acceptance-healthcheck.timer}"
SKIP_GIT_PULL="${LIBRARY_ROLLOUT_SKIP_GIT_PULL:-0}"
SKIP_TESTS="${LIBRARY_ROLLOUT_SKIP_TESTS:-0}"
SKIP_BUILD="${LIBRARY_ROLLOUT_SKIP_BUILD:-0}"
SKIP_SMOKE="${LIBRARY_ROLLOUT_SKIP_SMOKE:-0}"

read -r -a SERVICES <<< "$SERVICES_RAW"
services_stopped=0

log() {
  printf '[library-rollout] %s\n' "$*" >&2
}

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

start_services_best_effort() {
  if (( ${#SERVICES[@]} == 0 )); then
    return
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start "${SERVICES[@]}" || true
  fi
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

if [[ "$APP_REALPATH" != "/opt/library/app" ]]; then
  log "refusing to run outside /opt/library/app, got $APP_REALPATH"
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

if (( ${#SERVICES[@]} > 0 )) && command -v systemctl >/dev/null 2>&1; then
  run systemctl stop "${SERVICES[@]}"
  services_stopped=1
fi

run rm -rf node_modules

install_cmd='env -u NODE_ENV npm ci --include=dev --ignore-scripts --no-audit --no-fund --prefer-online'
if ! run_shell "$install_cmd"; then
  log "npm ci failed, cleaning npm cache and retrying once"
  run npm cache clean --force
  run rm -rf node_modules
  run_shell "$install_cmd"
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

if (( ${#SERVICES[@]} > 0 )) && command -v systemctl >/dev/null 2>&1; then
  run systemctl start "${SERVICES[@]}"
  services_stopped=0
  run systemctl is-active "${SERVICES[@]}"
fi

if [[ "$SKIP_SMOKE" != "1" ]]; then
  wait_for_url "$HEALTH_URL" "$HEALTH_TIMEOUT_SECONDS" "$HEALTH_RETRY_DELAY_SECONDS"
  run npm run acceptance:healthcheck -- \
    --base-url "$ACCEPTANCE_BASE_URL" \
    --state-file "$ACCEPTANCE_STATE_FILE" \
    --artifact-dir "$ACCEPTANCE_ARTIFACT_DIR" \
    --json
fi

run git status --short
log "rollout completed successfully"
