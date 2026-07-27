# HANZ Trade v1.8 Test Report

## Passed locally
- Node.js syntax validation
- Deterministic parsers for Frankfurter-compatible FX values
- UAE 24K retail parser fixture
- Gold spot USD/oz parser fixture
- Harga-Emas.org ANTAM 1g parser fixture
- Generic ANTAM 1g parser fixture
- ANTAM multi-source outlier rejection
- Candidate ticker sanitation
- Android XML parsing
- Existing JSON syntax
- ZIP integrity

## Live-source safeguards
- FX: Frankfurter primary, ExchangeRate-API open endpoint fallback
- UAE 24K: Dubai retail primary, Gold-API spot fallback, Harga-Emas.org spot fallback
- ANTAM: Harga-Emas.org primary, HargaEmas.com fallback, official Logam Mulia fallback
- Last-known-good retained when every live provider is unavailable
- Per-provider diagnostics written into widget-data.json
- Data status: verified-live, live, or stale

## Environment limitation
The local build environment has no external DNS access and no Android SDK. Actual internet fetches and APK compilation are therefore enforced and tested by GitHub Actions. The updater is designed to survive individual provider failures and only uses stale data when every provider in a group fails.
