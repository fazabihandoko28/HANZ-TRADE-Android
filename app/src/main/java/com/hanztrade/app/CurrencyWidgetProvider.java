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

public class CurrencyWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "com.hanztrade.app.REFRESH_WIDGET";
    private static final String DATA_ROOT =
            "https://raw.githubusercontent.com/fazabihandoko28/HANZ-TRADE-Android/main/public/";
    private static final DateTimeFormatter DATA_TIME =
            DateTimeFormatter.ofPattern("dd MMM HH:mm", Locale.ENGLISH).withZone(ZoneId.systemDefault());
    private static final String PREFS = "hanz_widget_cache";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
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
        String marketStatus = "Cached";
        String ihsgStatus = "Cached";

        try {
            JSONObject root = getJson(DATA_ROOT + "widget-data.json");
            if (!root.getBoolean("ok")) throw new IllegalStateException("Market feed unavailable");
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
            marketStatus = root.optBoolean("partial") ? "Partial" : "Data";
            cache.edit().putString("candidates", candidates)
                    .putString("market_data_time", marketDate).apply();
        } catch (Exception ignored) {
            // Keep the last available values when the market feed fails.
        }

        try {
            JSONObject index = getJson(DATA_ROOT + "ihsg.json");
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
            ihsgStatus = index.optBoolean("stale") ? "Cached" : "";
            cache.edit().putString("ihsg_date", ihsgDate).apply();
        } catch (Exception ignored) {
            // IHSG and the market feed can refresh independently.
        }

        String marketLine = marketDate.isEmpty() ? "Market —" :
                marketStatus + " " + DATA_TIME.format(Instant.parse(marketDate));
        String ihsgLine = ihsgDate.isEmpty() ? "IHSG —" : "IHSG " + ihsgDate
                + (ihsgStatus.isEmpty() ? "" : " (" + ihsgStatus.toLowerCase(Locale.US) + ")");
        views.setTextViewText(R.id.widgetStatus, marketLine + " · " + ihsgLine);
        return views;
    }

    private static JSONObject getJson(String endpoint) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            conn.setConnectTimeout(2500);
            conn.setReadTimeout(2500);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "HANZ-Trade-Android/2.2");
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
