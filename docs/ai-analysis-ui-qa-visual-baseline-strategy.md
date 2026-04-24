# AI Analysis UI QA Visual Baseline Strategy

## Goal

The repository keeps a committed, reviewable metadata baseline for the authenticated AI Analysis UI QA flow
without storing large screenshot binaries in git.

The baseline always covers the same three release sentinels:

- `okved-1way`
- `product-2way`
- `site-3way`

## Source Artifacts

Refresh the baseline from a successful QA run produced by one of these commands:

```bash
npm run test:ui:qa
npm run ui:qa:healthcheck -- --json
```

The source must be a real `summary.json` produced by the QA flow. The screenshots and JSON payloads remain
in `artifacts/` locally or under `/var/lib/library/...` on the target server.

## Committed Output

Export committed baseline metadata with:

```bash
npm run ui:qa:baseline -- --summary artifacts/ai-analysis-ui-qa/<run-id>/summary.json
```

By default the command writes:

- `docs/ai-analysis-ui-qa-baseline/latest.json`
- `docs/ai-analysis-ui-qa-baseline/latest.md`

These files are the repository-side source of truth for visual review:

- run id and source summary path
- base URL and auth context
- case-by-case winning path and selection strategy
- relative screenshot references for row/dialog/equipment captures
- relative JSON payload references for `companies`, `equipment-trace`, and `product-trace`

## Refresh Policy

Refresh and recommit the baseline whenever one of the following changes:

- user-visible equipment card semantics
- dialog structure or labels used in browser QA review
- winner-path presentation for `1way`, `2way`, or `3way`
- screenshot naming or QA artifact layout

No refresh is required for backend-only changes that do not affect browser-visible output.

## Review Rules

- Do not commit raw screenshot binaries into git.
- Keep the generated metadata files human-readable and review them in PRs.
- If the UI changed intentionally, update the baseline in the same change set.
- If the UI changed unintentionally, treat baseline drift as a regression until explained.
