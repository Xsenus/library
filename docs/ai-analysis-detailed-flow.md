# Детальный сценарий AI-анализа организаций

Документ описывает **фактический поток исполнения** в текущем коде: как происходит запуск
анализа **через очередь** и **без очереди**, куда ходит сервис, какие таблицы/поля читает,
какие fallback'и применяет и что происходит при ошибках/отсутствии данных.

## 1) Общая точка входа

Основной вход — `POST /api/ai-analysis/run`.

### 1.1 Нормализация запроса
1. Из тела берутся `inns`, `mode`, `steps`, `payload`, `source`.
2. `inns` нормализуются: приводятся к строке, обрезаются пробелы, удаляются дубли и пустые.
3. Проверяется, что есть хотя бы один ИНН; иначе возвращается `400`.
4. Определяется базовый URL внешней AI-интеграции из env:
   - `AI_INTEGRATION_BASE`
   - `AI_ANALYZE_BASE`
   - `ANALYZE_BASE`
   Если валидный URL не найден — `503`.

### 1.2 Проверка доступности интеграции
Перед любым запуском вызывается `GET /health` внешнего AI-сервиса.

- Если `/health` недоступен или вернул ошибку — API отвечает `502`, в очередь ничего не ставится.
- Если `/health` успешен — продолжается разбор режима запуска.

### 1.3 Определение режима запуска
Режим может быть:
- `full` — единый вызов полного пайплайна `/v1/pipeline/full`.
- `steps` — последовательный прогон шагов (`lookup`, `parse_site`, `analyze_json`, `ib_match`, `equipment_selection`).

На выбор режима влияют env-настройки:
- `AI_ANALYSIS_LAUNCH_MODE`
- `AI_ANALYSIS_LOCK_MODE`
- `AI_ANALYSIS_STEPS`

Если режим «залочен», запросные `mode/steps` переопределяются конфигом.

## 2) Запуск без очереди

Без очереди запускаются только специальные сценарии в `POST /api/ai-analysis/run`.

### 2.1 Когда запускается без очереди
1. **Один ИНН + режим `full`** -> immediate full run.
2. **Один ИНН + режим `steps`** -> immediate sequential steps.
3. **debug-step** (`source=debug-step`) + один ИНН + один шаг -> immediate single step (без смены финального статуса как у полного прогона).

### 2.2 Полный запуск без очереди (`full`, 1 ИНН)
Порядок:
1. Логируется старт (`ai_debug_events`, notification).
2. В `dadata_result` ставится `analysis_status='running'`, обнуляются/сбрасываются служебные поля (`progress`, `finished_at`, флаги ошибок и т.д., если колонки существуют).
3. Вызывается `runFullPipeline`:
   - перед каждой попыткой проверка `/health`;
   - затем `POST /v1/pipeline/full` с `{ inn }`;
   - до 3 попыток на шаг с паузой 2с (`MAX_STEP_ATTEMPTS`, `RETRY_DELAY_MS`).
4. По результату:
   - success -> `markFinished(...status='completed')`, лог success;
   - fail -> `markFinished(...status='failed', outcome='failed')`, лог error.
5. Клиенту возвращается JSON с `ok/status/error`.

### 2.3 Пошаговый запуск без очереди (`steps`, 1 ИНН)
Порядок:
1. Лог старта + `markRunning`.
2. Последовательно выполняются шаги `stepsToRun`.
3. После каждого успешного шага обновляется `analysis_progress` (если колонка есть).
4. На первом неуспешном шаге цикл завершается ошибкой.
5. Вся последовательность обернута в общий таймаут (`AI_INTEGRATION_OVERALL_TIMEOUT_MS`, default ~10 минут).
6. Финал аналогичен полному режиму: `completed`/`failed` + лог.

### 2.4 Одиночный debug-шаг
1. Лог «отладочный запуск шага».
2. Выполняется `runStep` ровно для одного шага.
3. Возвращается ответ по шагу (`ok/status/error`) без полного цикла `markFinished` для пайплайна.

## 3) Запуск через очередь

Если сценарий не попал в immediate-ветки (например, несколько ИНН), используется очередь.

### 3.1 Постановка в очередь
1. Гарантируется существование таблицы `ai_analysis_queue`.
2. Формируется payload задачи:
   - `source`, `count`, `requested_at`, `mode`, `steps`,
   - `defer_count=0`, `completed_steps=[]`.
3. Вставка `INSERT ... ON CONFLICT (inn) DO UPDATE`:
   - если ИНН уже в очереди, задача перезаписывается свежими параметрами.
4. В `ai_debug_events` пишется notification о постановке.
5. В `dadata_result` массово ставится `analysis_status='queued'` (+ сброс started/finished/progress/outcome/attempts в зависимости от доступных колонок).
6. Клиенту **сразу** отдается ACK, после чего в фоне вызывается `triggerQueueProcessing()`.

### 3.2 Как запускается фоновый обработчик
1. Берется advisory lock PostgreSQL (`pg_try_advisory_lock(42111)`), чтобы только один воркер обрабатывал очередь.
2. Если lock не получен, планируется повторный запуск через ~1.5с.
3. С lock'ом запускается `processQueue(lockClient)`.

### 3.3 Подготовка очереди к обработке
Перед циклом:
1. `cleanupStaleQueueItems()` удаляет «зависшие» элементы:
   - слишком старые (`queued_at` старше 2 часов),
   - или с `defer_count >= MAX_COMPANY_ATTEMPTS`.
2. Для удаленных задач фиксируется `failed` в `dadata_result`.

### 3.4 Выбор следующей компании
`dequeueNext()` делает атомарный выбор + удаление элемента через CTE + `FOR UPDATE SKIP LOCKED`.
Приоритезация:
1. В первую очередь — компании с признаками частичного/ошибочного прошлого прогона.
2. Затем — «не стартовавшие».
3. Затем остальные.

После выбора элемент удаляется из `ai_analysis_queue` и переходит в обработку.

### 3.5 Обработка stop-команд
В каждом цикле вызывается `consumeStopSignals()`:
1. Читает и удаляет команды `action='stop'` из `ai_analysis_commands`.
2. Вытаскивает оттуда `inns`.
3. Удаляет эти ИНН из очереди и ставит им `analysis_status='stopped'`.
4. Если текущий ИНН попал в stop-set — анализ пропускается.

### 3.6 Запуск анализа конкретного элемента
1. Лог `analysis_start`.
2. `markRunning(inn, attemptNo)` — статус `running`, сброс служебных полей, запись номера попытки.
3. Определяется режим из payload (`full` или `steps`).
4. Выполнение:
   - `full` -> `runFullPipeline`.
   - `steps` -> последовательный `runStep` по списку шагов с учетом `completed_steps` (для ретраев после частичного успеха).
5. Есть общий таймаут всей компании (`overallTimeoutMs`), по истечении результат принудительно `504 timed out`.

### 3.7 Ретраи
Есть два уровня retry:
1. **Retry шага**: до 3 попыток, задержка 2с.
2. **Retry компании в очереди**: до 3 попыток (`MAX_COMPANY_ATTEMPTS`).
   - При неуспехе, если лимит не исчерпан, задача снова enqueue с увеличенным `defer_count` и сохранением `completed_steps`.
   - Статус в `dadata_result` временно возвращается в `queued`.

### 3.8 Когда задача завершается
1. Если успех -> `markFinished(status='completed', progress=1, outcome='completed')`.
2. Если финальная ошибка -> `markFinished(status='failed', outcome='failed')`.
3. Если получен stop после выполнения — финал `stopped`.
4. Если подряд набралось 5 уникальных ошибок (`MAX_FAILURE_STREAK`) — обработчик останавливает цикл и пишет ошибку в лог.

### 3.9 Завершение воркера
1. Освобождается advisory lock (`pg_advisory_unlock`).
2. Если в очереди еще остались элементы, планируется повторный фоновый запуск.

## 4) Что именно вызывается во внешнем AI-сервисе

### 4.1 Режим full
- `POST /v1/pipeline/full` с `{ inn }`.

### 4.2 Режим steps
Для каждого шага есть primary + fallback:
1. `lookup`
   - primary: `GET /v1/lookup/{inn}/card`
   - fallback: `POST /v1/lookup/card` (`{inn}`)
2. `parse_site`
   - primary: `POST /v1/parse-site` (`{inn}`)
   - fallback: `GET /v1/parse-site/{inn}`
3. `analyze_json`
   - primary: `GET /v1/analyze-json/{inn}`
   - fallback: `POST /v1/analyze-json` (`{inn}`)
4. `ib_match`
   - primary: `GET /v1/ib-match/by-inn?inn=...`
   - fallback: `POST /v1/ib-match` (`{inn, client_id}`), затем `POST /v1/ib-match/by-inn` (`{inn}`)
5. `equipment_selection`
   - primary: `GET /v1/equipment-selection/by-inn/{inn}`

Перед каждой попыткой шага обязательно делается `/health`.

## 5) Что происходит, если что-то не найдено

### 5.1 Не найден base URL интеграции
- Немедленный отказ (`503`) и сообщение о не настроенном env.

### 5.2 Не проходит `/health`
- Для стартового запроса `run` -> `502`, запуск не начинается.
- Для отдельного шага/пайплайна внутри процесса -> фиксируется ошибка попытки, включается retry.

### 5.3 Отсутствуют колонки в `dadata_result`
Модуль `getDadataColumns()`:
1. Проверяет `information_schema.columns`.
2. Пытается автоматически добавить основные служебные колонки (`analysis_status`, `analysis_started_at`, `analysis_progress`, ...).
3. Если конкретной колонки все равно нет — обновление этого поля пропускается безопасно (без падения всего процесса).

### 5.4 Не найдено/пусто тело ответа внешнего API
- Ошибка формируется как `detail`, `error` или `HTTP <status>`.
- Шаг считается неуспешным и идет по fallback/ретраю.

### 5.5 Не поддерживается stop во внешнем AI
`POST /api/ai-analysis/stop` останавливает **локальную очередь** и выставляет локальные статусы;
в payload явно фиксируется, что внешний сервис может не уметь отменять уже стартовавшие джобы.

### 5.6 Нет задач в очереди
- Воркер завершает цикл, освобождает lock и просто выходит.

## 6) Где хранятся наблюдаемые следы анализа

1. `ai_analysis_queue` — текущая очередь на запуск.
2. `ai_analysis_commands` — команды управления (например `stop`).
3. `ai_debug_events` — журнал request/response/error/notification с payload.
4. `dadata_result` — пользовательские статусы анализа (`analysis_status`, `analysis_progress`, `analysis_outcome`, `analysis_attempts`, timestamps и т.д.).

## 7) Как читать состояние «в очереди / в работе»

`GET /api/ai-analysis/queue` строит объединенный список:
1. Элементы из `ai_analysis_queue` (источник `queue`).
2. Элементы, которые уже выполняются, но не стоят в очереди (источник `running`) по эвристике:
   - статус похож на running/processing,
   - или progress между 0 и 1,
   - или есть свежий `analysis_started_at` без `analysis_finished_at`,
   - и при этом нет терминальных признаков (`failed/completed/stopped/...`).

Это позволяет UI показывать общий «живой» список обработки, даже если задача уже dequeued и исполняется прямо сейчас.
