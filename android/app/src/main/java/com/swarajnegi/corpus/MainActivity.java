package com.swarajnegi.corpus;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(AnalysisJobPlugin.class);
        registerPlugin(SessionVaultPlugin.class);
        super.onCreate(savedInstanceState);
        // The WebView scales text by the system font size on top of a layout
        // already sized in px, which wraps and crowds the designed screens.
        // Settings → Text size → Large is the app's own control for this.
        android.webkit.WebSettings s = getBridge().getWebView().getSettings();
        s.setTextZoom(100);
        // The page declares a fixed layout width (index.html) and the WebView
        // scales it to the screen, so every phone shows the whole designed
        // column instead of a 390px layout blown up on a narrower one.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
    }
}
