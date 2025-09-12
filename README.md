# Library (Next.js 14) — Иерархический браузер PostgreSQL

Приложение на **Next.js 14 (App Router)** для просмотра и поиска иерархических данных из PostgreSQL: **Отрасль → Класс → Цех → Оборудование** + отдельная вкладка **CleanScore**. Бэкенд реализован через **API‑роуты** в `app/api/*` и использует пул соединений `pg`. UI построен на **Tailwind + shadcn/ui**.

---

## 🚀 Возможности

- Иерархический просмотр: **Industries → Prodclasses → Workshops → Equipment**
- Поиск с дебаунсом **300 мс** на каждом уровне
- Пагинация с **IntersectionObserver** и кнопкой догрузки
- Вкладка **CleanScore** с фильтром по минимальному CS (по умолчанию ≥ 0.95)
- Карточка оборудования: галерея изображений, ссылки, быстрый поиск в Google
- Валидируемые API‑ответы через **Zod**
- SQL‑запросы **строго параметризованы** (без SQL‑инъекций)
- Пул соединений **pg.Pool** с единым helper (`lib/db.ts`)

---

## 🧩 Технологии

- **Next.js 14 (App Router)**, TypeScript (strict), ESLint (core-web-vitals)
- **Tailwind CSS** + **shadcn/ui** (Radix UI)
- **PostgreSQL** + `pg` (node-postgres)
- **Zod** для схем ввода/вывода
- Хуки: `use-debounce`, `use-infinite-scroll`, `use-toast`

---

## 📦 Структура проекта (сокращённо)

```bash
.
├── app/
│   ├── page.tsx                     # Главная (ссылки на /library и CleanScore)
│   ├── layout.tsx                   # Глобальный макет
│   ├── globals.css                  # Tailwind + дизайн‑токены
│   ├── library/
│   │   ├── page.tsx                 # Страница библиотеки
│   │   └── LibraryClient.tsx        # Клиентская логика и состояние списков
│   └── api/
│       ├── industries/route.ts
│       ├── industries/[industryId]/prodclasses/route.ts
│       ├── prodclasses/[prodclassId]/workshops/route.ts
│       ├── workshops/[workshopId]/equipment/route.ts
│       ├── equipment/[id]/route.ts
│       └── cleanscore/route.ts
├── components/
│   ├── library/                     # Карточки, списки, поиск
│   └── ui/                          # shadcn/ui
├── hooks/                           # use-debounce, use-infinite-scroll, use-toast
├── lib/
│   ├── db.ts                        # Пул pg + query helpers
│   ├── utils.ts
│   └── validators.ts                # Все Zod‑схемы/типы
├── public/                          # (отсутствует; можно добавить ассеты)
├── tailwind.config.ts
├── next.config.js
├── Dockerfile
├── docker-compose.yml               # app + postgres (dev/demo)
├── .eslintrc.json
├── tsconfig.json
├── package.json / package-lock.json
├── .env.example / .env.local / .env.production
└── .gitignore
```

---

## 🔌 API (сводка по роутам)

Все эндпоинты **GET**, ответы валидируются Zod‑схемами из `lib/validators.ts`.

1. **`/api/industries`**  
   Параметры: `page`, `pageSize`, `query?`  
   Ответ: `{ items: Industry[], page, pageSize, total, totalPages }`  
   `Industry = { id: number, industry: string }`

2. **`/api/industries/[industryId]/prodclasses`**  
   Параметры: `industryId`, `page`, `pageSize`, `query?`  
   Ответ: `{ items: Prodclass[], ... }`  
   `Prodclass = { id, prodclass, industry_id, best_cs? }`

3. **`/api/prodclasses/[prodclassId]/workshops`**  
   Параметры: `prodclassId`, `page`, `pageSize`, `query?`  
   Ответ: `{ items: Workshop[], ... }`  
   `Workshop = { id, workshop_name, prodclass_id, company_id, workshop_score, best_cs?, created_at }`

4. **`/api/workshops/[workshopId]/equipment`**  
   Параметры: `workshopId`, `page`, `pageSize`, `query?`  
   Ответ: `{ items: EquipmentListItem[], ... }`  
   `EquipmentListItem = { id, equipment_name, workshop_id, equipment_score?, equipment_score_real?, clean_score? }`

5. **`/api/equipment/[id]`**  
   Параметры: `id`  
   Ответ: `EquipmentDetail` (расширенный набор полей, см. `lib/validators.ts`), среди прочего:  
   `description, images_url, contamination, surface, problems, old_method, benefit, synonyms_ru/en, blaster?, air?, rate?, company_id, utp_*...`

6. **`/api/cleanscore`**  
   Параметры: `page`, `pageSize`, `query?`, `minScore? (0..1, по умолчанию 0.95)`  
   Ответ: строки сводной таблицы:  
   `{ equipment_id, equipment_name, clean_score?, industry?*, prodclass?*, workshop_name?* }`

---

## 🗄️ База данных (минимально необходимая схема)

По коду очевидны ожидания следующих таблиц/полей (названия — как в SQL‑запросах):

- `ib_industry (id, industry)`
- `ib_prodclass (id, prodclass, industry_id, best_cs?)`
- `ib_workshops (id, workshop_name, prodclass_id, company_id, workshop_score, best_cs?, created_at)`
- `ib_equipment (id, workshop_id, equipment_name, equipment_score?, equipment_score_real?, clean_score?, ...доп. поля карточки)`

> Для `docker-compose` **создайте файл `db/init.sql`**, в котором создайте эти таблицы и demo‑данные. Пример‑заглушку можно начать так:
>
> ```sql
> -- db/init.sql (минимальный каркас)
> CREATE TABLE IF NOT EXISTS ib_industry (
>   id SERIAL PRIMARY KEY,
>   industry TEXT NOT NULL
> );
> CREATE TABLE IF NOT EXISTS ib_prodclass (
>   id SERIAL PRIMARY KEY,
>   prodclass TEXT NOT NULL,
>   industry_id INT NOT NULL REFERENCES ib_industry(id),
>   best_cs NUMERIC
> );
> CREATE TABLE IF NOT EXISTS ib_workshops (
>   id SERIAL PRIMARY KEY,
>   workshop_name TEXT NOT NULL,
>   prodclass_id INT NOT NULL REFERENCES ib_prodclass(id),
>   company_id INT NOT NULL,
>   workshop_score NUMERIC,
>   best_cs NUMERIC,
>   created_at TIMESTAMP DEFAULT NOW()
> );
> CREATE TABLE IF NOT EXISTS ib_equipment (
>   id SERIAL PRIMARY KEY,
>   workshop_id INT NOT NULL REFERENCES ib_workshops(id),
>   equipment_name TEXT NOT NULL,
>   equipment_score NUMERIC,
>   equipment_score_real NUMERIC,
>   clean_score NUMERIC,
>   description TEXT DEFAULT '' NOT NULL
> );
> ```

---

## 🔧 Переменные окружения

Файл `.env.local` (для разработки) и `.env`/`.env.production` (для прод) должны содержать:

```ini
# PostgreSQL
PGHOST=...
PGPORT=5432
PGDATABASE=...
PGUSER=...
PGPASSWORD=...
PGSSLMODE=prefer   # при необходимости

# Next.js
NODE_ENV=development
```

---

## 🛠️ Локальный запуск

```bash
# 1) Установите зависимости
npm ci

# 2) Настройте окружение
cp .env.example .env.local   # и замените плейсхолдеры на свои значения

# 3) Запустите dev‑сервер
npm run dev
# http://localhost:3000
```

### Старт через Docker Compose (демо)

> Требуется подготовить файл `db/init.sql` (см. выше).

```bash
docker compose up --build
# app: http://localhost:3000
# db : localhost:5432 / library_db / library_readonly / readonly_password
```

---

## 🧪 Скрипты npm

- `npm run dev` — dev‑сервер Next.js
- `npm run build` — сборка
- `npm run start` — prod‑режим
- `npm run lint` — ESLint (core‑web‑vitals)

---

## 🧱 Архитектурные решения

- **App Router** + серверные API в `app/api/*` (runtime = `nodejs`)
- **Пул соединений** `pg.Pool` в `lib/db.ts` (переиспользуемое подключение, `query<T>` с типами)
- **Валидация** входящих query‑параметров и ответов через Zod‑схемы (`lib/validators.ts`)
- **UI‑слои** изолированы в `components/library/*` и переиспользуемых `components/ui/*`
- **Хуки** (`hooks/*`) инкапсулируют debounce/инфинит‑скролл
- **Tailwind** + токены/переменные цветов в `app/globals.css`

---

## 🔐 Безопасность (обязательно к исправлению)

- **Не храните секреты в Git.** В репозитории обнаружены реальные `.env.local` и `.env.production`, а также реальный пароль в `.env.example`.  
  Рекомендации:

  1. Удалите секреты из истории Git (`git filter-repo` / GitHub Secret Scanning). Немедленно **поменяйте пароль БД**.
  2. Оставьте в репо только `.env.example` **с плейсхолдерами**, без реальных значений.
  3. Расширьте `.gitignore`, чтобы игнорировать **все** файлы `.env*`, кроме `.env.example` (см. раздел ниже и приложенный файл `.gitignore.recommended`).

- В `next.config.js` включён `images: { unoptimized: true }` — нормально для статического билда, но для прод‑CDN можно настроить домены/loader и кеширование.

---

## 📄 .gitignore (рекомендации)

Текущий `.gitignore` **не игнорирует** `/.env.production` и любые другие `.env.*` (кроме `*.local`). Добавьте правила ниже и оставьте исключение для примера:

```gitignore
# env
.env
.env.*
!.env.example
```

Полную рекомендуемую версию смотрите в файле [`/.gitignore.recommended`](./.gitignore.recommended).

---

## 🧰 Прод: systemd + Nginx (пример)

**systemd‑unit** (`/etc/systemd/system/library.service`):

```ini
[Unit]
Description=Library (Next.js) Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/library/app
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=/opt/library/app/.env

[Install]
WantedBy=multi-user.target
```

**Nginx‑виртуалхост** (reverse proxy):

```nginx
server {
    listen 80;
    server_name example.com;

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $http_connection;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

---

## 🧪 Качество кода

- ESLint: `next/core-web-vitals`
- TypeScript: `strict: true`, `paths: { "@/*": ["./*"] }`
- Рекомендуется добавить Prettier и CI (lint/build) в GitHub Actions

---

## 📜 Лицензия

MIT
