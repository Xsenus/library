# Company analysis workflow

Этот документ описывает серверные API, структуру хранения и ключевые элементы UI,
которые обеспечивают ручной и пакетный запуск анализа компаний в табе «База
компаний».

## Хранилище состояния анализа

Состояние анализов хранится в таблице `company_analysis_state`. Таблица создаётся
по требованию и поддерживается функцией `ensureCompanyAnalysisLoaded`.

```ts
// lib/company-analysis.ts
await db.query(`
  CREATE TABLE IF NOT EXISTS company_analysis_state (
    inn TEXT PRIMARY KEY,
    websites TEXT[] DEFAULT '{}'::text[],
    emails TEXT[] DEFAULT '{}'::text[],
    status TEXT NOT NULL DEFAULT 'idle',
    stage TEXT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    last_started_at TIMESTAMPTZ NULL,
    last_finished_at TIMESTAMPTZ NULL,
    duration_seconds INTEGER NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    rating NUMERIC NULL,
    info JSONB DEFAULT '{}'::jsonb,
    analysis_ok BOOLEAN DEFAULT FALSE,
    server_error BOOLEAN DEFAULT FALSE,
    no_valid_site BOOLEAN DEFAULT FALSE,
    stop_requested BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
```

Тот же модуль предоставляет функции для постановки анализов в очередь, запуска и
остановки (`queueCompanyAnalysis`, `startCompanyAnalysis`,
`stopCompanyAnalysis`), а также для обновления полей прогресса и метаданных
(`updateCompanyAnalysis`). Все операции перед возвращением результата
приводят строки к типам, описанным в `lib/validators.ts`.

## REST API

Для управления анализами доступны маршруты `/api/analysis/start`,
`/api/analysis/queue`, `/api/analysis/stop`, `/api/analysis/update` и
`/api/analysis/state`. Каждый маршрут принимает/возвращает JSON, валидирует
данные с помощью `zod` и обрабатывает ошибки, чтобы не ломать UI. Пример
обработчика запуска анализа:

```ts
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { inns } = startSchema.parse(body);
  const result = await startCompanyAnalysis(inns);
  return NextResponse.json({ ok: true, items: result });
}
```

Агрегация состояния при выдаче списка компаний реализована в
`app/api/okved/companies/route.ts`, где данные основной таблицы дополняются
информацией анализа и основным ОКВЭДом.

## UI таба «База компаний»

Компонент `components/library/okved-tab.tsx` отображает таблицу компаний с
дополнительными колонками (сайты, имейлы, даты и время запусков, длительность,
попытки, рейтинг) и диалогом с подробной информацией анализа. В верхней части
табличного блока расположены кнопки массового запуска и остановки, фильтры по
успешности, проблемам, отраслям и кодам ОКВЭД, а также чекбоксы для выбора
строк.

Для каждой компании показаны индивидуальные элементы управления: кнопка запуска
анализа, прогресс-бар и кнопка остановки при активном процессе, бейджи статуса,
ссылки на сайты/почты, а также кнопка «Инфо», раскрывающая диалог с подробным
отчётом (уровень соответствия, основной ОКВЭД, результаты ИИ-анализа, топ
оборудования и найденные продукты).

## Дополнительные сведения

Валидаторы `lib/validators.ts` описывают структуру данных анализа (инфо,
флаги, статусы) и переиспользуются как на сервере, так и в UI. Это обеспечивает
единый контракт между API и интерфейсом и упрощает статическую проверку типов.
