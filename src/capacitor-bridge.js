import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { NativeBiometric } from '@capgo/capacitor-native-biometric';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Share } from '@capacitor/share';

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
    AnalysisJob: registerPlugin('AnalysisJob'),
    SessionVault: registerPlugin('SessionVault'),
    App,
    Browser,
    NativeBiometric,
    SplashScreen,
    StatusBar,
    Style,
    Filesystem,
    Directory,
    LocalNotifications,
    Haptics,
    ImpactStyle,
    NotificationType,
    Share
};

window.pdfjsLib = pdfjsLib;
