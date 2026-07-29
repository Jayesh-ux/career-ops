package com.careerops.app.ui.chat

import android.app.Application
import android.util.Log
import android.widget.Toast
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
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONArray
import org.json.JSONObject
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

    data class ActivityLog(
        override val id: Long = nextId(),
        val title: String,
        val steps: List<ActivityStep>,
        val summary: String = ""
    ) : ChatMessage()

    data class ProcessingCard(
        override val id: Long = nextId(),
        val steps: List<ProcessingStep>,
        val currentStep: Int = 0,
        val elapsed: String = "",
        val detail: String = "",
        val workflowSteps: List<WorkflowStep> = emptyList(),
        val progress: Float = 0f,
        val currentTool: String = "",
        val portalName: String = ""
    ) : ChatMessage()

    companion object {
        private var counter = 0L
        fun nextId(): Long = ++counter
    }
}

data class WorkflowStep(
    val label: String,
    val done: Boolean = false
)

data class ActivityStep(
    val icon: String,
    val label: String,
    val detail: String = "",
    val status: StepStatus = StepStatus.DONE
)

data class ProcessingStep(
    val icon: String,
    val label: String,
    val detail: String = ""
)

enum class StepStatus { DONE, IN_PROGRESS, FAILED }

data class ResponseTimeEntry(
    val timestamp: Long,
    val messagePreview: String,
    val responseTimeMs: Long,
    val actionsCount: Int,
    val success: Boolean
)

data class ActionBlock(
    val type: String,
    val data: Map<String, String>
)

data class ParsedOutput(
    val text: String,
    val actions: List<ActionBlock>
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val api: CareerOpsApi,
    private val prefs: UserPrefs,
    private val app: Application
) : ViewModel() {

    companion object {
        private const val TAG = "CareerOps"
        private const val MAX_DEBUG_LOG = 200
        private const val MAX_RESPONSE_TIMES = 50
        private const val MAX_MESSAGES = 200
        private const val MAX_SYSTEM_TEXT = 3000
        private const val MAX_STREAMING_TEXT = 50000
        private val ACTION_REGEX = Regex("\\[ACTION:(\\w+)\\]([\\s\\S]*?)\\[/ACTION\\]")
        private val CLEAN_PATTERNS = listOf(
            Regex("\\[ACTION:[\\s\\S]*?\\[/ACTION\\]"),
            Regex("<thinking>[\\s\\S]*?</thinking>"),
        )
        private val NOISE_PATTERNS = listOf(
            Regex("(?i)^\\[.*?\\]\\s*$"),
        )

        // Scan result patterns
        private val SCAN_HEADER = Regex("(?i)\\b(?:found|matched|results?)\\s+(\\d+)\\s+(?:role|job|position|opportunity)")
        private val JOB_ENTRY = Regex("""(?m)^#{1,3}\s*(\d+)[.):\s]+\s*(.+)""")
        private val FIELD_BOLD = Regex("""\*\*(.+?)\*\*[:\s]+(.+)""")
        private val FIELD_BULLET = Regex("""(?m)^[-*]\s*\*\*(.+?)\*\*[:\s]+(.+)""")
        private val URL_PATTERN = Regex("""https?://\S+""")
    }

    val messages = mutableStateListOf<ChatMessage>()
    var isProcessing by mutableStateOf(false)
        private set
    
    var showDebug by mutableStateOf(false)
        private set

    var lastUserMessage by mutableStateOf("")
        private set

    val debugLog = mutableStateListOf<DebugEntry>()

    val responseTimes = mutableStateListOf<ResponseTimeEntry>()

    private val _streamingText = MutableStateFlow("")
    val streamingText: StateFlow<String> = _streamingText.asStateFlow()

    private val _progressText = MutableStateFlow("")
    val progressText: StateFlow<String> = _progressText.asStateFlow()

    private var currentSessionId: String? = null
    private var inboxPollJob: kotlinx.coroutines.Job? = null
    private var processingCardId: Long? = null

    init {
        // Restore persisted chat history
        val restored = restoreMessages()
        if (restored.isNotEmpty()) {
            messages.addAll(restored)
        } else {
            messages.add(ChatMessage.System(
                "Hey! I'm your job search assistant. Here's what I can do:\n\n" +
                "🔍 **Scan** job portals for matching roles\n" +
                "🌐 **Playwright** — scrape career pages for more opportunities\n" +
                "📄 **Tailor** your resume for each opportunity\n" +
                "📝 **Evaluate** any job posting (A-G scoring)\n" +
                "✉️ **Apply** — draft and send application emails\n" +
                "🤖 **Auto-fill** application forms via Playwright\n" +
                "📬 **IMAP** — monitor inbox for recruiter replies\n" +
                "🗑️ **Spam** — filter and delete junk mail\n" +
                "📋 **Track** all applications in one place\n" +
                "🔔 **Follow up** on pending applications\n" +
                "🎤 **Interview prep** with company research\n\n" +
                "Just tell me what you need — paste a job URL, say 'scan', or ask anything!\n\n" +
                "Tell me what to do — I'm here to help you land your next role."
            ))
        }

        // Show any pending automation events from background worker
        loadPendingEvents()

        debugLog.add(DebugEntry("init", "ViewModel created, session: none"))

        // Start inbox polling (check every 60s for new recruiter replies)
        startInboxPolling()
    }

    private fun startInboxPolling() {
        inboxPollJob?.cancel()
        inboxPollJob = viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(60_000) // every 60s
                if (prefs.userEmail.isEmpty()) continue
                try {
                    val inbox = api.getInbox(
                        email = prefs.userEmail,
                        daysBack = 1,
                        maxEmails = 10
                    )
                    val replies = inbox.emails.filter { email ->
                        !email.isSpam && (
                            email.subject.contains(Regex("(?i)(interview|schedule|offer|selected|shortlist|next steps|re:|reply)")) ||
                            email.body.contains(Regex("(?i)(interview|schedule|offer|next round|phone screen|we reviewed)")
                        ))
                    }
                    for (reply in replies) {
                        // Avoid duplicates by checking if already shown
                        val alreadyShown = messages.any { msg ->
                            msg is ChatMessage.System && msg.text.contains(reply.subject)
                        }
                        if (!alreadyShown) {
                            // Show toast notification
                            Toast.makeText(
                                app,
                                "New: ${reply.subject}",
                                Toast.LENGTH_LONG
                            ).show()

                            messages.add(ChatMessage.System(
                                "\uD83D\uDCE8 **New recruiter reply:**\n" +
                                "From: ${reply.from}\n" +
                                "Subject: ${truncateIfNeeded(reply.subject)}\n" +
                                "Say \"reply to ${reply.from}\" to draft a response."
                            ))
                        }
                    }
                } catch (_: Exception) {}
            }
        }
    }

    /**
     * Check for new notifications from the bridge server.
     * Called periodically to detect opportunities, replies, interviews.
     */
    fun checkNotifications() {
        viewModelScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    // Use direct HTTP call since we don't have a Retrofit endpoint yet
                    val client = okhttp3.OkHttpClient.Builder().build()
                    val request = okhttp3.Request.Builder()
                        .url("http://127.0.0.1:8787/notifications/check")
                        .post("{}".toRequestBody("application/json".toMediaType()))
                        .build()
                    client.newCall(request).execute()
                }
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return@launch
                    val json = org.json.JSONObject(body)
                    val notifications = json.getJSONArray("notifications")
                    for (i in 0 until notifications.length()) {
                        val notif = notifications.getJSONObject(i)
                        val type = notif.optString("type", "")
                        val title = notif.optString("title", "")
                        val message = notif.optString("message", "")

                        // Show toast
                        Toast.makeText(app, "$title: $message", Toast.LENGTH_LONG).show()

                        // Add to chat
                        val icon = when (type) {
                            "interview" -> "\uD83C\uDF1F"
                            "recruiter_reply" -> "\uD83D\uDCE8"
                            "offer" -> "\uD83C\uDF89"
                            "new_opportunities" -> "\uD83D\uDD0D"
                            else -> "\uD83D\uDCE2"
                        }
                        messages.add(ChatMessage.System("$icon **$title**\n$message"))
                    }
                }
            } catch (_: Exception) {}
        }
    }

    /**
     * Generate interview preparation for a company.
     */
    fun generateInterviewPrep(company: String, role: String) {
        if (company.isBlank()) return
        lastUserMessage = "Interview prep for $company"
        messages.add(ChatMessage.User("Interview prep for $company $role"))
        isProcessing = true

        val card = ChatMessage.ProcessingCard(steps = emptyList(), currentStep = 0, elapsed = "0s")
        processingCardId = card.id
        messages.add(card)

        val startTime = System.currentTimeMillis()

        viewModelScope.launch {
            try {
                val response = withContext(Dispatchers.IO) {
                    val client = okhttp3.OkHttpClient.Builder().build()
                    val json = org.json.JSONObject()
                        .put("company", company)
                        .put("role", role)
                    val body = json.toString().toRequestBody("application/json".toMediaType())
                    val request = okhttp3.Request.Builder()
                        .url("http://127.0.0.1:8787/interview-prep/generate")
                        .post(body)
                        .build()
                    client.newCall(request).execute()
                }

                val elapsed = System.currentTimeMillis() - startTime
                removeProcessing()

                if (response.isSuccessful) {
                    val body = response.body?.string() ?: ""
                    val json = org.json.JSONObject(body)
                    val preparation = json.optString("preparation", body)
                    messages.add(ChatMessage.System(
                        "\uD83C\uDF1F **Interview Prep: $company**\n\n${truncateIfNeeded(preparation)}"
                    ))
                } else {
                    messages.add(ChatMessage.System("Failed to generate interview prep: ${response.code}"))
                }
            } catch (e: Exception) {
                removeProcessing()
                messages.add(ChatMessage.System("Error generating interview prep: ${e.message}"))
            } finally {
                isProcessing = false
            }
        }
    }

    private fun loadPendingEvents() {
        val raw = prefs.pendingEvents
        if (raw.isBlank()) return
        try {
            val arr = JSONArray(raw)
            if (arr.length() == 0) return
            val events = mutableListOf<ChatMessage.System>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val type = obj.optString("type", "update")
                val message = obj.optString("message", "")
                if (message.isNotEmpty()) {
                    val icon = when (type) {
                        "draft" -> "\uD83D\uDCC3"
                        "followups" -> "\u23F0"
                        "interview_active" -> "\uD83C\uDF1F"
                        "liveness" -> "\uD83D\uDCED"
                        else -> "\uD83D\uDCE2"
                    }
                    events.add(ChatMessage.System("$icon **Automation Update:**\n${truncateIfNeeded(message)}"))
                }
            }
            // Insert after welcome message
            if (events.isNotEmpty()) {
                val insertIndex = 1 // after welcome
                for (event in events.reversed()) {
                    messages.add(insertIndex, event)
                }
                // Clear pending events
                prefs.pendingEvents = ""
            }
        } catch (_: Exception) {}
    }

    fun toggleDebug() {
        showDebug = !showDebug
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        
        lastUserMessage = text
        messages.add(ChatMessage.User(text))
        isProcessing = true

        // Create processing card — honest elapsed time only, no fake steps
        val card = ChatMessage.ProcessingCard(steps = emptyList(), currentStep = 0, elapsed = "0s")
        processingCardId = card.id
        messages.add(card)

        val startTime = System.currentTimeMillis()
        debugLog.add(DebugEntry("send", "message='${text.take(50)}', session=$currentSessionId"))

        val lower = text.lowercase()

        // ── Intent routing: hit backend directly for known intents ──────
        if (lower.contains("scan") || lower.contains("find job") || lower.contains("search")) {
            viewModelScope.launch { handleDirectScan() }
            return
        }
        if (lower.contains("inbox") || lower.contains("check email") || lower.contains("any reply") || lower.contains("any recruiter")) {
            viewModelScope.launch { handleDirectInbox() }
            return
        }
        if (lower.contains("spam") || lower.contains("clean inbox") || lower.contains("delete spam")) {
            viewModelScope.launch { handleDirectSpam() }
            return
        }
        if ((lower.startsWith("reply") || lower.startsWith("respond")) && (lower.contains("recruiter") || lower.contains("email") || lower.contains("interview"))) {
            viewModelScope.launch { handleDirectReply(text) }
            return
        }
        if (lower.startsWith("apply ") && (lower.contains("http") || lower.contains("www"))) {
            viewModelScope.launch { handleDirectApply(text) }
            return
        }
        if (lower.contains("tracker") || lower.contains("show my application")) {
            viewModelScope.launch { handleDirectTracker() }
            return
        }

        // ── Fallback: route to opencode for AI-heavy tasks ──────────────
        viewModelScope.launch { handleOpencodeChat(text, startTime) }
    }

    // ── Direct scan via POST /scan — bypasses opencode entirely ──────────
    private suspend fun handleDirectScan() {
        try {
            val profile = withContext(Dispatchers.IO) { api.getProfile() }
            val keywords = profile.targetRoles.takeIf { it.isNotEmpty() }
                ?: emptyList()
            val locations = profile.location.takeIf { it.isNotBlank() }?.let { listOf(it) }
                ?: emptyList()
            val response = withContext(Dispatchers.IO) {
                api.scan(ScanRequest(keywords = keywords, locations = locations))
            }
            removeProcessing()
            isProcessing = false

            if (response.results.isEmpty()) {
                messages.add(ChatMessage.System("Scan complete — no new matching jobs found."))
                return
            }

            messages.add(ChatMessage.System("Found **${response.results.size}** matching jobs (total scanned: ${response.total}):\n\nNew offers: **${response.newFound}**"))

            for (job in response.results.take(30)) {
                messages.add(ChatMessage.JobCard(
                    company = job.company,
                    role = job.role,
                    score = "",
                    url = job.url,
                    location = job.location,
                    onApply = {
                        viewModelScope.launch { draftApplication(job.company, job.role) }
                    },
                    onSkip = {
                        messages.add(ChatMessage.System("Skipped: ${job.company}"))
                    }
                ))
            }
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Scan failed: ${e.message}"))
        }
    }

    // ── Direct inbox via GET /email/inbox ─────────────────────────────────
    private suspend fun handleDirectInbox() {
        try {
            val userEmail = prefs.userEmail
            if (userEmail.isEmpty()) {
                removeProcessing()
                isProcessing = false
                messages.add(ChatMessage.System("Please sign in first to check your inbox."))
                return
            }
            val response = withContext(Dispatchers.IO) {
                api.getInbox(email = userEmail, daysBack = 14, maxEmails = 30)
            }
            removeProcessing()
            isProcessing = false

            if (response.emails.isEmpty()) {
                messages.add(ChatMessage.System("No new emails found in the last 14 days."))
                return
            }

            val legitimate = response.emails.filter { !it.isSpam }
            val spam = response.emails.filter { it.isSpam }

            messages.add(ChatMessage.System(
                "**Inbox:** ${response.total} emails (${legitimate.size} legitimate, ${spam.size} spam)"
            ))

            for (email2 in legitimate.take(10)) {
                val category = email2.category.ifEmpty { "general" }
                val icon = when (category) {
                    "interview" -> "\uD83C\uDF1F"
                    "response" -> "\u2709\uFE0F"
                    else -> "\uD83D\uDCE8"
                }
                messages.add(ChatMessage.System(
                    "$icon **${email2.subject}**\nFrom: ${email2.from}\nDate: ${email2.date}\nPreview: ${email2.body.take(150)}..."
                ))
            }

            if (spam.isNotEmpty()) {
                messages.add(ChatMessage.System(
                    "\uD83D\uDDD1\uFE0F ${spam.size} spam emails detected. Say **'delete spam'** to clean them."
                ))
            }
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Inbox check failed: ${e.message}"))
        }
    }

    // ── Direct spam delete via POST /email/spam/delete ───────────────────
    private suspend fun handleDirectSpam() {
        try {
            val email = prefs.userEmail
            if (email.isEmpty()) {
                removeProcessing()
                isProcessing = false
                messages.add(ChatMessage.System("Please sign in first to check spam."))
                return
            }
            val inbox = withContext(Dispatchers.IO) {
                api.getInbox(email = email, daysBack = 14, maxEmails = 50, includeSpam = true)
            }
            val spamIds = inbox.emails.filter { it.isSpam }.mapNotNull { it.body.take(20) }
            if (spamIds.isEmpty()) {
                removeProcessing()
                isProcessing = false
                messages.add(ChatMessage.System("No spam emails found to delete."))
                return
            }

            withContext(Dispatchers.IO) {
                api.deleteSpam(mapOf("messageIds" to spamIds, "markAsRead" to true))
            }
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Deleted ${spamIds.size} spam emails."))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Spam deletion failed: ${e.message}"))
        }
    }

    // ── Direct reply via POST /email/reply ────────────────────────────────
    private suspend fun handleDirectReply(text: String) {
        try {
            val replyType = when {
                text.contains("interview") -> "interview"
                text.contains("follow") -> "follow_up"
                text.contains("accept") -> "accept_offer"
                text.contains("negotiate") -> "negotiate"
                else -> "generic"
            }
            val response = withContext(Dispatchers.IO) {
                api.draftReply(EmailReplyRequest(
                    to = "",
                    subject = "",
                    body = "",
                    replyType = replyType
                ))
            }
            removeProcessing()
            isProcessing = false

            messages.add(ChatMessage.System(
                "**Reply draft (${replyType}):**\n\n${response.replyBody}"
            ))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Reply draft failed: ${e.message}"))
        }
    }

    // ── Direct apply via POST /auto-pipeline ──────────────────────────────
    private suspend fun handleDirectApply(text: String) {
        val urlMatch = Regex("https?://\\S+").find(text)
        if (urlMatch == null) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Please paste a valid job URL."))
            return
        }
        try {
            val response = withContext(Dispatchers.IO) {
                api.autoPipeline(AutoPipelineRequest(url = urlMatch.value))
            }
            removeProcessing()
            isProcessing = false

            messages.add(ChatMessage.Evaluation(
                company = response.company ?: "Unknown",
                role = response.role ?: "",
                score = response.score,
                summary = "Fit: ${response.fit}\nStrengths: ${response.strengths.joinToString(", ")}\nGaps: ${response.gaps.joinToString(", ")}"
            ))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Evaluation failed: ${e.message}"))
        }
    }

    // ── Direct tracker via GET /tracker ───────────────────────────────────
    private suspend fun handleDirectTracker() {
        try {
            val response = withContext(Dispatchers.IO) { api.getTracker() }
            removeProcessing()
            isProcessing = false

            if (response.applications.isEmpty()) {
                messages.add(ChatMessage.System("No applications tracked yet. Scan for jobs to get started."))
                return
            }

            val byStatus = response.applications.groupBy { it.status }
            val summary = byStatus.entries.joinToString("\n") { (status, apps) ->
                "- **$status**: ${apps.size}"
            }
            messages.add(ChatMessage.System("**Tracker:** ${response.applications.size} applications\n\n$summary"))

            for (app in response.applications.take(10)) {
                messages.add(ChatMessage.System(
                    "• **${app.company}** — ${app.role} | ${app.status} | Score: ${app.score}"
                ))
            }
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Tracker failed: ${e.message}"))
        }
    }

    // ── Opencode fallback for AI-heavy tasks ──────────────────────────────
    private suspend fun handleOpencodeChat(text: String, startTime: Long) {
        try {
                debugLog.add(DebugEntry("api", "Calling POST /chat/stream..."))
                val response = withContext(Dispatchers.IO) {
                    api.chatStream(ChatRequest(
                        message = text,
                        sessionId = currentSessionId
                    ))
                }
                
                if (!response.isSuccessful) {
                    removeProcessing()
                    val errorMsg = "HTTP ${response.code()}: ${response.errorBody()?.string() ?: "unknown"}"
                    debugLog.add(DebugEntry("error", errorMsg))
                    messages.add(ChatMessage.System("Error: ${truncateIfNeeded(errorMsg)}"))
                    isProcessing = false
                    return
                }

                val body = response.body()
                if (body == null) {
                    removeProcessing()
                    debugLog.add(DebugEntry("error", "Empty response body"))
                    messages.add(ChatMessage.System("Error: Empty response from server"))
                    isProcessing = false
                    return
                }

                // Start elapsed timer
                val timerJob = viewModelScope.launch {
                    while (isProcessing) {
                        val elapsed = (System.currentTimeMillis() - startTime) / 1000
                        updateProcessingCard(elapsed = "${elapsed}s")
                        kotlinx.coroutines.delay(1000)
                    }
                }

                // Parse SSE stream — updates progress in real-time
                _streamingText.value = ""
                val streamResult = withContext(Dispatchers.IO) {
                    parseSSEStreamIncremental(body)
                }

                timerJob.cancel()

                // Finalize
                val finalText = cleanContent(streamResult.fullText)
                val actions = streamResult.actions
                val streamedContent = _streamingText.value
                _streamingText.value = ""
                _progressText.value = ""

                removeProcessing()
                currentSessionId = streamResult.sessionId

                val elapsed = System.currentTimeMillis() - startTime

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

                // Display the final response
                val displayText = if (finalText.isNotBlank()) finalText
                    else if (streamedContent.isNotBlank()) cleanContent(streamedContent)
                    else ""

                if (displayText.isNotBlank()) {
                    // Check if this is a scan response with job listings
                    val isScanMessage = lastUserMessage.lowercase().let { msg ->
                        msg.contains("scan") || msg.contains("find jobs") ||
                        msg.contains("search") || msg.contains("portals")
                    }
                    
                    if (isScanMessage && actions.isEmpty()) {
                        try {
                            // Cap text for regex safety — scan output is never > 5000 chars
                            val cappedText = if (displayText.length > 8000) displayText.takeLast(8000) else displayText
                            val scanResult = parseScanResults(cappedText)
                            if (scanResult != null && scanResult.jobs.isNotEmpty()) {
                                // Add summary message
                                messages.add(ChatMessage.System(
                                    "Found ${scanResult.count} roles matching your profile"
                                ))
                                
                                // Add each job as a structured card
                                for (job in scanResult.jobs.take(20)) {
                                    messages.add(ChatMessage.JobCard(
                                        company = job["company"] ?: "Unknown",
                                        role = job["role"] ?: "",
                                        score = job["score"] ?: "",
                                        url = job["url"] ?: "",
                                        location = job["location"] ?: "",
                                        onApply = {
                                            viewModelScope.launch {
                                                draftApplication(
                                                    job["company"] ?: "",
                                                    job["role"] ?: ""
                                                )
                                            }
                                        },
                                        onSkip = {
                                            messages.add(ChatMessage.System("Skipped: ${job["company"]}"))
                                        }
                                    ))
                                }
                                
                                // Add follow-up action chips
                                messages.add(ChatMessage.System(
                                    "What would you like to do next?\n" +
                                    "• Evaluate Top Matches\n" +
                                    "• Search More Portals\n" +
                                    "• Adjust Filters\n" +
                                    "• Apply to All"
                                ))
                            } else {
                                // Fall back to raw text if parsing fails
                                messages.add(ChatMessage.System(truncateIfNeeded(displayText)))
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Scan parse failed, falling back to raw text", e)
                            messages.add(ChatMessage.System(truncateIfNeeded(displayText)))
                        }
                    } else {
                        val activityLog = try {
                            parseResponseToActivity(displayText, lastUserMessage)
                        } catch (e: Exception) {
                            Log.e(TAG, "Activity parse failed", e)
                            null
                        }
                        if (activityLog != null && actions.isEmpty()) {
                            messages.add(activityLog)
                        } else {
                            messages.add(ChatMessage.System(truncateIfNeeded(displayText)))
                        }
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
                    messages.add(ChatMessage.System("Error: ${truncateIfNeeded(streamResult.error)}"))
                }

                if (displayText.isBlank() && actions.isEmpty() && streamResult.error == null) {
                    addDebug(DebugEntry("warn", "Empty stream — no text, no actions"))
                    messages.add(ChatMessage.System("Empty response from server."))
                }
            } catch (e: Exception) {
                removeProcessing()
                _streamingText.value = ""
                _progressText.value = ""
                val elapsed = System.currentTimeMillis() - startTime
                val errorMsg = "${e.javaClass.simpleName}: ${e.message}"
                addDebug(DebugEntry("error", "$errorMsg (${elapsed}ms)"))
                Log.e(TAG, "Chat stream error", e)
                messages.add(ChatMessage.System("Error: ${truncateIfNeeded(errorMsg)}"))

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
                removeProcessing()
                isProcessing = false
                _streamingText.value = ""
                _progressText.value = ""
                processingCardId = null
                trimMessages()
                persistMessages()
        }
    }

    private fun updateProcessingCard(
        elapsed: String = "",
        detail: String = "",
        workflowSteps: List<WorkflowStep>? = null,
        progress: Float = -1f,
        currentTool: String = "",
        portalName: String = ""
    ) {
        val cardId = processingCardId ?: return
        val idx = messages.indexOfFirst { it.id == cardId }
        if (idx < 0) return
        val card = messages[idx] as? ChatMessage.ProcessingCard ?: return
        messages[idx] = card.copy(
            elapsed = if (elapsed.isNotEmpty()) elapsed else card.elapsed,
            detail = if (detail.isNotEmpty()) detail else card.detail,
            workflowSteps = workflowSteps ?: card.workflowSteps,
            progress = if (progress >= 0) progress else card.progress,
            currentTool = if (currentTool.isNotEmpty()) currentTool else card.currentTool,
            portalName = if (portalName.isNotEmpty()) portalName else card.portalName
        )
    }

    private fun removeProcessing() {
        val cardId = processingCardId ?: return
        val idx = messages.indexOfFirst { it.id == cardId }
        if (idx >= 0) {
            messages.removeAt(idx)
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
                                        // Cap streaming text to prevent UI crash on huge responses
                                        val displayText = textBuilder.toString()
                                        _streamingText.value = if (displayText.length > MAX_STREAMING_TEXT)
                                            displayText.takeLast(MAX_STREAMING_TEXT) else displayText
                                    }
                                }
                                "progress" -> {
                                    val progressText = json.optString("text", "")
                                    _progressText.value = progressText

                                    // Parse structured step progress from bridge server
                                    val workflowSteps = mutableListOf<WorkflowStep>()
                                    val stepsArr = json.optJSONArray("steps")
                                    if (stepsArr != null) {
                                        for (i in 0 until stepsArr.length()) {
                                            val stepObj = stepsArr.optJSONObject(i) ?: continue
                                            workflowSteps.add(WorkflowStep(
                                                label = stepObj.optString("label", ""),
                                                done = stepObj.optBoolean("done", false)
                                            ))
                                        }
                                    }
                                    val progressVal = json.optDouble("progress", -1.0).toFloat()
                                    val currentTool = json.optString("currentTool", "")

                                    // Extract portal-specific info
                                    val portal = json.optString("portal", "")
                                    val scanCurrent = json.optInt("current", 0)
                                    val scanTotal = json.optInt("total", 0)
                                    val phase = json.optString("phase", "")

                                    val portalDisplay = when {
                                        portal.isNotEmpty() && scanTotal > 0 -> "$portal ($scanCurrent/$scanTotal)"
                                        portal.isNotEmpty() -> portal
                                        else -> ""
                                    }
                                    updateProcessingCard(
                                        detail = progressText,
                                        workflowSteps = if (workflowSteps.isNotEmpty()) workflowSteps.toList() else null,
                                        progress = progressVal,
                                        currentTool = currentTool,
                                        portalName = portalDisplay
                                    )
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

                // Parse action blocks from accumulated text — cap first to avoid regex overhead on huge responses
        val fullTextForParse = if (textBuilder.length > MAX_STREAMING_TEXT) textBuilder.toString().takeLast(MAX_STREAMING_TEXT) else textBuilder.toString()
        val parsed = parseActionBlocks(fullTextForParse)
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

    /**
     * Parse scan results into structured job data.
     * Handles two formats:
     * 1. Pipe-separated: "+ Company | Title | Location" (from scan.mjs)
     * 2. Markdown numbered: "### 1. Company — Role" (from opencode responses)
     */
    private fun parseScanResults(text: String): ScanParseResult? {
        val entries = mutableListOf<MutableMap<String, String>>()
        
        // Format 1: Pipe-separated lines from scan.mjs output
        // Pattern: "+ Company | Title | Location [optional flags]"
        val pipeLinePattern = Regex("""^\s*\+\s+(.+?)\s*\|\s*(.+?)(?:\s*\|\s*(.+))?$""")
        
        for (line in text.lines()) {
            val match = pipeLinePattern.find(line.trim())
            if (match != null) {
                val job = mutableMapOf<String, String>()
                job["company"] = match.groupValues[1].trim()
                job["role"] = match.groupValues[2].trim()
                if (match.groupValues[3].isNotEmpty()) {
                    job["location"] = match.groupValues[3].trim()
                        .replace(Regex("\\[.*\\]"), "").trim() // Remove any [Trust: ...] flags
                }
                if (job["company"]?.isNotEmpty() == true) {
                    entries.add(job)
                }
            }
        }
        
        // Format 2: Markdown numbered entries (fallback for opencode-generated responses)
        if (entries.isEmpty()) {
            val sections = text.split(Regex("(?=\\n#{1,3}\\s*\\d+[.):\\s])|(?=\\n\\*\\*\\d+[.):\\s])"))
            
            for (section in sections) {
                val trimmed = section.trim()
                if (trimmed.isEmpty()) continue
                
                val job = mutableMapOf<String, String>()
                
                val headerMatch = JOB_ENTRY.find(trimmed)
                if (headerMatch != null) {
                    val headerText = headerMatch.groupValues[2].trim()
                    val separators = listOf(" — ", " - ", " | ", ": ", " – ")
                    for (sep in separators) {
                        if (headerText.contains(sep)) {
                            val parts = headerText.split(sep, limit = 2)
                            job["company"] = parts[0].trim().removePrefix("**").removeSuffix("**")
                            job["role"] = parts[1].trim().removePrefix("**").removeSuffix("**")
                            break
                        }
                    }
                    if (job["company"] == null) {
                        job["company"] = headerText.removePrefix("**").removeSuffix("**")
                    }
                }
                
                if (job["company"] == null || job["company"]?.isEmpty() == true) continue
                
                // Extract fields from bold labels
                for (match in FIELD_BOLD.findAll(trimmed)) {
                    val key = match.groupValues[1].lowercase().trim()
                    val value = match.groupValues[2].trim()
                    when {
                        key.contains("role") || key.contains("position") || key.contains("title") -> job["role"] = value
                        key.contains("location") || key.contains("city") -> job["location"] = value
                        key.contains("experience") || key.contains("exp") -> job["experience"] = value
                        key.contains("tech") || key.contains("stack") || key.contains("skill") -> job["tech"] = value
                        key.contains("salary") || key.contains("compensation") -> job["salary"] = value
                        key.contains("source") || key.contains("portal") || key.contains("via") -> job["source"] = value
                        key.contains("url") || key.contains("link") -> job["url"] = value
                    }
                }
                
                if (job["url"] == null) {
                    val urlMatch = URL_PATTERN.find(trimmed)
                    if (urlMatch != null) job["url"] = urlMatch.value
                }
                
                if (job["company"] != null) entries.add(job)
            }
        }
        
        if (entries.isEmpty()) return null
        
        // Extract summary count
        val countMatch = SCAN_HEADER.find(text)
        val count = countMatch?.groupValues?.get(1)?.toIntOrNull() ?: entries.size
        
        // Extract summary text (first meaningful line)
        val summaryLine = text.lines().firstOrNull { 
            it.trim().isNotEmpty() && !it.startsWith("#") && !it.startsWith("-") && !it.startsWith("*")
        }?.trim()?.take(120) ?: "Found $count roles"
        
        return ScanParseResult(summary = summaryLine, count = count, jobs = entries)
    }

    private data class ScanParseResult(
        val summary: String,
        val count: Int,
        val jobs: List<MutableMap<String, String>>
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

    private fun persistMessages() {
        try {
            val arr = JSONArray()
            for (msg in messages) {
                when (msg) {
                    is ChatMessage.User -> arr.put(JSONObject().put("type", "user").put("text", msg.text))
                    is ChatMessage.System -> arr.put(JSONObject().put("type", "system").put("text", msg.text))
                    else -> {} // Only persist user + system messages
                }
            }
            // Keep last 50 messages max
            val trimmed = if (arr.length() > 50) {
                val t = JSONArray()
                for (i in arr.length() - 50 until arr.length()) t.put(arr.get(i))
                t
            } else arr
            prefs.saveChatHistory(trimmed.toString(), app.applicationContext)
        } catch (_: Exception) {}
    }

    private fun restoreMessages(): List<ChatMessage> {
        val result = mutableListOf<ChatMessage>()
        try {
            val raw = prefs.loadChatHistory(app.applicationContext)
            if (raw.isBlank()) return result
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                val type = obj.optString("type", "")
                val text = obj.optString("text", "")
                if (text.isEmpty()) continue
                when (type) {
                    "user" -> result.add(ChatMessage.User(text))
                    "system" -> result.add(ChatMessage.System(text))
                }
            }
        } catch (_: Exception) {}
        return result
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
            
            if ((response["success"] as? Boolean) == true) {
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

    override fun onCleared() {
        super.onCleared()
        inboxPollJob?.cancel()
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

    private fun truncateIfNeeded(text: String): String {
        if (text.length <= MAX_SYSTEM_TEXT) return text
        return text.take(MAX_SYSTEM_TEXT) + "\n\n... (truncated — ${text.length} chars total)"
    }

    /**
     * Parse raw opencode response text into structured activity steps.
     * Detects what operations were performed and returns visual step cards.
     */
    /**
     * Intentionally returns null — all response text is shown as-is in SystemBubble.
     * Previous implementation fabricated ActivityLog cards by regex-matching keywords
     * from the user message and opencode skill documentation (which mentions Google,
     * Amazon etc. as examples), presenting fake "Matching companies found" data.
     * That was a trust-breaking bug: users saw generic FAANG names instead of their
     * actual personalized scan results.
     */
    private fun parseResponseToActivity(text: String, userMessage: String): ChatMessage.ActivityLog? {
        return null
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
