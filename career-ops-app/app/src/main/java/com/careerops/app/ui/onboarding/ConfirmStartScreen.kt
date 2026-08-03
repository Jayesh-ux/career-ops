package com.careerops.app.ui.onboarding

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.UserPrefs
import kotlinx.coroutines.launch

@Composable
fun ConfirmStartScreen(
    email: String,
    api: CareerOpsApi,
    userPrefs: UserPrefs,
    onStart: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var isChecking by remember { mutableStateOf(true) }
    var doctorResult by remember { mutableStateOf<Map<String, Any>?>(null) }
    var setupComplete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var hasResume by remember { mutableStateOf(false) }
    var hasProfile by remember { mutableStateOf(false) }
    var hasGoogleSession by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        scope.launch {
            var profileComplete = false
            try {
                val profile = api.getProfile()
                profileComplete = profile.name.isNotEmpty() &&
                            profile.targetRoles.isNotEmpty() &&
                            profile.location.isNotEmpty()
                hasProfile = profileComplete
            } catch (e: Exception) {
                hasProfile = false
            }
            try {
                val st = api.getPortalSessionStatus()
                hasGoogleSession = (st["googleSession"] as? Boolean) == true
            } catch (e: Exception) {
                hasGoogleSession = false
            }
            // Resume is considered uploaded if profile exists (setupUser creates a skeleton cv.md)
            try {
                val files = api.getUserFiles(email)
                hasResume = profileComplete || files.files.any { it.path.contains("cv.md", ignoreCase = true) }
            } catch (e: Exception) {
                hasResume = profileComplete
            }
            try {
                val doctor = api.doctor()
                doctorResult = mapOf(
                    "onboardingNeeded" to doctor.onboardingNeeded,
                    "missing" to doctor.missing,
                    "warnings" to doctor.warnings
                )
            } catch (e: Exception) {
                // doctor is non-essential
            }
            isChecking = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        if (isChecking) {
            Icon(
                Icons.Default.Refresh,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(24.dp))
            CircularProgressIndicator()
            Spacer(modifier = Modifier.height(16.dp))
            Text("Checking your setup...", fontSize = 16.sp)
        } else if (setupComplete) {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "You're all set!",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "career-ops is ready to start finding jobs for you.",
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(32.dp))
            Button(
                onClick = onStart,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                Text("Start Job Search", fontSize = 16.sp)
            }
        } else {
            Icon(
                Icons.Default.CheckCircle,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "Confirm & Start",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(16.dp))

            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    SetupCheckItem("Google Account", userPrefs.userEmail.isNotEmpty(), userPrefs.userEmail)
                    SetupCheckItem("Resume", hasResume, if (hasResume) "Uploaded" else "Not uploaded — go back and upload")
                    SetupCheckItem("Profile", hasProfile, if (hasProfile) userPrefs.userName else "Incomplete — go back and fill all fields")
                    SetupCheckItem("Job Portals (Google session)", hasGoogleSession, if (hasGoogleSession) "Session saved — auto-fill ready" else "Missing — go back and sign in with Google on the portals step")
                    SetupCheckItem("OAuth2 Token", userPrefs.refreshToken.isNotEmpty(), "Configured")
                }
            }

            if (error != null) {
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(error!!, color = MaterialTheme.colorScheme.onErrorContainer, fontSize = 13.sp)
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = {
                    if (!hasResume) {
                        error = "Please go back and upload your resume first."
                        return@Button
                    }
                    if (!hasProfile) {
                        error = "Please go back and complete your profile (name, roles, location, salary)."
                        return@Button
                    }
                    if (!hasGoogleSession) {
                        error = "Please go back to the portals step and complete the Google sign-in — Chat opens only after every dependency is ready."
                        return@Button
                    }
                    scope.launch {
                        try {
                            userPrefs.isOnboarded = true
                            setupComplete = true
                        } catch (e: Exception) {
                            error = e.message
                        }
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                enabled = hasResume && hasProfile && hasGoogleSession
            ) {
                Text("Confirm & Start", fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun SetupCheckItem(label: String, isComplete: Boolean, detail: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            if (isComplete) Icons.Default.CheckCircle else Icons.Default.Warning,
            contentDescription = null,
            tint = if (isComplete) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(20.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            Text(detail, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
        }
    }
}
