package com.local.prochat;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLException;

/**
 * 给更新检查 / 留言板用的轻量 HTTP 客户端。
 * 放在原生层：没有 CORS，能设置超时，也能拿到非 2xx 的响应体交给 JS 显示中文错误。
 */
class NetClient {
    private static final String TAG = "ProChat";
    private static final int MAX_BODY = 1024 * 1024;

    private final MainActivity act;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, HttpURLConnection> live =
            new ConcurrentHashMap<String, HttpURLConnection>();

    NetClient(MainActivity activity) {
        this.act = activity;
    }

    void get(final String id, final String url) {
        request(id, "GET", url, null, null);
    }

    void post(final String id, final String url, final String body) {
        request(id, "POST", url, body, null);
    }

    /** 带自定义请求头的 POST，给 DeepSeek 搜索这类需要 Bearer 鉴权的接口用。 */
    void postAuth(final String id, final String url, final String body, final String headersJson) {
        request(id, "POST", url, body, headersJson);
    }

    void shutdown() {
        for (HttpURLConnection c : live.values()) {
            try { c.disconnect(); } catch (Throwable ignored) {}
        }
        live.clear();
        pool.shutdownNow();
    }

    private void request(final String id, final String method, final String url,
                         final String body, final String headersJson) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    URL u = new URL(url);
                    String scheme = u.getProtocol() == null ? "" : u.getProtocol().toLowerCase();
                    if (!scheme.equals("http") && !scheme.equals("https")) {
                        throw new IOException("只支持 HTTP/HTTPS 地址");
                    }
                    conn = (HttpURLConnection) u.openConnection();
                    live.put(id, conn);
                    conn.setRequestMethod(method);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(20000);
                    conn.setInstanceFollowRedirects(true);
                    conn.setUseCaches(false);
                    conn.setRequestProperty("Accept", "application/json");
                    conn.setRequestProperty("Accept-Encoding", "identity");
                    conn.setRequestProperty("Cache-Control", "no-cache");
                    conn.setRequestProperty("User-Agent", "ProChat/Android");
                    applyHeaders(conn, headersJson);

                    if ("POST".equals(method)) {
                        byte[] data = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
                        conn.setDoOutput(true);
                        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                        conn.setFixedLengthStreamingMode(data.length);
                        OutputStream out = conn.getOutputStream();
                        try {
                            out.write(data);
                        } finally {
                            try { out.close(); } catch (Throwable ignored) {}
                        }
                    }

                    final int code = conn.getResponseCode();
                    InputStream in = (code >= 200 && code < 300)
                            ? conn.getInputStream() : conn.getErrorStream();
                    final String text = readAll(in);

                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            act.callJs("onHttp", JSONObject.quote(id),
                                    String.valueOf(code), JSONObject.quote(text));
                        }
                    });
                } catch (final Throwable t) {
                    Log.w(TAG, "http failed: " + t);
                    final String msg = friendly(t);
                    main.post(new Runnable() {
                        @Override
                        public void run() {
                            act.callJs("onHttpError", JSONObject.quote(id), JSONObject.quote(msg));
                        }
                    });
                } finally {
                    live.remove(id);
                    if (conn != null) {
                        try { conn.disconnect(); } catch (Throwable ignored) {}
                    }
                }
            }
        });
    }

    private static void applyHeaders(HttpURLConnection conn, String headersJson) {
        if (headersJson == null || headersJson.trim().isEmpty()) return;
        try {
            JSONObject o = new JSONObject(headersJson);
            java.util.Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                String v = o.optString(k, "");
                if (k == null || k.isEmpty() || v.isEmpty()) continue;
                conn.setRequestProperty(k, v);
            }
        } catch (Throwable ignored) {
        }
    }

    private static String readAll(InputStream in) {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try {
            byte[] buf = new byte[8192];
            int total = 0;
            int n;
            while ((n = in.read(buf)) >= 0) {
                if (total + n > MAX_BODY) {
                    int keep = Math.max(0, MAX_BODY - total);
                    if (keep > 0) out.write(buf, 0, keep);
                    break;
                }
                out.write(buf, 0, n);
                total += n;
            }
        } catch (Throwable ignored) {
        } finally {
            try { in.close(); } catch (Throwable ignored) {}
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String friendly(Throwable t) {
        if (t instanceof SocketTimeoutException) return "请求超时，请检查网络";
        if (t instanceof UnknownHostException) return "域名解析失败，请检查网络或服务器地址";
        if (t instanceof SSLException) return "HTTPS 证书校验失败";
        String m = t.getMessage();
        if (m != null && m.length() > 0) {
            if (m.contains("CLEARTEXT")) return "系统阻止了明文 HTTP 请求";
            return m;
        }
        return "网络请求失败";
    }
}
