package com.careerops.app.ui.onboarding

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.UserPrefs
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

@Composable
fun UploadResumeScreen(
    email: String,
    api: CareerOpsApi,
    userPrefs: UserPrefs,
    onUploadSuccess: (name: String, skills: List<String>) -> Unit,
    onSkip: () -> Unit
) {
    val context = LocalContext.current
    var selectedUri by remember { mutableStateOf<Uri?>(null) }
    var fileName by remember { mutableStateOf<String?>(null) }
    var isUploading by remember { mutableStateOf(false) }
    var uploadResult by remember { mutableStateOf<Pair<Boolean, String>?>(null) }
    var extractedName by remember { mutableStateOf("") }
    var extractedSkills by remember { mutableStateOf<List<String>>(emptyList()) }

    val filePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            selectedUri = it
            val cursor = context.contentResolver.query(it, null, null, null, null)
            cursor?.use { c ->
                val nameIdx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (c.moveToFirst() && nameIdx >= 0) {
                    fileName = c.getString(nameIdx)
                }
            }
            if (fileName == null) fileName = "resume.pdf"
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Send,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Upload Your Resume",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "PDF or DOCX format. We'll extract your experience and skills.",
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(32.dp))

        if (selectedUri == null) {
            OutlinedButton(
                onClick = { filePicker.launch("application/pdf") },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
            ) {
                Icon(Icons.Default.Info, contentDescription = null, modifier = Modifier.size(24.dp))
                Spacer(modifier = Modifier.width(12.dp))
                Text("Choose PDF or DOCX", fontSize = 16.sp)
            }
        } else {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Info, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(fileName ?: "resume.pdf", fontWeight = FontWeight.Medium)
                        if (extractedName.isNotEmpty()) {
                            Text("Parsed: $extractedName", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                        }
                    }
                    if (uploadResult?.first == true) {
                        Icon(
                            Icons.Default.CheckCircle,
                            null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (extractedSkills.isNotEmpty()) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)),
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text("Detected skills:", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = extractedSkills.joinToString(", "),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        if (uploadResult?.first == false) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp)
            ) {
                Text(
                    text = uploadResult?.second ?: "Upload failed",
                    modifier = Modifier.padding(12.dp),
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    fontSize = 13.sp
                )
            }
        }

        if (selectedUri != null && uploadResult?.first != true) {
            Button(
                onClick = {
                    isUploading = true
                    uploadResult = null
                    try {
                        val uri = selectedUri ?: return@Button
                        val inputStream = context.contentResolver.openInputStream(uri) ?: return@Button
                        val tempFile = File(context.cacheDir, fileName ?: "resume.pdf")
                        FileOutputStream(tempFile).use { out -> inputStream.copyTo(out) }
                        inputStream.close()

                        val requestFile = tempFile.asRequestBody("application/pdf".toMediaTypeOrNull())
                        val filePart = MultipartBody.Part.createFormData("resume", tempFile.name, requestFile)
                        val emailPart = email.toRequestBody("text/plain".toMediaTypeOrNull())

                        CoroutineScope(Dispatchers.IO).launch {
                            try {
                                val response = api.uploadResume(filePart, emailPart)
                                withContext(Dispatchers.Main) {
                                    isUploading = false
                                    if (response.success) {
                                        extractedName = response.name
                                        extractedSkills = response.skills
                                        uploadResult = Pair(true, "Uploaded successfully!")
                                        userPrefs.userName = response.name
                                        onUploadSuccess(response.name, response.skills)
                                    } else {
                                        uploadResult = Pair(false, "Upload failed. Try a different file.")
                                    }
                                }
                            } catch (e: Exception) {
                                withContext(Dispatchers.Main) {
                                    isUploading = false
                                    uploadResult = Pair(false, "Error: ${e.message}")
                                }
                            }
                        }
                    } catch (e: Exception) {
                        isUploading = false
                        uploadResult = Pair(false, "Error: ${e.message}")
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                enabled = !isUploading
            ) {
                if (isUploading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Upload & Extract", fontSize = 16.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        TextButton(onClick = onSkip) {
            Text("Skip for now", color = MaterialTheme.colorScheme.outline)
        }
    }
}
