# Обзор AI-анализа компаний

Ниже описано, как работает пайплайн AI-анализа и как пишутся вспомогательные логи. Схема
поведения повторяет PHP-прокси из Bitrix-приложения: есть фоновая очередь, обработчик с
ретраями сетевых шагов и журнал событий `ai_debug_events`, который помогает разбирать
трафик и ошибки.

## Входные сценарии и запросы
1. Автозагрузка карточки компании: UI отправляет `GET /api/ai-analysis/run?inn=...` (в
   веб-прокси пример — `GET /v1/lookup/{inn}/ai-analyzer`). Ответ сразу передаётся в UI
   без постановки в очередь.
2. Запуск по кнопке/массовая постановка: `POST /api/ai-analysis/run` с телом вида
   `{ inns: ['7707083893'], mode: 'full'|'steps', steps?: string[] }`. Внутри шаги и
   режимы нормализуются так же, как в PHP-прокси: сохраняются домены/почты/имя компании,
   а дальше по ним строятся обращения к интеграции.
3. Остановка: `POST /api/ai-analysis/stop` кладёт команду `stop` для указанных ИНН; при
   следующей выборке из очереди обработчик пропустит элемент и залогирует уведомление.

## Постановка компаний в очередь
1. Вызов `POST /api/ai-analysis/run` принимает список ИНН и режим работы (`full` или `steps`). Если режим не заблокирован конфигурацией, он берётся из тела запроса, иначе — принудительный (`AI_ANALYZE_FORCED_MODE`).
2. Тело запроса нормализуется в полезную нагрузку: `{ source, count, requested_at, mode, steps|null, defer_count: 0, completed_steps: [] }`. Отсутствие интеграции (`AI_INTEGRATION_BASE`/`ANALYZE_BASE`) или падение `/health` возвращают ошибку 5xx без записи в очередь.
3. Для каждого ИНН делается upsert в `ai_analysis_queue`: устанавливаются `queued_at`, `queued_by` (из сессии) и сериализованный `payload`. Параллельно в `dadata_result` проставляется статус `queued`, сбрасываются даты старта/финиша и прогресс.
4. В лог `ai_debug_events` добавляется уведомление о постановке в очередь c полями `{inns, requestedBy, mode, steps, source}`. UI сразу видит новые статусы и может фильтровать по событиям.

## Запуск фонового обработчика
1. После ответа клиенту бэкенд пытается взять advisory-lock с ключом `42111` — это исключает одновременную работу нескольких обработчиков очереди.
2. Пока блокировка удерживается, обработчик повторяет цикл: достаёт самый старый `queued_at` из `ai_analysis_queue` (`FOR UPDATE SKIP LOCKED`), помечает его как взятый в работу и удаляет из таблицы.
3. Перед выполнением проверяются команды остановки в `ai_analysis_commands`. Если найден стоп для конкретного ИНН, элемент пропускается: статус не меняется, в лог пишется уведомление об отмене.

## Подготовка к анализу
1. Для выбранного ИНН читается список доступных колонок в `dadata_result` (статус, прогресс, флаги ошибок). Затем `markRunning` ставит `status = 'running'`, обнуляет прогресс и флаги ошибок, сбрасывает `finished_at`.
2. В лог пишется уведомление `analysis_start` с названием компании; при этом в `dadata_result` по возможности фиксируются `server_error = 0`, `analysis_ok = 0`, `analysis_started_at = now()`.

## Выполнение шагов (что отправляем и что получаем)
1. Определение плана:
   - Режим `full`: вызывается `runFullPipeline`, который один раз шлёт `POST /v1/pipeline/full` с `{ inn }` и ждёт один ответ.
   - Режим `steps`: формируется список шагов с основной точкой входа и fallback-эндпоинтами из `STEP_DEFINITIONS`.
2. Набор шагов и адресов совпадает с PHP-примером (маршрут `/v1/...`):
   - `lookup`: `GET /v1/lookup/{inn}/card` → JSON карточки компании; если недоступно, `POST /v1/lookup/card` c `{inn}`.
   - `parse_site`: `POST /v1/parse-site` c `{ inn }` плюс собранные домены/почты; fallback — `GET /v1/parse-site/{inn}`.
   - `analyze_json`: `GET /v1/analyze-json/{inn}` или `POST /v1/analyze-json` c `{inn}`.
   - `ib_match`: `GET /v1/ib-match/by-inn?inn=...`, fallback — `POST /v1/ib-match` или `/v1/ib-match/by-inn` с `{inn}`.
   - `equipment_selection`: `GET /v1/equipment-selection/by-inn/{inn}`.
3. Перед каждым сетевым вызовом проверяется `/health` интеграции. Если сервис недоступен,
   логируется ошибка `server_retry`/`server_stop` и попытка повторяется либо завершается
   по тайм-ауту.
4. Для каждого шага создаётся `requestId`, чтобы связать запрос и ответ:
   - Отправляем HTTP-запрос (метод из шага, путь `/v1/...`, тело обычно `{ inn }` или
     `{ inn, domain, parse_domains, ... }`). В лог попадает событие `request` с
     `source=ai-integration`, `requestId`, путём и телом.
   - Если основной эндпоинт отвечает ошибкой/тайм-аутом, пробуем fallback-список в том же
     формате и логируем каждую попытку.
   - На успешный ответ пишется `response` с `payload` (JSON тела). При неуспехе — `error`
     с текстом ошибки и счётчиком `attempt`.
5. Количество попыток шага — до трёх. Между попытками ставится пауза 2 секунды и
   уведомление о повторе. Тайм-аут одного шага регулируется `AI_INTEGRATION_STEP_TIMEOUT_MS`
   (по умолчанию 5 минут); общий тайм-аут всего пайплайна —
   `AI_INTEGRATION_OVERALL_TIMEOUT_MS` (10 минут).
6. После успешного шага обновляется прогресс в `dadata_result` (доля выполненных шагов или
   `1` для полного режима) и дописывается `completed_steps` в полезную нагрузку для
   возможного возобновления.

### Линейный план запросов (что отправляем → что ожидаем → что делаем дальше)
1. `POST /api/ai-analysis/run` с `{ inns, mode, steps? }` → подтверждение постановки в очередь → обработчик берёт ИНН в работу.
2. (Перед каждым сетевым шагом) `GET /health` интеграции без тела → `200 OK` → продолжаем; иначе фиксируем `server_retry` или останавливаем по тайм-ауту.
3. `GET /v1/lookup/{inn}/card` (или `POST /v1/lookup/card {inn}`) → карточка компании {id, domains} → обновляем прогресс, передаём домен дальше.
4. `POST /v1/parse-site { inn, domain?, parse_domains[], parse_emails[], company_name?, portal_domain?, company_id? }` → JSON с итогами парсинга {planned_domains, successful_domains, chunks_inserted} → пишем прогресс.
5. `GET /v1/analyze-json/{inn}` (или `POST /v1/analyze-json {inn}`) → {status, text_length, total_text_length, domains_processed, ai?} → обновляем прогресс.
6. `GET /v1/ib-match/by-inn?inn=...` (fallback `POST /v1/ib-match`/`/by-inn {inn}`) → {summary, duration_ms} → логируем и обновляем прогресс.
7. `GET /v1/equipment-selection/by-inn/{inn}` → {goods_types, site_equipment, log} → прогресс.
8. `GET /v1/lookup/{inn}/ai-analyzer` → итоговый ответ AI {ai, company, sites...} → записываем в UI/БД, помечаем анализ завершённым.
9. При ошибке на любом шаге: фиксируем событие `error`, возвращаем в очередь с `defer_count+1` (макс. 3) и списком успешных шагов; после исчерпания попыток — статус `failed`.
10. При получении команды `stop` или успешном завершении всех шагов: ставим статус `completed`/`stopped`, пишем `analysis_success` или уведомление об отмене, снимаем блокировку обработчика.

## Завершение и повторные попытки
1. Когда все выбранные шаги завершены, элемент удаляется из очереди. Если в этот момент поступил стоп-сигнал, статус помечается как остановленный, пишется уведомление, остальные действия пропускаются.
2. При успехе вызывается `markFinished` со статусом `completed`, фиксируются длительность и прогресс `1`. В лог уходит `analysis_success`, а в `dadata_result` проставляется `analysis_ok = 1` и сбрасывается `server_error`.
3. При ошибке статус становится `failed`, прогресс и выполненные шаги сохраняются. В лог пишется событие `error` с причиной. Если `defer_count < 3`, компания возвращается в очередь с увеличенным счётчиком и списком завершённых шагов, чтобы при следующем запуске пропустить успешные части.
4. Когда очередь опустела, пишется итоговое уведомление с количеством успешных, отложенных и ошибочных компаний, чтобы видеть общий результат прохода.

## Где и как пишутся логи
1. `logAiDebugEvent` при первом вызове создаёт таблицу `ai_debug_events` и индексы. Попытки добавить флаги в `dadata_result` (колонки `server_error`, `analysis_ok`, `analysis_started_at`) оборачиваются в try/catch, чтобы отсутствие колонок не ломало логирование.
2. События делятся на категории: трафик (`request`/`response`), ошибки (`error` с `errorKey`), уведомления (`notification` c `notificationKey`). Для уведомлений шаблоны формируют читаемые сообщения вроде «Начат анализ компании …».
3. При записи уведомлений или ошибок система пытается обновить служебные флаги в `dadata_result`; если это не удалось, в stdout пишется предупреждение, но сама запись в лог остаётся доступной.

## Схема данных и маппинг для карточки
Ниже — краткая памятка, что хранится в основной базе (Postgres) и как складывается итоговый ответ для фронта.

### Таблицы и связи
- **clients_requests** — контейнер по заявке: `inn`, домены (`domain_1/2`), `okved_main`, описания сайтов, UTP/письмо и т.д.
- **pars_site** — тексты и URL сайтов, связаны через `company_id` с `clients_requests`.
- **ai_site_prodclass** — классификация продклассов (`prodclass`, `prodclass_score`), ссылка на `pars_site` по `text_pars_id`.
- **ai_site_goods_types** — типы продукции (`goods_type`, `goods_type_ID`, `goods_types_score`, `text_vector`), ссылка на `pars_site.text_par_id`.
- **ai_site_equipment** — подобранное оборудование (`equipment`, `equipment_ID`, `equipment_score`, `text_vector`), ссылка на `pars_site.text_pars_id`.

### Как пополняются таблицы
Эндпоинт `analyze-json` получает JSON c блоками `products`, `equipment`, `prodclass`, `sites` и т.п. Для `equipment` каждая позиция нормализуется в `(name, match_id/equipment_ID, score, vector)` и синхронизируется с `ai_site_equipment`:

1. Сначала подтягиваются существующие строки по `text_pars_id`.
2. Совпадения по `equipment_ID` или имени обновляются.
3. Новые значения вставляются `INSERT INTO public.ai_site_equipment (text_pars_id, equipment, equipment_score, equipment_ID, text_vector) ...`.
4. Лишние строки удаляются `DELETE FROM public.ai_site_equipment WHERE id = :row_id`.

Для блоков `products` и `prodclass` применяется тот же паттерн синхронизации в `ai_site_goods_types` и `ai_site_prodclass`.

### Как собирается ответ для UI
Сервис `analyze_company_by_inn` объединяет данные из всех таблиц:
- домены/описания из `clients_requests` и `pars_site`;
- продукты из `ai_site_goods_types`/`ai_site_prodclass`;
- оборудование из `ai_site_equipment`;
- UTP/письмо из `clients_requests`;
- индустрию — по лучшему `prodclass` или запасному варианту из `okved_main`.

Эндпоинт `GET /lookup/{inn}/ai-analyzer` возвращает уже собранный объект `AiAnalyzerResponse` с полями, которые ожидает карточка:
- `company.domain1/domain2` — описания сайтов;
- `ai.sites` — список URL;
- `ai.products[]` — `AiProduct(name, goods_group, domain, url)`;
- `ai.equipment[]` — `AiEquipment(name, equip_group, domain, url)`;
- `ai.prodclass` — `AiProdclass(id, name, label, score)`;
- `ai.industry`, `ai.utp`, `ai.letter`, `note`.

#### Детальный маппинг полей
- `company.domain1 / company.domain2` — первые две непустые `pars_site.description` по `company_id`; если описаний меньше, добираются `site_1_description / site_2_description` из `clients_requests`.
- `ai.sites` — из `clients_requests.domain_1/domain_2` + всех `pars_site.url/domain_1`, нормализуются в HTTPS и уникализируются.
- `company.domain1_site / company.domain2_site` — первые два элемента списка сайтов (`ai.sites`), могут быть пустыми при отсутствии валидных доменов.
- `ai.products` — строки `ai_site_goods_types`, связанные через `pars_site.company_id`, отсортированы по `goods_types_score`; дополняются `goods_lookup` при наличии. В ответ добавлен `tnved_code` (берётся из `goods_type_id`/`goods_type_ID` или справочника), чтобы карточка сразу показывала код ТНВЭД.
- `ai.prodclass` — строки `ai_site_prodclass` по тем же сайтам, сортировка по `prodclass_score`; при необходимости название подтягивается из `ib_prodclass`. Возвращается `description_okved_score` — коэффициент похожести описания сайта и ОКВЭД (0–1 или проценты), вычисляемый при разборе `analyze-json` и сохраняемый в таблице, если колонка есть.
- `ai.equipment` — строки `ai_site_equipment` по `company_id`, сортировка по `equipment_score`, нормализация и ограничение `_MAX_EQUIPMENT=100`.
- `ai.industry` — сначала лучшая `prodclass` → индустрия; иначе `clients_requests.okved_main`; затем фоллбек `dadata_result.main_okved` (Bitrix → Postgres) и перевод через `_okved_to_industry`; при отсутствии данных поле пустое.
- `ai.utp` — напрямую `clients_requests.utp`, при пустом значении — прочерк в ответе.
- `ai.letter` — напрямую `clients_requests.pismo`, пустое значение не показывается.
- `note` — текстовый список источников (`clients_requests`, `pars_site`, `ai_site_goods_types`, `ai_site_prodclass`, `ai_site_equipment`, `dadata_result`); если ничего не найдено — `no sources found`.

### Поля карточки и ожидаемые источники
Ниже — расшифровка блоков из карточки AI-анализатора и то, откуда берутся значения (все поля читает готовый payload, перерасчёта при открытии нет):

1. **Уровень соответствия и найденный класс предприятия.** Лучший `ai.prodclass` по максимальному `prodclass_score` (`score` → уровень, `label/name` → название класса). Если таблица пуста, блок остаётся пустым.
2. **Домен для парсинга.** Первый валидный домен из `ai.sites` (нормализованные `clients_requests.domain_1/2` + `pars_site.url/domain_1`). При отсутствии доменов значение `—`.
3. **Соответствие ИИ-описания сайта и ОКВЭД.** `ai.prodclass.description_okved_score` — коэффициент сходства описания сайта и ОКВЭД (0–1, часто показывается в процентах). Если нет продкласса или колонки, выводится пусто.
4. **ИИ-описание сайта.** `company.domain1/domain2` — два последних описания сайтов из `pars_site`, с фолбеком на `site_1/2_description` из `clients_requests`.
5. **Топ-10 оборудования.** `ai.equipment[]`, отсортированный по `equipment_score` и ограниченный 100 строками. Если нужен именно топ-10, обрезается на фронте.
6. **Виды найденной продукции на сайте и ТНВЭД.** `ai.products[]` с названием продукции/группы и `tnved_code` из `goods_type_id` или справочника; сортировка по `goods_types_score`, лимит 100 строк.

### Что не пересчитывается
- Эндпоинт `/v1/lookup/{inn}/ai-analyzer` не триггерит новый анализ и не обращается к внешним сервисам: он только читает сохранённые строки. Пустые таблицы = пустые поля.
- UTP, письмо, домены и оборудование/продукты берутся только из перечисленных таблиц; отсутствие данных в `clients_requests` или `ai_site_*` не компенсируется внешними источниками.

### Проверка содержимого вручную
1. Найти `company_id` по ИНН: `SELECT id FROM public.clients_requests WHERE inn=:inn ORDER BY COALESCE(ended_at, created_at) DESC NULLS LAST LIMIT 1;`.
2. Получить сайты/описания: `SELECT * FROM public.pars_site WHERE company_id=:company_id ORDER BY created_at DESC;`.
3. Продукты: `SELECT * FROM public.ai_site_goods_types JOIN public.pars_site ON ... WHERE company_id=:company_id ORDER BY goods_types_score DESC;`.
4. Продклассы: `SELECT * FROM public.ai_site_prodclass JOIN public.pars_site ON ... WHERE company_id=:company_id ORDER BY prodclass_score DESC;`.
5. Оборудование: `SELECT * FROM public.ai_site_equipment JOIN public.pars_site ON ... WHERE company_id=:company_id ORDER BY equipment_score DESC;`.
