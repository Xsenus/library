#!/usr/bin/env bash
set -euo pipefail

# Подтянуть переменные окружения из /etc/default/library, если есть
if [ -f /etc/default/library ]; then
  set -a
  . /etc/default/library
  set +a
fi

# Для диагностики (можно оставить)
echo "[library] NODE_ENV=${NODE_ENV:-} PORT=${PORT:-}" >&2

# Запуск Next.js; порт берём из PORT, по умолчанию 8090
exec /usr/bin/node node_modules/next/dist/bin/next start \
  --hostname 0.0.0.0 \
  --port "${PORT:-8090}"
