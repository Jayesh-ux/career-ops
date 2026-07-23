package com.careerops.app.ui.chat

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.careerops.app.data.model.*
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.UserPrefs
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class ChatMessage {
    data class User(val text: String) : ChatMessage()
    data class System(val text: String, val timestamp: String = "") : ChatMessage()
    data class Typing(val label: String = "Thinking...") : ChatMessage()
    data class JobCard(
        val company: String,
        val role: String,
        val score: String = "",
        val url: String = "",
        val location: String = "",
        val onApply: (() -> Unit)? = null,
        val onSkip: (() -> Unit)? = null
    ) : ChatMessage()
    data class EmailDraft(
        val to: String,
        val company: String,
        val role: String,
        val body: String,
        val subject: String = "",
        val contactBlock: String = "",
        val onSend: (() -> Unit)? = null,
        val onEdit: (() -> Unit)? = null
    ) : ChatMessage()
}

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val api: CareerOpsApi,
    private val prefs: UserPrefs
) : ViewModel() {

    companion object {
        private const val TAG = "CareerOps"
    }

    val messages = mutableStateListOf<ChatMessage>()
    var isProcessing by mutableStateOf(false)
        private set
    
    var showDebug by mutableStateOf(false)
        private set

    val debugLog = mutableStateListOf<DebugEntry>()

    private var currentSessionId: String? = null

    init {
        messages.add(ChatMessage.System(
            "Welcome to career-ops! I'm your AI job search assistant.\n\n" +
            "Try:\n" +
            "• \"Find remote frontend jobs\"\n" +
            "• \"Evaluate https://company.com/jobs/123\"\n" +
            "• \"Draft application for Adobe\"\n" +
            "• \"Check my inbox\"\n" +
            "• \"Show my applications\"\n\n" +
            "Toggle debug (top-right bug icon) to see connection details."
        ))
        debugLog.add(DebugEntry("init", "ViewModel created, session: none"))
    }

    fun toggleDebug() {
        showDebug = !showDebug
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        
        messages.add(ChatMessage.User(text))
        isProcessing = true
        messages.add(ChatMessage.Typing())

        val startTime = System.currentTimeMillis()
        debugLog.add(DebugEntry("send", "message='${text.take(50)}', session=$currentSessionId"))

        viewModelScope.launch {
            try {
                debugLog.add(DebugEntry("api", "Calling POST /chat..."))
                val response = api.chat(ChatRequest(
                    message = text,
                    sessionId = currentSessionId
                ))
                
                val elapsed = System.currentTimeMillis() - startTime
                removeTyping()
                currentSessionId = response.sessionId
                
                debugLog.add(DebugEntry("response",
                    "ok=${response.success}, " +
                    "session=${response.sessionId}, " +
                    "content=${response.content.take(80)}, " +
                    "actions=${response.actions.size}, " +
                    "error=${response.error}, " +
                    "time=${elapsed}ms"
                ))
                
                if (response.success && response.content.isNotBlank()) {
                    messages.add(ChatMessage.System(response.content))
                }
                
                for (action in response.actions) {
                    debugLog.add(DebugEntry("action", "type=${action.type}, data=${action.data}"))
                    when (action.type) {
                        "job_card" -> {
                            messages.add(ChatMessage.JobCard(
                                company = action.data["company"] ?: "Unknown",
                                role = action.data["role"] ?: "",
                                score = action.data["score"] ?: "",
                                url = action.data["url"] ?: "",
                                location = action.data["location"] ?: "",
                                onApply = {
                                    viewModelScope.launch {
                                        draftApplication(
                                            action.data["company"] ?: "",
                                            action.data["role"] ?: ""
                                        )
                                    }
                                },
                                onSkip = {
                                    messages.add(ChatMessage.System("Skipped: ${action.data["company"]}"))
                                }
                            ))
                        }
                        "email_draft" -> {
                            messages.add(ChatMessage.EmailDraft(
                                to = action.data["to"] ?: "",
                                company = action.data["company"] ?: "",
                                role = action.data["role"] ?: "",
                                body = action.data["body"] ?: "",
                                subject = action.data["subject"] ?: "",
                                contactBlock = action.data["contactBlock"] ?: "",
                                onSend = {
                                    viewModelScope.launch {
                                        sendEmail(
                                            to = action.data["to"] ?: "",
                                            subject = action.data["subject"] ?: "",
                                            body = action.data["body"] ?: "",
                                            company = action.data["company"] ?: "",
                                            role = action.data["role"] ?: ""
                                        )
                                    }
                                },
                                onEdit = {
                                    messages.add(ChatMessage.System("Edit the draft above and send it back."))
                                }
                            ))
                        }
                    }
                }
                
                if (response.error != null) {
                    messages.add(ChatMessage.System("Error: ${response.error}"))
                }
                
                if (!response.success && response.content.isBlank() && response.error == null) {
                    debugLog.add(DebugEntry("warn", "Empty response — content blank, no error, no actions"))
                    messages.add(ChatMessage.System("Empty response from server. Check debug panel for details."))
                }
            } catch (e: Exception) {
                removeTyping()
                val elapsed = System.currentTimeMillis() - startTime
                val errorMsg = "${e.javaClass.simpleName}: ${e.message}"
                debugLog.add(DebugEntry("error", "$errorMsg (${elapsed}ms)"))
                Log.e(TAG, "Chat error", e)
                messages.add(ChatMessage.System("Error: $errorMsg"))
            } finally {
                isProcessing = false
            }
        }
    }

    private suspend fun draftApplication(company: String, role: String) {
        try {
            val response = api.draftEmail(EmailDraftRequest(
                company = company,
                role = role,
                type = "application"
            ))
            
            if (response.success) {
                messages.add(ChatMessage.EmailDraft(
                    to = response.draft.to,
                    company = company,
                    role = role,
                    body = response.draft.body,
                    subject = response.draft.subject,
                    contactBlock = response.draft.contactBlock,
                    onSend = {
                        viewModelScope.launch {
                            sendEmail(
                                to = response.draft.to,
                                subject = response.draft.subject,
                                body = response.draft.body,
                                company = company,
                                role = role
                            )
                        }
                    },
                    onEdit = {
                        messages.add(ChatMessage.System("Edit the draft above and send it back."))
                    }
                ))
            }
        } catch (e: Exception) {
            messages.add(ChatMessage.System("Failed to generate draft: ${e.message}"))
        }
    }

    private suspend fun sendEmail(to: String, subject: String, body: String, company: String, role: String) {
        try {
            val response = api.sendEmail(EmailSendRequest(
                to = to,
                subject = subject,
                body = body,
                company = company,
                role = role
            ))
            
            if (response["success"] == true) {
                messages.add(ChatMessage.System("Email sent to $to"))
            } else {
                messages.add(ChatMessage.System("Failed to send email"))
            }
        } catch (e: Exception) {
            messages.add(ChatMessage.System("Error sending email: ${e.message}"))
        }
    }

    fun resetSession() {
        viewModelScope.launch {
            try {
                debugLog.add(DebugEntry("reset", "Clearing session"))
                api.resetChat()
                currentSessionId = null
                messages.clear()
                messages.add(ChatMessage.System("Session reset. How can I help you?"))
            } catch (e: Exception) {
                messages.add(ChatMessage.System("Error: ${e.message}"))
            }
        }
    }

    private fun removeTyping() {
        val typingIndex = messages.indexOfFirst { it is ChatMessage.Typing }
        if (typingIndex >= 0) {
            messages.removeAt(typingIndex)
        }
    }
}

data class DebugEntry(
    val tag: String,
    val message: String,
    val timestamp: Long = System.currentTimeMillis()
) {
    fun formatted(): String {
        val secs = (System.currentTimeMillis() - timestamp) / 1000
        return "[${tag.uppercase()}] $message"
    }
}
