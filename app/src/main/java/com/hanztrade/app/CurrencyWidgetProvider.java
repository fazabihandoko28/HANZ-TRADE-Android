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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class CurrencyWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "com.hanztrade.app.REFRESH_WIDGET";
    private static final String ENDPOINT = "https://hanz-trade.netlify.app/api/widget-data";
    private static final String PREFS = "hanz_widget_cache";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int GREEN = Color.rgb(45, 196, 125);
    private static final int RED = Color.rgb(255, 92, 106);
    private static final int NEUTRAL = Color.rgb(145, 160, 182);

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            showLoading(context, manager, id);
            fetchAndUpdate(context, manager, id);
        }
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

    private void showLoading(Context context, AppWidgetManager manager, int id) {
        RemoteViews views = baseViews(context);
        applyCached(context, views);
        views.setViewVisibility(R.id.widgetProgress, View.VISIBLE);
        views.setTextViewText(R.id.widgetStatus, "Updating…");
        manager.updateAppWidget(id, views);
    }

    private void fetchAndUpdate(Context context, AppWidgetManager manager, int id) {
        EXECUTOR.execute(() -> {
            RemoteViews views = baseViews(context);
            try {
                JSONObject root = getJson(ENDPOINT);
                if (!root.optBoolean("ok", true)) throw new IllegalStateException("API not ready");

                setMarket(views, R.id.usdIdrValue, R.id.usdIdrChange,
                        root.getJSONObject("usd_idr"), "Rp ", 0, context, "usd");
                setMarket(views, R.id.aedIdrValue, R.id.aedIdrChange,
                        root.getJSONObject("aed_idr"), "Rp ", 0, context, "aed");
                setMarket(views, R.id.uaeGoldValue, R.id.uaeGoldChange,
                        root.getJSONObject("uae_gold_24k"), "AED ", 2, context, "uae_gold");
                setMarket(views, R.id.antamValue, R.id.antamChange,
                        root.getJSONObject("antam_gold_1g"), "Rp ", 0, context, "antam");

                JSONArray candidates = root.optJSONArray("bei_candidates");
                String candidateText = candidateText(candidates);
                views.setTextViewText(R.id.beiCandidates, candidateText);
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString("candidates", candidateText)
                        .putLong("updated", System.currentTimeMillis())
                        .apply();

                String sourceStatus = root.optBoolean("partial", false) ? "Partial data" : "Live";
                views.setTextViewText(R.id.widgetStatus, sourceStatus + " · Updated " +
                        new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
                views.setViewVisibility(R.id.widgetProgress, View.GONE);
                manager.updateAppWidget(id, views);
            } catch (Exception e) {
                applyCached(context, views);
                views.setViewVisibility(R.id.widgetProgress, View.GONE);
                views.setTextViewText(R.id.widgetStatus, "Cached/offline · tap ↻");
                manager.updateAppWidget(id, views);
            }
        });
    }

    private static JSONObject getJson(String endpoint) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("User-Agent", "HANZ-Trade-Android/1.3");
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
        BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
        StringBuilder body = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) body.append(line);
        reader.close();
        conn.disconnect();
        return new JSONObject(body.toString());
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
