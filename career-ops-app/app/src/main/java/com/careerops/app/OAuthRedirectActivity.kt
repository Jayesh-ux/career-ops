package com.careerops.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class OAuthRedirectActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleRedirect(intent)
        finish()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleRedirect(intent)
        finish()
    }

    private fun handleRedirect(intent: Intent?) {
        val uri = intent?.data ?: return
        val code = uri.getQueryParameter("code") ?: return
        OAuthResultHolder.code = code
    }
}

object OAuthResultHolder {
    @Volatile
    var code: String? = null
}
