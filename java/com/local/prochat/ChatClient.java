package com.local.prochat;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLException;

/**
 * 直接调 OpenAI 兼容的 /chat/completions，自己解析 SSE 流式返回。
 * 放在原生层做的好处：没有 CORS 限制、能随时中断、能带自定义请求头。
 */
class ChatClient {
    private static final String TAG = "ProChat";

    private final MainActivity act;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, Req> live = new ConcurrentHashMap<>();

    private static class Req {
        volatile boolean aborted;
        volatile boolean done;
        volatile HttpURLConnection conn;
        volatile String usage;
        final StringBuilder buf = new StringBuilder();
        final StringBuilder rbuf = new StringBuilder();
        volatile boolean flushPosted;
    }

    ChatClient(MainActivity a) {
        act = a;
    }

    void ask(final String id, final String payloadJson) {
        final Req r = new Req();
        live.put(id, r);
        pool.execute(new Runnable() {
            @Override
            public void run() {
                String err = null;
                try {
                    JSONObject p = new JSONObject(payloadJson);
                    runChat(id, r, p);
                } catch (Throwable t) {
                    err = describe(t);
                }
                if (r.done) {
                    live.remove(id);
                    return;
                }
                if (err != null) {
                    fail(id, r, err);
                } else {
                    finish(id, r);
                }
                live.remove(id);
            }
        });
    }

    void stop(String id) {
        Req r = live.get(id);
        if (r == null) return;
        r.aborted = true;
        HttpURLConnection c = r.conn;
        if (c != null) {
            try {
                c.disconnect();
            } catch (Throwable ignored) {
            }
        }
    }

    void shutdown() {
        for (Req r : live.values()) {
            r.aborted = true;
            try {
                if (r.conn != null) r.conn.disconnect();
            } catch (Throwable ignored) {
            }
        }
        live.clear();
        pool.shutdownNow();
    }

    // ---------------------------------------------------------------- chat

    private void runChat(String id, Req r, JSONObject p) throws Exception {
        String baseUrl = p.optString("baseUrl", "").trim();
        String apiKey = p.optString("apiKey", "").trim();
        String model = p.optString("model", "").trim();
        if (baseUrl.isEmpty()) throw new IllegalArgumentException("还没填接口地址，请到设置里添加模型服务");
        if (model.isEmpty()) throw new IllegalArgumentException("还没选模型，请到设置里填写模型名");
        if (r.aborted) return;

        boolean stream = p.optBoolean("stream", true);
        URL url = new URL(endpoint(baseUrl, "chat/completions"));
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        r.conn = c;
        c.setRequestMethod("POST");
        c.setConnectTimeout(30000);
        c.setReadTimeout(180000);
        c.setDoOutput(true);
        c.setDoInput(true);
        c.setUseCaches(false);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        c.setRequestProperty("Accept", stream ? "text/event-stream" : "application/json");
        c.setRequestProperty("User-Agent", "ProChat/1.0 (Android)");
        if (!apiKey.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + apiKey);
        applyExtraHeaders(c, p.optJSONObject("headers"));

        JSONObject body = new JSONObject();
        body.put("model", model);
        body.put("stream", stream);
        JSONArray msgs = p.optJSONArray("messages");
        body.put("messages", msgs == null ? new JSONArray() : msgs);
        if (p.has("temperature")) body.put("temperature", p.optDouble("temperature", 0.7));
        int maxTokens = p.optInt("maxTokens", 0);
        if (maxTokens > 0) body.put("max_tokens", maxTokens);

        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = c.getOutputStream()) {
            out.write(bytes);
            out.flush();
        }

        int code = c.getResponseCode();
        if (code < 200 || code >= 300) {
            String raw = readAll(c.getErrorStream());
            throw new IOException("HTTP " + code + " · " + prettyError(raw));
        }

        InputStream raw = c.getInputStream();
        BufferedInputStream in = new BufferedInputStream(raw, 16384);
        in.mark(1);
        int first = in.read();
        in.reset();
        if (first == '{' || first == '[') {
            parseFull(r, readAll(in));
        } else {
            parseSse(id, r, in);
        }
    }

    private void parseFull(Req r, String text) throws Exception {
        if (text == null || text.trim().isEmpty()) {
            throw new IOException("服务器返回了空响应");
        }
        JSONObject o = new JSONObject(text);
        JSONObject err = o.optJSONObject("error");
        if (err != null) throw new IOException(prettyError(err.toString()));
        JSONArray ch = o.optJSONArray("choices");
        if (ch != null && ch.length() > 0) {
            JSONObject m = ch.optJSONObject(0).optJSONObject("message");
            if (m == null) m = ch.optJSONObject(0);
            String t = m.optString("content", "");
            String rs = m.optString("reasoning_content", m.optString("reasoning", ""));
            synchronized (r) {
                if (!rs.isEmpty()) r.rbuf.append(rs);
                if (!t.isEmpty()) r.buf.append(t);
            }
        }
        JSONObject u = o.optJSONObject("usage");
        if (u != null) r.usage = u.toString();
    }

    private void parseSse(String id, Req r, InputStream raw) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(raw, StandardCharsets.UTF_8));
        String line;
        int guard = 0;
        while ((line = br.readLine()) != null) {
            if (r.aborted) return;
            if (++guard > 200000) break;
            if (line.isEmpty() || line.startsWith(":")) continue;
            String data;
            if (line.startsWith("data:")) {
                data = line.substring(5).trim();
            } else if (line.startsWith("{")) {
                data = line.trim();
            } else {
                continue;
            }
            if (data.isEmpty() || "[DONE]".equals(data)) {
                if ("[DONE]".equals(data)) return;
                continue;
            }
            String err = handleEvent(id, r, data);
            if (err != null) throw new IOException(err);
        }
    }

    private String handleEvent(String id, Req r, String data) {
        JSONObject o;
        try {
            o = new JSONObject(data);
        } catch (Throwable t) {
            return null;
        }
        JSONObject err = o.optJSONObject("error");
        if (err != null) return prettyError(err.toString());
        if (o.has("error") && !o.isNull("error")) {
            Object e = o.opt("error");
            if (e instanceof String) return String.valueOf(e);
        }
        JSONObject u = o.optJSONObject("usage");
        if (u != null) r.usage = u.toString();

        JSONArray ch = o.optJSONArray("choices");
        if (ch == null || ch.length() == 0) return null;
        JSONObject choice = ch.optJSONObject(0);
        if (choice == null) return null;
        JSONObject d = choice.optJSONObject("delta");
        if (d == null) d = choice.optJSONObject("message");
        if (d == null) return null;

        String content = d.optString("content", "");
        String reasoning = d.optString("reasoning_content", d.optString("reasoning", ""));
        if ("null".equals(content)) content = "";
        if ("null".equals(reasoning)) reasoning = "";

        boolean has = false;
        synchronized (r) {
            if (!reasoning.isEmpty()) {
                r.rbuf.append(reasoning);
                has = true;
            }
            if (!content.isEmpty()) {
                r.buf.append(content);
                has = true;
            }
        }
        if (has) scheduleFlush(id, r);
        return null;
    }

    // -------------------------------------------------------------- models

    void listModels(final String id, final String payloadJson) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject p = new JSONObject(payloadJson);
                    String baseUrl = p.optString("baseUrl", "").trim();
                    String apiKey = p.optString("apiKey", "").trim();
                    if (baseUrl.isEmpty()) throw new IllegalArgumentException("缺少接口地址");
                    HttpURLConnection c = (HttpURLConnection) new URL(endpoint(baseUrl, "models")).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setRequestProperty("Accept", "application/json");
                    c.setRequestProperty("User-Agent", "ProChat/1.0 (Android)");
                    if (!apiKey.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + apiKey);
                    applyExtraHeaders(c, p.optJSONObject("headers"));
                    int code = c.getResponseCode();
                    String text = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
                    if (code < 200 || code >= 300) throw new IOException("HTTP " + code + " · " + prettyError(text));
                    JSONArray out = new JSONArray();
                    JSONObject o = new JSONObject(text);
                    JSONArray data = o.optJSONArray("data");
                    if (data == null) data = o.optJSONArray("models");
                    if (data != null) {
                        for (int i = 0; i < data.length(); i++) {
                            JSONObject m = data.optJSONObject(i);
                            if (m == null) {
                                String s = data.optString(i, "");
                                if (!s.isEmpty()) out.put(s);
                                continue;
                            }
                            String mid = m.optString("id", m.optString("name", ""));
                            if (!mid.isEmpty()) out.put(mid);
                        }
                    }
                    act.callJs("onModels", JSONObject.quote(id), out.toString());
                } catch (Throwable t) {
                    act.callJs("onModelsError", JSONObject.quote(id), JSONObject.quote(describe(t)));
                }
            }
        });
    }

    // ------------------------------------------------------------- helpers

    private void scheduleFlush(final String id, final Req r) {
        if (r.flushPosted) return;
        r.flushPosted = true;
        main.post(new Runnable() {
            @Override
            public void run() {
                r.flushPosted = false;
                String t;
                String rs;
                synchronized (r) {
                    t = r.buf.toString();
                    r.buf.setLength(0);
                    rs = r.rbuf.toString();
                    r.rbuf.setLength(0);
                }
                if (!rs.isEmpty()) act.callJs("onReasoning", JSONObject.quote(id), JSONObject.quote(rs));
                if (!t.isEmpty()) act.callJs("onDelta", JSONObject.quote(id), JSONObject.quote(t));
            }
        });
    }

    private void flushNow(String id, Req r) {
        String t;
        String rs;
        synchronized (r) {
            t = r.buf.toString();
            r.buf.setLength(0);
            rs = r.rbuf.toString();
            r.rbuf.setLength(0);
        }
        if (!rs.isEmpty()) act.callJs("onReasoning", JSONObject.quote(id), JSONObject.quote(rs));
        if (!t.isEmpty()) act.callJs("onDelta", JSONObject.quote(id), JSONObject.quote(t));
    }

    private void finish(String id, Req r) {
        if (r.done) return;
        r.done = true;
        flushNow(id, r);
        act.callJs("onDone", JSONObject.quote(id), r.usage == null ? "null" : r.usage);
    }

    private void fail(String id, Req r, String msg) {
        if (r.done) return;
        r.done = true;
        flushNow(id, r);
        if (r.aborted) {
            act.callJs("onDone", JSONObject.quote(id), r.usage == null ? "null" : r.usage);
            return;
        }
        Log.w(TAG, "request failed: " + msg);
        act.callJs("onError", JSONObject.quote(id), JSONObject.quote(msg));
    }

    private static void applyExtraHeaders(HttpURLConnection c, JSONObject headers) {
        if (headers == null) return;
        try {
            Iterator<String> it = headers.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = headers.optString(k, "");
                if (k != null && !k.trim().isEmpty() && v != null && !v.isEmpty()) {
                    c.setRequestProperty(k.trim(), v);
                }
            }
        } catch (Throwable ignored) {
        }
    }

    static String endpoint(String base, String path) {
        String b = base == null ? "" : base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.endsWith("/chat/completions")) b = b.substring(0, b.length() - "/chat/completions".length());
        if (b.endsWith("/completions")) b = b.substring(0, b.length() - "/completions".length());
        if (b.endsWith("/models")) b = b.substring(0, b.length() - "/models".length());
        return b + "/" + path;
    }

    private static String readAll(InputStream in) {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        try {
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        } catch (Throwable ignored) {
        }
        try {
            in.close();
        } catch (Throwable ignored) {
        }
        try {
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return "";
        }
    }

    static String prettyError(String raw) {
        if (raw == null) return "未知错误";
        String t = raw.trim();
        if (t.isEmpty()) return "服务器没有返回内容";
        try {
            JSONObject o = new JSONObject(t);
            Object e = o.opt("error");
            if (e instanceof JSONObject) {
                JSONObject eo = (JSONObject) e;
                String m = eo.optString("message", "");
                if (!m.isEmpty()) return m;
            }
            if (e instanceof String) return (String) e;
            String m = o.optString("message", o.optString("detail", o.optString("msg", "")));
            if (!m.isEmpty()) return m;
        } catch (Throwable ignored) {
        }
        if (t.length() > 400) t = t.substring(0, 400) + "…";
        return t;
    }

    static String describe(Throwable t) {
        if (t == null) return "未知错误";
        Throwable root = t;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        if (root instanceof SocketTimeoutException) {
            return "请求超时：模型响应太慢。可以减少上下文长度或稍后重试";
        }
        if (root instanceof UnknownHostException) {
            return "域名解析失败，请检查网络和接口地址";
        }
        if (root instanceof SSLException) {
            return "SSL 连接失败，请确认接口地址是 https 且证书正常";
        }
        String m = root.getMessage();
        if (m == null || m.trim().isEmpty()) m = root.getClass().getSimpleName();
        if (m.contains("Socket closed") || m.contains("closed")) return "已中断";
        if (m.contains("ECONNREFUSED") || m.contains("Connection refused")) return "连接被拒绝，接口地址或端口不对";
        return m;
    }
}
