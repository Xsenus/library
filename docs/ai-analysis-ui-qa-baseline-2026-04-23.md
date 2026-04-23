# AI Analysis UI QA Baseline — 2026-04-23

## Scope

This document captures the authenticated browser QA baseline collected after enabling the production
browser monitoring stack for `library`.

Environment:

- public base URL: `https://ai.irbistech.com`
- local service base on VPS: `http://127.0.0.1:8090`
- VPS: `79.174.94.14`
- server artifact root: `/var/lib/library/ai-analysis-ui-qa-health/2026-04-23T09-55-32-026Z`
- local review copy: `artifacts/ai-analysis-ui-qa-baseline/2026-04-23T09-55-32-026Z`

## Result

The authenticated browser QA run passed end-to-end:

- `npm run ui:smoke:healthcheck -- --base-url http://127.0.0.1:8090 --json` -> `ok=true`
- `npm run ui:qa:healthcheck -- --base-url http://127.0.0.1:8090 --json` -> `ok=true`
- `ai-analysis-ui-smoke-healthcheck.timer` -> `enabled`, `active`
- `ai-analysis-ui-qa-healthcheck.timer` -> `enabled`, `active`

## Cases

### okved / 1way

- INN: `1841109992`
- dialog title: `ЮПИТЕР · ИНН 1841109992`
- strategy: `okved`
- winning path: `1way`
- final score: `0.99`
- visual check: the dialog shows `Подбор по ОКВЭД`, no parsing domain, no site match, and equipment cards use `SCORE_E1` / `Источник: ОКВЭД`

### product / 2way

- INN: `6320002223`
- dialog title: `АВТОВАЗ · ИНН 6320002223`
- strategy: `site`
- winning path: `2way`
- final score: `0.834`
- visual check: equipment cards show product context `Легковые автомобили`, badges `Через продукцию` / `SCORE_E2`, and `GEN` matches clean-score semantics

### site / 3way

- INN: `3444070534`
- dialog title: `ЛУКОЙЛ-НИЖНЕВОЛЖСКНЕФТЬ · ИНН 3444070534`
- strategy: `site`
- winning path: `3way`
- final score: `0.4876`
- matched site equipment: `Oil refining equipment`
- matched site score: `0.53`
- visual check: the winning equipment card keeps the raw site match label `Найдено на сайте: Oil refining equipment (53.0%)`, uses `SCORE_E3`, and preserves `FINAL = VECTOR x GEN`

## Artifacts

The baseline includes:

- `summary.json`
- company-row screenshots
- full dialog screenshots
- equipment-section screenshots
- `companies`, `equipment-trace`, and `product-trace` JSON payloads for every case

Key reviewed screenshots:

- `okved-1way/02-company-dialog.png`
- `product-2way/02-company-dialog.png`
- `site-3way/02-company-dialog.png`

## Notes

- The browser QA regression fixed on this date was a selector mismatch: the Playwright helper typed INN into the responsible-person filter instead of the main company search input.
- Production monitoring currently uses an existing activated worker credential from the app auth store via `/etc/default/library-monitoring`; a dedicated isolated QA account is still an infrastructure improvement, not a code blocker.
- External webhook destinations for browser-monitoring alerts are still not configured.
