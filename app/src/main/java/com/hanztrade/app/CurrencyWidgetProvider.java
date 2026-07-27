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
    private static final String DATA_URL = "https://hanz-trade.netlify.app/widget-data.json";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int UP = Color.rgb(51, 199, 119);
    private static final int DOWN = Color.rgb(255, 92, 92);
    private static final int FLAT = Color.rgb(145, 160, 182);

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
        restoreCached(context, views);
        views.setViewVisibility(R.id.widgetProgress, View.VISIBLE);
        views.setTextViewText(R.id.widgetStatus, "Updating…");
        manager.updateAppWidget(id, views);
    }

    private void fetchAndUpdate(Context context, AppWidgetManager manager, int id) {
        EXECUTOR.execute(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(DATA_URL).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestProperty("Accept", "application/json");
                conn.setRequestProperty("User-Agent", "HANZ-TRADE-Android/1.3");

                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);

                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                reader.close();
                conn.disconnect();

                JSONObject root = new JSONObject(body.toString());
                Metric usd = metric(root, "usd_idr");
                Metric aed = metric(root, "aed_idr");
                Metric uaeGold = metric(root, "uae_gold_24k");
                Metric antam = metric(root, "antam_gold_1g");
                String candidates = candidates(root.optJSONArray("bei_candidates"));
                String updated = root.optString("updated", "");
                boolean stale = root.optBoolean("stale", false);

                String usdValue = "Rp " + format(usd.value, 0);
                String aedValue = "Rp " + format(aed.value, 0);
                String uaeValue = "AED " + format(uaeGold.value, 2) + "/g";
                String antamValue = "Rp " + format(antam.value, 0);

                context.getSharedPreferences("widget_data", Context.MODE_PRIVATE).edit()
                        .putLong("cached_at", System.currentTimeMillis())
                        .putString("usd_value", usdValue).putString("usd_change", changeText(usd.change))
                        .putFloat("usd_change_n", (float) usd.change)
                        .putString("aed_value", aedValue).putString("aed_change", changeText(aed.change))
                        .putFloat("aed_change_n", (float) aed.change)
                        .putString("uae_value", uaeValue).putString("uae_change", changeText(uaeGold.change))
                        .putFloat("uae_change_n", (float) uaeGold.change)
                        .putString("antam_value", antamValue).putString("antam_change", changeText(antam.change))
                        .putFloat("antam_change_n", (float) antam.change)
                        .putString("candidates", candidates)
                        .putString("server_updated", updated)
                        .apply();

                RemoteViews views = baseViews(context);
                views.setViewVisibility(R.id.widgetProgress, View.GONE);
                setMetric(views, R.id.usdIdrValue, R.id.usdIdrChange, usdValue, usd.change);
                setMetric(views, R.id.aedIdrValue, R.id.aedIdrChange, aedValue, aed.change);
                setMetric(views, R.id.uaeGoldValue, R.id.uaeGoldChange, uaeValue, uaeGold.change);
                setMetric(views, R.id.antamValue, R.id.antamChange, antamValue, antam.change);
                views.setTextViewText(R.id.beiCandidates, candidates);
                views.setTextViewText(R.id.widgetStatus, (stale ? "Cached · " : "Updated ") + new SimpleDateFormat("dd MMM HH:mm", Locale.getDefault()).format(new Date()));
                manager.updateAppWidget(id, views);
            } catch (Exception e) {
                RemoteViews views = baseViews(context);
                views.setViewVisibility(R.id.widgetProgress, View.GONE);
                restoreCached(context, views);
                views.setTextViewText(R.id.widgetStatus, "Offline · showing last data · tap ↻");
                manager.updateAppWidget(id, views);
            }
        });
    }

    private static Metric metric(JSONObject root, String key) {
        JSONObject obj = root.optJSONObject(key);
        if (obj == null) return new Metric(0, 0);
        return new Metric(obj.optDouble("price", 0), obj.optDouble("change_pct", 0));
    }

    private static String candidates(JSONArray array) {
        if (array == null || array.length() == 0) return "No strong candidate";
        StringBuilder out = new StringBuilder(array.length() + " Candidates · ");
        for (int i = 0; i < array.length(); i++) {
            if (i > 0) out.append(" · ");
            out.append(array.optString(i));
        }
        return out.toString();
    }

    private static void setMetric(RemoteViews views, int valueId, int changeId, String value, double change) {
        views.setTextViewText(valueId, value);
        views.setTextViewText(changeId, changeText(change));
        views.setTextColor(changeId, change > 0.0001 ? UP : change < -0.0001 ? DOWN : FLAT);
    }

    private void restoreCached(Context context, RemoteViews views) {
        var prefs = context.getSharedPreferences("widget_data", Context.MODE_PRIVATE);
        views.setTextViewText(R.id.usdIdrValue, prefs.getString("usd_value", "—"));
        views.setTextViewText(R.id.aedIdrValue, prefs.getString("aed_value", "—"));
        views.setTextViewText(R.id.uaeGoldValue, prefs.getString("uae_value", "—"));
        views.setTextViewText(R.id.antamValue, prefs.getString("antam_value", "—"));
        views.setTextViewText(R.id.beiCandidates, prefs.getString("candidates", "No strong candidate"));
        setCachedChange(views, R.id.usdIdrChange, prefs.getString("usd_change", "—"), prefs.getFloat("usd_change_n", 0));
        setCachedChange(views, R.id.aedIdrChange, prefs.getString("aed_change", "—"), prefs.getFloat("aed_change_n", 0));
        setCachedChange(views, R.id.uaeGoldChange, prefs.getString("uae_change", "—"), prefs.getFloat("uae_change_n", 0));
        setCachedChange(views, R.id.antamChange, prefs.getString("antam_change", "—"), prefs.getFloat("antam_change_n", 0));
    }

    private static void setCachedChange(RemoteViews views, int id, String text, float change) {
        views.setTextViewText(id, text);
        views.setTextColor(id, change > 0.0001 ? UP : change < -0.0001 ? DOWN : FLAT);
    }

    private RemoteViews baseViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.currency_widget);
        Intent open = new Intent(context, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widgetRoot, openPi);

        Intent refresh = new Intent(context, CurrencyWidgetProvider.class);
        refresh.setAction(ACTION_REFRESH);
        PendingIntent refreshPi = PendingIntent.getBroadcast(context, 1, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.refreshButton, refreshPi);
        return views;
    }

    private static String changeText(double value) {
        if (Math.abs(value) < 0.0001) return "— 0.00%";
        return (value > 0 ? "▲ " : "▼ ") + format(Math.abs(value), 2) + "%";
    }

    private static String format(double value, int digits) {
        StringBuilder pattern = new StringBuilder("#,##0");
        if (digits > 0) {
            pattern.append(".");
            for (int i = 0; i < digits; i++) pattern.append("0");
        }
        return new DecimalFormat(pattern.toString()).format(value);
    }

    private static class Metric {
        final double value;
        final double change;
        Metric(double value, double change) { this.value = value; this.change = change; }
    }
}
