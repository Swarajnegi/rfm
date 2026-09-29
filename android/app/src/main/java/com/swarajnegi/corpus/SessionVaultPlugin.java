package com.swarajnegi.corpus;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SessionVault")
public class SessionVaultPlugin extends Plugin {
    private static final String ALIAS = "corpus.auth.v1";
    private synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    private String name(PluginCall call) {
        String name = call.getString("key", "");
        if (!name.startsWith("corpus-auth") || name.length() > 160) throw new IllegalArgumentException();
        return name;
    }
    @PluginMethod public void get(PluginCall call) {
        try {
            String raw = getContext().getSharedPreferences("corpus_auth_vault", 0).getString(name(call), null);
            JSObject result = new JSObject();
            if (raw != null) {
                String[] parts = raw.split(":", 2);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception e) { call.reject("Cannot unlock the saved session. Please sign in again."); }
    }
    @PluginMethod public void set(PluginCall call) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" +
                Base64.encodeToString(cipher.doFinal(call.getString("value", "").getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!getContext().getSharedPreferences("corpus_auth_vault", 0).edit().putString(name(call), encrypted).commit())
                throw new IllegalStateException();
            call.resolve();
        } catch (Exception e) { call.reject("Cannot save the session securely."); }
    }
    @PluginMethod public void remove(PluginCall call) {
        try {
            if (!getContext().getSharedPreferences("corpus_auth_vault", 0).edit().remove(name(call)).commit())
                throw new IllegalStateException();
            call.resolve();
        } catch (Exception e) { call.reject("Cannot remove the saved session."); }
    }
}
