package com.hanztrade.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

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
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

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
        views.setViewVisibility(R.id.widgetProgress, View.VISIBLE);
        views.setTextViewText(R.id.widgetStatus, "Updating…");
        manager.updateAppWidget(id, views);
    }

    private void fetchAndUpdate(Context context, AppWidgetManager manager, int id) {
        EXECUTOR.execute(() -> {
            try {
                URL url = new URL("https://open.er-api.com/v6/latest/USD");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(12000);
                conn.setReadTimeout(12000);
                conn.setRequestProperty("Accept", "application/json");

                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                reader.close();
                conn.disconnect();

                JSONObject rates = new JSONObject(body.toString()).getJSONObject("rates");
                double idr = rates.getDouble("IDR");
                double aed = rates.getDouble("AED");
                double aedIdr = idr / aed;

                context.getSharedPreferences("rates", Context.MODE_PRIVATE).edit()
                        .putLong("updated", System.currentTimeMillis())
                        .putString("usd_idr", format(idr, 2))
                        .putString("aed_idr", format(aedIdr, 2))
                        .putString("usd_aed", format(aed, 4))
                        .apply();

                RemoteViews views = baseViews(context);
                views.setViewVisibility(R.id.widgetProgress, View.GONE);
                views.setTextViewText(R.id.usdIdrValue, format(idr, 2));
                views.setTextViewText(R.id.aedIdrValue, format(aedIdr, 2));
                views.setTextViewText(R.id.usdAedValue, format(aed, 4));
                views.setTextViewText(R.id.widgetStatus,
                        "Updated " + new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date()));
                manager.updateAppWidget(id, views);
            } catch (Exception e) {
                RemoteViews views = baseViews(context);
                views.setViewVisibility(R.id.widgetProgress, View.GONE);
                var prefs = context.getSharedPreferences("rates", Context.MODE_PRIVATE);
                views.setTextViewText(R.id.usdIdrValue, prefs.getString("usd_idr", "—"));
                views.setTextViewText(R.id.aedIdrValue, prefs.getString("aed_idr", "—"));
                views.setTextViewText(R.id.usdAedValue, prefs.getString("usd_aed", "—"));
                views.setTextViewText(R.id.widgetStatus, "Offline · tap ↻");
                manager.updateAppWidget(id, views);
            }
        });
    }

    private RemoteViews baseViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.currency_widget);

        Intent open = new Intent(context, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(
                context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widgetRoot, openPi);

        Intent refresh = new Intent(context, CurrencyWidgetProvider.class);
        refresh.setAction(ACTION_REFRESH);
        PendingIntent refreshPi = PendingIntent.getBroadcast(
                context, 1, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.refreshButton, refreshPi);

        return views;
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
