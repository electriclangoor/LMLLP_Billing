package com.langoormedia.biller;

// Biller for Android: shows the same quotation & invoice page (bundled inside the app)
// full screen, and connects its buttons to Android: printing / Save as PDF, saving files
// to Downloads, the file picker, WhatsApp and the back gesture.

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    // The page is served from a fixed private address, so saved history and drafts stay put
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/web/index.html";
    private static final String DOWNLOAD_FOLDER = Environment.DIRECTORY_DOWNLOADS + "/Biller";
    private static final int PICK_FILE = 1;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF0A0A0A);
        web = new WebView(this);
        root.addView(web);
        setContentView(root);

        // Keep the page clear of the status bar, navigation bar, camera cut-out and keyboard
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                openOutside(url);   // WhatsApp and other links open in their own apps
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType(pickerType(params.getAcceptTypes()));
                try {
                    startActivityForResult(pick, PICK_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        web.addJavascriptInterface(new Bridge(), "BillerAndroid");

        // Back gesture: close a dialog or history list first; otherwise leave Biller as it is
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                () -> web.evaluateJavascript("window.billerBack ? window.billerBack() : false", handled -> {
                    if (!"true".equals(handled)) moveTaskToBack(true);
                }));

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    // "image/*" for the signature, anything else (backups are .json) opens the general picker
    private static String pickerType(String[] accept) {
        if (accept != null) {
            for (String a : accept) {
                if (a != null && a.startsWith("image/")) return "image/*";
            }
        }
        return "*/*";
    }

    private void openOutside(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE || fileCallback == null) return;
        Uri picked = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
        fileCallback.onReceiveValue(picked != null ? new Uri[] { picked } : null);
        fileCallback = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    // Called from the page (app.js) as window.BillerAndroid
    private class Bridge {

        // Print / Download PDF: Android's print sheet, where "Save as PDF" is one of the printers
        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                String name = (title == null || title.trim().isEmpty()) ? "Biller" : title.trim();
                PrintManager pm = getSystemService(PrintManager.class);
                pm.print(name, web.createPrintDocumentAdapter(name),
                        new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            });
        }

        // Backups and accountant exports go to Downloads/Biller
        @JavascriptInterface
        public void saveFile(String filename, String text, String type) {
            String mime = (type == null || type.isEmpty()) ? "application/octet-stream" : type.split(";")[0].trim();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, DOWNLOAD_FOLDER);
            ContentResolver resolver = getContentResolver();
            Uri uri = null;
            try {
                uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("no file");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("no file");
                    out.write(text.getBytes(StandardCharsets.UTF_8));
                }
                toast("Saved to Downloads/Biller: " + filename);
            } catch (Exception e) {
                if (uri != null) resolver.delete(uri, null, null);
                toast("Couldn't save " + filename);
            }
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> openOutside(Uri.parse(url)));
        }

        private void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
        }
    }
}
