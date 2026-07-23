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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.ResponseBody
import javax.inject.Inject

sealed class ChatMessage {
    data class User(val text: String) : ChatMessage()
    data class System(val text: String, val timestamp: String = "") : ChatMessage()
    data class Typing(val label: String = "Thinking...") : ChatMessage()
    data class ToolStatus(val label: String, val detail: String = "") : ChatMessage()
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
    data class Evaluation(
        val company: String = "",
        val role: String = "",
        val score: String = "",
        val summary: String = "",
        val reportPath: String = ""
    ) : ChatMessage()
}

data class ResponseTimeEntry(
    val timestamp: Long,
    val messagePreview: String,
    val responseTimeMs: Long,
    val actionsCount: Int,
    val success: Boolean
)

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

    val responseTimes = mutableStateListOf<ResponseTimeEntry>()

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
                debugLog.add(DebugEntry("api", "Calling POST /chat/stream..."))
                val response = api.chatStream(ChatRequest(
                    message = text,
                    sessionId = currentSessionId
                ))
                
                if (!response.isSuccessful) {
                    removeTyping()
                    val errorMsg = "HTTP ${response.code()}: ${response.errorBody()?.string() ?: "unknown"}"
                    debugLog.add(DebugEntry("error", errorMsg))
                    messages.add(ChatMessage.System("Error: $errorMsg"))
                    isProcessing = false
                    return@launch
                }

                val body = response.body()
                if (body == null) {
                    removeTyping()
                    debugLog.add(DebugEntry("error", "Empty response body"))
                    messages.add(ChatMessage.System("Error: Empty response from server"))
                    isProcessing = false
                    return@launch
                }

                // Parse SSE stream on IO thread
                val streamResult = withContext(Dispatchers.IO) {
                    parseSSEStream(body, startTime)
                }

                removeTyping()
                currentSessionId = streamResult.sessionId

                val elapsed = System.currentTimeMillis() - startTime

                // Track response time
                responseTimes.add(
                    ResponseTimeEntry(
                        timestamp = startTime,
                        messagePreview = text.take(30),
                        responseTimeMs = elapsed,
                        actionsCount = streamResult.actions.size,
                        success = streamResult.error == null
                    )
                )

                debugLog.add(DebugEntry("response",
                    "session=${streamResult.sessionId}, " +
                    "tokens=${streamResult.fullText.length}, " +
                    "actions=${streamResult.actions.size}, " +
                    "error=${streamResult.error}, " +
                    "time=${elapsed}ms"
                ))

                // Display the accumulated streamed text
                if (streamResult.fullText.isNotBlank()) {
                    val cleaned = cleanContent(streamResult.fullText)
                    if (cleaned.isNotBlank()) {
                        messages.add(ChatMessage.System(cleaned))
                    }
                }

                // Display action blocks
                for (action in streamResult.actions) {
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
                        "evaluation" -> {
                            messages.add(ChatMessage.Evaluation(
                                company = action.data["company"] ?: "",
                                role = action.data["role"] ?: "",
                                score = action.data["score"] ?: "",
                                summary = action.data["summary"] ?: "",
                                reportPath = action.data["reportPath"] ?: ""
                            ))
                        }
                    }
                }

                if (streamResult.error != null) {
                    messages.add(ChatMessage.System("Error: ${streamResult.error}"))
                }

                if (streamResult.fullText.isBlank() && streamResult.actions.isEmpty() && streamResult.error == null) {
                    debugLog.add(DebugEntry("warn", "Empty stream — no text, no actions"))
                    messages.add(ChatMessage.System("Empty response from server."))
                }
            } catch (e: Exception) {
                removeTyping()
                val elapsed = System.currentTimeMillis() - startTime
                val errorMsg = "${e.javaClass.simpleName}: ${e.message}"
                debugLog.add(DebugEntry("error", "$errorMsg (${elapsed}ms)"))
                Log.e(TAG, "Chat stream error", e)
                messages.add(ChatMessage.System("Error: $errorMsg"))

                responseTimes.add(
                    ResponseTimeEntry(
                        timestamp = startTime,
                        messagePreview = text.take(30),
                        responseTimeMs = elapsed,
                        actionsCount = 0,
                        success = false
                    )
                )
            } finally {
                isProcessing = false
            }
        }
    }

    private data class StreamResult(
        val fullText: String = "",
        val sessionId: String? = null,
        val actions: List<ActionBlock> = emptyList(),
        val error: String? = null
    )

    /**
     * Parse SSE stream from bridge server.
     * Events: text_delta ({text}), done ({sessionId}), error ({error})
     */
    private fun parseSSEStream(body: ResponseBody, startTime: Long): StreamResult {
        val source = body.source()
        val textBuilder = StringBuilder()
        var sessionId: String? = null
        var error: String? = null
        val actions = mutableListOf<ActionBlock>()
        var currentEvent = ""
        val dataBuffer = StringBuilder()

        try {
            while (!source.exhausted()) {
                val line = source.readUtf8Line() ?: break

                when {
                    line.startsWith("event: ") -> {
                        currentEvent = line.removePrefix("event: ").trim()
                    }
                    line.startsWith("data: ") -> {
                        dataBuffer.clear()
                        dataBuffer.append(line.removePrefix("data: "))
                    }
                    line.isEmpty() && currentEvent.isNotEmpty() -> {
                        // End of SSE message — process the event
                        val dataStr = dataBuffer.toString()
                        try {
                            val json = org.json.JSONObject(dataStr)
                            when (currentEvent) {
                                "text_delta" -> {
                                    val delta = json.optString("text", "")
                                    if (delta.isNotEmpty()) {
                                        textBuilder.append(delta)
                                    }
                                }
                                "done" -> {
                                    sessionId = json.optString("sessionId", sessionId)
                                }
                                "error" -> {
                                    error = json.optString("error", "Unknown error")
                                }
                            }
                        } catch (e: Exception) {
                            // Non-JSON data, skip
                        }
                        currentEvent = ""
                        dataBuffer.clear()
                    }
                }
            }
        } catch (e: Exception) {
            if (error == null) {
                error = "Stream read error: ${e.message}"
            }
        }

        // Parse action blocks from accumulated text
        val parsed = parseActionBlocks(textBuilder.toString())
        actions.addAll(parsed.actions)

        return StreamResult(
            fullText = parsed.text,
            sessionId = sessionId,
            actions = actions,
            error = error
        )
    }

    /**
     * Parse [ACTION:type]...[/ACTION] blocks from text.
     */
    private fun parseActionBlocks(text: String): ParsedOutput {
        val actions = mutableListOf<ActionBlock>()
        val actionRegex = Regex("\\[ACTION:(\\w+)\\]([\\s\\S]*?)\\[/ACTION\\]")
        
        val cleanText = actionRegex.replace(text) { match ->
            val type = match.groupValues[1]
            val content = match.groupValues[2].trim()
            val lines = content.split("\n")
            val data = mutableMapOf<String, String>()
            
            for (line in lines) {
                val colonIndex = line.indexOf(':')
                if (colonIndex > 0) {
                    val key = line.substring(0, colonIndex).trim()
                    val value = line.substring(colonIndex + 1).trim()
                    data[key] = value
                }
            }
            
            actions.add(ActionBlock(type = type, data = data))
            "" // Remove the action block from text
        }.trim()

        return ParsedOutput(text = cleanText, actions = actions)
    }

    private data class ParsedOutput(
        val text: String,
        val actions: List<ActionBlock>
    )

    fun getAverageResponseTime(): Long {
        if (responseTimes.isEmpty()) return 0
        return responseTimes.map { it.responseTimeMs }.average().toLong()
    }

    fun getLastResponseTime(): Long {
        return responseTimes.lastOrNull()?.responseTimeMs ?: 0
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
                responseTimes.clear()
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

    private fun cleanContent(raw: String): String {
        var text = raw
            .replace(Regex("\\[ACTION:[\\s\\S]*?\\[/ACTION\\]"), "")
            .replace(Regex("<thinking>[\\s\\S]*?</thinking>"), "")
            .replace(Regex("```[\\s\\S]*?```"), "")
            .replace(Regex("`[^`]+`"), "")
            .trim()
        
        val noisePatterns = listOf(
            Regex("(?i)^(running|executing|tool|bash)[^\\n]*$"),
            Regex("(?i)^\\[.*?\\]\\s*$"),
            Regex("(?i)^Step \\d+:"),
            Regex("(?i)^\\d+\\.\\s+"),
            Regex("(?i)^>\\s+"),
        )
        val lines = text.split("\n").filter { line ->
            noisePatterns.none { it.matches(line.trim()) }
        }
        
        return lines.joinToString("\n").trim()
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
