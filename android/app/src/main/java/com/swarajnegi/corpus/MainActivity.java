package com.swarajnegi.corpus;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(AnalysisJobPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
