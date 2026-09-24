package com.swarajnegi.corpus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public class AnalysisJobService extends Service {
    private static final String CHANNEL = "corpus_analysis";
    private static final int NOTIFICATION_ID = 7301;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Corpus analysis", NotificationManager.IMPORTANCE_LOW));
        }
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notification)
            .setContentTitle("Corpus is analysing your holdings")
            .setContentText("The brief will be ready when you return")
            .setOngoing(true)
            .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (intent.getBooleanExtra("warm", false)) {
            new android.os.Handler(getMainLooper()).postDelayed(() -> stopSelf(startId), 20000);
            return START_NOT_STICKY;
        }

        final String id = intent.getStringExtra("id");
        final String url = intent.getStringExtra("url");
        final String body = intent.getStringExtra("body");
        final String headers = intent.getStringExtra("headers");
        new Thread(() -> runRequest(id, url, body, headers, startId), "CorpusAnalysis").start();
        return START_NOT_STICKY;
    }

    private void runRequest(String id, String url, String body, String headers, int startId) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10000);
            // Outwaits the gateway's 85s budget; matches GATEWAY_WAIT_MS in regenWealth.js.
            connection.setReadTimeout(95000);
            connection.setDoOutput(true);
            JSONObject requestHeaders = new JSONObject(headers);
            Iterator<String> keys = requestHeaders.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                connection.setRequestProperty(key, requestHeaders.optString(key));
            }
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) { out.write(payload); }
            int statusCode = connection.getResponseCode();
            InputStream input = statusCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String response = readLimited(input);
            SharedPreferences prefs = getSharedPreferences(AnalysisJobPlugin.PREFS, 0);
            if (id != null && id.equals(prefs.getString("id", ""))) {
                prefs.edit().putString("state", statusCode >= 400 ? "error" : "done")
                    .putInt("statusCode", statusCode).putString("body", response).apply();
            }
        } catch (Exception e) {
            SharedPreferences prefs = getSharedPreferences(AnalysisJobPlugin.PREFS, 0);
            if (id != null && id.equals(prefs.getString("id", ""))) {
                prefs.edit().putString("state", "error")
                    .putString("error", e.getMessage() == null ? "Network request failed" : e.getMessage()).apply();
            }
        } finally {
            if (connection != null) connection.disconnect();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf(startId);
        }
    }

    private String readLimited(InputStream input) throws Exception {
        if (input == null) return "";
        try (InputStream in = input; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int count;
            while ((count = in.read(buffer)) != -1) {
                if (out.size() + count > 1024 * 1024) throw new Exception("AI response exceeded 1 MB");
                out.write(buffer, 0, count);
            }
            return out.toString(StandardCharsets.UTF_8);
        }
    }
}
