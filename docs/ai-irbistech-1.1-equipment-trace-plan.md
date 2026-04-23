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
  - `npm test` -> `31 passed`
- local production build was verified:
  - `npm run build` -> success
- the score breakdown in the equipment card was reduced to `VECTOR / GEN / K / FINAL`
- `GEN` keeps backward-compatible fallback to legacy `bd_score` when older payloads are opened
- production rollout was completed:
  - repository was updated on the server
  - current production `library` runs commit `5ca17fb`
  - missing build-time dev typings were installed on the server (`npm install --include=dev`)
  - production `next build` completed successfully
  - `library.service` restarted successfully
- production smoke checks were completed for:
  - `1way` / `okved`
  - `2way` / product
  - `3way` / site
  - `analysis_score` API sorting
  - public root responds with `307 -> /login` for unauthenticated access as expected

Not done or intentionally deferred:

- no separate visual QA artifact set (screenshots / acceptance sheet) was produced in this iteration

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
- `analysis_score` smoke verification succeeds after backend rollout

## Implementation Checklist

- [x] Replace merge-by-fill trace normalization with winner-path normalization
- [x] Build path-specific lookup maps in `normalizeEquipmentTracePayload()`
- [x] Keep `okved` origin labeling while using `clean_score` semantics
- [x] Stop using `vector_score` as fallback for raw site score display
- [x] Simplify score breakdown to `VECTOR`, `GEN`, `K`, `FINAL`
- [x] Update product trace `db_score` resolution
- [x] Rewrite equipment trace tests
- [x] Rewrite product trace tests
- [ ] Run manual UI QA on `1way`, `2way`, `3way`, and `okved` cases
- [x] Run API smoke checks for `analysis_score`
