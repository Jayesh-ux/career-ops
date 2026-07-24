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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.ResponseBody
import javax.inject.Inject

sealed class ChatMessage {
    abstract val id: Long

    data class User(val text: String, override val id: Long = nextId()) : ChatMessage()
    data class System(val text: String, override val id: Long = nextId(), val timestamp: String = "") : ChatMessage()
    data class Typing(override val id: Long = -1L, val label: String = "Thinking...") : ChatMessage()
    data class ToolStatus(override val id: Long = nextId(), val label: String, val detail: String = "") : ChatMessage()
    data class JobCard(
        override val id: Long = nextId(),
        val company: String,
        val role: String,
        val score: String = "",
        val url: String = "",
        val location: String = "",
        val onApply: (() -> Unit)? = null,
        val onSkip: (() -> Unit)? = null
    ) : ChatMessage()
    data class EmailDraft(
        override val id: Long = nextId(),
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
        override val id: Long = nextId(),
        val company: String = "",
        val role: String = "",
        val score: String = "",
        val summary: String = "",
        val reportPath: String = ""
    ) : ChatMessage()

    companion object {
        private var counter = 0L
        fun nextId(): Long = ++counter
    }
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
        private const val MAX_DEBUG_LOG = 200
        private const val MAX_RESPONSE_TIMES = 50
        private const val MAX_MESSAGES = 200
        private val ACTION_REGEX = Regex("\\[ACTION:(\\w+)\\]([\\s\\S]*?)\\[/ACTION\\]")
        private val CLEAN_PATTERNS = listOf(
            Regex("\\[ACTION:[\\s\\S]*?\\[/ACTION\\]"),
            Regex("<thinking>[\\s\\S]*?</thinking>"),
        )
        private val NOISE_PATTERNS = listOf(
            Regex("(?i)^\\[.*?\\]\\s*$"),
        )
    }

    val messages = mutableStateListOf<ChatMessage>()
    var isProcessing by mutableStateOf(false)
        private set
    
    var showDebug by mutableStateOf(false)
        private set

    val debugLog = mutableStateListOf<DebugEntry>()

    val responseTimes = mutableStateListOf<ResponseTimeEntry>()

    private val _streamingText = MutableStateFlow("")
    val streamingText: StateFlow<String> = _streamingText.asStateFlow()

    private val _progressText = MutableStateFlow("")
    val progressText: StateFlow<String> = _progressText.asStateFlow()

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

                // Parse SSE stream incrementally — emits deltas to streamingText
                _streamingText.value = ""
                val streamResult = withContext(Dispatchers.IO) {
                    parseSSEStreamIncremental(body)
                }

                // Finalize: get cleaned text and action blocks
                val finalText = cleanContent(streamResult.fullText)
                val actions = streamResult.actions

                // Capture streaming text before clearing
                val streamedContent = _streamingText.value
                _streamingText.value = ""
                _progressText.value = ""

                removeTyping()
                currentSessionId = streamResult.sessionId

                val elapsed = System.currentTimeMillis() - startTime

                // Track response time
                addResponseTime(
                    ResponseTimeEntry(
                        timestamp = startTime,
                        messagePreview = text.take(30),
                        responseTimeMs = elapsed,
                        actionsCount = actions.size,
                        success = streamResult.error == null
                    )
                )

                addDebug(DebugEntry("response",
                    "session=${streamResult.sessionId}, " +
                    "tokens=${streamResult.fullText.length}, " +
                    "actions=${actions.size}, " +
                    "error=${streamResult.error}, " +
                    "time=${elapsed}ms"
                ))

                // Display the final cleaned text
                if (finalText.isNotBlank()) {
                    messages.add(ChatMessage.System(finalText))
                } else if (streamedContent.isNotBlank()) {
                    // Fallback: use streamed content if cleanup removed everything
                    val fallback = cleanContent(streamedContent)
                    if (fallback.isNotBlank()) {
                        messages.add(ChatMessage.System(fallback))
                    }
                }

                // Display action blocks
                for (action in actions) {
                    addDebug(DebugEntry("action", "type=${action.type}, data=${action.data}"))
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

                if (streamResult.fullText.isBlank() && actions.isEmpty() && streamResult.error == null) {
                    addDebug(DebugEntry("warn", "Empty stream — no text, no actions"))
                    messages.add(ChatMessage.System("Empty response from server."))
                }
            } catch (e: Exception) {
                removeTyping()
                _streamingText.value = ""
                _progressText.value = ""
                val elapsed = System.currentTimeMillis() - startTime
                val errorMsg = "${e.javaClass.simpleName}: ${e.message}"
                addDebug(DebugEntry("error", "$errorMsg (${elapsed}ms)"))
                Log.e(TAG, "Chat stream error", e)
                messages.add(ChatMessage.System("Error: $errorMsg"))

                addResponseTime(
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
                _streamingText.value = ""
                _progressText.value = ""
                trimMessages()
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
     * Parse SSE stream incrementally — emits text deltas to _streamingText
     * as they arrive, so the UI can render them in real-time.
     */
    private fun parseSSEStreamIncremental(body: ResponseBody): StreamResult {
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
                                        _streamingText.value = textBuilder.toString()
                                    }
                                }
                                "progress" -> {
                                    _progressText.value = json.optString("text", "")
                                }
                                "connected" -> {
                                    _progressText.value = "Connected..."
                                }
                                "done" -> {
                                    _progressText.value = ""
                                    sessionId = json.optString("sessionId", sessionId)
                                }
                                "error" -> {
                                    _progressText.value = ""
                                    error = json.optString("error", "Unknown error")
                                }
                            }
                        } catch (_: Exception) { }
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
        
        val cleanText = ACTION_REGEX.replace(text) { match ->
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
            ""
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

    private fun addDebug(entry: DebugEntry) {
        debugLog.add(entry)
        // Cap debug log to prevent unbounded growth
        while (debugLog.size > MAX_DEBUG_LOG) {
            debugLog.removeAt(0)
        }
    }

    private fun addResponseTime(entry: ResponseTimeEntry) {
        responseTimes.add(entry)
        // Cap response times to prevent unbounded growth
        while (responseTimes.size > MAX_RESPONSE_TIMES) {
            responseTimes.removeAt(0)
        }
    }

    private fun trimMessages() {
        while (messages.size > MAX_MESSAGES) {
            messages.removeAt(0)
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
                addDebug(DebugEntry("reset", "Clearing session"))
                api.resetChat()
                currentSessionId = null
                _streamingText.value = ""
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
        for (pattern in CLEAN_PATTERNS) {
            text = pattern.replace(text, "")
        }
        text = text.trim()
        
        val lines = text.split("\n").filter { line ->
            NOISE_PATTERNS.none { it.matches(line.trim()) }
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
        return "[${tag.uppercase()}] $message"
    }
}
