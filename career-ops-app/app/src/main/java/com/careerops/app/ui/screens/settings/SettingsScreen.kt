package com.careerops.app.ui.screens.settings

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.data.model.PortalCredsEntry
import com.careerops.app.data.model.PortalRequirement
import com.careerops.app.data.model.PortalCredsRequest
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.UserPrefs
import kotlinx.coroutines.launch

private val PORTAL_LOGIN_URLS = mapOf(
    "Internshala" to "https://internshala.com/login",
    "Naukri" to "https://www.naukri.com/nlogin/login",
    "Shine" to "https://www.shine.com/login",
    "TimesJobs" to "https://www.timesjobs.com/login",
    "Hirist" to "https://www.hirist.com/login",
    "iimjobs" to "https://www.iimjobs.com/login",
    "Foundit" to "https://www.foundit.in/login",
    "Instahyre" to "https://www.instahyre.com/login",
    "Cutshort" to "https://cutshort.io/login",
    "Freshersworld" to "https://www.freshersworld.com/user/login",
    "LinkedIn" to "https://www.linkedin.com/login",
    "Glassdoor" to "https://www.glassdoor.co.in/profile/login.htm",
    "Indeed" to "https://in.indeed.com/account/login",
    "Monster" to "https://www.monsterindia.com/",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit = {},
    onReconnectGmail: () -> Unit = {},
    onEditProfile: () -> Unit = {},
    onStartPortalLogin: (portal: String, url: String) -> Unit = { _, _ -> },
    userPrefs: UserPrefs,
    api: CareerOpsApi? = null
) {
    var bridgeUrl by remember { mutableStateOf(userPrefs.bridgeServerUrl) }
    var bridgeToken by remember { mutableStateOf(userPrefs.bridgeToken) }
    var showResetDialog by remember { mutableStateOf(false) }

    val gmailConnected = userPrefs.refreshToken.isNotEmpty()

    // ── Portal Logins: Google OAuth (primary) + portal password fallback ──
    val scope = rememberCoroutineScope()
    var requirements by remember { mutableStateOf<List<PortalRequirement>>(emptyList()) }
    var savedCreds by remember { mutableStateOf<Map<String, PortalCredsEntry>>(emptyMap()) }
    var loginNote by remember { mutableStateOf("") }
    var portalsLoading by remember { mutableStateOf(true) }
    var portalsError by remember { mutableStateOf("") }
    var editingPortal by remember { mutableStateOf<String?>(null) }
    var portalEmail by remember { mutableStateOf("") }
    var portalPassword by remember { mutableStateOf("") }
    var portalFullName by remember { mutableStateOf("") }
    var portalPhone by remember { mutableStateOf("") }
    var portalSaving by remember { mutableStateOf(false) }
    var portalToast by remember { mutableStateOf("") }

    fun loadPortals() {
        val a = api ?: return
        portalsLoading = true
        portalsError = ""
        scope.launch {
            try {
                val req = a.getPortalRequirements()
                requirements = req.portals.filter { it.loginRequired == true || it.loginRequired == "partial" }
                loginNote = req.loginNote
                val cr = a.getPortalCreds()
                savedCreds = cr.creds.associateBy { it.portal.lowercase() }
            } catch (e: Exception) {
                portalsError = e.message ?: "Could not load portals"
            }
            portalsLoading = false
        }
    }

    fun saveEditingPortal(portal: String) {
        val a = api ?: return
        if (portalEmail.isBlank()) { portalToast = "Email required"; return }
        portalSaving = true
        scope.launch {
            try {
                a.savePortalCreds(
                    PortalCredsRequest(
                        portal = portal,
                        email = portalEmail.trim(),
                        password = portalPassword,
                        fullName = portalFullName.trim(),
                        phone = portalPhone.trim()
                    )
                )
                portalToast = "$portal saved — Google OAuth still preferred"
                editingPortal = null
                loadPortals()
            } catch (e: Exception) {
                portalToast = "Save failed: ${e.message}"
            }
            portalSaving = false
        }
    }

    fun deleteEditingPortal(portal: String) {
        val a = api ?: return
        scope.launch {
            try {
                a.deletePortalCreds(portal)
                portalToast = "$portal removed"
                editingPortal = null
                loadPortals()
            } catch (e: Exception) {
                portalToast = "Delete failed: ${e.message}"
            }
        }
    }

    LaunchedEffect(api) {
        loadPortals()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Email, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Gmail Connection", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    if (gmailConnected) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Column {
                                Text("Connected", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                                Text(userPrefs.userEmail, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedButton(onClick = onReconnectGmail, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Refresh, null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Reconnect Gmail")
                        }
                    } else {
                        Text("Connect your Gmail to send emails, check inbox, and reply to recruiters.", fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(modifier = Modifier.height(12.dp))
                        Button(onClick = onReconnectGmail, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Person, null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Connect with Google")
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = onReconnectGmail, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Default.Lock, null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Use App Password instead")
                        }
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Person, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Account", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Email: ${userPrefs.userEmail.ifEmpty { "Not signed in" }}", fontSize = 14.sp)
                    Text("Name: ${userPrefs.userName.ifEmpty { "Not set" }}", fontSize = 14.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(onClick = onEditProfile, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Edit, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Edit Profile")
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Lock, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Portal Logins", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "We use Google OAuth to log in to job portals and fill application forms automatically. " +
                        "Add a portal password only as a fallback for portals without Google sign-in. " +
                        "Credentials are encrypted and stored per-account.",
                        fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (loginNote.isNotBlank()) {
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(loginNote, fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = { onStartPortalLogin("Google", "https://accounts.google.com/AccountChooser") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Person, null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sign in with Google (one-time)")
                    }
                    Text(
                        "This logs you into your Google account once in the auto-fill browser. " +
                        "From then on, 'Continue with Google' on any portal signs you in automatically.",
                        fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.outline
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Or sign in to a specific portal (or store a fallback password):", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)

                    if (portalsError.isNotBlank()) {
                        Text("⚠️ $portalsError", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                    }
                    if (portalsLoading) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    }

                    val listed = requirements.filter { it.loginRequired == true || it.loginRequired == "partial" }
                    listed.forEach { p ->
                        val existing = savedCreds[p.portal.lowercase()]
                        val isEditing = editingPortal == p.portal
                        HorizontalDivider(modifier = Modifier.padding(vertical = 6.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(p.portal, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                                    if (p.googleOAuth) {
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text("Google OAuth", fontSize = 10.sp, color = MaterialTheme.colorScheme.primary)
                                    }
                                }
                                Text(
                                    existing?.let { "Saved · ${it.email}${if (it.hasPassword) " · password set" else ""}" } ?: "No password stored — Google OAuth will be used",
                                    fontSize = 12.sp, color = MaterialTheme.colorScheme.outline
                                )
                            }
                            if (isEditing) {
                                TextButton(onClick = { editingPortal = null }) { Text("Close") }
                            } else {
                                TextButton(onClick = {
                                    onStartPortalLogin(p.portal, PORTAL_LOGIN_URLS[p.portal] ?: "https://accounts.google.com/AccountChooser")
                                }) { Text("Login") }
                                TextButton(onClick = {
                                    editingPortal = p.portal
                                    portalEmail = existing?.email?.replace("…", "")?.takeIf { it.contains("@") } ?: userPrefs.userEmail
                                    portalPassword = ""
                                    portalFullName = userPrefs.userName
                                    portalPhone = ""
                                }) { Text(existing?.let { "Manage" } ?: "Add") }
                            }
                        }
                        if (isEditing) {
                            Spacer(modifier = Modifier.height(8.dp))
                            OutlinedTextField(
                                value = portalEmail, onValueChange = { portalEmail = it },
                                label = { Text("Email (${p.portal})") }, modifier = Modifier.fillMaxWidth(), singleLine = true
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            OutlinedTextField(
                                value = portalPassword, onValueChange = { portalPassword = it },
                                label = { Text("Password (fallback only)") }, modifier = Modifier.fillMaxWidth(),
                                singleLine = true, visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation()
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            OutlinedTextField(
                                value = portalFullName, onValueChange = { portalFullName = it },
                                label = { Text("Full name on profile") }, modifier = Modifier.fillMaxWidth(), singleLine = true
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            OutlinedTextField(
                                value = portalPhone, onValueChange = { portalPhone = it },
                                label = { Text("Phone on profile") }, modifier = Modifier.fillMaxWidth(), singleLine = true
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { saveEditingPortal(p.portal) }, enabled = !portalSaving) {
                                    if (portalSaving) CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                                    else Text("Save")
                                }
                                if (existing != null) {
                                    OutlinedButton(onClick = { deleteEditingPortal(p.portal) }) { Text("Remove") }
                                }
                            }
                        }
                    }

                    if (requirements.isEmpty() && !portalsLoading) {
                        Text("No login-gated portals detected.", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    }

                    if (portalToast.isNotBlank()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(portalToast, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Notifications, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Automation", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(12.dp))

                    var autoApply by remember { mutableStateOf(userPrefs.autoApply) }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Auto-Apply", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                            Text("Skip draft, send application immediately", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                        }
                        Switch(checked = autoApply, onCheckedChange = {
                            autoApply = it; userPrefs.autoApply = it
                        })
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(8.dp))

                    var autoReply by remember { mutableStateOf(userPrefs.autoReply) }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Auto-Reply", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                            Text("Auto-respond to recruiter emails", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                        }
                        Switch(checked = autoReply, onCheckedChange = {
                            autoReply = it; userPrefs.autoReply = it
                        })
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Settings, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Bridge Server", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(value = bridgeUrl, onValueChange = { bridgeUrl = it }, label = { Text("Server URL") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(value = bridgeToken, onValueChange = { bridgeToken = it }, label = { Text("Bridge Token") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(onClick = { userPrefs.bridgeServerUrl = bridgeUrl; userPrefs.bridgeToken = bridgeToken }) { Text("Save") }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("About", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("career-ops v1.0.0", fontSize = 14.sp)
                    Text("AI-powered job search pipeline", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.onSurface)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Danger Zone", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(onClick = { showResetDialog = true }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Delete, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sign Out & Reset")
                    }
                }
            }
        }
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            title = { Text("Sign Out?") },
            text = { Text("This will clear all local data. You can sign in again.") },
            confirmButton = {
                TextButton(onClick = { userPrefs.clear(); showResetDialog = false }) { Text("Sign Out") }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) { Text("Cancel") }
            }
        )
    }
}
