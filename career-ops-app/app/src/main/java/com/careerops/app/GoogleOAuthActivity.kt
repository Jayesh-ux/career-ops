package com.careerops.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class GoogleOAuthActivity : Activity() {

    companion object {
        private const val EXTRA_AUTH_URL = "auth_url"

        fun createIntent(context: Context, authUrl: String): Intent {
            return Intent(context, GoogleOAuthActivity::class.java).apply {
                putExtra(EXTRA_AUTH_URL, authUrl)
            }
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

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false

                    // Intercept the redirect back after Google auth
                    if (url.startsWith("https://career-ops.app")) {
                        val uri = Uri.parse(url)
                        val code = uri.getQueryParameter("code")
                        val error = uri.getQueryParameter("error")

                        val resultIntent = Intent().apply {
                            if (!code.isNullOrEmpty()) {
                                putExtra("auth_code", code)
                                setResult(Activity.RESULT_OK, this)
                            } else {
                                putExtra("auth_error", error ?: "Authorization failed")
                                setResult(Activity.RESULT_CANCELED, this)
                            }
                        }
                        // Let the Google session cookies settle, then grab them
                        // so the same login can seed the Playwright profile
                        // (one login powers IMAP + portal auto-fill).
                        view?.postDelayed({
                            val cookies = CookieManager.getInstance()
                                .getCookie("https://accounts.google.com").orEmpty()
                            resultIntent.putExtra("google_cookies", cookies)
                            setResultActivity(resultIntent)
                        }, 1000L)
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

    private fun setResultActivity(resultIntent: Intent) {
        setResult(RESULT_OK, resultIntent)
        finish()
    }
}
