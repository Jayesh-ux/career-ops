package com.careerops.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.LinkedHashMap

class GoogleOAuthActivity : Activity() {

    companion object {
        private const val EXTRA_AUTH_URL = "auth_url"
        private const val TAG = "GoogleOAuth"
        // How long to keep polling for the session cookies after the redirect.
        private const val COOKIE_POLL_MS = 400L
        private const val COOKIE_POLL_ATTEMPTS = 15 // ~6s total

        fun createIntent(context: Context, authUrl: String): Intent {
            return Intent(context, GoogleOAuthActivity::class.java).apply {
                putExtra(EXTRA_AUTH_URL, authUrl)
            }
        }

        /**
         * Collect the Google session cookies the WebView just minted. Each host
         * query only returns cookies scoped to that URL (host-only cookies like
         * `__Secure-1PSID` on google.com are invisible from accounts.google.com),
         * so probe several hosts and merge by name.
         */
        private fun captureGoogleCookies(): String {
            val hosts = listOf(
                "https://accounts.google.com",
                "https://google.com",
                "https://www.google.com"
            )
            val merged = LinkedHashMap<String, String>()
            for (host in hosts) {
                val cookies = CookieManager.getInstance().getCookie(host).orEmpty()
                for (pair in cookies.split("; ")) {
                    val idx = pair.indexOf('=')
                    if (idx <= 0) continue
                    val name = pair.substring(0, idx).trim()
                    val value = pair.substring(idx + 1).trim()
                    if (name.isNotEmpty() && value.isNotEmpty()) merged.putIfAbsent(name, value)
                }
            }
            return merged.entries.joinToString("; ") { "${it.key}=${it.value}" }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val authUrl = intent.getStringExtra(EXTRA_AUTH_URL) ?: run {
            finish()
            return
        }

        val webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            CookieManager.getInstance().setAcceptCookie(true)

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false

                    // Intercept the redirect back after Google auth
                    if (url.startsWith("https://career-ops.app")) {
                        val uri = Uri.parse(url)
                        val code = uri.getQueryParameter("code")
                        val error = uri.getQueryParameter("error")

                        val resultIntent = Intent()
                        if (code.isNullOrEmpty()) {
                            resultIntent.putExtra("auth_error", error ?: "Authorization failed")
                        } else {
                            resultIntent.putExtra("auth_code", code)
                        }
                        // Poll for the Google session cookies so the same login
                        // can seed the Playwright profile (one login powers IMAP
                        // + portal auto-fill). Some flows (2FA, One Tap) commit
                        // cookies a moment after the code redirect, so keep
                        // trying briefly instead of a single-shot grab.
                        val viewRef = view
                        fun finishWithResult() {
                            if (viewRef == null) {
                                setResult(Activity.RESULT_OK, resultIntent)
                                finish()
                                return
                            }
                            viewRef.postDelayed(object : Runnable {
                                var attempts = 0
                                override fun run() {
                                    val cookies = captureGoogleCookies()
                                    val names = cookies.split("; ")
                                        .mapNotNull { it.substringBefore('=').takeIf { n -> n.isNotBlank() } }
                                    Log.d(TAG, "cookie poll ${++attempts}: ${names.joinToString(",")}")
                                    if (cookies.isNotEmpty() || attempts >= COOKIE_POLL_ATTEMPTS) {
                                        resultIntent.putExtra("google_cookies", cookies)
                                        resultIntent.putExtra("google_cookies_count", names.size)
                                        resultIntent.putExtra("google_cookies_names", names.joinToString(","))
                                        setResult(Activity.RESULT_OK, resultIntent)
                                        finish()
                                    } else {
                                        viewRef.postDelayed(this, COOKIE_POLL_MS)
                                    }
                                }
                            }, COOKIE_POLL_MS)
                        }
                        finishWithResult()
                        return true
                    }

                    // Let WebView handle everything else (Google login pages)
                    return false
                }
            }
        }

        setContentView(webView)
        webView.loadUrl(authUrl)
    }
}
