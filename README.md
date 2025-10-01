# Library (Next.js 14) — Навигатор по оборудованию

Внутренняя панель на **Next.js 14 (App Router)** для поиска оборудования и смежных сущностей по иерархии БД. Страницы защищены авторизацией по cookie‑сессии, а данные берутся из PostgreSQL (pgvector) c дополнительными интеграциями Bitrix24, Google Custom Search и AI‑поиском. UI построен на **Tailwind CSS + shadcn/ui**.

---

## 🚀 Ключевые возможности

- **Защищённый доступ**: middleware проверяет cookie `cin_session`, layout валидирует статус пользователя в БД и выполняет редирект на `/login` при отсутствии сессии.
- **Иерархический браузер**: вкладка «Библиотека» позволяет проходить цепочку *Отрасль → Класс → Цех → Оборудование* с дебаунсом, бесконечным скроллом и автоподбором выбранных элементов.
- **CleanScore & модерация**: отдельная вкладка показывает таблицу лучших CleanScore, позволяет подтверждать значение `equipment_score_real` и синхронизирует состояние между вкладками.
- **AI‑поиск**: вкладка «AI Search» вызывает `/api/ai-search`, комбинируя быстрые SQL‑запросы, pgvector kNN и внешнее API с эмбеддингами OpenAI.
- **ОКВЭД‑аналитика**: вкладка «ОКВЭД» позволяет фильтровать компании, сортировать по выручке, управлять шириной колонок и переходить к карточкам оборудования.
- **Резолвер товаров**: endpoint `/api/goods/[id]/resolve` ищет подходящее оборудование по связям, векторной близости и строковому совпадению, чтобы открыть цепочку в библиотеке.
- **Bitrix24 интеграция**: API `/api/b24/*` дергают веб‑хуки Bitrix24, вытаскивают ответственных и цветовые статусы по ИНН с локальным кэшем, сборкой batch‑запросов и вспомогательными утилитами.
- **Google Images и галерея**: `/api/images/google` оборачивает Google Custom Search и возвращает нормализованный список превью для карточки оборудования.
- **Дневные квоты**: `/api/user/quota` считает уникальные просмотры карточек за день (Europe/Amsterdam), применяет персональные лимиты и сохраняет прогресс в интерфейсе через хук `useDailyQuota`.

---

## 🧩 Технологический стек

- **Next.js 14 (App Router)** + TypeScript strict.
- **Tailwind CSS** и **shadcn/ui** для компонентов и темизации.
- **PostgreSQL + pg** (два пула: основной и Bitrix), поддержка pgvector и параметризованные запросы.
- **Zod** для схем входящих и исходящих данных API.
- **bcryptjs**, **jose** для аутентификации и JWT‑сессий.
- **OpenAI / Custom AI сервис** для векторного поиска и рекомендаций.

---

## 📦 Структура проекта (ключевые узлы)

```
app/
├── (protected)/            # Все защищённые страницы
│   ├── layout.tsx          # Проверка сессии и статуса пользователя
│   ├── page.tsx            # Дашборд с ссылками на вкладки
│   └── library/            # Вкладки Library / CleanScore / OKВЭД / AI
├── login/                  # Страница входа
├── api/                    # Next.js API routes
│   ├── auth/               # Логин / логаут / статус
│   ├── industries/, …      # Иерархические списки
│   ├── ai-search/          # AI подсказки по оборудованию
│   ├── goods/[id]/resolve  # Резолвер цепочек для товаров
│   ├── okved/              # ОКВЭД + Bitrix24 аналитика
│   ├── b24/                # Прокси для Bitrix24 webhook
│   └── user/quota          # Дневные лимиты
├── middleware.ts           # Защита маршрутов по cookie
└── globals.css             # Tailwind baseline

components/
├── library/                # Карточки, списки, вкладки
└── ui/                     # shadcn/ui

lib/
├── db.ts                   # Основной пул PostgreSQL
├── db-bitrix.ts            # Подключение к Bitrix реплике
├── auth.ts                 # JWT cookie-сессии
├── quota.ts                # Подсчёт лимитов
├── b24.ts                  # Помощники для Bitrix24 API
└── validators.ts           # Zod-схемы
```

---

## 🔌 Основные API-роуты

| Группа | Endpoint | Назначение |
| --- | --- | --- |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` | Cookie‑сессия, статус пользователя, выход. |
| Library | `/api/industries`, `/api/industries/[id]/prodclasses`, `/api/prodclasses/[id]/workshops`, `/api/workshops/[id]/equipment`, `/api/equipment/[id]` | Иерархические списки и карточки оборудования. |
| CleanScore | `GET /api/cleanscore` | Таблица агрегированных CleanScore с пагинацией и фильтрами. |
| Goods | `GET /api/goods/[id]/resolve` | Поиск цепочки для товара по связям, вектору или названию. |
| AI Search | `POST /api/ai-search` | Комбинированный SQL + AI‑поиск по оборудованию/продукции. |
| OKВЭД | `GET /api/okved`, `/api/okved/main`, `/api/okved/companies`, `/api/okved/company` | Данные по ОКВЭД, компаниям, ответственным и цветам из Bitrix24. |
| Bitrix24 | `POST /api/b24/responsibles`, `POST /api/b24/resolve-company` | Интеграция с CRM, получение ответственных по ИНН, резолв компании. |
| Utility | `GET /api/images/google`, `GET /api/user/quota` | Поиск изображений в Google, расчёт дневного лимита просмотров. |

---

## 🔐 Аутентификация и лимиты

- Логин принимает bcrypt/plaintext пароли, сверяет с таблицей `users_irbis`, создаёт JWT (HS256) и выставляет httpOnly‑куку `cin_session`. Флаг `remember` переводит cookie в «длинный» (7 дней).
- Middleware блокирует все страницы кроме `/login`, `_next/*`, `/static/*`, `/api/*`, перенаправляя незалогиненных пользователей на форму входа и сохраняя `next` в query string.
- Layout для защищённых маршрутов дополнительно проверяет актуальное состояние пользователя (активация, `irbis_worker`) через `getLiveUserState`. Если запись неактивна — делает redirect обратно на `/login`.
- Endpoint `/api/user/quota` использует `resolveUserLimit` и `countUsedToday`, чтобы вернуть дневной лимит, остаток и HTTP‑заголовки `X-Views-Limit/X-Views-Remaining`. Клиентский хук `useDailyQuota` оборачивает его в React‑состояние и оптимистично обновляет остаток.

---

## 🌐 Интеграции и внешние сервисы

- **Google Custom Search**: API‑роут подставляет ключ/ID из переменных окружения, ограничивает ответ полями `link`, `thumbnail`, `context`. Ошибки возвращаются в JSON с кодом Google API.
- **AI search backend**: `AI_SEARCH_BASE` задаёт URL собственного сервиса, `OPENAI_API_KEY` и `OPENAI_EMBED_MODEL` пробрасываются дальше для генерации эмбеддингов. При неудаче используется локальный SQL/pgvector фолбэк.
- **Bitrix24**: вспомогательный модуль `lib/b24.ts` строит batch‑запросы (`b24BatchJson`), нормализует URL портала и кидает ошибки, если веб‑хук не настроен. Endpoint `/api/b24/responsibles` кэширует ИНН и имена ответственных в памяти с TTL.

---

## ⚙️ Переменные окружения

Скопируйте `.env.example` в `.env.local` и заполните значениями. Ключевые переменные:

| Переменная | Назначение |
| --- | --- |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | Подключение основного пула PostgreSQL для всех иерархических запросов. |
| `JWT_SECRET` | Секрет для подписи JWT‑сессии, обязателен для логина. |
| `USE_HTTPS` | Включает secure‑флаг cookie в продакшене (`true` при работе за HTTPS). |
| `NEXT_PUBLIC_GPT_IMAGES_BASE` | Путь для локальных изображений карточки оборудования (используется на клиенте). |
| `GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` | Ключ и идентификатор движка Google Custom Search для `/api/images/google`. |
| `AI_SEARCH_BASE`, `OPENAI_API_KEY`, `OPENAI_EMBED_MODEL` | Бэкенд AI‑поиска, ключ OpenAI и модель эмбеддингов для комбинированного поиска. |
| `B24_WEBHOOK_URL`, `B24_PORTAL_ORIGIN`, `B24_UF_INN_FIELDS`, `B24_UF_INN_FIELD`, `B24_COLOR_UF_FIELD` | Настройки доступа к Bitrix24, список UF‑полей ИНН и поле цвета статусного маркера. |
| `BITRIX_DB_HOST`, `BITRIX_DB_PORT`, `BITRIX_DB_NAME`, `BITRIX_DB_USER`, `BITRIX_DB_PASSWORD`, `BITRIX_DB_SSL` | Отдельное подключение к реплике Bitrix (таблица `dadata_result`). |

> `.env` и `.env.*` игнорируются Git. Не храните реальные секреты в репозитории — оставляйте только `.env.example` с плейсхолдерами.

---

## 🛠️ Локальный запуск

```bash
# 1) Установить зависимости
npm ci

# 2) Создать файл окружения
cp .env.example .env.local
# затем заполнить переменные (PostgreSQL, JWT_SECRET и др.)

# 3) Запустить dev-сервер
npm run dev
# http://localhost:3000
```

### Docker Compose (демо)

Для быстрой демонстрации можно собрать контейнеры.

```bash
docker compose up --build
# app: http://localhost:3000
# db : postgres://library_readonly:readonly_password@localhost:5432/library_db
```

Перед запуском подготовьте `db/init.sql` с таблицами `ib_industry`, `ib_prodclass`, `ib_workshops`, `ib_equipment` и демо‑данными под структуру запросов.

---

## 🧪 Скрипты npm

- `npm run dev` — Next.js dev mode.
- `npm run build` — продакшн сборка.
- `npm run start` — запуск собранного приложения.
- `npm run lint` — ESLint (`next/core-web-vitals`).

---

## 🔐 Рекомендации по безопасности

- Меняйте все секреты при утечке и не коммитьте реальные `.env` файлы. Пример `.env.example` содержит только плейсхолдеры и безопасные значения по умолчанию.
- Для продакшена включайте `USE_HTTPS=true`, храните `JWT_SECRET` в хранилищах секретов, ограничивайте доступ к БД и Bitrix webhook.
- Рассмотрите добавление CI для запуска `npm run lint`/`npm run build` и сканера секретов перед деплоем.

---

## 📜 Лицензия

MIT
