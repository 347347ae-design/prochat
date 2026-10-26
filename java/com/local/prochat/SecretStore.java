package com.local.prochat;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * API Key 用 Android Keystore 里的 AES-GCM 密钥加密后再落盘。
 * Keystore 不可用时降级为明文存储（加 "raw:" 前缀），保证功能可用。
 */
class SecretStore {
    private static final String ALIAS = "prochat_master_key";
    private static final String PREFS = "prochat_secrets";
    private final SharedPreferences sp;

    SecretStore(Context c) {
        sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private SecretKey masterKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            return (SecretKey) ks.getKey(ALIAS, null);
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    synchronized void set(String name, String value) {
        if (value == null) value = "";
        if (value.isEmpty()) {
            sp.edit().remove(name).apply();
            return;
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, masterKey());
            byte[] iv = c.getIV();
            byte[] enc = c.doFinal(value.getBytes("UTF-8"));
            byte[] all = new byte[iv.length + enc.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(enc, 0, all, iv.length, enc.length);
            sp.edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
        } catch (Throwable t) {
            sp.edit().putString(name, "raw:" + value).apply();
        }
    }

    synchronized String get(String name) {
        String v = sp.getString(name, null);
        if (v == null || v.isEmpty()) return "";
        try {
            if (v.startsWith("raw:")) return v.substring(4);
            byte[] all = Base64.decode(v, Base64.NO_WRAP);
            int ivLen = 12;
            byte[] iv = new byte[ivLen];
            byte[] enc = new byte[all.length - ivLen];
            System.arraycopy(all, 0, iv, 0, ivLen);
            System.arraycopy(all, ivLen, enc, 0, enc.length);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, masterKey(), new GCMParameterSpec(128, iv));
            return new String(c.doFinal(enc), "UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    synchronized void remove(String name) {
        sp.edit().remove(name).apply();
    }

    synchronized void clearAll() {
        sp.edit().clear().apply();
    }

    static byte[] randomBytes(int n) {
        byte[] b = new byte[n];
        new SecureRandom().nextBytes(b);
        return b;
    }
}
