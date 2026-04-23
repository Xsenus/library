#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_DIR="${LIBRARY_SYSTEMD_SOURCE_DIR:-$SCRIPT_DIR/systemd}"
APP_DIR="${LIBRARY_SYSTEMD_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd -P)}"
TARGET_DIR="${LIBRARY_SYSTEMD_TARGET_DIR:-/etc/systemd/system}"
UNITS_RAW="${LIBRARY_SYSTEMD_UNITS:-library-system-healthcheck.service library-system-healthcheck.timer ai-analysis-acceptance-healthcheck.service ai-analysis-acceptance-healthcheck.timer ai-analysis-ui-smoke-healthcheck.service ai-analysis-ui-smoke-healthcheck.timer ai-analysis-ui-qa-healthcheck.service ai-analysis-ui-qa-healthcheck.timer}"
ENV_TEMPLATE_SOURCE="${LIBRARY_SYSTEMD_ENV_TEMPLATE_SOURCE:-$SCRIPT_DIR/systemd/library-monitoring.env.example}"
ENV_TEMPLATE_TARGET="${LIBRARY_SYSTEMD_ENV_TEMPLATE_TARGET:-/etc/default/library-monitoring.example}"
ENV_FILE_TARGET="${LIBRARY_SYSTEMD_ENV_FILE_TARGET:-/etc/default/library-monitoring}"
BOOTSTRAP_ENV_FILE="${LIBRARY_SYSTEMD_BOOTSTRAP_ENV_FILE:-0}"
ENABLE_TIMERS="${LIBRARY_SYSTEMD_ENABLE_TIMERS:-1}"
SKIP_SYSTEMCTL="${LIBRARY_SYSTEMD_SKIP_SYSTEMCTL:-0}"

read -r -a UNITS <<< "$UNITS_RAW"
TIMERS=()
TIMERS_TO_ENABLE=()
TIMERS_TO_DISABLE=()
DRY_RUN=0

log() {
  printf '[library-systemd-install] %s\n' "$*" >&2
}

run() {
  log "+ $*"
  "$@"
}

is_true() {
  case "${1,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

env_file_has_nonempty_value() {
  local env_file="$1"
  local key="$2"

  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  grep -Eq "^[[:space:]]*${key}[[:space:]]*=[[:space:]]*[^[:space:]#].*$" "$env_file"
}

ui_qa_timer_ready() {
  local env_file="$1"

  if env_file_has_nonempty_value "$env_file" "AI_ANALYSIS_UI_QA_LOGIN" &&
    env_file_has_nonempty_value "$env_file" "AI_ANALYSIS_UI_QA_PASSWORD"; then
    return 0
  fi

  if env_file_has_nonempty_value "$env_file" "AI_ANALYSIS_UI_SMOKE_LOGIN" &&
    env_file_has_nonempty_value "$env_file" "AI_ANALYSIS_UI_SMOKE_PASSWORD"; then
    return 0
  fi

  return 1
}

playwright_browser_ready() {
  if [[ ! -d "$APP_DIR" ]]; then
    return 1
  fi

  (
    cd "$APP_DIR"
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
  )
}

resolve_timers_to_enable() {
  TIMERS_TO_ENABLE=()
  TIMERS_TO_DISABLE=()

  local timer
  for timer in "${TIMERS[@]}"; do
    case "$timer" in
      ai-analysis-ui-smoke-healthcheck.timer)
        if playwright_browser_ready; then
          TIMERS_TO_ENABLE+=("$timer")
        else
          TIMERS_TO_DISABLE+=("$timer")
          log "skipping automatic enable for $timer until Playwright Chromium is available in $APP_DIR"
        fi
        ;;
      ai-analysis-ui-qa-healthcheck.timer)
        if ! playwright_browser_ready; then
          TIMERS_TO_DISABLE+=("$timer")
          log "skipping automatic enable for $timer until Playwright Chromium is available in $APP_DIR"
        elif ui_qa_timer_ready "$ENV_FILE_TARGET"; then
          TIMERS_TO_ENABLE+=("$timer")
        else
          TIMERS_TO_DISABLE+=("$timer")
          log "skipping automatic enable for $timer until UI QA credentials are configured in $ENV_FILE_TARGET"
        fi
        ;;
      *)
        TIMERS_TO_ENABLE+=("$timer")
        ;;
    esac
  done
}

usage() {
  cat >&2 <<'EOF'
Usage: bash deploy/install-library-systemd-units.sh [--dry-run]

Environment overrides:
  LIBRARY_SYSTEMD_APP_DIR
  LIBRARY_SYSTEMD_SOURCE_DIR
  LIBRARY_SYSTEMD_TARGET_DIR
  LIBRARY_SYSTEMD_UNITS
  LIBRARY_SYSTEMD_ENV_TEMPLATE_SOURCE
  LIBRARY_SYSTEMD_ENV_TEMPLATE_TARGET
  LIBRARY_SYSTEMD_ENV_FILE_TARGET
  LIBRARY_SYSTEMD_BOOTSTRAP_ENV_FILE=1|0
  LIBRARY_SYSTEMD_ENABLE_TIMERS=1|0
  LIBRARY_SYSTEMD_SKIP_SYSTEMCTL=1|0
EOF
}

if (( $# > 1 )); then
  usage
  exit 2
fi
if (( $# == 1 )); then
  if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=1
  else
    usage
    exit 2
  fi
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  log "systemd source directory is missing: $SOURCE_DIR"
  exit 2
fi
if [[ ! -f "$ENV_TEMPLATE_SOURCE" ]]; then
  log "monitoring env template is missing: $ENV_TEMPLATE_SOURCE"
  exit 2
fi
if (( ${#UNITS[@]} == 0 )); then
  log "no systemd units configured via LIBRARY_SYSTEMD_UNITS"
  exit 2
fi

for unit in "${UNITS[@]}"; do
  if [[ ! -f "$SOURCE_DIR/$unit" ]]; then
    log "systemd unit is missing in source dir: $SOURCE_DIR/$unit"
    exit 2
  fi
  if [[ "$unit" == *.timer ]]; then
    TIMERS+=("$unit")
  fi
done

if (( DRY_RUN == 1 )); then
  log "dry-run mode: files and systemctl actions will not be changed"
fi
if is_true "$SKIP_SYSTEMCTL"; then
  log "systemctl operations are disabled via LIBRARY_SYSTEMD_SKIP_SYSTEMCTL=1"
fi

if (( DRY_RUN == 0 )); then
  run install -d "$TARGET_DIR"
  for unit in "${UNITS[@]}"; do
    run install -m 0644 "$SOURCE_DIR/$unit" "$TARGET_DIR/$unit"
  done
  run install -d "$(dirname "$ENV_TEMPLATE_TARGET")"
  run install -m 0644 "$ENV_TEMPLATE_SOURCE" "$ENV_TEMPLATE_TARGET"
  if is_true "$BOOTSTRAP_ENV_FILE"; then
    if [[ -f "$ENV_FILE_TARGET" ]]; then
      log "skipping bootstrap of existing env file: $ENV_FILE_TARGET"
    else
      run install -d "$(dirname "$ENV_FILE_TARGET")"
      run install -m 0644 "$ENV_TEMPLATE_SOURCE" "$ENV_FILE_TARGET"
    fi
  fi
else
  for unit in "${UNITS[@]}"; do
    log "would install $SOURCE_DIR/$unit -> $TARGET_DIR/$unit"
  done
  log "would install monitoring env template $ENV_TEMPLATE_SOURCE -> $ENV_TEMPLATE_TARGET"
  if is_true "$BOOTSTRAP_ENV_FILE"; then
    log "would bootstrap monitoring env file $ENV_TEMPLATE_SOURCE -> $ENV_FILE_TARGET if missing"
  fi
fi

if is_true "$SKIP_SYSTEMCTL" || (( DRY_RUN == 1 )); then
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  log "systemctl is required unless LIBRARY_SYSTEMD_SKIP_SYSTEMCTL=1 is set"
  exit 2
fi

run systemctl daemon-reload

if ! is_true "$ENABLE_TIMERS"; then
  log "timer enabling skipped"
  exit 0
fi

resolve_timers_to_enable

if [[ ${#TIMERS_TO_DISABLE[@]} -gt 0 ]]; then
  run systemctl disable --now "${TIMERS_TO_DISABLE[@]}" || true
fi

if [[ ${#TIMERS_TO_ENABLE[@]} -gt 0 ]]; then
  run systemctl enable --now "${TIMERS_TO_ENABLE[@]}"
else
  log "no monitoring timers are eligible for auto-enable"
fi
