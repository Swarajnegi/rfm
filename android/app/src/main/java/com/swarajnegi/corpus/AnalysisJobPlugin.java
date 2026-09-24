package com.swarajnegi.corpus;

import android.content.Intent;
import android.content.SharedPreferences;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.URI;
import java.util.UUID;

@CapacitorPlugin(name = "AnalysisJob")
public class AnalysisJobPlugin extends Plugin {
    static final String PREFS = "corpus_analysis_job";
    // The app talks to one AI endpoint, its own gateway. Direct provider hosts
    // were allowed here while users supplied keys; nothing sends to them now.
    private static boolean isAllowedHost(String host) {
        return host != null && host.endsWith(".workers.dev");
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), AnalysisJobService.class);
            intent.putExtra("warm", true);
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not keep analysis active: " + e.getMessage());
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url", "");
        String body = call.getString("body", "");
        JSObject headers = call.getObject("headers", new JSObject());
        try {
            URI uri = URI.create(url);
            if (!"https".equals(uri.getScheme()) || !isAllowedHost(uri.getHost())) {
                call.reject("Unsupported AI provider URL.");
                return;
            }
            if (body.isEmpty()) {
                call.reject("Empty AI request.");
                return;
            }
            String id = UUID.randomUUID().toString();
            getContext().getSharedPreferences(PREFS, 0).edit()
                .putString("id", id).putString("state", "running")
                .remove("body").remove("error").remove("statusCode").apply();
            Intent intent = new Intent(getContext(), AnalysisJobService.class);
            intent.putExtra("id", id);
            intent.putExtra("url", url);
            intent.putExtra("body", body);
            intent.putExtra("headers", headers.toString());
            ContextCompat.startForegroundService(getContext(), intent);
            JSObject result = new JSObject();
            result.put("id", id);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not start background analysis: " + e.getMessage());
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        JSObject result = new JSObject();
        result.put("id", prefs.getString("id", ""));
        result.put("state", prefs.getString("state", "idle"));
        result.put("body", prefs.getString("body", ""));
        result.put("error", prefs.getString("error", ""));
        result.put("statusCode", prefs.getInt("statusCode", 0));
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String id = call.getString("id", "");
        if (id.equals(prefs.getString("id", "")) && !"running".equals(prefs.getString("state", ""))) {
            prefs.edit().clear().apply();
        }
        call.resolve();
    }
}
