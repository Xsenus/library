# Library (Next.js 14) — навигатор оборудования

Внутреннее веб‑приложение для команды продаж/аналитики: помогает находить оборудование по иерархии (отрасль → класс → цех → оборудование), смотреть расширенную карточку, работать с CleanScore, ОКВЭД, AI‑поиском и AI‑анализом компаний.

---

## 1) Что это за проект

Приложение построено на **Next.js 14 (App Router)** и работает как единый full‑stack:

- UI на React + Tailwind + shadcn/ui.
- Backend на API‑роутах Next.js (`app/api/**`).
- Основная БД PostgreSQL (`lib/db.ts`) + отдельный пул для Bitrix‑реплики (`lib/db-bitrix.ts`).
- Авторизация через JWT cookie (`cin_session`).

Ключевая идея: пользователь работает в одном интерфейсе, а API внутри этого же приложения агрегирует данные из локальной БД, Bitrix24, Google Custom Search и внешней AI‑интеграции.

---

## 2) Главные возможности

1. **Защищённый кабинет**
   - middleware пропускает только публичные пути (`/login`, `/embed/*`, статика), остальные страницы требуют cookie сессии.
   - защищённый layout дополнительно проверяет актуальный статус пользователя в БД (`activated`).

2. **Библиотека оборудования**
   - вкладка с иерархией: `Отрасль → Класс → Цех → Оборудование`.
   - поиск по каждому уровню, пагинация, бесконечный скролл, автодовыбор связанных сущностей.

3. **Карточка оборудования + дневные лимиты**
   - подробные поля оборудования (описания, проблемы, преимущества, ссылки, изображения).
   - учёт уникальных просмотров в `users_activity` и персональные лимиты/безлимит для сотрудников.

4. **CleanScore и модерация**
   - отдельный таб с лучшими позициями по clean_score, фильтрами и подтверждением `equipment_score_real`.

5. **ОКВЭД‑аналитика**
   - подбор компаний по ОКВЭД, сортировка и навигация обратно к оборудованию.

6. **AI Search**
   - комбинированный поиск: быстрый SQL, fallback на vector/AI‑сервис, логирование запросов в debug‑журнал.

7. **AI Analysis (очередь анализа компаний по ИНН)**
   - постановка задач в очередь, воркер с advisory lock, пошаговый/полный режим, ретраи/таймауты, stop‑команды.

8. **Интеграция с Bitrix24**
   - API‑роуты для резолва компании по ИНН, ответственных и контактных данных.

9. **Встраиваемая карточка**
   - публичная страница `/embed/equipment` открывает карточку только по безопасному `hash_equipment`.

---

## 3) Архитектура

### Frontend

- `app/login/page.tsx` — вход.
- `app/(protected)/layout.tsx` — защита приватных страниц.
- `app/(protected)/library/LibraryClient.tsx` — основной клиентский экран с табами.
- `components/library/*` — табы и специализированные блоки (AI Search, AI Analysis, OKVED, карточки и т.д.).
- `components/ui/*` — базовые UI‑компоненты shadcn/ui.

### Backend (Next API)

- `app/api/auth/*` — логин/логаут/проверка сессии.
- `app/api/industries/*`, `prodclasses/*`, `workshops/*`, `equipment/*` — иерархия и карточки.
- `app/api/ai-search/route.ts` — AI поиск.
- `app/api/ai-analysis/*` — очередь/запуск/остановка/список компаний для анализа.
- `app/api/health/route.ts` — сводная health-диагностика `library -> DB -> AI integration`.
- `app/api/ai-debug/events/route.ts` — журнал AI‑событий.
- `app/api/b24/*`, `app/api/okved/*` — Bitrix24 и ОКВЭД.
- `app/api/images/*` — картинки Google/proxy.
- `app/api/goods/[id]/resolve/route.ts` — резолв товара в цепочку библиотеки.
- `app/api/user/quota/route.ts` — лимиты просмотров за день.

### Слой библиотек (`lib/*`)

- `auth.ts` — JWT cookie сессии.
- `db.ts`, `db-bitrix.ts` — подключения к БД.
- `quota.ts` — лимиты и подсчёт просмотров.
- `equipment.ts` — получение карточки оборудования.
- `ai-integration.ts`, `ai-analysis-config.ts`, `ai-analysis-types.ts` — интеграция AI‑анализа.
- `b24.ts`, `b24-meta.ts`, `company-contacts.ts` — интеграция Bitrix24/контакты.
- `validators.ts` — входные и выходные схемы (Zod).
- `ai-debug.ts` — запись/чтение debug‑событий.

---

## 4) Поток запроса (как приложение работает по шагам)

1. Пользователь открывает страницу.
2. `middleware.ts` проверяет, нужен ли логин.
3. Для защищённых страниц `app/(protected)/layout.tsx` валидирует живой статус пользователя в БД.
4. `LibraryClient.tsx` подгружает профиль (`/api/auth/me`) и дальше запрашивает нужные данные из API.
5. API‑роуты валидируют входные параметры через Zod, делают SQL‑запросы через `db`/`dbBitrix`.
6. Ответы возвращаются в UI; пользователь может углубляться в иерархию или запускать AI‑процессы.
7. Для AI‑операций дополнительно пишутся события в debug‑таблицу и обновляется прогресс в служебных таблицах.

---

## 5) Авторизация и роли

- Логин: `POST /api/auth/login`.
- Сессия хранится в cookie `cin_session` (JWT, `httpOnly`, `sameSite=lax`).
- Проверка сессии: `GET /api/auth/me`.
- Выход: `POST /api/auth/logout`.

Ролевые признаки:

- `activated` — доступ разрешён/запрещён.
- `irbis_worker` — сотрудник (доступ к расширенным вкладкам и логике квот).
- `is_admin` вычисляется по логину `admin` (в отдельных местах, например очистка AI debug).

---

## 6) Квоты просмотров

Логика квот применяется при открытии `GET /api/equipment/[id]`:

- если пользователь безлимитный — карточка всегда доступна;
- если лимитный — учитываются только **уникальные** карточки за текущий день;
- таймзона дневного окна: `Europe/Amsterdam`;
- в ответе отдаются служебные заголовки `X-Views-Limit` и `X-Views-Remaining`.

---

## 7) AI Search

`POST /api/ai-search`:

- делает быстрые SQL‑поиски по товарам/оборудованию/классам;
- при необходимости вызывает внешний AI endpoint (`AI_SEARCH_BASE`) и эмбеддинги OpenAI;
- нормализует и дедуплицирует результаты;
- логирует события в AI debug журнал.

---

## 8) AI Analysis (очередной анализ компаний)

Основные endpoint’ы:

- `GET/POST /api/ai-analysis/run` — старт анализа (моментальный/через очередь).
- `GET /api/ai-analysis/queue` — состояние очереди и активных задач.
- `POST /api/ai-analysis/stop` — команда остановки для ИНН.
- `GET /api/ai-analysis/companies` — список компаний/статусов для UI.

Особенности:

- очередь на таблице `ai_analysis_queue`;
- worker запускается в приложении и берёт advisory lock (защита от параллельных воркеров);
- поддержка пошагового и full‑режима;
- таймауты и ретраи конфигурируются через переменные окружения.

Подробный разбор: `docs/ai-analysis-overview.md` и `docs/ai-analysis-detailed-flow.md`.

---

## 9) Переменные окружения

Минимально необходимые:

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `JWT_SECRET`

Часто используемые интеграции:

- `AI_SEARCH_BASE`, `OPENAI_API_KEY`, `OPENAI_EMBED_MODEL`
- `AI_INTEGRATION_BASE_URL` или `AI_INTEGRATION_BASE`
- `AI_INTEGRATION_HEALTH_TIMEOUT_MS`
- `B24_WEBHOOK_URL`, `B24_PORTAL_ORIGIN`
- `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX`
- `BITRIX_DB_*`
- `AI_ANALYSIS_UI_SMOKE_*` — browser smoke для `/login` и AI Analysis
- `AI_ANALYSIS_UI_QA_*` — browser QA artifact capture для `okved/1way`, `2way`, `3way`
- `AI_ANALYSIS_UI_QA_HEALTH_*` — standalone monitoring для authenticated browser QA
- `AI_ANALYSIS_UI_SMOKE_HEALTH_*` — standalone monitoring для browser-level smoke
- `AI_ANALYSIS_ACCEPTANCE_*` — acceptance QA для `1way/2way/3way/okved` trace-семантики
- `AI_ANALYSIS_ACCEPTANCE_HEALTH_*` — standalone monitoring для live trace acceptance QA
- `LIBRARY_HEALTH_BASE_URL` — base URL для `npm run test:health:smoke`
- `LIBRARY_SYSTEM_HEALTH_*` — standalone monitoring для `npm run healthcheck`

См. полный шаблон: `.env.example`.

---

## 10) Локальный запуск

```bash
npm ci
cp .env.example .env.local
npm run dev
```

По умолчанию: `http://localhost:3000`.

Сборка/прод:

```bash
npm run build
npm run start
```

Для browser-level smoke один раз установите Chromium для Playwright:

```bash
npx playwright install chromium
```

Smoke и диагностика:

```bash
npm run test:ui:smoke
npm run test:ui:qa
npm run test:health:smoke
npm run test:acceptance:qa
npm run healthcheck -- --json
npm run healthcheck -- --artifact-dir /var/lib/library/library-system-health --json
npm run ui:qa:healthcheck -- --json
npm run ui:smoke:healthcheck -- --json
npm run acceptance:healthcheck -- --json
npm run acceptance:suite
npm run acceptance:report -- --library-health artifacts/library-system-health/latest.json
```

`npm run test:ui:qa` requires worker credentials in `AI_ANALYSIS_UI_QA_LOGIN/PASSWORD`
or falls back to `AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD`. It captures row/dialog/equipment
screenshots plus `companies`, `equipment-trace`, and `product-trace` JSON artifacts for
the configured `okved/1way`, `2way`, and `3way` INN cases.

`npm run ui:qa:healthcheck -- --json` uses the same credentials, writes timestamped plus
`latest.json` monitoring artifacts, and supports state-file deduplication and optional
webhook alerts for unhealthy transitions and recovery.

`npm run ui:qa:baseline -- --summary <path-to-summary.json>` exports committed baseline
metadata into `docs/ai-analysis-ui-qa-baseline/` so the release baseline stays reviewable
in git without storing screenshot binaries.

`npm run healthcheck -- --artifact-dir <path>` now writes timestamped plus `latest.json`
artifacts for `/api/health`, so service-chain evidence is stored in the same form as the
other monitoring jobs.

`npm run acceptance:report` consolidates JSON artifacts from `ai-integration`, `library`,
and `ai-site-analyzer` into one markdown/json acceptance report. The ai-integration block now
also understands direct `analysis-score-sql-readiness` artifacts in addition to acceptance and
sync-health artifacts. Each input may point either to a concrete JSON file or to a directory
with `latest.json` / `summary.json`. If a source is not passed explicitly, the script also
tries to auto-discover standard artifact locations in the workspace and under `/var/lib/...`.
For automation, `--require-release-ready` fails on `fail/missing`, and `--require-clean` also
fails on warnings.

`npm run acceptance:suite` runs the local smoke/acceptance chain end-to-end, writes isolated
per-run artifacts and logs under `artifacts/ai-irbistech-acceptance-suite/`, and then assembles
the final acceptance report automatically. By default it is strict about release readiness,
continues after individual task failures so the report is still produced, and keeps browser smoke
plus browser QA in `auto` mode so those steps are skipped with an explicit blocker reason when
Playwright Chromium is unavailable. UI QA auto-mode also skips when worker credentials are absent.
The suite now also runs ai-integration SQL readiness directly and supports
`--require-postgres-sql-target` when rollout verification must treat the postgres target as strict.
It also emits an auxiliary release-readiness markdown/json report from the freshly collected suite
artifacts, so the same run captures both acceptance semantics and operational evidence.

`npm run release:gate` adds one more orchestration layer on top of the suite: it runs the
acceptance suite, keeps the suite-level companion release-readiness report, and then optionally
executes a separate live release-readiness audit against the configured monitoring env files. When
explicit base URLs are not passed, the gate now auto-resolves `library`, `ai-integration`, and
`ai-site-analyzer` base URLs from the standard monitoring env files, so a configured host can run
the full gate with one command and get one combined markdown/json verdict under
`docs/ai-irbistech-release-gate/`. For split production deployments, pass
`--ai-integration-root`, `--ai-integration-python`, and `--ai-site-analyzer-base-url`; if the
`ai-site-analyzer` root is not present locally, the suite falls back to an HTTP healthcheck through
`npm run ai-site-analyzer:remote-healthcheck`. When `ai-site-analyzer` runs on a different VPS, use
`--skip-live-readiness` and keep the analyzer's own `ai-site-analyzer-healthcheck.timer` active on
that host, because the live readiness audit checks local systemd units and local `/var/lib`
artifacts.

`npm run release:readiness` builds a separate release-readiness audit from monitoring env files,
systemd timers, webhook destinations, optional browser prerequisites, and the latest monitoring
artifacts across `ai-integration`, `library`, and `ai-site-analyzer`. It writes markdown/json
output under `docs/ai-irbistech-release-readiness/` and supports `--require-ready`,
`--require-clean`, plus `--skip-systemctl` for hosts where timer probing must be deferred. For
server-side strict gating without extra CLI forwarding, `npm run release:readiness:require-ready`
is also available. Missing required monitoring artifacts now mark the audit as `incomplete`, and
required artifacts with `ok=false` mark it as `not_ready`. The audit now also enforces freshness
windows for required `latest.json` evidence, so stale artifacts are surfaced as missing release
evidence instead of silently passing.

Для production-мониторинга `/api/health` добавлены systemd-шаблоны:

- `deploy/systemd/library-system-healthcheck.service`
- `deploy/systemd/library-system-healthcheck.timer`

Для production-мониторинга live trace acceptance QA добавлены systemd-шаблоны:

- `deploy/systemd/ai-analysis-acceptance-healthcheck.service`
- `deploy/systemd/ai-analysis-acceptance-healthcheck.timer`

Для production-мониторинга browser-level smoke добавлены systemd-шаблоны:

- `deploy/systemd/ai-analysis-ui-smoke-healthcheck.service`
- `deploy/systemd/ai-analysis-ui-smoke-healthcheck.timer`

Для production-мониторинга authenticated browser QA добавлены systemd-шаблоны:

- `deploy/systemd/ai-analysis-ui-qa-healthcheck.service`
- `deploy/systemd/ai-analysis-ui-qa-healthcheck.timer`

Они используют optional env-file `/etc/default/library-monitoring`.

Production rollout helper for the current VPS layout:

```bash
sudo bash deploy/library-rollout.sh
```

The helper is intentionally scoped to `/opt/library/app`. It runs `git pull --ff-only`, stops
`library.service` and installed monitoring timers, rebuilds `node_modules` with dev dependencies
from `package-lock.json`, verifies `tsx`/`next`, runs tests/build, starts services back, and runs
health plus trace-acceptance smoke checks. The health check waits for the Next.js service to
become ready before running acceptance diagnostics. If `npm ci` exits without a valid `tsx/next`
toolchain, the helper now cleans the npm cache and retries the install once before failing.
Browser-level smoke is also run automatically
when Playwright Chromium is available; this can be forced or disabled through
`LIBRARY_ROLLOUT_UI_SMOKE_MODE=always|never`. Authenticated browser QA artifact capture is also run
automatically when Playwright Chromium and worker credentials are available; this can be controlled
through `LIBRARY_ROLLOUT_UI_QA_MODE=always|never`. It can also install/update repo-managed
monitoring units before restart through `LIBRARY_ROLLOUT_INSTALL_SYSTEMD=auto|always|never`.
The rollout script also loads `/etc/default/library-monitoring` by default via
`LIBRARY_ROLLOUT_MONITORING_ENV_FILE`, so browser smoke/QA and acceptance checks can reuse the
same credentials and base URLs as the systemd healthchecks.

The repository also treats `public/static/` as generated host storage, so those production image
artifacts no longer pollute `git status`. The tracked `run.sh` is now marked executable in git to
avoid Linux-only filemode drift on the VPS working tree.

Standalone installer for monitoring units:

```bash
sudo bash deploy/install-library-systemd-units.sh
```

The installer copies `deploy/systemd/*.service|*.timer` into `/etc/systemd/system`, runs
`systemctl daemon-reload`, and enables the monitoring timers. The authenticated browser QA timer
is kept disabled until `/etc/default/library-monitoring` contains either
`AI_ANALYSIS_UI_QA_LOGIN/PASSWORD` or fallback `AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD`, so first-time
rollouts do not create false alarms on servers without worker credentials. The browser smoke and
browser QA timers are also kept disabled until Playwright Chromium is available in the target app
directory. For local verification and custom targets, override `LIBRARY_SYSTEMD_TARGET_DIR` and
use `LIBRARY_SYSTEMD_SKIP_SYSTEMCTL=1` or `--dry-run`.

When `node_modules` becomes partially broken on a host and plain `rm -rf node_modules` fails, the
rollout helper now falls back to Python `shutil.rmtree(...)` before reinstalling dependencies.

For local rollout dry-runs outside production, override `APP_DIR` together with
`LIBRARY_ROLLOUT_ALLOWED_APP_DIR`. To validate the control flow without reinstalling dependencies,
set `LIBRARY_ROLLOUT_SKIP_INSTALL=1`.

The same installer now also writes `deploy/systemd/library-monitoring.env.example` to
`/etc/default/library-monitoring.example` and can bootstrap the real
`/etc/default/library-monitoring` file when `LIBRARY_SYSTEMD_BOOTSTRAP_ENV_FILE=true` is set.
Existing real env files are never overwritten.

---

## 11) Docker

В репозитории есть `Dockerfile`, `docker-compose.yml`, `run.sh` для контейнерного запуска.

```bash
docker compose up --build
```

---

## 12) Встраиваемая карточка (`/embed/equipment`)

- страница публичная и не требует cookie‑сессии;
- принимает `hash_equipment` (или совместимые алиасы параметра);
- ищет оборудование по публичному хэшу;
- может показываться во внешнем `iframe` (заголовки настроены в `next.config.js`).

Важно: для работы нужно заполнить `ib_equipment.hash_equipment` и обеспечить уникальность значения.

---

## 13) Скрипты

- `npm run dev` — запуск dev сервера.
- `npm run build` — production build.
- `npm run start` — запуск production сервера.
- `npm run lint` — линтер.
- `npm run backfill:equipment-hash` — заполнение `hash_equipment` для старых записей.
- `npm run test:ui:smoke` — browser-level smoke для `/login` и AI Analysis.
- `npm run test:ui:qa` — авторизованный browser QA capture для `okved/1way`, `2way`, `3way` с screenshot+JSON артефактами.
- `npm run ui:qa:baseline` — экспорт committed visual-baseline metadata из `summary.json` в `docs/ai-analysis-ui-qa-baseline/`.
- `npm run test:health:smoke` — проверка `GET /api/health` и сводки зависимостей.
- `npm run test:acceptance:qa` — acceptance QA для live trace-семантики `1way/2way/3way/okved` с JSON-артефактом.
- `npm run acceptance:report` — сборка сводного markdown/json acceptance report из JSON-артефактов `ai-integration`, `library` и `ai-site-analyzer`, включая `analysis-score-sql-readiness`, с auto-discovery стандартных artifact-путей и gating-флагами `--require-release-ready` / `--require-clean`.
- `npm run acceptance:suite` — единый orchestration-прогон smoke/acceptance задач с per-run artifacts/logs, preflight по Playwright Chromium и UI QA credentials, прямым ai-integration SQL readiness-check, автоматической сборкой итогового acceptance report и companion release-readiness report, по умолчанию со строгой проверкой `release-ready`.
- `npm run release:gate` — единый итоговый gate поверх acceptance suite и отдельного live release-readiness audit с export в `docs/ai-irbistech-release-gate/`, общим verdict по readiness, автоподхватом base URL из стандартных monitoring env-файлов, split-root флагами для production (`--ai-integration-root`, `--ai-integration-python`, `--ai-site-analyzer-base-url`) и remote HTTP fallback для `ai-site-analyzer`; в multi-host схеме используйте `--skip-live-readiness`, а live healthcheck analyzer держите на его VPS.
- `npm run release:readiness` — сводный release-readiness audit по monitoring env-файлам, systemd timers, webhook destinations, browser prerequisites и latest monitoring artifacts с export в `docs/ai-irbistech-release-readiness/` и gating-флагами `--require-ready` / `--require-clean`.
- `npm run release:readiness:require-ready` — server-side strict запуск release-readiness audit без дополнительной передачи CLI-флагов через `npm run -- ...`.
- `npm run healthcheck` — standalone healthcheck `GET /api/health` с exit code, state-file, `latest.json`/timestamped JSON-артефактами и optional webhook alert.
- `npm run ui:qa:healthcheck` — standalone monitoring authenticated browser QA с exit code, state-file, screenshot/JSON-артефактами и optional webhook alert.
- `npm run ui:smoke:healthcheck` — standalone browser-level smoke monitoring с exit code, state-file, screenshot/JSON-артефактами и optional webhook alert.
- `npm run acceptance:healthcheck` — standalone monitoring live trace acceptance QA с exit code, state-file, JSON-артефактом и optional webhook alert.

