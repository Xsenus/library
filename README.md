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
- `AI_ANALYSIS_UI_SMOKE_*`
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
npm run test:health:smoke
npm run test:acceptance:qa
npm run healthcheck -- --json
npm run acceptance:healthcheck -- --json
```

Для production-мониторинга `/api/health` добавлены systemd-шаблоны:

- `deploy/systemd/library-system-healthcheck.service`
- `deploy/systemd/library-system-healthcheck.timer`

Для production-мониторинга live trace acceptance QA добавлены systemd-шаблоны:

- `deploy/systemd/ai-analysis-acceptance-healthcheck.service`
- `deploy/systemd/ai-analysis-acceptance-healthcheck.timer`

Они используют optional env-file `/etc/default/library-monitoring`.

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
- `npm run test:health:smoke` — проверка `GET /api/health` и сводки зависимостей.
- `npm run test:acceptance:qa` — acceptance QA для live trace-семантики `1way/2way/3way/okved` с JSON-артефактом.
- `npm run healthcheck` — standalone healthcheck `GET /api/health` с exit code, state-file и optional webhook alert.
- `npm run acceptance:healthcheck` — standalone monitoring live trace acceptance QA с exit code, state-file, JSON-артефактом и optional webhook alert.

