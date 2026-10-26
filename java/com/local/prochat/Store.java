package com.local.prochat;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 应用私有目录里的键值存储，用来放会话记录等大块 JSON。
 * 比 localStorage 更可靠（不受 WebView 数据清理影响）。
 */
class Store {
    private final File dir;

    Store(Context c) {
        dir = new File(c.getFilesDir(), "store");
        if (!dir.exists()) dir.mkdirs();
    }

    private File file(String key) {
        String safe = key == null ? "null" : key.replaceAll("[^A-Za-z0-9_.-]", "_");
        return new File(dir, safe + ".json");
    }

    String get(String key) {
        File f = file(key);
        if (!f.isFile()) return "";
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int n = 0;
            while (n < buf.length) {
                int r = in.read(buf, n, buf.length - n);
                if (r <= 0) break;
                n += r;
            }
            return new String(buf, 0, n, StandardCharsets.UTF_8);
        } catch (Throwable e) {
            return "";
        }
    }

    void put(String key, String value) {
        File f = file(key);
        File tmp = new File(dir, f.getName() + ".tmp");
        byte[] data = value == null ? new byte[0] : value.getBytes(StandardCharsets.UTF_8);
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(data);
            out.flush();
        } catch (Throwable e) {
            return;
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            tmp.renameTo(f);
        }
    }

    void remove(String key) {
        file(key).delete();
    }

    void clear() {
        File[] fs = dir.listFiles();
        if (fs != null) {
            for (File f : fs) f.delete();
        }
    }
}
