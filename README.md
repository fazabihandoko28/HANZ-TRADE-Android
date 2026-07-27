# HANZ TRADE v2.1

Android home-screen widget plus resilient static data engine.

## Public endpoints
- `/widget-data.json` — values consumed by Android widget
- `/health.json` — market-source health
- `/health.html` — human-readable health page
- `/bei-candidates.json` — candidate output
- `/bei-health.json` — candidate workflow health

## GitHub Actions
1. **Build HANZ-TRADE APK** — builds APK only.
2. **Update HANZ market data** — runs twice hourly, uses multiple providers and last-known-good fallback.
3. **Update HANZ BEI candidates** — normalizes candidate output on weekdays; set repository secret `BEI_CANDIDATES_URL` to a JSON endpoint produced by the HANZ screening engine.

The market workflow fails rather than publishing empty or structurally invalid prices. Source diagnostics are visible in `health.json` and the workflow summary.

## Automation workflows

This repository includes three workflows under `.github/workflows`:

- `Build HANZ-TRADE APK`
- `Update HANZ market data`
- `Update HANZ BEI candidates`

Market data is published as static JSON in `public/widget-data.json`; no Netlify Function is required.
