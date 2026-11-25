package com.hanztrade.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.DecimalFormat;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

public class CurrencyWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "com.hanztrade.app.REFRESH_WIDGET";
    private static final String DATA_ROOT =
            "https://raw.githubusercontent.com/fazabihandoko28/HANZ-TRADE-Android/main/public/";
    private static final DateTimeFormatter DATA_TIME =
            DateTimeFormatter.ofPattern("dd MMM HH:mm", Locale.ENGLISH).withZone(ZoneId.systemDefault());
    private static final String PREFS = "hanz_widget_cache";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final ExecutorService FETCH_EXECUTOR = Executors.newFixedThreadPool(4);
    private static final long FETCH_TIMEOUT_MS = 7600;
    private static final int GREEN = Color.rgb(45, 196, 125);
    private static final int RED = Color.rgb(255, 92, 106);
    private static final int NEUTRAL = Color.rgb(145, 160, 182);

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        if (appWidgetIds.length == 0) return;
        PendingResult pending = goAsync();
        EXECUTOR.execute(() -> {
            try {
                RemoteViews views = fetchViews(context);
                manager.updateAppWidget(appWidgetIds, views);
            } finally {
                if (pending != null) pending.finish();
            }
        });
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_REFRESH.equals(intent.getAction())) {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, CurrencyWidgetProvider.class));
            onUpdate(context, manager, ids);
        }
    }

    private RemoteViews fetchViews(Context context) {
        RemoteViews views = baseViews(context);
        applyCached(context, views);
        var cache = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String marketDate = cache.getString("market_data_time", "");
        String ihsgDate = cache.getString("ihsg_date", "");
        String marketStatus = "CACHED";
        String ihsgStatus = "CACHED";
        String btcStatus = "CACHED";
        String forecastStatus = "—";

        Future<JSONObject> marketRequest = FETCH_EXECUTOR.submit(
                () -> getJson(DATA_ROOT + "widget-data.json"));
        Future<JSONObject> ihsgRequest = FETCH_EXECUTOR.submit(
                () -> getJson(DATA_ROOT + "ihsg.json"));
        Future<JSONObject> btcRequest = FETCH_EXECUTOR.submit(() -> getJson(
                "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"));
        Future<JSONObject> historyRequest = FETCH_EXECUTOR.submit(() -> getJson(
                "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90"));
        long fetchDeadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(FETCH_TIMEOUT_MS);

        try {
            JSONObject root = awaitJson(marketRequest, fetchDeadline);
            if (root == null || !root.getBoolean("ok")) throw new IllegalStateException("Market feed unavailable");
            Instant snapshot = Instant.parse(root.getString("updated"));
            if (!marketDate.isEmpty() && snapshot.isBefore(Instant.parse(marketDate))) {
                throw new IllegalStateException("Older market snapshot");
            }
            JSONObject usd = root.getJSONObject("usd_idr");
            JSONObject aed = root.getJSONObject("aed_idr");
            JSONObject uaeGold = root.getJSONObject("uae_gold_24k");
            JSONObject antam = root.getJSONObject("antam_gold_1g");
            setMarket(views, R.id.usdIdrValue, R.id.usdIdrChange, usd, "Rp ", 0, context, "usd");
            setMarket(views, R.id.aedIdrValue, R.id.aedIdrChange, aed, "Rp ", 0, context, "aed");
            setMarket(views, R.id.uaeGoldValue, R.id.uaeGoldChange, uaeGold, "AED ", 2, context, "uae_gold");
            setMarket(views, R.id.antamValue, R.id.antamChange, antam, "Rp ", 0, context, "antam");
            String candidates = candidateText(root.optJSONArray("bei_candidates"));
            views.setTextViewText(R.id.beiCandidates, candidates);
            marketDate = snapshot.toString();
            boolean tooOld = snapshot.isBefore(Instant.now().minusSeconds(3 * 60 * 60));
            marketStatus = tooOld ? "STALE" : (root.optBoolean("partial") ? "PARTIAL" : "OK");
            cache.edit().putString("candidates", candidates)
                    .putString("market_data_time", marketDate).apply();
        } catch (Exception ignored) {
            marketStatus = "CACHED";
        }

        try {
            JSONObject index = awaitJson(ihsgRequest, fetchDeadline);
            if (index == null) throw new IllegalStateException("IHSG feed unavailable");
            LocalDate date = LocalDate.parse(index.getString("market_date"));
            double close = index.getDouble("close");
            double change = index.getDouble("change_pct");
            if (!Double.isFinite(close) || close <= 0 || !Double.isFinite(change)
                    || (!ihsgDate.isEmpty() && date.isBefore(LocalDate.parse(ihsgDate)))) {
                throw new IllegalStateException("Invalid or older IHSG snapshot");
            }
            JSONObject quote = new JSONObject().put("price", close).put("change_pct", change);
            setMarket(views, R.id.ihsgValue, R.id.ihsgChange, quote, "", 2, context, "ihsg");
            ihsgDate = date.toString();
            ihsgStatus = index.optBoolean("stale") ? "STALE" : "OK";
            cache.edit().putString("ihsg_date", ihsgDate).apply();
        } catch (Exception ignored) {
            ihsgStatus = "CACHED";
        }

        JSONObject btc = null;
        try {
            JSONObject root = awaitJson(btcRequest, fetchDeadline);
            if (root == null) throw new IllegalStateException("BTC feed unavailable");
            btc = root.getJSONObject("bitcoin");
            double price = btc.getDouble("usd");
            double change = btc.getDouble("usd_24h_change");
            if (!Double.isFinite(price) || price <= 0 || !Double.isFinite(change)) {
                throw new IllegalStateException("Invalid BTC quote");
            }
            JSONObject quote = new JSONObject().put("price", price).put("change_pct", change);
            setMarket(views, R.id.btcUsdValue, R.id.btcUsdChange, quote, "$", 0, context, "btc");
            btcStatus = "LIVE";
        } catch (Exception ignored) {
            btcStatus = "CACHED";
        }

        try {
            JSONObject history = awaitJson(historyRequest, fetchDeadline);
            if (history == null || btc == null) throw new IllegalStateException("BTC forecast feed unavailable");
            String forecast = btcForecast(history.getJSONArray("prices"), btc.getDouble("usd"));
            views.setTextViewText(R.id.btcForecast, forecast);
            forecastStatus = "OK";
        } catch (Exception ignored) {
            views.setTextViewText(R.id.btcForecast, "BTC estimate unavailable");
            forecastStatus = "UNAVAILABLE";
        }

        String marketLine = marketDate.isEmpty() ? "Market —" :
                "Data " + DATA_TIME.format(Instant.parse(marketDate));
        String ihsgLine = ihsgDate.isEmpty() ? "IHSG —" : "IHSG " + ihsgDate;
        views.setTextViewText(R.id.widgetStatus, marketLine + " · " + ihsgLine);
        views.setTextViewText(R.id.widgetLastCheck,
                "Checked " + DATA_TIME.format(Instant.now()) + " · Market " + marketStatus
                        + " · IHSG " + ihsgStatus + " · BTC " + btcStatus
                        + " · Est " + forecastStatus);
        return views;
    }

    private static JSONObject awaitJson(Future<JSONObject> request) {
        try {
            return request.get(FETCH_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception ignored) {
            request.cancel(true);
            return null;
        }
    }

    private static JSONObject getJson(String endpoint) throws Exception {
        String requestUrl = endpoint;
        if (endpoint.startsWith(DATA_ROOT)) {
            requestUrl += (endpoint.contains("?") ? "&" : "?")
                    + "refresh=" + System.currentTimeMillis();
        }
        HttpURLConnection conn = (HttpURLConnection) new URL(requestUrl).openConnection();
        try {
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setUseCaches(false);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Cache-Control", "no-cache, no-store, max-age=0");
            conn.setRequestProperty("Pragma", "no-cache");
            conn.setRequestProperty("User-Agent", "HANZ-Trade-Android/2.6");
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    conn.getInputStream(), java.nio.charset.StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                return new JSONObject(body.toString());
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String btcForecast(JSONArray history, double price) throws Exception {
        int n = history.length();
        if (n < 722) throw new IllegalStateException("Insufficient hourly history");
        double[] values = new double[n];
        long[] times = new long[n];
        for (int i = 0; i < n; i++) {
            JSONArray point = history.getJSONArray(i);
            times[i] = point.getLong(0);
            values[i] = point.getDouble(1);
            if (!Double.isFinite(values[i]) || values[i] <= 0
                    || (i > 0 && times[i] <= times[i - 1])) {
                throw new IllegalStateException("Invalid BTC history");
            }
        }
        int end = n - 2;
        if (System.currentTimeMillis() - times[end] > 172800000L) {
            throw new IllegalStateException("Stale BTC history");
        }

        StringBuilder out = new StringBuilder("BTC estimate (experimental)");
        int[] horizonsHours = {24, 168, 720};
        String[] labels = {"24h", "7d", "30d"};
        for (int h = 0; h < horizonsHours.length; h++) {
            int lag = horizonsHours[h];
            double[] returns = new double[end - lag + 1];
            for (int i = lag; i <= end; i++) {
                returns[i - lag] = Math.log(values[i] / values[i - lag]);
            }
            java.util.Arrays.sort(returns);
            int count = returns.length;
            double median = (returns[(count - 1) / 2] + returns[count / 2]) / 2;
            double estimate = price * Math.exp(median);
            if (!Double.isFinite(estimate) || estimate <= 0) {
                throw new IllegalStateException("Invalid BTC estimate");
            }
            out.append("\\n").append(labels[h]).append(": $").append(format(estimate, 0));
        }
        return out.toString();
    }

    private void setMarket(RemoteViews views, int valueId, int changeId, JSONObject item,
                           String prefix, int digits, Context context, String key) {
        double price = item.optDouble("price", Double.NaN);
        double change = item.optDouble("change_pct", 0.0);
        boolean available = !Double.isNaN(price) && price > 0;
        String value = available ? prefix + format(price, digits) : "Unavailable";
        String changeText = available ? changeLabel(change) : "—";
        views.setTextViewText(valueId, value);
        views.setTextViewText(changeId, changeText);
        views.setTextColor(changeId, change > 0 ? GREEN : change < 0 ? RED : NEUTRAL);

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(key + "_value", value)
                .putString(key + "_change", changeText)
                .putInt(key + "_color", change > 0 ? GREEN : change < 0 ? RED : NEUTRAL)
                .apply();
    }

    private void applyCached(Context context, RemoteViews views) {
        var p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        applyOne(views, p, R.id.usdIdrValue, R.id.usdIdrChange, "usd");
        applyOne(views, p, R.id.aedIdrValue, R.id.aedIdrChange, "aed");
        applyOne(views, p, R.id.uaeGoldValue, R.id.uaeGoldChange, "uae_gold");
        applyOne(views, p, R.id.antamValue, R.id.antamChange, "antam");
        applyOne(views, p, R.id.ihsgValue, R.id.ihsgChange, "ihsg");
        applyOne(views, p, R.id.btcUsdValue, R.id.btcUsdChange, "btc");
        views.setTextViewText(R.id.beiCandidates, p.getString("candidates", "No candidates"));
    }

    private void applyOne(RemoteViews views, android.content.SharedPreferences p,
                          int valueId, int changeId, String key) {
        views.setTextViewText(valueId, p.getString(key + "_value", "—"));
        views.setTextViewText(changeId, p.getString(key + "_change", "—"));
        views.setTextColor(changeId, p.getInt(key + "_color", NEUTRAL));
    }

    private RemoteViews baseViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.currency_widget);
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(context, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widgetRoot, openPi);

        Intent refresh = new Intent(context, CurrencyWidgetProvider.class);
        refresh.setAction(ACTION_REFRESH);
        PendingIntent refreshPi = PendingIntent.getBroadcast(context, 1, refresh,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.refreshButton, refreshPi);
        return views;
    }

    private static String candidateText(JSONArray candidates) {
        if (candidates == null || candidates.length() == 0) return "0 candidates";
        StringBuilder tickers = new StringBuilder();
        int limit = Math.min(candidates.length(), 4);
        for (int i = 0; i < limit; i++) {
            String ticker;
            Object value = candidates.opt(i);
            if (value instanceof JSONObject) ticker = ((JSONObject) value).optString("ticker", "");
            else ticker = String.valueOf(value);
            ticker = ticker.replace(".JK", "").trim().toUpperCase(Locale.US);
            if (ticker.isEmpty()) continue;
            if (tickers.length() > 0) tickers.append(" · ");
            tickers.append(ticker);
        }
        return candidates.length() + " · " + (tickers.length() == 0 ? "candidates" : tickers);
    }

    private static String changeLabel(double change) {
        if (Math.abs(change) < 0.005) return "— 0.00%";
        return (change > 0 ? "▲ " : "▼ ") + format(Math.abs(change), 2) + "%";
    }

    private static String format(double value, int digits) {
        StringBuilder pattern = new StringBuilder("#,##0");
        if (digits > 0) {
            pattern.append(".");
            for (int i = 0; i < digits; i++) pattern.append("0");
        }
        return new DecimalFormat(pattern.toString()).format(value);
    }
}
