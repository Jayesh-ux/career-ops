package com.careerops.app.ui.onboarding

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
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
fun ProfileFormScreen(
    email: String,
    api: CareerOpsApi,
    userPrefs: UserPrefs,
    onComplete: () -> Unit
) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(userPrefs.userName) }
    var targetRoles by remember { mutableStateOf("") }
    var location by remember { mutableStateOf("") }
    var compensation by remember { mutableStateOf("") }
    var isSaving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            Icons.Default.Person,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Your Profile",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Help us find the right roles for you.",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(32.dp))

        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text("Full Name") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = email,
            onValueChange = {},
            label = { Text("Email") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = false
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = targetRoles,
            onValueChange = { targetRoles = it },
            label = { Text("Target Roles (comma-separated)") },
            placeholder = { Text("e.g. Full Stack Developer, Frontend Engineer") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = false,
            minLines = 2
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = location,
            onValueChange = { location = it },
            label = { Text("Preferred Location") },
            placeholder = { Text("e.g. Mumbai, Remote India") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = compensation,
            onValueChange = { compensation = it },
            label = { Text("Salary Target") },
            placeholder = { Text("e.g. 3-6 LPA") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(24.dp))

        if (error != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            ) {
                Text(
                    text = error!!,
                    modifier = Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    fontSize = 13.sp
                )
            }
        }

        Button(
            onClick = {
                when {
                    name.isBlank() -> { error = "Name is required"; return@Button }
                    targetRoles.isBlank() -> { error = "Target roles are required"; return@Button }
                    location.isBlank() -> { error = "Location is required"; return@Button }
                    compensation.isBlank() -> { error = "Salary range is required"; return@Button }
                }
                isSaving = true
                error = null
                scope.launch {
                    try {
                        userPrefs.userName = name
                        val roles = targetRoles.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                        api.updateProfile(
                            com.careerops.app.data.model.ProfileUpdateRequest(
                                name = name,
                                email = email,
                                targetRoles = roles,
                                location = location,
                                compensation = compensation
                            )
                        )
                        api.setupUser(
                            email,
                            com.careerops.app.data.model.UserSetupRequest(
                                name = name,
                                targetRoles = roles,
                                location = location,
                                compensation = compensation
                            )
                        )
                        userPrefs.isOnboarded = true
                        isSaving = false
                        onComplete()
                    } catch (e: Exception) {
                        isSaving = false
                        error = "Failed to save: ${e.message}"
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp),
            enabled = !isSaving && name.isNotBlank() && targetRoles.isNotBlank() && location.isNotBlank() && compensation.isNotBlank()
        ) {
            if (isSaving) {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Text("Save & Start", fontSize = 16.sp)
            }
        }
    }
}
