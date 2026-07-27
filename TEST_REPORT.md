# HANZ Trade v1.6 Test Report

Tested on 2026-07-27 before packaging.

## Passed
- Node.js updater syntax and deterministic self-test.
- Full updater execution with controlled live-value fixtures.
- Generated `widget-data.json` schema, four positive prices, percentage changes, and candidate sanitation.
- Seed `widget-data.json` contains non-null usable prices, so the widget does not start blank.
- Android resource XML parsing.
- Endpoint in Android source remains `https://hanz-trade.netlify.app/widget-data.json`.
- Netlify deployment remains static; no Netlify Function or `@netlify/blobs` dependency.
- APK workflow version/name updated to v1.6.

## Live sources configured
- FX: Frankfurter v2 public API.
- UAE 24K: Gulf News table provided by Dubai Gold & Jewellery Group, with last-known-good fallback.
- ANTAM 1g: public Logam Mulia API, then official ANTAM English page fallback, then last-known-good fallback.
- BEI candidates: local JSON, secret list, or remote HANZ candidate endpoint.

## Limitation
The execution environment used for packaging blocks outbound network calls, so external HTTP fetching was verified through source availability and the updater was end-to-end tested with controlled fixtures. GitHub Actions performs the real network run. Crucially, a source outage no longer produces a blank widget because validated last-known-good prices are bundled and retained.
