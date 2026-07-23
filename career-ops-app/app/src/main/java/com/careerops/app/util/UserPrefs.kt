package com.careerops.app.util

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class UserPrefs(context: Context) {

    private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        "career_ops_secure_prefs",
        masterKeyAlias,
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var userEmail: String
        get() = prefs.getString("user_email", "") ?: ""
        set(value) = prefs.edit().putString("user_email", value).apply()

    var userName: String
        get() = prefs.getString("user_name", "") ?: ""
        set(value) = prefs.edit().putString("user_name", value).apply()

    var accessToken: String
        get() = prefs.getString("access_token", "") ?: ""
        set(value) = prefs.edit().putString("access_token", value).apply()

    var refreshToken: String
        get() = prefs.getString("refresh_token", "") ?: ""
        set(value) = prefs.edit().putString("refresh_token", value).apply()

    var clientId: String
        get() = prefs.getString("client_id", "") ?: ""
        set(value) = prefs.edit().putString("client_id", value).apply()

    var clientSecret: String
        get() = prefs.getString("client_secret", "") ?: ""
        set(value) = prefs.edit().putString("client_secret", value).apply()

    var tokenExpiresAt: Long
        get() = prefs.getLong("token_expires_at", 0)
        set(value) = prefs.edit().putLong("token_expires_at", value).apply()

    var bridgeServerUrl: String
        get() = prefs.getString("bridge_url", "http://127.0.0.1:8787") ?: "http://127.0.0.1:8787"
        set(value) = prefs.edit().putString("bridge_url", value).apply()

    var isOnboarded: Boolean
        get() = prefs.getBoolean("is_onboarded", false)
        set(value) = prefs.edit().putBoolean("is_onboarded", value).apply()

    var isAutomationRunning: Boolean
        get() = prefs.getBoolean("automation_running", false)
        set(value) = prefs.edit().putBoolean("automation_running", value).apply()

    val isLoggedIn: Boolean
        get() = userEmail.isNotEmpty() && refreshToken.isNotEmpty()

    fun clear() {
        prefs.edit().clear().apply()
    }
}
