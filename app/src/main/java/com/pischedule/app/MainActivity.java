package com.pischedule.app;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

/** Offline web UI with a stable HTTPS asset origin and Android document picker. */
public final class MainActivity extends Activity {
    private static final int PICK_WORKBOOK = 1001;
    private static final int REQUEST_NOTIFICATIONS = 1002;
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245, 246, 244));
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(root);
        root.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(ReminderReceiver.CHANNEL, "日程和课程提醒",
                        NotificationManager.IMPORTANCE_DEFAULT));
        webView.addJavascriptInterface(new ReminderBridge(), "PiReminders");
        webView.addJavascriptInterface(new LocalDatabase(this), "PiDatabase");

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !ASSET_HOST.equals(uri.getHost());
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                boolean image = java.util.Arrays.stream(params.getAcceptTypes()).anyMatch(type -> type.startsWith("image/"));
                picker.setType(image ? "image/*" : "*/*");
                if (!image) picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                        "application/vnd.ms-excel",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/octet-stream"
                });
                try {
                    startActivityForResult(picker, PICK_WORKBOOK);
                } catch (ActivityNotFoundException exception) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "设备未提供文件选择器", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        webView.loadUrl("https://" + ASSET_HOST + "/assets/index.html");
    }

    private String reminderError;

    public final class ReminderBridge {
        @JavascriptInterface
        public void replace(String snapshot) {
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                try {
                    ReminderReceiver.replace(MainActivity.this, snapshot);
                    reminderError = null;
                } catch (org.json.JSONException | IllegalStateException error) {
                    reminderError = "提醒数据保存失败，请重新打开应用。";
                }
                updateReminderStatus();
            });
        }

        @JavascriptInterface
        public void refreshStatus() {
            runOnUiThread(MainActivity.this::updateReminderStatus);
        }

        @JavascriptInterface
        public void testNotification() {
            runOnUiThread(() -> ReminderReceiver.testNotification(MainActivity.this));
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(MainActivity.this::openReminderSettings);
        }
    }

    private void updateReminderStatus() {
        if (isDestroyed()) return;
        boolean notifications = ReminderReceiver.notificationsAllowed(this);
        boolean exact = ReminderReceiver.exactAllowed(this);
        String status = reminderError != null ? reminderError
                : !notifications ? "开启通知后可收到日程和课程提醒。"
                : !exact ? "提醒可能延迟。允许「闹钟和提醒」后可准时提醒。"
                : "日程和课程开始前 30 分钟提醒。";
        webView.evaluateJavascript("window.showReminderStatus && window.showReminderStatus("
                + JSONObject.quote(status) + "," + (notifications && exact) + "," + notifications + ")", null);
    }

    private void openReminderSettings() {
        if (!ReminderReceiver.notificationsAllowed(this)) {
            if (Build.VERSION.SDK_INT >= 33
                    && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    && !getPreferences(MODE_PRIVATE).getBoolean("notification_requested", false)) {
                getPreferences(MODE_PRIVATE).edit().putBoolean("notification_requested", true).apply();
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQUEST_NOTIFICATIONS);
                return;
            }
            if (!getSystemService(NotificationManager.class).areNotificationsEnabled()) {
                startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
                return;
            }
            startActivity(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, ReminderReceiver.CHANNEL));
        } else if (Build.VERSION.SDK_INT >= 31 && !ReminderReceiver.exactAllowed(this)) {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getPackageName())));
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        ReminderReceiver.schedule(this, System.currentTimeMillis());
        updateReminderStatus();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQUEST_NOTIFICATIONS) {
            ReminderReceiver.schedule(this, System.currentTimeMillis());
            updateReminderStatus();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_WORKBOOK && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false",
                handled -> {
                    if (!"true".equals(handled)) finish();
                });
    }

    @Override
    protected void onDestroy() {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        webView.destroy();
        super.onDestroy();
    }
}
