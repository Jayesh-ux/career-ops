package com.careerops.app.ui.screens.settings

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.GoogleOAuthActivity
import com.careerops.app.data.remote.CareerOpsApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val WEB_CLIENT_ID = "221656652451-5cb11e7qhkkngdjbs6emaiqidt4a93dr.apps.googleusercontent.com"

/**
 * One-time Google login for portals — user-friendly first.
 *
 * The SAME login the user already did for Gmail/IMAP also leaves browser
 * session cookies in the app's WebView. This screen reuses that: it checks the
 * saved session and, if present, just confirms it (zero extra steps). If not,
 * it offers a single "Sign in with Google" button that runs the familiar WebView
 * login and captures the cookies. The raw in-app browser is hidden behind an
 * "Advanced" toggle for troubleshooting / power users.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PortalLoginScreen(
    portalName: String,
    startUrl: String,
    api: CareerOpsApi,
    onDone: () -> Unit = {},
    onClose: () -> Unit = {},
    inOnboarding: Boolean = false
) {
    val context = LocalContext.current
    var screenshotB64 by remember { mutableStateOf("") }
    var liveUrl by remember { mutableStateOf("") }
    var liveTitle by remember { mutableStateOf("") }
    var hasGoogle by remember { mutableStateOf(false) }
    var formVisible by remember { mutableStateOf(false) }
    var googleSignedIn by remember { mutableStateOf(false) }
    var hasGaps by remember { mutableStateOf(false) }
    var onGoogleAuth by remember { mutableStateOf(false) }
    var accounts by remember { mutableStateOf<List<String>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var finished by remember { mutableStateOf(false) }

    var typingText by remember { mutableStateOf("") }
    var navText by remember { mutableStateOf(startUrl) }
    var displayedWidth by remember { mutableStateOf(0) }
    var displayedHeight by remember { mutableStateOf(0) }
    var alreadyConnected by remember { mutableStateOf(false) }
    var showAdvanced by remember { mutableStateOf(false) }
    var sessionOpen by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()
    val pageW = 1280f
    val pageH = 800f

    fun decodeBmp(b64: String): Bitmap? {
        return if (b64.isEmpty()) null
        else try {
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) { null }
    }

    fun refreshConnection() {
        scope.launch {
            try {
                val st = api.getPortalSessionStatus()
                alreadyConnected = (st["googleSession"] as? Boolean) == true
                error = if (alreadyConnected) "" else "Not connected yet — tap “Sign in with Google” to connect."
            } catch (e: Exception) {
                error = e.message ?: "Could not reach the server. Check that career-ops is running and try again."
            }
        }
    }

    // One login powers both IMAP and portals: if the WebView OAuth already
    // seeded a Google session, there is nothing to do — just confirm & continue.
    LaunchedEffect(api) {
        try {
            val st = api.getPortalSessionStatus()
            if ((st["googleSession"] as? Boolean) == true) {
                alreadyConnected = true
                loading = false
                return@LaunchedEffect
            }
            error = "Connect your job portals so applications can be auto-filled for you."
        } catch (_: Exception) {
            error = "Could not reach the server. Check that career-ops is running and try again."
        }
        loading = false
    }

    // Poll the live frame only while the in-app browser session is open.
    LaunchedEffect(api) {
        while (isActive) {
            delay(1600)
            if (finished || alreadyConnected) break
            if (!sessionOpen) continue
            try {
                val st = api.getLoginSessionState()
                if (st["success"] == true) {
                    screenshotB64 = st["screenshot"] as? String ?: ""
                    liveUrl = st["url"] as? String ?: ""
                    liveTitle = st["title"] as? String ?: ""
                    hasGoogle = (st["hasGoogle"] as? Boolean) == true
                    formVisible = (st["formVisible"] as? Boolean) == true
                    googleSignedIn = (st["googleSignedIn"] as? Boolean) == true
                    hasGaps = (st["hasGaps"] as? Boolean) == true
                    onGoogleAuth = (st["onGoogleAuth"] as? Boolean) == true
                    accounts = (st["accounts"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
                    if (error == "Not connected yet — tap “Sign in with Google” to connect.") error = ""
                } else if (!error.startsWith("Not connected") && !error.startsWith("Could not reach")) {
                    error = st["error"] as? String ?: error
                }
            } catch (_: Exception) { /* transient — keep polling */ }
        }
    }

    val bmp = remember(screenshotB64) {
        screenshotB64.let { if (it.isEmpty()) null else decodeBmp(it) }
    }

    fun applyTap(offset: Offset) {
        val scaleX = if (displayedWidth > 0) pageW / displayedWidth else 1f
        val scaleY = if (displayedHeight > 0) pageH / displayedHeight else 1f
        scope.launch {
            try {
                val r = api.loginSessionTap(
                    mapOf("x" to (offset.x * scaleX).toInt(), "y" to (offset.y * scaleY).toInt())
                )
                screenshotB64 = r["screenshot"] as? String ?: screenshotB64
            } catch (_: Exception) {}
        }
    }

    fun openBrowserFallback() {
        scope.launch {
            loading = true
            try {
                val opened = api.openLoginSession(mapOf("url" to startUrl))
                if ((opened["success"] as? Boolean) == true) {
                    sessionOpen = true
                    error = ""
                } else {
                    error = opened["error"] as? String ?: "Could not start browser"
                }
            } catch (e: Exception) {
                error = e.message ?: "Could not reach the server"
            }
            loading = false
        }
    }

    // The one-tap path: run the familiar WebView Google login. Its session
    // cookies are extracted and seeded to the Playwright profile by the
    // GoogleOAuthActivity, so portals connect with the same login as IMAP.
    val oauthLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val cookies = result.data?.getStringExtra("google_cookies").orEmpty()
            scope.launch {
                if (cookies.isNotEmpty()) {
                    try { api.seedLoginSession(mapOf("cookieString" to cookies)) } catch (_: Exception) {}
                }
                try {
                    val st = api.getPortalSessionStatus()
                    alreadyConnected = (st["googleSession"] as? Boolean) == true
                    error = if (alreadyConnected) "" else "Couldn't confirm the session yet. Tap “Sign in with Google” again, or use the in-app browser below."
                } catch (e: Exception) {
                    error = e.message ?: "Could not reach the server"
                }
            }
        } else {
            error = "Google sign-in was cancelled. Try again, or use the in-app browser below."
        }
    }

    fun launchGoogleSignIn() {
        val authUri = "https://accounts.google.com/o/oauth2/v2/auth?" +
            "client_id=$WEB_CLIENT_ID&" +
            "redirect_uri=https://career-ops.app&" +
            "response_type=code&" +
            "scope=openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly&" +
            "access_type=offline&" +
            "prompt=select_account"
        val intent = GoogleOAuthActivity.createIntent(context, authUri)
        oauthLauncher.launch(intent)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (inOnboarding) "Connect your job portals" else "One-time Login — $portalName") },
                navigationIcon = {
                    IconButton(onClick = onClose) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // ── Already connected (one-login-for-both) ──
            if (alreadyConnected) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF2E7D32))
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.CheckCircle, null, tint = Color.White)
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text("Portals connected!", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                            Text(
                                "Your Google login is saved — Internshala, Naukri, Shine & more will auto-fill your applications.",
                                color = Color.White, fontSize = 12.sp, lineHeight = 16.sp
                            )
                        }
                    }
                }
                Button(
                    onClick = onDone,
                    modifier = Modifier.fillMaxWidth().height(56.dp)
                ) {
                    Text("Continue", fontSize = 16.sp)
                }
                return@Column
            }

            // ── One-tap connect ──
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Connect your job portals", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        if (inOnboarding)
                            "One Google login powers your emails AND auto-fill on Internshala, Naukri, Shine & more. " +
                            "Tap below — no password needed again."
                        else
                            "Reconnect your Google login so applications can be auto-filled on Internshala, Naukri, Shine & more.",
                        fontSize = 13.sp, lineHeight = 18.sp
                    )
                    Spacer(modifier = Modifier.height(14.dp))
                    Button(
                        onClick = { launchGoogleSignIn() },
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        Icon(Icons.Default.Person, null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sign in with Google", fontSize = 15.sp)
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    TextButton(
                        onClick = {
                            showAdvanced = !showAdvanced
                            if (showAdvanced) openBrowserFallback()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            if (showAdvanced) "Hide the in-app browser" else "Trouble signing in? Use the in-app browser",
                            fontSize = 12.sp
                        )
                    }
                }
            }

            if (error.isNotBlank()) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)
                ) {
                    Text(
                        error,
                        modifier = Modifier.padding(12.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        fontSize = 13.sp
                    )
                }
            }

            // ── Advanced: live in-app browser (troubleshooting / power users) ──
            if (showAdvanced) {
                if (loading) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                            Spacer(modifier = Modifier.width(12.dp))
                            Text("Opening the in-app browser…", fontSize = 13.sp)
                        }
                    }
                }

                // Tap-to-sign-in account chips (Google account chooser)
                if (accounts.isNotEmpty() && !googleSignedIn) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text("Choose an account", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            accounts.forEach { acc ->
                                OutlinedButton(
                                    onClick = {
                                        scope.launch {
                                            try {
                                                val r = api.loginSessionAccount(mapOf("email" to acc))
                                                screenshotB64 = r["screenshot"] as? String ?: screenshotB64
                                            } catch (_: Exception) {}
                                        }
                                    },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(Icons.Default.Person, null, modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(acc, maxLines = 1)
                                }
                            }
                        }
                    }
                }

                // Live browser frame
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(pageW / pageH)
                        .background(Color(0xFF111111))
                        .onSizeChanged { displayedWidth = it.width; displayedHeight = it.height }
                        .pointerInput(bmp) {
                            detectTapGestures { offset -> applyTap(offset) }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    val image = bmp
                    if (image != null) {
                        Image(
                            bitmap = image.asImageBitmap(),
                            contentDescription = "Live portal login view",
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Text("Waiting for browser…", color = Color.White, fontSize = 13.sp)
                    }
                }

                Text("Page: ${liveTitle.ifEmpty { "…" }}", fontSize = 11.sp, color = MaterialTheme.colorScheme.outline, maxLines = 1)
                Text(liveUrl, fontSize = 11.sp, color = MaterialTheme.colorScheme.outline, maxLines = 1)

                // Navigation controls
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = {
                        scope.launch {
                            try { val r = api.loginSessionBack(); screenshotB64 = r["screenshot"] as? String ?: screenshotB64 } catch (_: Exception) {}
                        }
                    }) { Icon(Icons.Default.ArrowBack, null, modifier = Modifier.size(16.dp)); Text(" Back") }
                    OutlinedTextField(
                        value = navText, onValueChange = { navText = it },
                        label = { Text("URL") }, modifier = Modifier.weight(1f), singleLine = true
                    )
                    Button(onClick = {
                        scope.launch {
                            try {
                                val r = api.loginSessionNavigate(mapOf("url" to navText.trim()))
                                screenshotB64 = r["screenshot"] as? String ?: screenshotB64
                                liveUrl = r["url"] as? String ?: liveUrl
                            } catch (_: Exception) {}
                        }
                    }) { Text("Go") }
                }

                // Typing (for passwords / email)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = typingText, onValueChange = { typingText = it },
                        label = { Text("Type into focused field (e.g. password)") },
                        modifier = Modifier.weight(1f), singleLine = true
                    )
                    Button(onClick = {
                        scope.launch {
                            try {
                                val r = api.loginSessionType(mapOf("text" to typingText))
                                screenshotB64 = r["screenshot"] as? String ?: screenshotB64
                            } catch (_: Exception) {}
                        }
                    }, enabled = typingText.isNotEmpty()) { Text("Type") }
                }

                Button(
                    onClick = {
                        scope.launch {
                            saving = true
                            try {
                                val r = api.finishLoginSession()
                                finished = true
                                val google = (r["googleSession"] as? Boolean) == true
                                if (google) {
                                    error = ""
                                    onDone()
                                } else {
                                    error = "No Google session detected. Sign in with Google first."
                                }
                            } catch (e: Exception) {
                                error = e.message ?: "Finish failed"
                            }
                            saving = false
                        }
                    },
                    enabled = !saving && !finished,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (saving) CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text("I'm logged in — Save session")
                }
            }
        }
    }
}
