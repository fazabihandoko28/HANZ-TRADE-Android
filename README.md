# HANZ-TRADE Android

Android app + Home Screen widget for:
- USD/IDR
- AED/IDR
- USD/AED
- Fullscreen dashboard: https://hanz-trade.netlify.app

## Build APK automatically with GitHub
1. Create a new empty GitHub repository.
2. Upload ALL files and folders from this project, including the hidden `.github` folder.
3. Open the repository's **Actions** tab.
4. Open **Build HANZ-TRADE APK**.
5. Press **Run workflow**.
6. After the green check appears, open the run and download artifact **HANZ-TRADE-APK**.
7. Extract it to get `HANZ-TRADE-v1.0.apk`.

## Install on Android
Allow your browser/file manager to install unknown apps, then open the APK.

## Add the widget
Long-press an empty Home Screen area > Widgets > HANZ-TRADE > drag the 4x2 widget.

The widget refreshes automatically about every 30 minutes and also has a manual refresh button.

## HANZ Widget Data Service (v1.2)

The Android widget reads one endpoint:

`https://hanz-trade.netlify.app/widget-data.json`

The repository now includes a Netlify Function that aggregates:

- USD/IDR and AED/IDR from Frankfurter daily institutional reference rates.
- UAE 24K suggested retail gold price from Dubai Jewellery Group.
- ANTAM 1 gram retail price from the official Logam Mulia page.
- BEI strong candidates from the HANZ Intelligence Engine.

### Netlify setup

1. Deploy this repository to the existing `hanz-trade` Netlify site.
2. Build settings are read automatically from `netlify.toml`.
3. Optional environment variable `HANZ_CANDIDATES_URL` should point to the JSON output of the HANZ screening engine. Accepted fields: `bei_candidates`, `candidates`, or `strong_candidates`.
4. Emergency fallback variables are supported if a gold source changes its HTML:
   - `UAE_GOLD_24K_OVERRIDE`
   - `ANTAM_GOLD_1G_OVERRIDE`

The function stores the prior daily snapshot in Netlify Blobs. The widget uses it to display ▲, ▼, or — versus the previous day. On the first day after deployment, changes display as 0.00% until a prior-day snapshot exists.

### BEI fallback

Until `HANZ_CANDIDATES_URL` is configured, edit `public/bei-candidates.json`. The Android APK does not need to be rebuilt when candidates change.

## Production hardening in v1.3

- Each upstream source is isolated: one failed source no longer takes down the entire widget endpoint.
- Last valid values are served from Netlify Blobs when an official page or API is temporarily unavailable.
- The payload includes `stale` and `source_status` so the Android widget can clearly label cached data.
- ANTAM and UAE number parsing are handled separately to avoid decimal/thousands separator errors.
- BEI symbols are normalized, `.JK` is removed, and malformed symbols are rejected.
- APK workflow output is now `HANZ-TRADE-v1.3.apk`.

Deploy the repository to the existing Netlify site and set `HANZ_CANDIDATES_URL` to the live HANZ Intelligence screening output. Until then, `public/bei-candidates.json` remains the fallback source.
