package com.careerops.app.ui.screens.settings

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.data.remote.CareerOpsApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * One-time interactive portal/Google login.
 *
 * Renders a live screenshot of the persistent browser profile (driven by the
 * bridge's login-session.mjs) so the user can sign in with Google ONCE. The
 * session cookies are saved into the profile and reused by every future
 * auto-fill run. Supports tap, typing, back, and URL navigation.
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

    // Start the session once, then poll the live frame.
    LaunchedEffect(api) {
        loading = true
        try {
            val opened = api.openLoginSession(mapOf("url" to startUrl))
            if ((opened["success"] as? Boolean) == true) {
                error = ""
            } else {
                error = opened["error"] as? String ?: "Could not start browser session"
            }
        } catch (e: Exception) {
            error = e.message ?: "Could not reach the bridge server"
        }
        loading = false
    }

    LaunchedEffect(api) {
        while (isActive) {
            delay(1600)
            if (finished) break
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
                    error = ""
                } else {
                    error = st["error"] as? String ?: error
                }
            } catch (_: Exception) { /* transient — keep polling */ }
            loading = false
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
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        if (inOnboarding)
                            "Almost done — one Google sign-in unlocks every job portal (Internshala, Naukri, Shine, …). " +
                            "Choose your account below or on the screen — no password needed for accounts already signed in. " +
                            "You can skip this for now and do it later from Settings → Portal Logins."
                        else
                            "Sign in once with Google here. Your session is saved to this device and " +
                            "reused automatically for every future auto-fill (Internshala, Naukri, Shine, ...). " +
                            "Tap an account below to sign in instantly (like the Gmail account picker), or tap the screen to interact.",
                        fontSize = 13.sp, lineHeight = 18.sp
                    )
                    if (hasGoogle) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text("✓ Google sign-in detected on this page — tap it.", fontSize = 12.sp, color = Color(0xFF2E7D32))
                    }
                    when {
                        googleSignedIn -> {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                "✅ Google signed in. Complete any consent (Continue/Allow) if asked, then tap “I'm logged in — Save session”.",
                                fontSize = 12.sp, color = Color(0xFF2E7D32)
                            )
                        }
                        onGoogleAuth -> {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                if (accounts.isNotEmpty())
                                    "⚠️ Google is NOT signed in yet. Tap the account you want above, then complete any password/verification steps until the status turns green."
                                else
                                    "⚠️ On Google's sign-in page — Google is NOT signed in yet. Tap the email field, type it, continue, type your password, and complete any verification, all the way to the end.",
                                fontSize = 12.sp, color = Color(0xFFB26A00)
                            )
                        }
                        hasGaps && !googleSignedIn -> {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                "⚠️ Partial Google session only — not fully signed in. Keep going through the sign-in until the status turns green.",
                                fontSize = 12.sp, color = Color(0xFFB26A00)
                            )
                        }
                        formVisible && liveUrl.contains("google") -> {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text("✓ On Google's sign-in page. Enter your Google credentials to continue.", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }

            if (error.isNotBlank()) {
                Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer)) {
                    Text(error, modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer, fontSize = 13.sp)
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
                        Text(
                            "Tap an account to sign in — no password needed if its session is still valid. " +
                            "Accounts not shown here need a one-time email + password login.",
                            fontSize = 11.sp, lineHeight = 15.sp, color = MaterialTheme.colorScheme.outline
                        )
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
                } else if (loading) {
                    CircularProgressIndicator()
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
                            val count = r["cookieCount"] as? Number ?: 0
                            if (google) {
                                error = ""
                                onDone()
                            } else {
                                error = if ((count as? Int ?: 0) > 0) {
                                    "Session saved (${count} cookies) but no Google session cookie detected. Sign in with Google first."
                                } else {
                                    "No cookies saved — sign in before finishing."
                                }
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

            if (inOnboarding && !finished) {
                OutlinedButton(
                    onClick = {
                        scope.launch { try { api.finishLoginSession() } catch (_: Exception) {} }
                        onClose()
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Skip for now — I'll do this later")
                }
            }
        }
    }
}
