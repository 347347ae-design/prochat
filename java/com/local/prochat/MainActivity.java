package com.local.prochat;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

public class MainActivity extends Activity {
    private static final String TAG = "ProChat";
    private static final int REQ_PICK_IMAGE = 1001;
    private static final int REQ_MIC = 1002;
    private static final int REQ_SAVE_IMAGE = 1003;

    private WebView web;
    private ChatClient chat;
    private NetClient net;
    private SecretStore secrets;
    private Store store;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean backIntercept;

    private SpeechRecognizer recognizer;
    private String pendingVoiceLocale;
    private String pendingSaveAsset;
    private String pendingSaveName;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        secrets = new SecretStore(this);
        store = new Store(this);
        chat = new ChatClient(this);
        net = new NetClient(this);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setBackgroundColor(Color.parseColor("#F7F8FA"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }
        });
        web.loadUrl("file:///android_asset/index.html");
    }

    private boolean handleUrl(Uri u) {
        if (u == null) return false;
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        if (scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto") || scheme.equals("tel")) {
            openExternal(u);
            return true;
        }
        return false;
    }

    private void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            startActivity(i);
        } catch (Throwable t) {
            toast("没有可以打开这个链接的应用");
        }
    }

    @Override
    public void onBackPressed() {
        if (backIntercept) {
            callJs("onBack", null);
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        try {
            if (recognizer != null) {
                recognizer.destroy();
                recognizer = null;
            }
        } catch (Throwable ignored) {
        }
        chat.shutdown();
        if (net != null) {
            net.shutdown();
            net = null;
        }
        if (web != null) {
            web.removeJavascriptInterface("Native");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------ JS bridge

    /** 把 JS 侧的回调排到主线程执行。参数必须是已经序列化好的 JSON 片段。 */
    void callJs(final String fn, final String... jsonArgs) {
        StringBuilder sb = new StringBuilder("window.ProChatNative&&window.ProChatNative.");
        sb.append(fn).append('(');
        for (int i = 0; i < jsonArgs.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(jsonArgs[i] == null ? "null" : jsonArgs[i]);
        }
        sb.append(");");
        final String js = sb.toString();
        ui.post(new Runnable() {
            @Override
            public void run() {
                WebView w = web;
                if (w == null) return;
                try {
                    w.evaluateJavascript(js, null);
                } catch (Throwable t) {
                    Log.w(TAG, "evaluateJavascript failed: " + t);
                }
            }
        });
    }

    void toast(final String msg) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                try {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                } catch (Throwable ignored) {
                }
            }
        });
    }

    private void applyBars(final boolean dark, final String hex) {
        try {
            int c = Color.parseColor(hex);
            Window w = getWindow();
            w.setStatusBarColor(c);
            w.setNavigationBarColor(c);
            if (Build.VERSION.SDK_INT >= 23) {
                View dv = w.getDecorView();
                int flags = dv.getSystemUiVisibility();
                if (dark) {
                    flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                } else {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                }
                if (Build.VERSION.SDK_INT >= 26) {
                    if (dark) {
                        flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    } else {
                        flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    }
                }
                dv.setSystemUiVisibility(flags);
            }
        } catch (Throwable ignored) {
        }
    }

    public class Bridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String appInfo() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                JSONObject o = new JSONObject();
                o.put("version", pi.versionName == null ? "" : pi.versionName);
                o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("speech", SpeechRecognizer.isRecognitionAvailable(MainActivity.this));
                return o.toString();
            } catch (Throwable t) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void httpGet(String id, String url) {
            if (net != null) net.get(id, url);
        }

        @JavascriptInterface
        public void httpPost(String id, String url, String body) {
            if (net != null) net.post(id, url, body);
        }

        @JavascriptInterface
        public String getStore(String key) {
            return store.get(key);
        }

        @JavascriptInterface
        public void setStore(String key, String value) {
            store.put(key, value);
        }

        @JavascriptInterface
        public void removeStore(String key) {
            store.remove(key);
        }

        @JavascriptInterface
        public void clearStore() {
            store.clear();
        }

        @JavascriptInterface
        public String getSecret(String name) {
            return secrets.get(name);
        }

        @JavascriptInterface
        public void setSecret(String name, String value) {
            secrets.set(name, value);
        }

        @JavascriptInterface
        public void removeSecret(String name) {
            secrets.remove(name);
        }

        @JavascriptInterface
        public void clearSecrets() {
            secrets.clearAll();
        }

        @JavascriptInterface
        public void ask(String id, String payload) {
            chat.ask(id, payload);
        }

        @JavascriptInterface
        public void stop(String id) {
            chat.stop(id);
        }

        @JavascriptInterface
        public void listModels(String id, String payload) {
            chat.listModels(id, payload);
        }

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }

        @JavascriptInterface
        public void log(String msg) {
            Log.d(TAG, "[js] " + msg);
        }

        @JavascriptInterface
        public void copy(final String text) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) {
                            cm.setPrimaryClip(ClipData.newPlainText("ProChat", text));
                            toast("已复制");
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void share(final String text) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("text/plain");
                        i.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(i, "分享内容"));
                    } catch (Throwable t) {
                        toast("分享失败");
                    }
                }
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    openExternal(Uri.parse(url));
                }
            });
        }

        @JavascriptInterface
        public void saveAssetImage(final String assetName, final String fileName) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (Build.VERSION.SDK_INT <= 28
                                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                                != PackageManager.PERMISSION_GRANTED) {
                            pendingSaveAsset = assetName;
                            pendingSaveName = fileName;
                            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_SAVE_IMAGE);
                            return;
                        }
                        saveAssetImageNow(assetName, fileName);
                    } catch (Throwable t) {
                        toast("保存失败");
                    }
                }
            });
        }

        @JavascriptInterface
        public void setBackIntercept(final boolean on) {
            backIntercept = on;
        }

        @JavascriptInterface
        public void setSystemBars(final boolean dark, final String hex) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    applyBars(dark, hex);
                }
            });
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (on) {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        public void pickImage() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i;
                        if (Build.VERSION.SDK_INT >= 33) {
                            i = new Intent("android.provider.action.PICK_IMAGES");
                            i.setType("image/*");
                        } else {
                            i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                            i.addCategory(Intent.CATEGORY_OPENABLE);
                            i.setType("image/*");
                        }
                        startActivityForResult(i, REQ_PICK_IMAGE);
                    } catch (Throwable t) {
                        try {
                            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                            i.addCategory(Intent.CATEGORY_OPENABLE);
                            i.setType("image/*");
                            startActivityForResult(i, REQ_PICK_IMAGE);
                        } catch (Throwable t2) {
                            toast("打不开图片选择器");
                        }
                    }
                }
            });
        }

        @JavascriptInterface
        public void startVoice(final String locale) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    startVoiceInternal(locale);
                }
            });
        }

        @JavascriptInterface
        public void stopVoice() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    stopVoiceInternal();
                }
            });
        }
    }

    // --------------------------------------------------------------- 图片

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK_IMAGE || resultCode != RESULT_OK || data == null) return;
        Uri uri = data.getData();
        if (uri == null) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String dataUrl = encodeImage(uri);
                    if (dataUrl == null) {
                        callJs("onToast", JSONObject.quote("这张图片读不出来，换一张试试"));
                    } else {
                        callJs("onImage", JSONObject.quote(dataUrl));
                    }
                } catch (Throwable t) {
                    callJs("onToast", JSONObject.quote("图片处理失败：" + t.getMessage()));
                }
            }
        }, "image-encode").start();
    }

    private String encodeImage(Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, bounds);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= 1400 && bounds.outHeight / (sample * 2) >= 1400) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bmp;
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            bmp = BitmapFactory.decodeStream(in, null, opts);
        }
        if (bmp == null) return null;

        try (InputStream in = getContentResolver().openInputStream(uri)) {
            ExifInterface exif = new ExifInterface(in);
            int orientation = exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            int deg = 0;
            if (orientation == ExifInterface.ORIENTATION_ROTATE_90) deg = 90;
            else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) deg = 180;
            else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) deg = 270;
            if (deg != 0) {
                Matrix m = new Matrix();
                m.postRotate(deg);
                Bitmap rotated = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
                if (rotated != bmp) bmp.recycle();
                bmp = rotated;
            }
        } catch (Throwable ignored) {
        }

        int max = 1280;
        int w = bmp.getWidth();
        int h = bmp.getHeight();
        if (Math.max(w, h) > max) {
            float scale = max / (float) Math.max(w, h);
            Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.round(w * scale), Math.round(h * scale), true);
            if (scaled != bmp) bmp.recycle();
            bmp = scaled;
        }

        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 80, bos);
        bmp.recycle();
        String b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
        return "data:image/jpeg;base64," + b64;
    }

    // --------------------------------------------------------------- 语音

    private void startVoiceInternal(String locale) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingVoiceLocale = locale;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                callJs("onVoiceError", JSONObject.quote("这台手机没有可用的语音识别服务（需要安装/开启 Google 或厂商的语音服务）"));
                return;
            }
            stopVoiceInternal();
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new VoiceListener());
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            if (locale != null && !locale.isEmpty() && !"auto".equals(locale)) {
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale);
            }
            recognizer.startListening(i);
        } catch (Throwable t) {
            callJs("onVoiceError", JSONObject.quote("语音识别启动失败：" + t.getMessage()));
        }
    }

    private void stopVoiceInternal() {
        if (recognizer != null) {
            try {
                recognizer.cancel();
            } catch (Throwable ignored) {
            }
            try {
                recognizer.destroy();
            } catch (Throwable ignored) {
            }
            recognizer = null;
        }
    }

    private void saveAssetImageNow(String assetName, String fileName) {
        Bitmap bmp = null;
        Uri uri = null;
        try (InputStream in = getAssets().open(assetName)) {
            bmp = BitmapFactory.decodeStream(in);
            if (bmp == null) {
                toast("收款码图片读取失败");
                return;
            }
            String displayName = fileName + "-" + System.currentTimeMillis() + ".jpg";
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, displayName);
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                values.put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/ProChat");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    toast("保存失败，请截图保存");
                    return;
                }
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null || !bmp.compress(Bitmap.CompressFormat.JPEG, 95, out)) {
                        throw new RuntimeException("write failed");
                    }
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContentResolver().update(uri, done, null, null);
                toast("收款码已保存到相册");
            } else {
                String saved = MediaStore.Images.Media.insertImage(
                        getContentResolver(), bmp, displayName, "ProChat 打赏收款码");
                toast(saved == null ? "保存失败，请截图保存" : "收款码已保存到相册");
            }
        } catch (Throwable t) {
            if (uri != null && Build.VERSION.SDK_INT >= 29) {
                try {
                    getContentResolver().delete(uri, null, null);
                } catch (Throwable ignored) {
                }
            }
            toast("保存失败，请截图保存");
        } finally {
            if (bmp != null && !bmp.isRecycled()) bmp.recycle();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_SAVE_IMAGE) {
            String asset = pendingSaveAsset;
            String name = pendingSaveName;
            pendingSaveAsset = null;
            pendingSaveName = null;
            if (granted && asset != null) {
                saveAssetImageNow(asset, name == null ? "ProChat-donate" : name);
            } else {
                toast("没有存储权限，无法保存收款码");
            }
            return;
        }
        if (requestCode != REQ_MIC) return;
        if (granted) {
            startVoiceInternal(pendingVoiceLocale);
        } else {
            callJs("onVoiceError", JSONObject.quote("没有麦克风权限，无法语音输入"));
        }
    }

    private class VoiceListener implements RecognitionListener {
        private void emit(Bundle results, boolean isFinal) {
            if (results == null) return;
            java.util.ArrayList<String> list =
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (list == null || list.isEmpty()) return;
            callJs("onVoice", JSONObject.quote(list.get(0)), isFinal ? "true" : "false");
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            callJs("onVoiceStart", null);
        }

        @Override
        public void onBeginningOfSpeech() {
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
        }

        @Override
        public void onError(int error) {
            callJs("onVoiceError", JSONObject.quote(voiceErrorText(error)));
            stopVoiceInternal();
        }

        @Override
        public void onResults(Bundle results) {
            emit(results, true);
            callJs("onVoiceEnd", null);
            stopVoiceInternal();
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            emit(partialResults, false);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }
    }

    private static String voiceErrorText(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "录音出错了，检查一下麦克风";
            case SpeechRecognizer.ERROR_CLIENT:
                return "语音识别客户端错误";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "没有麦克风权限";
            case SpeechRecognizer.ERROR_NETWORK:
                return "语音识别需要联网，请检查网络";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "语音识别网络超时";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "没听清，再说一次";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "识别器忙，稍后再试";
            case SpeechRecognizer.ERROR_SERVER:
                return "语音服务返回错误";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "没听到声音";
            default:
                return "语音识别出错（" + error + "）";
        }
    }
}
