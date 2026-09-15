import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { App } from '@capacitor/app';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';

// ── pdf.js for client-side PDF parsing (Phase 5) ──
import * as pdfjsLib from 'pdfjs-dist';

// Use local .js worker script for 100% offline client-side PDF parsing in Capacitor Android
try {
    if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
    }
} catch (e) {
    console.warn("Failed to set PDF workerSrc:", e);
}

// CapacitorHttp issues requests from native code, so it is not subject to the
// WebView's CORS policy. That is what lets the price sync call Yahoo directly on
// Android instead of paying for a doomed direct attempt plus a public CORS proxy.
// app.js feature-detects this, so the web build keeps working unchanged.
window.AppPlugins = {
    Capacitor,
    CapacitorHttp,
    App,
    NativeBiometric,
    SplashScreen,
    StatusBar,
    Style,
    Filesystem,
    Directory,
    LocalNotifications,
    Haptics,
    ImpactStyle,
    NotificationType
};

window.pdfjsLib = pdfjsLib;
