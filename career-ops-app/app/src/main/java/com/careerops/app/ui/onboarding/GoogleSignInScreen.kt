package com.careerops.app.ui.onboarding

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.GoogleOAuthActivity

private const val TAG = "GoogleSignIn"
private const val WEB_CLIENT_ID = "221656652451-5cb11e7qhkkngdjbs6emaiqidt4a93dr.apps.googleusercontent.com"

@Composable
fun GoogleSignInScreen(
    oauthError: String? = null,
    onSignInSuccess: (email: String, authToken: String) -> Unit,
    onSignInError: (String) -> Unit,
    onSessionCookies: (String) -> Unit = {}
) {
    val context = LocalContext.current
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    // ONE Google login, in the app's own browser. The user picks an account
    // they already have. The SAME sign-in produces:
    //   • the auth code  → bridge → Gmail/IMAP access, and
    //   • the WebView session cookies → captured and seeded to Playwright, so
    //     job portals (Internshala, Naukri, Shine …) auto-fill applications.
    val gmailOAuthLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        isLoading = false
        if (result.resultCode == Activity.RESULT_OK) {
            val code = result.data?.getStringExtra("auth_code")
            val googleCookies = result.data?.getStringExtra("google_cookies").orEmpty()
            if (!code.isNullOrEmpty()) {
                // Pass cookies FIRST so they are available when the exchange
                // coroutine builds its request (it now carries them).
                if (googleCookies.isNotEmpty()) onSessionCookies(googleCookies)
                // Email is resolved by the bridge from the ID token.
                onSignInSuccess("", code)
            } else {
                onSignInError("Authorization failed. Please try again.")
            }
        } else {
            onSignInError("Sign-in was cancelled.")
        }
    }

    fun launchBrowserSignIn() {
        isLoading = true
        errorMessage = null
        val authUri = "https://accounts.google.com/o/oauth2/v2/auth?" +
            "client_id=$WEB_CLIENT_ID&" +
            "redirect_uri=https://career-ops.app&" +
            "response_type=code&" +
            "scope=openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify&" +
            "access_type=offline&" +
            "prompt=consent%20select_account"
        val intent = GoogleOAuthActivity.createIntent(context, authUri)
        gmailOAuthLauncher.launch(intent)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Person,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Welcome to career-ops",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "AI-powered job search assistant.\nSign in to get started.",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(8.dp))

        Card(
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
            ),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Default.Email,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text("One Google login", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Text(
                        "Powers your emails AND auto-filled applications on Internshala, Naukri, Shine & more. " +
                        "Your password is never stored.",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        val displayError = errorMessage ?: oauthError
        if (displayError != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            ) {
                Text(
                    text = displayError,
                    modifier = Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    fontSize = 13.sp
                )
            }
        }

        Button(
            onClick = { launchBrowserSignIn() },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            enabled = !isLoading
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Text("Sign in with Google", fontSize = 16.sp)
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            "A Google sign-in page will open — pick the account you already use.",
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.outline,
            textAlign = TextAlign.Center
        )
    }
}
