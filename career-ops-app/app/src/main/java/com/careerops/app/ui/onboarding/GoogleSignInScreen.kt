package com.careerops.app.ui.onboarding

import android.app.Activity
import android.util.Log
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
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import android.util.Log as AndroidLog

private const val TAG = "GoogleSignIn"
private const val WEB_CLIENT_ID = "221656652451-5cb11e7qhkkngdjbs6emaiqidt4a93dr.apps.googleusercontent.com"

@Composable
fun GoogleSignInScreen(
    oauthError: String? = null,
    onSignInSuccess: (email: String, authToken: String) -> Unit,
    onSignInError: (String) -> Unit
) {
    val context = LocalContext.current
    var isLoading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var pendingGmailEmail by remember { mutableStateOf<String?>(null) }

    val gso = remember {
        GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestServerAuthCode(WEB_CLIENT_ID, true)
            .requestEmail()
            .requestScopes(
                Scope("https://www.googleapis.com/auth/gmail.send"),
                Scope("https://www.googleapis.com/auth/gmail.readonly")
            )
            .build()
    }

    val googleSignInClient = remember { GoogleSignIn.getClient(context, gso) }

    val gmailOAuthLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        isLoading = false
        if (result.resultCode == Activity.RESULT_OK) {
            val code = result.data?.getStringExtra("auth_code")
            if (!code.isNullOrEmpty()) {
                // Email may be unknown (standalone "Use browser sign-in" flow).
                // The bridge resolves the real email from the ID token.
                onSignInSuccess(pendingGmailEmail.orEmpty(), code)
            } else {
                onSignInError("Authorization failed.")
            }
            pendingGmailEmail = null
        } else {
            pendingGmailEmail = null
            onSignInError("Gmail authorization was cancelled.")
        }
    }

    val signInLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        isLoading = false
        if (result.resultCode == Activity.RESULT_OK) {
            val task = GoogleSignIn.getSignedInAccountFromIntent(result.data)
            try {
                val account = task.getResult(ApiException::class.java)
                val email = account?.email ?: ""
                val serverAuthCode = account?.serverAuthCode ?: ""
                AndroidLog.d(TAG, "GoogleSignIn OK: email=$email, hasCode=${serverAuthCode.isNotEmpty()}")
                if (email.isNotEmpty() && serverAuthCode.isNotEmpty()) {
                    onSignInSuccess(email, serverAuthCode)
                } else if (email.isNotEmpty()) {
                    onSignInError("NEEDS_GMAIL_AUTH:$email")
                } else {
                    onSignInError("Could not retrieve email from Google account.")
                }
            } catch (e: ApiException) {
                AndroidLog.e(TAG, "GoogleSignIn failed: statusCode=${e.statusCode}", e)
                when (e.statusCode) {
                    12501, 12500, 16 -> onSignInError("Sign-in was cancelled.")
                    12502 -> onSignInError("Sign-in timed out. Please try again.")
                    7 -> onSignInError("Network error. Check your connection.")
                    8 -> onSignInError("Internal Google error. Please try again later.")
                    else -> onSignInError("Google sign-in failed (code: ${e.statusCode}). Try again.")
                }
            }
        } else {
            onSignInError("Sign-in was cancelled.")
        }
    }

    fun launchGmailOAuth(email: String) {
        pendingGmailEmail = email
        isLoading = true
        val authUri = "https://accounts.google.com/o/oauth2/v2/auth?" +
            "client_id=$WEB_CLIENT_ID&" +
            "redirect_uri=https://career-ops.app&" +
            "response_type=code&" +
            "scope=openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly&" +
            "access_type=offline&" +
            "login_hint=$email&" +
            "prompt=consent"
        val intent = GoogleOAuthActivity.createIntent(context, authUri)
        gmailOAuthLauncher.launch(intent)
    }

    val isNeedsGmailAuth = oauthError?.startsWith("NEEDS_GMAIL_AUTH:") == true
    val gmailAuthEmail = oauthError?.removePrefix("NEEDS_GMAIL_AUTH:")

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
                    Text("Gmail access required", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Text(
                        "We use OAuth2 to read and draft emails. Your password is never stored.",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.outline
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        val displayError = if (isNeedsGmailAuth) null else (errorMessage ?: oauthError)
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

        if (isNeedsGmailAuth) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Account connected!", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "Now connect Gmail so we can read and draft emails for you.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                }
            }
            Button(
                onClick = { gmailAuthEmail?.let { launchGmailOAuth(it) } },
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
                    Text("Connect Gmail", fontSize = 16.sp)
                }
            }
        } else {
            Button(
                onClick = {
                    isLoading = true
                    errorMessage = null
                    googleSignInClient.signOut().addOnCompleteListener {
                        signInLauncher.launch(googleSignInClient.signInIntent)
                    }
                },
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

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedButton(
                onClick = {
                    isLoading = true
                    errorMessage = null
                    // Email unknown in this flow; bridge resolves it from the ID token.
                    pendingGmailEmail = ""
                    val authUri = "https://accounts.google.com/o/oauth2/v2/auth?" +
                        "client_id=$WEB_CLIENT_ID&" +
                        "redirect_uri=https://career-ops.app&" +
                        "response_type=code&" +
                        "scope=openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly&" +
                        "access_type=offline&" +
                        "prompt=select_account"
                    val intent = GoogleOAuthActivity.createIntent(context, authUri)
                    gmailOAuthLauncher.launch(intent)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                enabled = !isLoading
            ) {
                Text("Use browser sign-in", fontSize = 14.sp)
            }
        }
    }
}
