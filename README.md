# HANZ-TRADE Android v1.6

Home-screen widget displaying:

- USD/IDR with daily direction and percentage
- AED/IDR with daily direction and percentage
- UAE Gold 24K (AED/gram) with daily direction and percentage
- ANTAM Gold 24K 1 gram with daily direction and percentage
- BEI strong-stock candidates

## Data architecture

The Android widget reads one static file:

`https://hanz-trade.netlify.app/widget-data.json`

GitHub Actions refreshes this file hourly. There are no Netlify Functions or Netlify Blobs.

## Optional GitHub Actions secrets

- `UAE_GOLD_24K_AED`: manual fallback price in AED/gram
- `ANTAM_GOLD_1G_IDR`: manual fallback price for ANTAM 1 gram
- `BEI_STRONG_CANDIDATES`: comma-separated tickers, e.g. `BBRI,ANTM,TLKM`
- `BEI_CANDIDATES_URL`: optional URL containing a candidates array

When a gold source fails, the updater preserves the last-known-good published value. Currency must be available from one of two independent public currency endpoints, or the workflow fails without publishing broken data.
