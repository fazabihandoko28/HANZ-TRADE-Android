# HANZ TRADE Android v1.3

Android home-screen widget displaying:

1. USD/IDR with daily direction and percentage
2. AED/IDR with daily direction and percentage
3. UAE Gold 24K (AED/gram) with daily direction and percentage
4. ANTAM Gold 24K 1 gram with daily direction and percentage
5. BEI strong-stock candidates

The Android widget reads one endpoint:

`https://hanz-trade.netlify.app/api/widget-data`

## Netlify environment variables

Optional fallbacks when official gold pages change structure:

- `UAE_GOLD_24K_AED`
- `ANTAM_GOLD_1G_IDR`
- `BEI_STRONG_CANDIDATES` — comma-separated tickers, e.g. `BBRI,ANTM,TLKM`
- `BEI_CANDIDATES_URL` — optional JSON endpoint from the HANZ screening engine

Currency data is fetched automatically. Daily snapshots are stored in Netlify Blobs for up/down comparison.
