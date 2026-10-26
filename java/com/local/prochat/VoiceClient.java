package com.local.prochat;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 录音 + OpenAI 兼容的 /audio/transcriptions 转写。
 *
 * 不依赖谷歌语音服务；录音文件只发送到用户自己填写的转写接口。
 * 录音格式固定为 16kHz、单声道、16bit PCM WAV，兼容性最好。
 */
class VoiceClient {
    private static final String TAG = "ProChatVoice";
    private static final int SAMPLE_RATE = 16000;
    private static final int MAX_RECORD_MS = 60000;
    private static final int MIN_BYTES = SAMPLE_RATE * 2 / 2; // 至少约 0.5 秒

    private final MainActivity act;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newSingleThreadExecutor();

    private volatile boolean recording;
    private AudioRecord recorder;
    private Thread reader;
    private ByteArrayOutputStream pcm;
    private File wavFile;
    private String baseUrl = "";
    private String apiKey = "";
    private String model = "";
    private String lang = "";
    private JSONObject headers;

    private final Runnable timeout = new Runnable() {
        @Override
        public void run() {
            stop();
        }
    };

    VoiceClient(MainActivity a) {
        act = a;
    }

    boolean isRecording() {
        return recording;
    }

    void start(final JSONObject p) {
        if (recording) return;
        baseUrl = p.optString("baseUrl", "").trim();
        apiKey = p.optString("apiKey", "").trim();
        model = p.optString("model", "").trim();
        lang = p.optString("lang", "").trim();
        headers = p.optJSONObject("headers");

        if (baseUrl.isEmpty()) {
            fail("还没填语音转写接口地址，请到设置里配置");
            return;
        }
        if (model.isEmpty()) {
            fail("还没填语音转写模型，请到设置里配置");
            return;
        }

        try {
            int min = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) min = SAMPLE_RATE * 2;
            int bufSize = Math.max(min, SAMPLE_RATE * 2);
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                cleanupRecorder();
                fail("麦克风初始化失败，请检查是否有其他应用正在录音");
                return;
            }

            pcm = new ByteArrayOutputStream(SAMPLE_RATE * 2 * 8);
            wavFile = new File(act.getCacheDir(), "voice-" + System.currentTimeMillis() + ".wav");
            recorder.startRecording();
            recording = true;
            main.post(new Runnable() {
                @Override
                public void run() {
                    act.callJs("onVoiceStart");
                }
            });

            reader = new Thread(new Runnable() {
                @Override
                public void run() {
                    byte[] buf = new byte[4096];
                    try {
                        while (recording) {
                            int n = recorder == null ? -1 : recorder.read(buf, 0, buf.length);
                            if (n > 0) {
                                synchronized (pcm) {
                                    pcm.write(buf, 0, n);
                                }
                            }
                        }
                    } catch (Throwable t) {
                        Log.w(TAG, "record read failed: " + t);
                    }
                }
            }, "prochat-voice");
            reader.start();
            main.postDelayed(timeout, MAX_RECORD_MS);
        } catch (Throwable t) {
            recording = false;
            cleanupRecorder();
            fail("录音启动失败：" + describe(t));
        }
    }

    void stop() {
        if (!recording) return;
        recording = false;
        main.removeCallbacks(timeout);
        try {
            if (recorder != null) recorder.stop();
        } catch (Throwable ignored) {
        }
        if (reader != null) {
            try {
                reader.join(800);
            } catch (Throwable ignored) {
            }
        }
        cleanupRecorder();

        byte[] data;
        synchronized (pcm) {
            data = pcm.toByteArray();
        }
        if (data.length < MIN_BYTES) {
            deleteWav();
            fail("录音太短，请按住说完一句再结束");
            return;
        }

        try {
            writeWav(wavFile, data);
        } catch (Throwable t) {
            deleteWav();
            fail("录音保存失败：" + describe(t));
            return;
        }

        final File file = wavFile;
        final String base = baseUrl;
        final String key = apiKey;
        final String m = model;
        final String l = lang;
        final JSONObject h = headers;
        main.post(new Runnable() {
            @Override
            public void run() {
                act.callJs("onVoiceEnd");
                act.callJs("onToast", JSONObject.quote("正在识别…"));
            }
        });
        pool.execute(new Runnable() {
            @Override
            public void run() {
                transcribe(file, base, key, m, l, h);
            }
        });
    }

    void cancel() {
        recording = false;
        main.removeCallbacks(timeout);
        try {
            if (recorder != null) recorder.stop();
        } catch (Throwable ignored) {
        }
        cleanupRecorder();
        deleteWav();
    }

    void shutdown() {
        cancel();
        pool.shutdownNow();
    }

    private void transcribe(File file, String base, String key, String m, String language, JSONObject extra) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(ChatClient.endpoint(base, "audio/transcriptions"));
            c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(20000);
            c.setReadTimeout(90000);
            c.setDoOutput(true);
            c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "ProChat/1.0 (Android)");
            if (!key.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + key);
            applyHeaders(c, extra);

            String boundary = "----ProChat" + System.currentTimeMillis();
            c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

            ByteArrayOutputStream body = new ByteArrayOutputStream();
            writeField(body, boundary, "model", m);
            String langCode = langCode(language);
            if (!langCode.isEmpty()) writeField(body, boundary, "language", langCode);
            writeFile(body, boundary, "file", file);
            body.write(("--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));

            byte[] bytes = body.toByteArray();
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = new BufferedOutputStream(c.getOutputStream())) {
                out.write(bytes);
                out.flush();
            }

            int code = c.getResponseCode();
            String text = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
            if (code < 200 || code >= 300) {
                if (code == 404) {
                    throw new IOException("转写接口不存在（HTTP 404），请检查 Base URL 是否支持 /audio/transcriptions");
                }
                if (code == 401 || code == 403) {
                    throw new IOException("转写 Key 没有权限（HTTP " + code + "），请检查 Key 和模型");
                }
                throw new IOException("HTTP " + code + " · " + ChatClient.prettyError(text));
            }
            String result = parseText(text);
            if (result == null || result.trim().isEmpty()) {
                throw new IOException("没有识别到文字，再说一次");
            }
            final String recognized = result.trim();
            main.post(new Runnable() {
                @Override
                public void run() {
                    act.callJs("onVoice", JSONObject.quote(recognized), "true");
                    act.callJs("onVoiceEnd");
                }
            });
        } catch (Throwable t) {
            fail(describe(t));
        } finally {
            if (c != null) c.disconnect();
            if (file != null) file.delete();
        }
    }

    private static void applyHeaders(HttpURLConnection c, JSONObject headers) {
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

    private static void writeField(OutputStream out, String boundary, String name, String value) throws IOException {
        String s = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n"
                + value + "\r\n";
        out.write(s.getBytes(StandardCharsets.UTF_8));
    }

    private static void writeFile(OutputStream out, String boundary, String field, File file) throws IOException {
        String head = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"" + field + "\"; filename=\"" + file.getName() + "\"\r\n"
                + "Content-Type: audio/wav\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        try (InputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        out.write("\r\n".getBytes(StandardCharsets.UTF_8));
    }

    private static String parseText(String raw) {
        if (raw == null) return "";
        String t = raw.trim();
        if (t.isEmpty()) return "";
        try {
            JSONObject o = new JSONObject(t);
            String text = o.optString("text", "");
            if (!text.isEmpty()) return text;
            JSONObject data = o.optJSONObject("data");
            if (data != null) {
                text = data.optString("text", "");
                if (!text.isEmpty()) return text;
            }
            text = o.optString("result", "");
            if (!text.isEmpty()) return text;
        } catch (Throwable ignored) {
        }
        // 少数服务直接返回纯文本
        return t.startsWith("{") || t.startsWith("[") ? "" : t;
    }

    private static String langCode(String locale) {
        String v = locale == null ? "" : locale.trim().toLowerCase();
        if (v.isEmpty() || "auto".equals(v)) return "";
        if (v.startsWith("zh")) return "zh";
        if (v.startsWith("en")) return "en";
        if (v.startsWith("ja")) return "ja";
        if (v.startsWith("ko")) return "ko";
        if (v.startsWith("yue")) return "yue";
        return v.split("[-_]")[0];
    }

    private static void writeWav(File file, byte[] pcm) throws IOException {
        int dataLen = pcm.length;
        int riffLen = 36 + dataLen;
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(new byte[]{'R', 'I', 'F', 'F'});
            writeIntLE(out, riffLen);
            out.write(new byte[]{'W', 'A', 'V', 'E'});
            out.write(new byte[]{'f', 'm', 't', ' '});
            writeIntLE(out, 16);
            writeShortLE(out, 1);       // PCM
            writeShortLE(out, 1);       // mono
            writeIntLE(out, SAMPLE_RATE);
            writeIntLE(out, SAMPLE_RATE * 2);
            writeShortLE(out, 2);
            writeShortLE(out, 16);
            out.write(new byte[]{'d', 'a', 't', 'a'});
            writeIntLE(out, dataLen);
            out.write(pcm);
        }
    }

    private static void writeIntLE(OutputStream out, int v) throws IOException {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
        out.write((v >> 16) & 0xff);
        out.write((v >> 24) & 0xff);
    }

    private static void writeShortLE(OutputStream out, int v) throws IOException {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
    }

    private void cleanupRecorder() {
        try {
            if (recorder != null) recorder.release();
        } catch (Throwable ignored) {
        }
        recorder = null;
        reader = null;
    }

    private void deleteWav() {
        try {
            if (wavFile != null) wavFile.delete();
        } catch (Throwable ignored) {
        }
        wavFile = null;
    }

    private void fail(final String msg) {
        main.post(new Runnable() {
            @Override
            public void run() {
                act.callJs("onVoiceError", JSONObject.quote(msg == null ? "语音识别失败" : msg));
            }
        });
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

    private static String describe(Throwable t) {
        if (t == null) return "未知错误";
        Throwable root = t;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        if (root instanceof SocketTimeoutException) return "语音转写超时，请稍后重试";
        if (root instanceof UnknownHostException) return "语音转写域名解析失败，请检查网络和接口地址";
        String m = root.getMessage();
        if (m == null || m.trim().isEmpty()) m = root.getClass().getSimpleName();
        return m;
    }
}
