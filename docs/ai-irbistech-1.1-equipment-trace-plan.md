# AI IRBISTECH 1.1: Frontend Trace and UI Plan

## Purpose

This document is the working implementation plan for the `AI IRBISTECH 1.1` technical assignment inside `library`.

The main frontend goal is not to recalculate scores in the UI, but to show the backend scoring truth correctly:

```text
FINAL = VECTOR x GEN
GEN = clean_score
```

The critical correction is that equipment trace in the UI must be built from the winning path only.

If an item wins through `3way`, the UI must not keep `factor` or `gen_score` from `1way`.
If an item wins through `2way`, the UI must not keep site trace from `3way`.

## Current Status (2026-04-23)

Done in code and verified:

- `normalizeEquipmentTracePayload()` was rewritten to winner-path logic
- trace fields now come only from the winning path:
  - `1way` -> `1way` detail only
  - `2way` -> `2way` detail only
  - `3way` -> `3way` detail only plus raw best site match text/score
- raw site score in the equipment card now uses only `matched_site_equipment_score`
- product trace now prefers `gen_score` over legacy `db_score/crore_3` fallback semantics
- frontend tests were updated and pass locally:
  - `npm test` -> `72 passed`
- local production build was verified:
  - `npm run build` -> success
- image API routes were marked dynamic so production build no longer emits a false `Dynamic server usage` warning for `/api/images/proxy`
- Bitrix24 client config is now read lazily, so production build no longer emits missing `B24_WEBHOOK_URL` / `B24_PORTAL_ORIGIN` warnings unless B24 API is actually called
- Browserslist data was refreshed in `package-lock.json` to `caniuse-lite@1.0.30001790`, so production build no longer emits the outdated `caniuse-lite` warning
- browser-level smoke was added with Playwright:
  - `scripts/test-ai-analysis-ui-smoke.ts`
  - `npm run test:ui:smoke`
  - stable UI selectors were added for login and AI Analysis entry points
  - screenshot artifacts are written to `artifacts/ai-analysis-ui-smoke/`
- repeatable authenticated browser QA artifact capture was added for target trace cases:
  - `lib/ai-analysis-ui-qa.ts`
  - `scripts/test-ai-analysis-ui-qa.ts`
  - `npm run test:ui:qa`
  - stable UI selectors were added for AI Analysis filters and the equipment list
  - screenshot and JSON artifacts are written to `artifacts/ai-analysis-ui-qa/`
- standalone monitoring wrapper was added for authenticated browser QA:
  - `lib/ai-analysis-ui-qa-healthcheck.ts`
  - `scripts/ai-analysis-ui-qa-healthcheck.ts`
  - `npm run ui:qa:healthcheck`
  - `deploy/systemd/ai-analysis-ui-qa-healthcheck.service`
  - `deploy/systemd/ai-analysis-ui-qa-healthcheck.timer`
  - timestamped and `latest.json` artifacts are written to `/var/lib/library/ai-analysis-ui-qa-health/`
  - optional webhook alerts are supported through `AI_ANALYSIS_UI_QA_HEALTH_ALERT_WEBHOOK_URL`
- standalone monitoring wrapper was added for browser-level smoke:
  - `lib/ai-analysis-ui-smoke.ts`
  - `lib/ai-analysis-ui-smoke-healthcheck.ts`
  - `scripts/ai-analysis-ui-smoke-healthcheck.ts`
  - `npm run ui:smoke:healthcheck`
  - `deploy/systemd/ai-analysis-ui-smoke-healthcheck.service`
  - `deploy/systemd/ai-analysis-ui-smoke-healthcheck.timer`
  - optional webhook alerts are supported through `AI_ANALYSIS_UI_SMOKE_HEALTH_ALERT_WEBHOOK_URL`
- cross-service health diagnostics were added for `library -> postgres/bitrix -> ai-integration`:
  - `app/api/health/route.ts`
  - `lib/library-system-health.ts`
  - `scripts/test-library-system-health-smoke.ts`
  - `npm run test:health:smoke`
- standalone monitoring wrapper was added for `GET /api/health`:
  - `lib/library-system-healthcheck.ts`
  - `scripts/library-system-healthcheck.ts`
  - `npm run healthcheck`
  - `deploy/systemd/library-system-healthcheck.service`
  - `deploy/systemd/library-system-healthcheck.timer`
  - optional webhook alerts are supported through `LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL`
- repeatable acceptance QA was added for live `1way/2way/3way/okved` trace semantics:
  - `lib/ai-analysis-acceptance-qa.ts`
  - `scripts/test-ai-analysis-acceptance-qa.ts`
  - `npm run test:acceptance:qa`
  - JSON artifacts are written to `artifacts/ai-analysis-acceptance-qa/`
- standalone monitoring wrapper was added for live trace acceptance QA:
  - `lib/ai-analysis-acceptance-healthcheck.ts`
  - `scripts/ai-analysis-acceptance-healthcheck.ts`
  - `npm run acceptance:healthcheck`
  - `deploy/systemd/ai-analysis-acceptance-healthcheck.service`
  - `deploy/systemd/ai-analysis-acceptance-healthcheck.timer`
  - optional webhook alerts are supported through `AI_ANALYSIS_ACCEPTANCE_HEALTH_ALERT_WEBHOOK_URL`
- production rollout helper was added for the current VPS layout:
  - `deploy/library-rollout.sh`
  - the helper verifies `/opt/library/app`, repairs `node_modules` from `package-lock.json`, runs tests/build, restarts services, waits for health readiness, and runs trace-acceptance smoke checks
  - browser-level smoke is now auto-included in rollout when Playwright Chromium is available
  - authenticated browser QA artifact capture is now auto-included in rollout when Playwright Chromium and worker credentials are available
  - can install/update repo-managed monitoring units before restart via `LIBRARY_ROLLOUT_INSTALL_SYSTEMD=auto|always|never`
  - local validation can now skip dependency reinstall through `LIBRARY_ROLLOUT_SKIP_INSTALL=1`
  - rollout now loads `/etc/default/library-monitoring` via `LIBRARY_ROLLOUT_MONITORING_ENV_FILE`, so smoke/QA/acceptance commands can reuse the same operational credentials and base URLs
- standalone systemd installer was added for first-time monitoring rollout:
  - `deploy/install-library-systemd-units.sh`
  - copies repo-managed monitoring units into `/etc/systemd/system`
  - installs `deploy/systemd/library-monitoring.env.example` into `/etc/default/library-monitoring.example`
  - can bootstrap `/etc/default/library-monitoring` without overwriting an existing file
  - automated tests now verify env-template coverage, shared `EnvironmentFile`, and installer bootstrap references
  - keeps `ai-analysis-ui-smoke-healthcheck.timer` disabled until Playwright Chromium is available on the server
  - keeps `ai-analysis-ui-qa-healthcheck.timer` disabled until worker credentials are present in `/etc/default/library-monitoring`
  - local verification after env-template coverage tests:
    - `npm test` -> `72 passed`
  - runs `systemctl daemon-reload`
  - enables monitoring timers
- local acceptance QA was verified against production:
  - `npm run test:acceptance:qa` -> success
  - `1841109992` confirms `okved` / `1way`
  - `6320002223` confirms `2way` product trace
  - `3444070534` confirms `3way` row semantics and raw site score
- public browser smoke was verified against production:
  - `https://ai.irbistech.com/` redirects to `/login`
  - login page screenshot artifact was captured successfully
- public health smoke was verified against production:
  - `https://ai.irbistech.com/api/health` returns `200`
  - `severity=ok`
  - `main_db`, `bitrix_db`, `ai_integration`, and `analysis_score_sync` are all green
- the score breakdown in the equipment card was reduced to `VECTOR / GEN / K / FINAL`
- `GEN` keeps backward-compatible fallback to legacy `bd_score` when older payloads are opened
- equipment card display semantics were extracted into a pure helper:
  - `lib/ai-analysis-equipment-card-view.ts`
  - card-level render-contract tests now cover `1way`, `2way`, `3way`, `okved`, and legacy fallback payloads
- production rollout was completed:
  - repository was updated on the server
  - current production `library` code was rolled out from commit `e98f55b`
  - server-side npm cache was cleaned after `TAR_ENTRY_ERROR` warnings
  - server-side node_modules were repaired with `env -u NODE_ENV npm ci --include=dev --ignore-scripts --no-audit --no-fund --prefer-online`
  - repeatable rollout is now captured in `deploy/library-rollout.sh`
  - `deploy/library-rollout.sh` was executed successfully on production after adding health readiness retry
  - server-side `npm test` completed successfully (`58 passed`)
  - production `next build` completed successfully
  - production `next build` no longer emits the previous `/api/images/proxy` dynamic-server warning
  - production `next build` no longer emits missing Bitrix24 webhook/origin warnings during static analysis
  - production `next build` no longer emits the outdated Browserslist/caniuse-lite warning
  - `library.service` restarted successfully
- standalone `/api/health` monitoring was deployed to production:
  - `library-system-healthcheck.timer` is enabled and active
  - `library-system-healthcheck.service` runs successfully
  - state file is written to `/var/lib/library/library-system-health-state.json`
  - `/etc/default/library-monitoring` is configured without a webhook destination
- standalone trace acceptance monitoring was deployed to production:
  - `ai-analysis-acceptance-healthcheck.timer` is enabled and active
  - `ai-analysis-acceptance-healthcheck.service` runs successfully
  - state file is written to `/var/lib/library/ai-analysis-acceptance-health-state.json`
  - JSON artifacts are written to `/var/lib/library/ai-analysis-acceptance-health/`
  - `/etc/default/library-monitoring` is configured without a webhook destination
- production smoke checks were completed for:
  - `1way` / `okved`
  - `2way` / product
  - `3way` / site
  - `analysis_score` API sorting
  - public root responds with `307 -> /login` for unauthenticated access as expected
  - public `https://ai.irbistech.com/api/health` responds with `ok=true`
  - production `npm run test:acceptance:qa` responds with `ok=true`
  - production `npm run acceptance:healthcheck` responds with `ok=true`
  - `okved` trace now returns readable `origin_name="Подбор по ОКВЭД"`

Not done or intentionally deferred:

- no dedicated worker smoke account is configured yet for authenticated browser-level QA in production, so the new `npm run test:ui:qa` flow and rollout-integrated UI QA step cannot be live-verified there yet
- screenshot and acceptance artifacts are generated on demand and gitignored; there is still no committed visual acceptance baseline in the repository
- the repository now has a systemd-ready alert consumer for browser-level smoke, but a real external webhook destination is still not configured
- the repository now has a systemd-ready alert consumer for authenticated browser QA, but a real external webhook destination is still not configured
- the repository now has a systemd-ready alert consumer for `GET /api/health`, but a real external webhook destination is still not configured
- the repository now has a systemd-ready alert consumer for live trace acceptance QA, but a real external webhook destination is still not configured

## Source of Truth

The frontend plan depends on the backend migration described in the `AI IRBISTECH 1.1` technical assignment.

Expected backend semantics after the backend release:

- `equipment_all[].score` is the final winning score
- `equipment_all[].source` is the winning path
- `1way` details expose:
  - `vector_score`
  - `gen_score`
  - `final_score`
- `2way` details expose:
  - `vector_score`
  - `gen_score`
  - `final_score`
- `3way` details expose:
  - raw `equipment_score`
  - `vector_score`
  - `gen_score`
  - `final_score`

## Repository Scope

This technical assignment affects this repository in four main places:

1. trace normalization in `lib/ai-analysis-equipment-trace.ts`
2. equipment card rendering in `components/library/ai-company-analysis-tab.tsx`
3. product trace mapping in `lib/ai-analysis-product-trace.ts`
4. frontend tests in `tests/`

It does not require route changes in:

- `app/api/ai-analysis/companies/route.ts`
- `app/api/ai-analysis/queue/route.ts`

Those routes already support `analysis_score` as an optional field. They only need smoke verification after backend rollout.

## High-Level Target State

After the migration, the frontend must satisfy all of the following:

- trace is built from the winner path only
- raw site match score is shown as raw site score, not as factor-adjusted vector score
- breakdown in the equipment card visually matches `FINAL = VECTOR x GEN`
- `GEN` is understood as `clean_score`
- `analysis_score` is visible and sortable once backend and DB are updated

## Current Code Entry Points

Main implementation surface:

- `lib/ai-analysis-equipment-trace.ts`
- `components/library/ai-company-analysis-tab.tsx`
- `lib/ai-analysis-product-trace.ts`
- `tests/ai-analysis-equipment-trace.test.ts`
- `tests/ai-analysis-product-trace.test.ts`

## Delivery Strategy

Recommended implementation order:

1. rewrite trace normalization first
2. then update card rendering
3. then update product trace
4. then rewrite tests to reflect winner-path semantics
5. finally run smoke checks against live payload shape

Do not start from UI cosmetics. The core issue is incorrect data mixing before rendering.

## Workstream 1: Winner-Path Trace Normalization

### 1.1 Replace merge-by-fill logic with winner-path logic

File:

- `lib/ai-analysis-equipment-trace.ts`

Function:

- `normalizeEquipmentTracePayload()`

Current problem:

- the function starts with `equipment_all`
- then incrementally mixes fields from `1way`, `2way`, `3way`, and `site_equipment`
- many fields are filled with "if empty" rules
- this allows a winning `3way` row to display `factor`, `gen_score`, or path metadata from `1way`

Required target behavior:

- build separate lookup maps:
  - `oneWayById`
  - `twoWayById`
  - `threeWayById`
  - `bestSiteEquipmentById`
- for each `equipment_all` row:
  - inspect `final_source`
  - choose one path detail source only
  - populate score trace from that path only

Required winner mapping:

- `1way` winner -> read only from `oneWayById`
- `2way` winner -> read only from `twoWayById`
- `3way` winner -> read only from `threeWayById`

Allowed supplemental data:

- `2way` winner may additionally use `goods_type_name` to set `matched_product_name`
- `3way` winner may additionally use `bestSiteEquipmentById` to set:
  - `matched_site_equipment`
  - `matched_site_equipment_score`

Disallowed behavior:

- do not mix scoring inputs from multiple path families
- do not populate `gen_score` for `3way` from `1way`
- do not populate `factor` for `2way` from `1way`
- do not overwrite winner-path semantics just because another path has a non-null field

### 1.2 Define exact trace field ownership

File:

- `lib/ai-analysis-equipment-trace.ts`

Required field ownership:

For a `1way` winner:

- `final_score` <- `equipment_all.score`
- `final_source` <- `equipment_all.source`
- `vector_score` <- `1way_detail.vector_score`
- `gen_score` <- `1way_detail.gen_score`
- `bd_score` <- `1way_detail.db_score`
- `factor` <- `1way_detail.factor`
- `calculation_path` <- `1way_detail.path`
- `origin_kind` <- `okved` or `site` depending on strategy and path

For a `2way` winner:

- `final_score` <- `equipment_all.score`
- `final_source` <- `equipment_all.source`
- `vector_score` <- `2way_detail.vector_score`
- `gen_score` <- `2way_detail.gen_score`
- `bd_score` <- `2way_detail.db_score`
- `factor` <- `2way_detail.factor`
- `calculation_path` <- `2way`
- `matched_product_name` <- goods type name from the winning detail
- `origin_kind` <- `product`

For a `3way` winner:

- `final_score` <- `equipment_all.score`
- `final_source` <- `equipment_all.source`
- `vector_score` <- `3way_detail.vector_score`
- `gen_score` <- `3way_detail.gen_score`
- `bd_score` <- `3way_detail.db_score`
- `factor` <- `3way_detail.factor`
- `calculation_path` <- `3way`
- `matched_site_equipment` <- best site equipment match text
- `matched_site_equipment_score` <- best raw site score
- `origin_kind` <- `site`

Implementation note:

- `final_score` should still prefer `equipment_all.score`, because it reflects the merged winner result
- path detail should explain the winner, not redefine the winner

### 1.3 Preserve `okved` source labeling

File:

- `lib/ai-analysis-equipment-trace.ts`

Required behavior:

- when `selection_strategy === 'okved'` and the winning path is `1way`
  - `origin_kind` must remain `okved`
  - `origin_name` should keep the existing label for OKVED-driven selection

Important nuance:

- `origin_kind = okved` does not mean `gen_score = SCORE_1`
- after the backend change, `gen_score` must still be `clean_score`

## Workstream 2: Equipment Card Rendering

### 2.1 Show raw site score correctly

File:

- `components/library/ai-company-analysis-tab.tsx`

Relevant UI area:

- equipment card list in the AI company analysis tab

Current problem:

- site score label falls back to `vector_score`
- after the backend migration, `vector_score` in `3way` is already factor-adjusted
- that is not the same thing as "found on site" raw confidence

Required change:

- render site score using only:
  - `trace?.matched_site_equipment_score`
- remove fallback to:
  - `trace?.vector_score`

Expected result:

- if a raw site match exists, show it
- if a raw site match does not exist, do not silently display vector score as site score

### 2.2 Align breakdown with the formula

File:

- `components/library/ai-company-analysis-tab.tsx`

Current problem:

- the card shows `BD_SCORE`, `VECTOR`, `GEN`, `K`, `FINAL`
- after the backend change, `BD_SCORE` and `GEN` refer to the same business concept in practice: `clean_score`
- keeping both risks confusing users

Required target:

- breakdown should visually communicate:
  - `VECTOR`
  - `GEN`
  - `K`
  - `FINAL`

Recommended implementation:

- remove the separate `BD_SCORE` line from the card

Acceptable fallback option:

- if there is a strong reason to keep it, rename `BD_SCORE` to `CLEAN_SCORE`
- but do not display both `BD_SCORE` and `GEN` if they show the same meaning

### 2.3 Keep display priorities stable

File:

- `components/library/ai-company-analysis-tab.tsx`

Required checks:

- the score badge should still render from `trace.final_score ?? item.score`
- the explanatory subtitle should prefer:
  - matched product name for `2way`
  - matched site equipment for `3way`
  - okved label for `okved`-driven `1way`

No new visual redesign is required here. The task is correctness of semantics.

## Workstream 3: Product Trace Consistency

### 3.1 Fix linked-equipment `db_score`

File:

- `lib/ai-analysis-product-trace.ts`

Current problem:

- linked equipment entries may still resolve `db_score` from legacy fallback order
- after the backend change, `db_score` must show `clean_score`

Required change:

- when building linked equipment rows, resolve:

```text
db_score = gen_score ?? db_score ?? crore_3 ?? CRORE_3
```

Expected result:

- product trace cards show `clean_score` semantics consistently
- `2way` linked equipment no longer implies the old `equipment_score` math

### 3.2 Verify top-equipment ordering still uses final score

File:

- `lib/ai-analysis-product-trace.ts`

Required checks:

- linked equipment ranking must continue to compare `final_score`
- no ranking branch should sort by `db_score`, `vector_score`, or raw goods score by mistake

## Workstream 4: API Smoke Verification

No code changes are required up front in:

- `app/api/ai-analysis/companies/route.ts`
- `app/api/ai-analysis/queue/route.ts`

But after backend rollout, perform smoke verification for:

- `analysis_score` field presence in the API payload
- sorting by `analysis_score_desc`
- correct fallback behavior when old rows still do not have `analysis_score`

Expected result:

- once the backend and DB migration are deployed, the library API should start returning `analysis_score` automatically through the optional column machinery

## Workstream 5: Tests

### 5.0 Add explicit card-view render contract coverage

Files:

- `lib/ai-analysis-equipment-card-view.ts`
- `tests/ai-analysis-equipment-card-view.test.ts`

Required outcome:

- the equipment card display rules are testable without rendering the whole `ai-company-analysis-tab.tsx`
- UI semantics for winner-path traces are pinned in one pure helper
- regressions like "site score accidentally equals vector score" are caught before manual QA

Covered cases:

- `3way` winner uses raw site score for the "found on site" badge
- `2way` winner shows product context and `GEN = clean_score`
- legacy payload without `gen_score` falls back to `bd_score`
- `okved` badge keeps correct context text
- card still renders stable values when trace is absent

### 5.1 Rewrite equipment trace tests around winner-path behavior

File:

- `tests/ai-analysis-equipment-trace.test.ts`

Required test updates:

- winning `3way` row must take:
  - `factor`
  - `vector_score`
  - `gen_score`
  - `final_score`
  from `3way`, not from `1way`
- winning `2way` row must expose:
  - `gen_score = clean_score`
  - `bd_score = clean_score`
- `okved` strategy must keep:
  - `origin_kind = okved`
  while still using:
  - `gen_score = clean_score`

Recommended new test cases:

- same `equipment_id` appears in all three paths, winner is `3way`
- same `equipment_id` appears in `1way` and `2way`, winner is `2way`
- equal final score tie uses `final_source` from backend and frontend respects it
- `3way` row has no site match text, but still renders clean scoring values without fake site score

### 5.2 Update product trace tests

File:

- `tests/ai-analysis-product-trace.test.ts`

Required test updates:

- linked equipment `db_score` must resolve to `clean_score`
- linked equipment ordering must remain based on `final_score`
- payloads using new explicit `gen_score` should win over older legacy fallback fields

## Workstream 6: Manual QA Checklist

### 6.0 Add browser-level smoke and artifact generation

Files:

- `scripts/test-ai-analysis-ui-smoke.ts`
- `app/login/page.tsx`
- `app/(protected)/library/LibraryClient.tsx`
- `components/library/ai-company-analysis-tab.tsx`

Required outcome:

- the repository has a repeatable browser-level smoke for the AI Analysis UI
- smoke can run in public mode without credentials and verify the `/login` redirect path
- smoke can optionally run in authenticated worker mode when `AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD` are provided
- screenshots and JSON summary are stored outside git in `artifacts/ai-analysis-ui-smoke/`

Covered flow:

- open public root and verify redirect to `/login`
- verify login form is rendered
- if worker credentials exist:
  - sign in through the real login form
  - open `/library?tab=aianalysis`
  - verify the company table is rendered
  - open company details dialog
  - verify the equipment section is visible

### 6.1 Add repeatable authenticated browser QA artifact capture

Files:

- `lib/ai-analysis-ui-qa.ts`
- `scripts/test-ai-analysis-ui-qa.ts`
- `tests/ai-analysis-ui-qa.test.ts`
- `components/library/ai-company-analysis-tab.tsx`

Required outcome:

- the repository has a repeatable browser QA runner for target `okved/1way`, `2way`, and `3way` cases
- the runner signs in through the real login form and opens the real AI Analysis UI
- the runner filters the company table by INN using stable selectors instead of fragile text matching
- each case stores row, dialog, and equipment screenshots outside git
- each case stores `companies`, `equipment-trace`, and `product-trace` JSON payloads for the same INN
- each case reuses acceptance semantics and fails if the winning path or formula expectations are broken

Operational command:

```bash
npm run test:ui:qa
```

Credential note:

- the script requires `AI_ANALYSIS_UI_QA_LOGIN/PASSWORD`
- if dedicated QA credentials are not set, it falls back to `AI_ANALYSIS_UI_SMOKE_LOGIN/PASSWORD`

### 6.2 Add repeatable trace acceptance QA

Files:

- `lib/ai-analysis-acceptance-qa.ts`
- `scripts/test-ai-analysis-acceptance-qa.ts`
- `tests/ai-analysis-acceptance-qa.test.ts`

Required outcome:

- live trace semantics for known `1way`, `2way`, `3way`, and `okved` cases can be checked without a browser
- the script validates `FINAL = VECTOR x GEN`
- the script validates `GEN = clean_score` through `gen_score ~= bd_score`
- the script catches winner-path leakage:
  - `2way` rows should not borrow site matches
  - `3way` rows should not borrow product matches
  - `okved` rows should not borrow site/product matches
- the script writes a JSON summary artifact outside git

Operational command:

```bash
npm run test:acceptance:qa
```

Default production cases:

- `1841109992` -> `okved` / `1way`
- `6320002223` -> `site` / `2way`
- `3444070534` -> `site` / `3way` row presence and raw site score

After implementation, verify the following in the running UI:

1. a `3way` winner shows:
   - final score from `equipment_all`
   - raw site match score in the "found on site" label
   - `VECTOR`, `GEN`, `K`, `FINAL` consistent with the winning `3way` detail
2. a `2way` winner shows:
   - matched product name
   - `GEN = clean_score`
   - no leakage from `1way` path
3. an `okved`-driven `1way` winner shows:
   - `origin_kind = okved`
   - `GEN = clean_score`
4. the list sorted by analysis score still behaves correctly after backend rollout

## Workstream 7: Cross-Service Health Diagnostics

### 7.0 Add a single health endpoint for the live service chain

Files:

- `app/api/health/route.ts`
- `lib/library-system-health.ts`
- `scripts/test-library-system-health-smoke.ts`
- `tests/library-system-health.test.ts`

Required outcome:

- one unauthenticated route returns the current health summary for the live `library` dependency chain
- the route checks:
  - main PostgreSQL
  - `bitrix_data` PostgreSQL
  - `ai-integration /health`
  - optional `analysis-score-sync-health` inside `ai-integration`
- required dependency failures return `HTTP 503`
- optional diagnostic failures degrade the payload semantics without hiding the main service state

Required payload semantics:

- top-level `ok=true` means all required dependencies are healthy
- top-level `severity` is:
  - `ok` when everything is healthy
  - `degraded` when only optional diagnostics fail
  - `failed` when a required dependency fails
- each service entry keeps:
  - `required`
  - `status`
  - `detail`
  - `latencyMs`

Smoke verification:

- `npm run test:health:smoke` must call `/api/health`
- the smoke output must print a compact JSON summary for CI/manual use
- production verification should confirm the route can be called without authentication and reports the current dependency states

### 7.1 Add standalone monitoring for `/api/health`

Files:

- `lib/library-system-healthcheck.ts`
- `scripts/library-system-healthcheck.ts`
- `tests/library-system-healthcheck.test.ts`
- `deploy/systemd/library-system-healthcheck.service`
- `deploy/systemd/library-system-healthcheck.timer`

Required outcome:

- the library service chain can be monitored without a browser or CI runner
- the command returns exit code `0` only when `/api/health` reports `ok=true`
- the command writes a local state file to deduplicate repeated unhealthy alerts
- optional webhook notifications are sent on unhealthy transitions and recovery
- systemd timer templates are present for VPS deployment

Operational command:

```bash
npm run healthcheck -- --json
```

Environment variables:

- `LIBRARY_SYSTEM_HEALTH_URL`
- `LIBRARY_SYSTEM_HEALTH_TIMEOUT_MS`
- `LIBRARY_SYSTEM_HEALTH_ALERT_WEBHOOK_URL`
- `LIBRARY_SYSTEM_HEALTH_ALERT_ON_RECOVERY`
- `LIBRARY_SYSTEM_HEALTH_STATE_FILE`

### 7.2 Add standalone monitoring for live trace acceptance QA

Files:

- `lib/ai-analysis-acceptance-healthcheck.ts`
- `scripts/ai-analysis-acceptance-healthcheck.ts`
- `tests/ai-analysis-acceptance-healthcheck.test.ts`
- `deploy/systemd/ai-analysis-acceptance-healthcheck.service`
- `deploy/systemd/ai-analysis-acceptance-healthcheck.timer`

Required outcome:

- live `1way`, `2way`, `3way`, and `okved` trace semantics can be monitored without a browser or CI runner
- the command returns exit code `0` only when `/api/health` is healthy and all acceptance cases pass
- the command writes a local state file to deduplicate repeated unhealthy alerts
- timestamped and `latest.json` artifacts are written outside git for operational inspection
- optional webhook notifications are sent on unhealthy transitions and recovery
- systemd timer templates are present for VPS deployment

Operational command:

```bash
npm run acceptance:healthcheck -- --json
```

Environment variables:

- `AI_ANALYSIS_ACCEPTANCE_HEALTH_BASE_URL`
- `AI_ANALYSIS_ACCEPTANCE_HEALTH_TIMEOUT_MS`
- `AI_ANALYSIS_ACCEPTANCE_HEALTH_ALERT_WEBHOOK_URL`
- `AI_ANALYSIS_ACCEPTANCE_HEALTH_ALERT_ON_RECOVERY`
- `AI_ANALYSIS_ACCEPTANCE_HEALTH_STATE_FILE`
- `AI_ANALYSIS_ACCEPTANCE_HEALTH_ARTIFACT_DIR`

## Risks and Review Points

### Risk 1: Hidden data mixing survives the refactor

Common failure mode:

- one helper still fills missing values from another path after the winner-path rewrite

Review every "if null then fallback" rule carefully.

### Risk 2: Site score label shows the wrong number

Common failure mode:

- raw site score label still falls back to `vector_score`

This must be removed.

### Risk 3: UI continues to present duplicate business concepts

Common failure mode:

- `BD_SCORE` and `GEN` both remain visible with the same meaning

This makes the scoring card harder to trust.

### Risk 4: Frontend tests still encode legacy semantics

Common failure mode:

- tests continue asserting old values like:
  - `gen_score = score_1`
  - `vector_score = raw site score`

These expectations must be rewritten after the backend contract changes.

## Definition of Done

This frontend task is complete only when all statements below are true:

- trace is built strictly from the winning path
- no path mixes scoring inputs from another path
- raw site score is shown only as raw site score
- breakdown visually matches `FINAL = VECTOR x GEN`
- `GEN` reflects `clean_score`
- tests are updated and passing
- browser-level smoke exists for `/login` and `AI Analysis`
- repeatable browser QA artifact capture exists for targeted `okved/1way`, `2way`, and `3way` cases
- trace acceptance QA exists for live `1way/2way/3way/okved` semantics
- cross-service health route exists for `library -> ai-integration -> DB`
- standalone healthcheck exists for `/api/health` and can be used by systemd/cron
- standalone healthcheck exists for authenticated browser QA and can be used by systemd/cron
- standalone healthcheck exists for browser-level smoke and can be used by systemd/cron
- standalone healthcheck exists for live trace acceptance QA and can be used by systemd/cron
- `analysis_score` smoke verification succeeds after backend rollout

## Implementation Checklist

- [x] Replace merge-by-fill trace normalization with winner-path normalization
- [x] Build path-specific lookup maps in `normalizeEquipmentTracePayload()`
- [x] Keep `okved` origin labeling while using `clean_score` semantics
- [x] Stop using `vector_score` as fallback for raw site score display
- [x] Simplify score breakdown to `VECTOR`, `GEN`, `K`, `FINAL`
- [x] Add pure equipment-card render contract helper and tests
- [x] Update product trace `db_score` resolution
- [x] Rewrite equipment trace tests
- [x] Rewrite product trace tests
- [x] Add browser-level smoke script for `/login` and `AI Analysis`
- [x] Add repeatable browser QA artifact capture for `1way`, `2way`, `3way`, and `okved` cases
- [x] Add live trace acceptance QA for `1way`, `2way`, `3way`, and `okved`
- [x] Add cross-service `/api/health` diagnostics and smoke script
- [x] Add standalone `/api/health` monitoring script and systemd timer templates
- [x] Add standalone authenticated browser QA monitoring script and systemd timer templates
- [x] Add standalone browser-level smoke monitoring script and systemd timer templates
- [x] Add standalone trace acceptance monitoring script and systemd timer templates
- [ ] Run manual UI QA on `1way`, `2way`, `3way`, and `okved` cases
- [x] Run API smoke checks for `analysis_score`
