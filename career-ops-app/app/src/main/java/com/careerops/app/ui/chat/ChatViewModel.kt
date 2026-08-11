package com.careerops.app.ui.chat

import android.app.Application
import android.util.Log
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
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
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.ResponseBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import retrofit2.HttpException
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
        val salary: String = "",
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
        val sending: Boolean = false,
        val sent: Boolean = false,
        val onSend: (() -> Unit)? = null,
        val onEdit: (() -> Unit)? = null
    ) : ChatMessage()
    data class ReplyDraft(
        override val id: Long = nextId(),
        val to: String,
        val subject: String,
        val body: String,
        val replyType: String,
        val inReplyTo: String = "",
        val threadId: String = "",
        val sending: Boolean = false,
        val sent: Boolean = false,
        val onSend: (() -> Unit)? = null,
        val onEdit: (() -> Unit)? = null
    ) : ChatMessage()
    data class InboxNotificationCard(
        override val id: Long = nextId(),
        val type: String = "",
        val title: String = "",
        val message: String = "",
        val from: String = "",
        val fromEmail: String = "",
        val subject: String = "",
        val threadId: String = "",
        val messageId: String = "",
        val inReplyTo: String = "",
        val body: String = "",
        val date: String = "",
        val onReply: (() -> Unit)? = null
    ) : ChatMessage()
    data class Evaluation(
        override val id: Long = nextId(),
        val company: String = "",
        val role: String = "",
        val score: String = "",
        val summary: String = "",
        val reportPath: String = "",
        val onApply: (() -> Unit)? = null
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

    data class ScanActions(
        override val id: Long = nextId(),
        val expandLocationLabel: String = "",
        val tryKeywordsLabel: String = "",
        val deepScanLabel: String = "",
        val otherLocations: List<ScanResult> = emptyList(),
        val onExpandLocation: (() -> Unit)? = null,
        val onTryKeywords: (() -> Unit)? = null,
        val onDeepScan: (() -> Unit)? = null
    ) : ChatMessage()

    data class FormQuestion(
        override val id: Long = nextId(),
        val fieldId: String,
        val category: String = "",
        val label: String = "",
        val required: Boolean = false,
        val options: List<String> = emptyList(),
        val hint: String = "",
        val answered: Boolean = false,
        val answer: String = "",
        val onAnswer: ((String) -> Unit)? = null
    ) : ChatMessage()

    data class ScanResultsCard(
        override val id: Long = nextId(),
        val summary: String,
        val scanned: Int,
        val results: List<ScanResult>,
        val onViewAll: (() -> Unit)? = null
    ) : ChatMessage()

    data class BatchReviewCard(
        override val id: Long = nextId(),
        val company: String = "",
        val role: String = "",
        val score: String = "",
        val fit: String = "",
        val strengths: List<String> = emptyList(),
        val gaps: List<String> = emptyList(),
        val reportNum: Int = 0,
        val url: String = "",
        val contactPhones: List<String> = emptyList(),
        val onTailorCv: (() -> Unit)? = null,
        val onApply: (() -> Unit)? = null,
        val onDiscard: (() -> Unit)? = null
    ) : ChatMessage()

    data class SubmitConfirmation(
        override val id: Long = nextId(),
        val company: String = "",
        val atsType: String = "",
        val fieldsFilled: Int = 0,
        val fieldsTotal: Int = 0,
        val cvAttached: Boolean = false,
        val onSubmit: (() -> Unit)? = null,
        val onReview: (() -> Unit)? = null
    ) : ChatMessage()

    data class ManualApplyCard(
        override val id: Long = nextId(),
        val company: String = "",
        val url: String = "",
        val guide: ManualApplyGuide? = null,
        val onMarkApplied: (() -> Unit)? = null
    ) : ChatMessage()

    // One recruiter phone + its own ready-to-open wa.me link. A posting can
    // expose several phones, so each number gets its own target — a single
    // bad/concatenated value can never corrupt the whole draft.
    data class WhatsAppTarget(
        val label: String = "",
        val digits: String = "",
        val link: String = ""
    )

    // Fallback when the posting has no contact email but the recruiter's
    // phone was found — the drafted letter is sent straight to WhatsApp
    // via a wa.me link with a prefilled message, so the user can apply
    // without the assistant being present.
    data class WhatsAppApply(
        override val id: Long = nextId(),
        val company: String = "",
        val role: String = "",
        val url: String = "",
        val phone: String = "",
        val waTargets: List<WhatsAppTarget> = emptyList(),
        val waLink: String = "",
        val message: String = "",
        val onMarkApplied: (() -> Unit)? = null
    ) : ChatMessage()

    data class SpamConfirm(
        override val id: Long = nextId(),
        val count: Int = 0,
        val senders: List<String> = emptyList(),
        val deleting: Boolean = false,
        val onConfirm: (() -> Unit)? = null,
        val onCancel: (() -> Unit)? = null
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
        private const val MAX_MESSAGES = 1200
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

    // Guard against duplicate application sends: rapid taps on a draft's Send
    // button used to fire multiple /email/send calls (3 clicks = 3 emails + 3
    // tracker rows). sendingDraftIds blocks concurrent sends for the same
    // draft; sentDraftIds blocks any re-send after success.
    private val sendingDraftIds = mutableSetOf<Long>()
    private val sentDraftIds = mutableSetOf<Long>()

    // ── CLI-like operation control ──────────────────────────────────────
    // isProcessing drives the persistent Stop/Retry bar. When it flips to
    // false we automatically drain any messages the user queued while busy.
    private var _isProcessing by mutableStateOf(false)
    var isProcessing: Boolean
        get() = _isProcessing
        private set(value) {
            _isProcessing = value
            if (!value && !suppressDrain) drainQueue()
        }
    private var suppressDrain = false

    /** Messages sent while busy — they run one-by-one after the current task. */
    private val queuedMessages = mutableStateListOf<String>()

    /** True when the last operation was interrupted by Stop (drives "Resume"). */
    private var wasInterrupted by mutableStateOf(false)

    val queued: List<String> get() = queuedMessages.toList()
    val hasQueued: Boolean get() = queuedMessages.isNotEmpty()

    fun clearQueue() {
        if (queuedMessages.isNotEmpty()) {
            messages.add(ChatMessage.System("\u23F9\uFE0F **Cleared ${queuedMessages.size} queued task(s).**"))
            queuedMessages.clear()
            persistMessages()
        }
    }
    
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

    /** The currently-running operation so the persistent HITL "Stop" can cancel it. */
    private var activeJob: kotlinx.coroutines.Job? = null

    /** Draft editor state — driven by the persistent "Edit" quick action and draft cards. */
    var editingDraftId by mutableStateOf<Long?>(null)
        private set
    var editingDraftText by mutableStateOf("")
        private set
    private var scanKeywords: String = ""
    private var scanLocations: String = ""
    private var scanRound: Int = 0

    // In-flight /scan/stream OkHttp call — cancelled on Stop so the SSE read
    // loop unblocks (a bare coroutine cancel can't interrupt a blocking
    // readLine(); only cancelling the call does).
    private var activeScanCall: okhttp3.Call? = null

    // Full-screen scan results overlay (all jobs in one scrollable list)
    var scanResultsOverlay: List<ScanResult>? by mutableStateOf(null)
        private set
    private var scanResultsSummary: String = ""
    fun openScanResults(summary: String, results: List<ScanResult>) {
        scanResultsSummary = summary
        // Render the list live: drop any job that has since been applied to or
        // discarded (removed from suggestedJobs), so re-opening the full-screen
        // list from an old chat card never resurrects a company you already
        // applied to — no duplicate applications.
        scanResultsOverlay = results.filter { job -> suggestedJobs.any { isSameListing(it, job) } }
    }
    fun closeScanResults() { scanResultsOverlay = null }
    fun scanResultsOverlaySummary(): String = scanResultsSummary

    // Pinned "Suggested jobs" list — every scan's results are collected here so
    // a pinned button (ChatScreen FAB) can re-open them in a modal without
    // scrolling the chat. Auto-updates: applying to a company removes it, so
    // the list only ever shows companies you have NOT applied to yet.
    var suggestedJobs: List<ScanResult> by mutableStateOf(emptyList())
        private set
    var suggestedJobsOverlay: Boolean by mutableStateOf(false)
        private set
    // True once the first scan produces results — keeps the pinned
    // "Suggested jobs" button visible permanently (even when the list is
    // empty), so the job list never "goes away" into the chat history.
    var hasScannedOnce: Boolean by mutableStateOf(false)
        private set
    fun openSuggestedJobs() { suggestedJobsOverlay = true }
    fun closeSuggestedJobs() { suggestedJobsOverlay = false }
    fun applyFromSuggestedJobs(job: ScanResult) {
        suggestedJobsOverlay = false
        viewModelScope.launch { draftApplication(job.company, job.role, job.url) }
    }
    // Fuzzy identity: two listings are "the same job" if their normalized
    // company names match (e.g. "Sanket Rathod Collectives" vs
    // "Sanket Rathod Collectives Pvt. Ltd.") or their URLs match ignoring a
    // trailing slash. Used so applied/discarded jobs never reappear even when
    // the tracked name or URL string differs from the listing's.
    // Fuzzy identity: two listings are "the same opening" if their URLs match
    // (ignoring a trailing slash) OR their normalized company AND role both
    // match. A different role at the same company is a SEPARATE job and stays
    // visible/applyable — applying to "Senior Developer" at a company must not
    // hide that company's "DevOps Engineer" opening.
    private fun isSameListing(a: ScanResult, b: ScanResult): Boolean {
        val urlMatches = a.url.isNotBlank() && b.url.isNotBlank() &&
            a.url.trim().trimEnd('/').equals(b.url.trim().trimEnd('/'), ignoreCase = true)
        if (urlMatches) return true
        val companyMatches = normalizeCompanyName(a.company).isNotEmpty() &&
            normalizeCompanyName(a.company) == normalizeCompanyName(b.company)
        val roleMatches = normalizeRoleName(a.role).isNotEmpty() &&
            normalizeRoleName(a.role) == normalizeRoleName(b.role)
        return companyMatches && roleMatches
    }
    private fun normalizeCompanyName(name: String): String =
        name.lowercase().filter { it.isLetterOrDigit() }
    private fun normalizeRoleName(role: String): String =
        role.lowercase().filter { it.isLetterOrDigit() }

    fun removeAppliedFromSuggested(company: String, role: String = "", jobUrl: String = "") {
        if (company.isBlank() && jobUrl.isBlank()) return
        val target = ScanResult(company = company, role = role, url = jobUrl)
        // Remove only the exact opening that was applied to/discarded (by URL,
        // or by company+role). Other roles at the same company stay listed.
        suggestedJobs = suggestedJobs.filterNot { job -> isSameListing(target, job) }
        persistSuggestedJobs()
    }

    // Drop any suggested job whose EXACT opening (company AND role) is already
    // in the tracker with an active status (Applied/Responded/Interview/Offer/
    // Discarded). Keeps the pinned list truthful even for entries restored from
    // a previous session or merged before a job was applied/discarded — while
    // leaving a company's other, unapplied roles visible.
    private suspend fun filterSuggestedAgainstTracker() {
        if (suggestedJobs.isEmpty()) return
        try {
            val tracker = withContext(Dispatchers.IO) { api.getTracker() }
            val blocked = tracker.applications
                .filter { it.status in setOf("Applied", "Interview", "Offer", "Responded", "Discarded") }
                .map { Pair(normalizeCompanyName(it.company), normalizeRoleName(it.role)) }
                .filter { it.first.isNotEmpty() && it.second.isNotEmpty() }
                .toSet()
            if (blocked.isEmpty()) return
            val before = suggestedJobs.size
            suggestedJobs = suggestedJobs.filterNot { job ->
                blocked.contains(Pair(normalizeCompanyName(job.company), normalizeRoleName(job.role)))
            }
            if (suggestedJobs.size != before) persistSuggestedJobs()
        } catch (_: Exception) {}
    }

    // Persist the pinned suggested-jobs list to disk so it survives app
    // restarts — the "Suggested (N)" button stays pinned across sessions.
    private fun persistSuggestedJobs() {
        try {
            val arr = JSONArray()
            for (job in suggestedJobs) {
                arr.put(JSONObject()
                    .put("company", job.company)
                    .put("role", job.role)
                    .put("url", job.url)
                    .put("source", job.source)
                    .put("location", job.location)
                    .put("salary", job.salary)
                    .put("score", job.score)
                    .put("fit", job.fit))
            }
            prefs.saveSuggestedJobs(arr.toString(), app.applicationContext)
        } catch (_: Exception) {}
    }

    private fun restoreSuggestedJobs() {
        try {
            val raw = prefs.loadSuggestedJobs(app.applicationContext)
            if (raw.isBlank()) return
            val arr = JSONArray(raw)
            val restored = mutableListOf<ScanResult>()
            for (i in 0 until arr.length()) {
                val obj = arr.getJSONObject(i)
                restored.add(ScanResult(
                    company = obj.optString("company", ""),
                    role = obj.optString("role", ""),
                    url = obj.optString("url", ""),
                    source = obj.optString("source", ""),
                    location = obj.optString("location", ""),
                    salary = obj.optString("salary", ""),
                    score = obj.optString("score", ""),
                    fit = obj.optString("fit", "")
                ))
            }
            suggestedJobs = restored.distinctBy { it.url.ifBlank { "${it.company}::${it.role}" } }
        } catch (_: Exception) {}
    }

    // The bridge server is the source of truth for the last scan's job list —
    // it caches the final results per-user (scan-results-cache.json). Restore
    // from there on open: instant, no re-scan, and the list only changes when
    // the user runs a scan again (which overwrites the server cache). The local
    // suggested_jobs.json restore above stays as a fallback for offline opens.
    private suspend fun restoreSuggestedJobsFromServer() {
        try {
            val cached = withContext(Dispatchers.IO) { api.getCachedScanResults() }
            if (!cached.cached) return
            if (cached.results.isNotEmpty()) {
                suggestedJobs = cached.results
                    .distinctBy { it.url.ifBlank { "${it.company}::${it.role}" } }
                hasScannedOnce = true
                persistSuggestedJobs()
            }
            filterSuggestedAgainstTracker()
        } catch (_: Exception) {}
    }
    fun applyFromScanResults(job: ScanResult) {
        // Close the overlay so the draft steps are visible in the chat below.
        scanResultsOverlay = null
        viewModelScope.launch { draftApplication(job.company, job.role, job.url) }
    }
    fun discardFromScanResults(job: ScanResult) {
        // Remove the discarded job from the pinned list (by URL + company) so
        // it disappears immediately — the same removal used after applying.
        removeAppliedFromSuggested(job.company, job.role, job.url)
        messages.add(ChatMessage.System("Discarded: ${job.company} — ${job.role}"))
        persistMessages()
    }

    init {
        // Restore persisted chat history
        val restored = restoreMessages()
        if (restored.isNotEmpty()) {
            messages.addAll(restored)
        } else {
            messages.add(ChatMessage.System(
                "Hey! I'm your job search assistant. Here's what I can do:\n\n" +
                "🔍 **Scan** job portals for matching roles\n" +
                "📄 **Tailor** your resume for each opportunity\n" +
                "📝 **Evaluate** any job posting (A-G scoring)\n" +
                "✉️ **Apply** — draft and send application emails\n" +
                "📫 **IMAP** — monitor inbox for recruiter replies\n" +
                "🤖 **Playwright** — auto-fill application forms\n" +
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

        // Restore the pinned suggested-jobs list so it survives restarts.
        restoreSuggestedJobs()
        if (suggestedJobs.isNotEmpty()) hasScannedOnce = true

        // Restore the server-side per-user scan cache (last scan's job list).
        // Overrides the local restore above so the pinned list always reflects
        // the most recent scan, then re-filters against the tracker.
        viewModelScope.launch { restoreSuggestedJobsFromServer() }

        // Re-filter the restored list against the tracker (applied/discarded
        // companies must not linger from a previous session).
        viewModelScope.launch { filterSuggestedAgainstTracker() }

        debugLog.add(DebugEntry("init", "ViewModel created, session: none"))

        // Persist whenever the message list changes so chat survives process
        // kills — not just onDispose (which never runs if the app is killed
        // while chat is on screen).
        viewModelScope.launch {
            snapshotFlow { messages.toList() }
                .debounce(500)
                .collect { persistMessages() }
        }

        // Persist the pinned suggested-jobs list whenever it changes, so the
        // "Suggested (N)" button stays available across app restarts.
        viewModelScope.launch {
            snapshotFlow { suggestedJobs.toList() }
                .drop(1)
                .debounce(500)
                .collect { persistSuggestedJobs() }
        }

        // Start inbox polling (check every 60s for new recruiter replies)
        startInboxPolling()
    }

    private fun startInboxPolling() {
        inboxPollJob?.cancel()
        inboxPollJob = viewModelScope.launch {
            while (true) {
                kotlinx.coroutines.delay(30_000) // every 30s
                // Keep the pinned suggested-jobs list truthful: re-drop any
                // company that entered the tracker since the last refresh
                // (Applied/Responded/Interview/Offer/Discarded) even when the
                // application was submitted from another client.
                filterSuggestedAgainstTracker()
                if (prefs.userEmail.isEmpty()) continue
                try {
                    // Cursor-based scan: first run backfills 90 days, then scans
                    // incrementally — no older opportunity is ever missed, and
                    // already-classified mail is not re-processed.
                    val scan = api.scanInbox()
                    for (n in scan.notifications) {
                        if (n.type != "recruiter_reply" && n.type != "interview" && n.type != "offer") continue
                        val alreadyNotified = messages.any { msg ->
                            msg is ChatMessage.System && msg.text.contains(n.message.take(60))
                        }
                        if (alreadyNotified) continue
                        val icon = when (n.type) {
                            "interview" -> "\uD83C\uDF1F"
                            "offer" -> "\uD83C\uDF89"
                            else -> "\uD83D\uDCE8"
                        }
                        Toast.makeText(app, "${n.title}: ${n.message}", Toast.LENGTH_LONG).show()
                        // NOTIFY ONLY. Never auto-draft or auto-send from polling —
                        // the user must explicitly ask to draft a reply.
                        val text = if (n.type == "recruiter_reply") {
                            "$icon **${n.title}:**\n${n.message}\n\n" +
                            "_Nothing was drafted or sent. To reply, say **'reply to {company}'** and I'll prepare a draft for your review._"
                        } else {
                            "$icon **${n.title}:**\n${n.message}"
                        }
                        messages.add(ChatMessage.System(text))
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
                    val baseUrl = prefs.bridgeServerUrl.trimEnd('/')
                    val request = okhttp3.Request.Builder()
                        .url("$baseUrl/notifications/check")
                        .header("X-User-Id", prefs.userEmail)
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
                            "interview_reminder" -> "\u23F0"
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
                    val baseUrl = prefs.bridgeServerUrl.trimEnd('/')
                    val json = org.json.JSONObject()
                        .put("company", company)
                        .put("role", role)
                    val body = json.toString().toRequestBody("application/json".toMediaType())
                    val request = okhttp3.Request.Builder()
                        .url("$baseUrl/interview-prep/generate")
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
                    messages.add(ChatMessage.System("Couldn't generate interview prep right now. Please try again."))
                }
            } catch (e: Exception) {
                removeProcessing()
                messages.add(ChatMessage.System("Couldn't generate interview prep right now. Please try again."))
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

        // CLI-like queueing: if we're busy, park the message and run it later.
        if (isProcessing) {
            queuedMessages.add(text)
            messages.add(ChatMessage.System(
                "\u23F3 **Queued** — I'm busy with another task. I'll run \"${text.take(60)}\" " +
                    "as soon as it finishes. Tap **Queue** to view or clear it."
            ))
            persistMessages()
            return
        }

        wasInterrupted = false
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
        // Playwright / deeper search → opencode (has browser + all tools)
        if (lower.contains("playwright") && (lower.contains("search") || lower.contains("fill") || lower.contains("apply"))) {
            debugLog.add(DebugEntry("route", "playwright search → opencode"))
        } else if (lower.contains("search more") || lower.contains("use playwright") || lower.contains("use browser") || lower.contains("also search") || lower.contains("deeper search")) {
            debugLog.add(DebugEntry("route", "deep search → opencode"))
        } else if (lower.contains("scan") || lower.contains("find job") || lower.contains("search")) {
            debugLog.add(DebugEntry("route", "scan intent → handleDirectScan"))
            activeJob = viewModelScope.launch { handleDirectScan() }
            return
        }
        // Spam intent first — "clean spam from my inbox" / "clean inbox" /
        // "delete spam" all contain "inbox", which must not route to the
        // recruiter-reply scan below.
        if (lower.contains("spam") || lower.contains("clean inbox") || lower.contains("delete spam")) {
            activeJob = viewModelScope.launch { handleDirectSpam() }
            return
        }
        if (lower.contains("inbox") || lower.contains("check email") || lower.contains("any reply") || lower.contains("any recruiter")) {
            activeJob = viewModelScope.launch { handleDirectInbox() }
            return
        }
        if ((lower.startsWith("reply") || lower.startsWith("respond")) && !lower.contains("http")) {
            activeJob = viewModelScope.launch { handleDirectReply(text) }
            return
        }
        if ((lower.startsWith("apply ") || lower.startsWith("evaluate ")) && (lower.contains("http") || lower.contains("www"))) {
            activeJob = viewModelScope.launch { handleDirectApply(text) }
            return
        }
        // Batch: "batch <url1> <url2>" or any message carrying 2+ job URLs
        if (lower.startsWith("batch") || Regex("https?://\\S+").findAll(text).count() >= 2) {
            activeJob = viewModelScope.launch { handleDirectBatch(text) }
            return
        }
        if (lower.contains("tracker") || lower.contains("show my application")) {
            activeJob = viewModelScope.launch { handleDirectTracker() }
            return
        }
        if (lower.contains("check interview") || lower.contains("any interview") || lower.contains("interview status") || lower.contains("upcoming interview") || lower.contains("interview reminder") || lower.contains("interview schedule")) {
            activeJob = viewModelScope.launch { handleCheckInterviews() }
            return
        }
        if ((lower.contains("auto-fill") || lower.contains("autofill") || lower.contains("auto fill") || (lower.contains("playwright") && lower.contains("fill"))) && (lower.contains("http") || lower.contains("www"))) {
            activeJob = viewModelScope.launch { handleDirectAutoFill(text) }
            return
        }
        if (lower.contains("schedule") || lower.contains("automation status") || lower.contains("scheduler")) {
            activeJob = viewModelScope.launch { handleDirectSchedule() }
            return
        }
        if ((lower.startsWith("follow") || lower.startsWith("followup") || lower.startsWith("follow up")) && lower.contains("company")) {
            activeJob = viewModelScope.launch { handleDirectFollowUp(text) }
            return
        }
        if (lower.startsWith("confirm fill") || lower.equals("confirm fill", ignoreCase = true)) {
            activeJob = viewModelScope.launch { handleConfirmFill() }
            return
        }
        if (lower.startsWith("send follow") || lower.startsWith("send followup") || lower.startsWith("send follow-up")) {
            activeJob = viewModelScope.launch { handleSendFollowUp(text) }
            return
        }
        if (_pendingFollowUpBody.isNotEmpty() && lower.contains("follow up") == false &&
            Regex("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}").containsMatchIn(text)) {
            // User supplied a recipient email while a follow-up is pending —
            // store it and ask for explicit confirmation before sending.
            activeJob = viewModelScope.launch { handleCaptureFollowUpTo(text) }
            return
        }
        if (lower.contains("interview prep") || lower.contains("interview preparation") || lower.startsWith("prepare for")) {
            activeJob = viewModelScope.launch {
                handleInterviewPrep(text)
            }
            return
        }

        // ── Fallback: route to opencode for AI-heavy tasks ──────────────
        activeJob = viewModelScope.launch { handleOpencodeChat(text, startTime) }
    }

    // ── Scan: uses /scan/stream SSE for live per-portal progress ─────────
    private suspend fun handleDirectScan(
        overrideKeywords: String? = null,
        overrideLocations: String? = null,
        deep: Boolean = false,
        round: Int = 1
    ) {
        var timerJob: kotlinx.coroutines.Job? = null
        try {
            // Reuse any existing processing card (sendMessage already added one).
            // This prevents a duplicate card that never gets removed.
            isProcessing = true
            ensureProcessingCard("Starting scan...")
            persistMessages()
            val scanStartTime = System.currentTimeMillis()
            timerJob = viewModelScope.launch {
                while (isProcessing) {
                    val elapsed = (System.currentTimeMillis() - scanStartTime) / 1000
                    updateProcessingCard(elapsed = "${elapsed}s")
                    kotlinx.coroutines.delay(1000)
                }
            }
            updateProcessingCard(detail = "Looking up your profile...")

            val profile = withContext(Dispatchers.IO) { api.getProfile() }
            val profileKeywords = (profile.targetRoles + profile.archetypes)
                .map { it.trim() }.filter { it.isNotEmpty() }.distinct()
                .takeIf { it.isNotEmpty() }
                ?: emptyList()
            val profileLocation = profile.location.takeIf { it.isNotBlank() } ?: ""

            val keywords = if (overrideKeywords != null) {
                overrideKeywords.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            } else {
                profileKeywords
            }
            val locations = if (overrideLocations != null) {
                overrideLocations.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            } else {
                profileLocation.takeIf { it.isNotBlank() }?.let { listOf(it) } ?: emptyList()
            }

            // Store scan context for expansion actions
            scanKeywords = keywords.joinToString(",")
            scanLocations = locations.joinToString(",")
            scanRound = round

            val rolesStr = keywords.joinToString(", ")
            val locStr = locations.joinToString(", ").takeIf { it.isNotBlank() } ?: "any location"

            updateProcessingCard(detail = "Scanning for $rolesStr in $locStr...")

            // Call /scan/stream SSE endpoint
            val baseUrl = prefs.bridgeServerUrl.trimEnd('/')
            val kwEncoded = java.net.URLEncoder.encode(keywords.joinToString(","), "UTF-8")
            val locEncoded = java.net.URLEncoder.encode(locations.joinToString(","), "UTF-8")
            val roundParam = if (round > 1) "&round=$round" else (if (deep) "&deep=true" else "")
            val url = "$baseUrl/scan/stream?keywords=$kwEncoded&locations=$locEncoded$roundParam"

            val client = okhttp3.OkHttpClient.Builder()
                .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(300, java.util.concurrent.TimeUnit.SECONDS)
                .build()

            val request = okhttp3.Request.Builder()
                .url(url)
                .header("X-User-Id", prefs.userEmail)
                .build()

            val call = client.newCall(request)
            activeScanCall = call
            val response = withContext(Dispatchers.IO) { call.execute() }
            val body = response.body ?: throw Exception("No response body")

            var finalResults: ScanResponse? = null

            withContext(Dispatchers.IO) {
                body.byteStream().bufferedReader().use { reader ->
                    var currentEvent = ""
                    val dataBuffer = StringBuilder()
                    var line = reader.readLine()
                    while (line != null) {
                        when {
                            line.startsWith("event: ") -> currentEvent = line.removePrefix("event: ").trim()
                            line.startsWith("data: ") -> {
                                dataBuffer.clear()
                                dataBuffer.append(line.removePrefix("data: "))
                            }
                            line.isEmpty() && currentEvent.isNotEmpty() -> {
                                val dataStr = dataBuffer.toString()
                                try {
                                    val json = JSONObject(dataStr)
                                    when (currentEvent) {
                                        "start" -> {
                                            val total = json.optInt("totalPortals", 0)
                                            val phase = json.optString("phase", "")
                                            withContext(Dispatchers.Main) {
                                                updateProcessingCard(
                                                    detail = "Scanning $total portals ($phase phase)...",
                                                    progress = 0f
                                                )
                                            }
                                        }
                                        "progress" -> {
                                            val company = json.optString("current", "")
                                            val kwMatches = json.optInt("keywordMatches", 0)
                                            val completed = json.optInt("completed", 0)
                                            val total = json.optInt("total", 0)
                                            val statusNote = json.optString("statusNote", "")
                                            val progress = if (total > 0) completed.toFloat() / total else 0f
                                            val status = when {
                                                statusNote.isNotEmpty() -> statusNote
                                                kwMatches > 0 -> "$kwMatches match${if (kwMatches != 1) "es" else ""}"
                                                else -> "no matches"
                                            }
                                            withContext(Dispatchers.Main) {
                                                updateProcessingCard(
                                                    detail = "$completed/$total — $company: $status",
                                                    progress = progress
                                                )
                                            }
                                        }
                                        "results" -> {
                                            // Live results during the scan — merge into the
                                            // pinned suggested-jobs list so the FAB count and
                                            // the open modal update in realtime, no need to
                                            // wait for `done`. Server already excluded tracker
                                            // (applied/responded/interview/offer/discarded)
                                            // and below-minimum-salary jobs.
                                            val resultsArr = json.optJSONArray("results") ?: JSONArray()
                                            val jobs = mutableListOf<ScanResult>()
                                            for (i in 0 until resultsArr.length()) {
                                                val j = resultsArr.getJSONObject(i)
                                                jobs.add(ScanResult(
                                                    company = j.optString("company", ""),
                                                    role = j.optString("role", ""),
                                                    url = j.optString("url", ""),
                                                    location = j.optString("location", ""),
                                                    salary = j.optString("salary", ""),
                                                    score = j.optString("score", ""),
                                                    fit = j.optString("fit", "")
                                                ))
                                            }
                                            if (jobs.isNotEmpty()) {
                                                withContext(Dispatchers.Main) {
                                                    hasScannedOnce = true
                                                    suggestedJobs = (suggestedJobs + jobs)
                                                        .distinctBy { it.url.ifBlank { "${it.company}::${it.role}" } }
                                                    persistSuggestedJobs()
                                                }
                                            }
                                        }
                                        "done" -> {
                                            val resultsArr = json.optJSONArray("results") ?: JSONArray()
                                            val jobs = mutableListOf<ScanResult>()
                                            for (i in 0 until resultsArr.length()) {
                                                val j = resultsArr.getJSONObject(i)
                                                jobs.add(ScanResult(
                                                    company = j.optString("company", ""),
                                                    role = j.optString("role", ""),
                                                    url = j.optString("url", ""),
                                                    location = j.optString("location", ""),
                                                    salary = j.optString("salary", ""),
                                                    score = j.optString("score", ""),
                                                    fit = j.optString("fit", "")
                                                ))
                                            }
                                            val portalResultsArr = json.optJSONArray("portalResults") ?: JSONArray()
                                            val portals = mutableListOf<PortalResult>()
                                            for (i in 0 until portalResultsArr.length()) {
                                                val p = portalResultsArr.getJSONObject(i)
                                                portals.add(PortalResult(
                                                    company = p.optString("company", ""),
                                                    status = p.optString("status", ""),
                                                    keywordMatches = p.optInt("keywordMatches", 0),
                                                    exactMatches = p.optInt("exactMatches", 0),
                                                    error = p.optString("error", "")
                                                ))
                                            }
                                            val wideningArr = json.optJSONArray("wideningSteps") ?: JSONArray()
                                            val steps = mutableListOf<String>()
                                            for (i in 0 until wideningArr.length()) { steps.add(wideningArr.getString(i)) }

                                            val otherLocArr = json.optJSONArray("otherLocations") ?: JSONArray()
                                            val otherJobs = mutableListOf<ScanResult>()
                                            for (i in 0 until otherLocArr.length()) {
                                                val j = otherLocArr.getJSONObject(i)
                                                otherJobs.add(ScanResult(
                                                    company = j.optString("company", ""),
                                                    role = j.optString("role", ""),
                                                    url = j.optString("url", ""),
                                                    location = j.optString("location", ""),
                                                    salary = j.optString("salary", ""),
                                                    score = j.optString("score", ""),
                                                    fit = j.optString("fit", "")
                                                ))
                                            }

                                            finalResults = ScanResponse(
                                                results = jobs,
                                                total = json.optInt("total", 0),
                                                newFound = json.optInt("newFound", 0),
                                                portalsScanned = json.optJSONObject("summary")?.optInt("portalsScanned", portalResultsArr.length()) ?: portalResultsArr.length(),
                                                locationExactMatch = if (json.has("locationExactMatch")) json.optBoolean("locationExactMatch") else null,
                                                portalResults = portals,
                                                wideningSteps = steps,
                                                otherLocations = otherJobs
                                            )
                                        }
                                        "error" -> {
                                            val err = json.optString("error", "Scan failed")
                                            withContext(Dispatchers.Main) { timerJob?.cancel(); removeProcessing(); isProcessing = false }
                                            throw Exception(err)
                                        }
                                    }
                                } catch (_: Exception) { }
                                currentEvent = ""
                                dataBuffer.clear()
                            }
                        }
                        line = reader.readLine()
                    }
                }
            }

            timerJob?.cancel()
            withContext(Dispatchers.Main) {
                removeProcessing()
                isProcessing = false

                if (finalResults != null) {
                    val r = finalResults!!

                    // The pinned "View Jobs (N)" list mirrors the LAST scan's
                    // results — REPLACE, don't merge. During the scan the live
                    // `results` events merged progressive snapshots onto the old
                    // list; the final `done` payload is the authoritative set,
                    // so the FAB count, the JobsScreen header, the chat message
                    // and the card all show the same number after it lands.
                    if (r.results.isNotEmpty()) {
                        hasScannedOnce = true
                        suggestedJobs = r.results
                            .distinctBy { it.url.ifBlank { "${it.company}::${it.role}" } }
                        persistSuggestedJobs()
                    }

                    // Belt-and-suspenders: drop any restored/stale entry whose
                    // company is already in the tracker (applied/responded/
                    // interview/offer/discarded), then surface the pinned list
                    // right away — no scrolling the chat to find it.
                    viewModelScope.launch { filterSuggestedAgainstTracker() }

                    // Show widening steps (honest match report)
                    if (r.wideningSteps.isNotEmpty()) {
                        for (step in r.wideningSteps) {
                            messages.add(ChatMessage.System(step))
                        }
                    }

                    if (r.results.isNotEmpty()) {
                        val locLabel = if (r.locationExactMatch == true) "in $locStr" else "near $locStr (other areas)"
                        messages.add(ChatMessage.System("Found **${r.results.size}** job(s) matching **$rolesStr** $locLabel (${r.portalsScanned} sources scanned, ${r.total} roles found):"))
                        messages.add(ChatMessage.ScanResultsCard(
                            summary = "Found ${r.results.size} jobs matching your profile",
                            scanned = r.total,
                            results = r.results,
                            onViewAll = { openSuggestedJobs() }
                        ))
                    } else {
                        messages.add(ChatMessage.System("No matching jobs found right now. I'll re-check on the next scheduled scan."))
                    }

                    // Scan report — readable per-portal summary (no cryptic "74 kw, 74 loc")
                    if (r.portalResults.isNotEmpty()) {
                        val matched = r.portalResults
                            .filter { it.keywordMatches > 0 }
                            .sortedByDescending { it.keywordMatches }
                        val blocked = r.portalResults
                            .filter { it.status == "errored" || it.error.isNotEmpty() || it.status == "blocked" }
                        val report = mutableListOf<String>()
                        report.add("**Scan report:** ${r.portalsScanned} portals checked · ${r.total} roles found · **${r.results.size} matched you**.")
                        if (matched.isNotEmpty()) {
                            val top = matched.take(8).joinToString(", ") { "${it.company}: ${it.keywordMatches} roles" }
                            report.add("Top sources: $top${if (matched.size > 8) " +${matched.size - 8} more" else ""}")
                        }
                        if (blocked.isNotEmpty()) {
                            report.add("⚠ ${blocked.size} portal(s) were blocked or empty — the scan retried them in the browser (Playwright).")
                        }
                        if (report.size > 1) {
                            messages.add(ChatMessage.System(report.joinToString("\n")))
                        }
                    }

                    // Add interactive expansion actions — every first-pass scan
                    // invites the user to "Scan again" which widens across more
                    // Indian job portals (Naukri, Indeed, Shine, Foundit, TimesJobs,
                    // Hirist, Cutshort, Instahyre, Internshala, and more).
                    val expandLabel = if (scanRound < 2) {
                        "Scan again to search more Indian portals"
                    } else {
                        ""
                    }
                    val tryKwLabel = if (r.results.isEmpty()) "Try different keywords" else ""

                    if (expandLabel.isNotEmpty() || tryKwLabel.isNotEmpty()) {
                        messages.add(ChatMessage.ScanActions(
                            expandLocationLabel = expandLabel,
                            tryKeywordsLabel = tryKwLabel,
                            deepScanLabel = "",
                            otherLocations = r.otherLocations,
                            onExpandLocation = if (expandLabel.isNotEmpty()) { {
                                viewModelScope.launch { handleRerunScan("expand") }
                            } } else null,
                            onTryKeywords = if (tryKwLabel.isNotEmpty()) { {
                                viewModelScope.launch { handleRerunScan("keywords") }
                            } } else null,
                            onDeepScan = null
                        ))
                    }
                    persistMessages()
                } else {
                    messages.add(ChatMessage.System("Scan completed but could not parse results."))
                }
            }
        } catch (e: java.net.SocketTimeoutException) {
            timerJob?.cancel()
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Couldn't reach the server. Make sure your bridge server is running."))
        } catch (e: kotlinx.coroutines.CancellationException) {
            // Stop was pressed — stopProcessing already cleaned up and posted
            // the "Stopped" message. Rethrow so the coroutine ends quietly.
            throw e
        } catch (e: Exception) {
            timerJob?.cancel()
            removeProcessing()
            isProcessing = false
            if (wasInterrupted) {
                // OkHttp cancel throws IOException ("Canceled"), which would
                // otherwise surface as "Scan failed". Quietly exit — the
                // "Stopped" message was already posted by stopProcessing().
                return
            }
            messages.add(ChatMessage.System("Scan failed: ${e.message}"))
        } finally {
            activeScanCall = null
        }
    }

    // ── Consolidated scan re-run action ──────────────────────────────────
    private data class ScanRerun(val label: String, val keywords: String, val locations: String, val deep: Boolean, val round: Int)

    private suspend fun handleRerunScan(action: String) {
        val rerun = when (action) {
            "expand" -> ScanRerun(
                "Scanning more Indian job portals (Naukri, Indeed, Shine, Foundit, TimesJobs, Hirist, Cutshort, Instahyre, Internshala and more)...",
                scanKeywords, scanLocations, false, 2
            )
            "keywords" -> ScanRerun("Trying broader keywords...", "", scanLocations, false, 1)
            "deep" -> ScanRerun("Running deep scan with Playwright (same filters)...", scanKeywords, scanLocations, true, 2)
            else -> return
        }
        messages.add(ChatMessage.System(rerun.label))
        handleDirectScan(overrideKeywords = rerun.keywords, overrideLocations = rerun.locations, deep = rerun.deep, round = rerun.round)
    }

    // ── Direct inbox via POST /email/scan (classified) ──────────────────
    // Only recruiter-relevant mail surfaces (interview / offer / recruiter_reply),
    // each with a Reply button that drafts a thread-aware reply to THAT recruiter.
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
                // Explicit 90-day window: the server re-lists EVERY recruiter
                // reply from the last 90 days (cache + fast heuristic, no slow
                // model calls), so no recruiter conversation is ever missed.
                // The background poll keeps scanning incrementally (new only).
                api.scanInbox(ScanInboxRequest(daysBack = 90))
            }
            removeProcessing()
            isProcessing = false

            val relevant = response.notifications.filter {
                it.type == "interview" || it.type == "offer" || it.type == "recruiter_reply"
            }

            if (relevant.isEmpty()) {
                messages.add(ChatMessage.System(
                    "**Inbox (90 days):** No recruiter replies, interviews, or offers found (${response.scanned} emails scanned). " +
                    "I'll keep watching for new opportunities."
                ))
                persistMessages()
                return
            }

            messages.add(ChatMessage.System(
                "**Inbox (90 days):** ${relevant.size} recruiter message${if (relevant.size != 1) "s" else ""} found (${response.scanned} emails scanned). " +
                "Tap **Reply** on any conversation to draft a reply to that specific recruiter."
            ))

            for (n in relevant) {
                val icon = when (n.type) {
                    "interview" -> "\uD83C\uDF1F"
                    "offer" -> "\uD83C\uDF89"
                    else -> "\uD83D\uDCE8"
                }
                val email = n.email
                val fromEmail = (email?.fromEmail ?: n.fromEmail).ifBlank { "" }
                val from = (email?.from ?: n.from).ifBlank { "Unknown" }
                val subject = (email?.subject ?: n.subject).ifBlank { "Re: your application" }
                val body = (email?.body ?: n.body).ifBlank { "" }
                val messageId = (email?.messageId ?: n.messageId).ifBlank { "" }
                val threadId = (email?.threadId ?: n.threadId).ifBlank { "" }
                val inReplyTo = (email?.inReplyTo ?: "").ifBlank { "" }
                val date = (email?.date ?: n.date).ifBlank { "" }
                messages.add(ChatMessage.InboxNotificationCard(
                    type = n.type,
                    title = n.title,
                    message = n.message,
                    from = from,
                    fromEmail = fromEmail,
                    subject = subject,
                    threadId = threadId,
                    messageId = messageId,
                    inReplyTo = inReplyTo,
                    body = body,
                    date = date,
                    onReply = {
                        viewModelScope.launch {
                            draftReplyForThread(
                                to = fromEmail,
                                subject = subject,
                                originalBody = body,
                                inReplyTo = messageId,
                                threadId = threadId,
                                replyType = when (n.type) {
                                    "interview" -> "interview"
                                    "offer" -> "accept_offer"
                                    else -> "generic"
                                }
                            )
                        }
                    }
                ))
                // Brief visual header line before the card
                messages.add(ChatMessage.System("$icon **${n.title}**"))
            }

            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            val reason = e.message?.takeIf { it.isNotBlank() }?.let { "\n($it)" } ?: ""
            messages.add(ChatMessage.System("Couldn't check your inbox right now. Please try again.$reason"))
        }
    }

    // ── Direct spam delete via POST /email/spam/delete ───────────────────
    // HITL: "delete spam" never deletes immediately. It fetches the flagged
    // messages, shows a SpamConfirm card with count + senders, and only deletes
    // after the user taps Delete and confirms in the dialog.
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
            val spamEmails = inbox.emails.filter { it.spam?.isSpam == true }
            val spamIds = spamEmails.mapNotNull {
                it.gmailId.ifEmpty { it.uid.ifEmpty { it.id } }.takeIf { id -> id.isNotEmpty() && id != "0" }
            }
            if (spamIds.isEmpty()) {
                removeProcessing()
                isProcessing = false
                messages.add(ChatMessage.System("No spam emails found to delete."))
                return
            }

            _pendingSpamIds = spamIds
            _pendingSpamSenders = spamEmails
                .map { it.from.ifBlank { it.subject.ifBlank { "(no sender)" } } }
                .distinct()
                .take(12)
            removeProcessing()
            isProcessing = false

            val cardId = ChatMessage.nextId()
            _pendingSpamCardId = cardId
            messages.add(ChatMessage.SpamConfirm(
                id = cardId,
                count = spamIds.size,
                senders = _pendingSpamSenders,
                onConfirm = { viewModelScope.launch { performSpamDelete() } },
                onCancel = {
                    _pendingSpamCardId = null
                    _pendingSpamIds = emptyList()
                    _pendingSpamSenders = emptyList()
                    val idx = messages.indexOfFirst { it.id == cardId }
                    if (idx >= 0) messages.removeAt(idx)
                }
            ))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            val reason = e.message?.takeIf { it.isNotBlank() }?.let { "\n($it)" } ?: ""
            messages.add(ChatMessage.System("Couldn't clean your inbox right now. Please try again.$reason"))
        }
    }

    // Pending spam-delete state (filled by handleDirectSpam, cleared by the
    // confirm/cancel handlers).
    private var _pendingSpamCardId: Long? = null
    private var _pendingSpamIds: List<String> = emptyList()
    private var _pendingSpamSenders: List<String> = emptyList()

    private suspend fun performSpamDelete() {
        val cardId = _pendingSpamCardId ?: return
        val ids = _pendingSpamIds
        if (ids.isEmpty()) return
        val idx = messages.indexOfFirst { it.id == cardId }
        if (idx >= 0 && messages[idx] is ChatMessage.SpamConfirm) {
            messages[idx] = (messages[idx] as ChatMessage.SpamConfirm).copy(deleting = true)
        }
        try {
            val response = withContext(Dispatchers.IO) {
                api.deleteSpam(SpamDeleteRequest(messageIds = ids, markAsRead = true))
            }
            val deletedCount = (response["deleted"] as? Number)?.toInt() ?: ids.size
            messages.add(ChatMessage.System("Deleted $deletedCount spam email${if (deletedCount == 1) "" else "s"}."))
        } catch (e: Exception) {
            messages.add(ChatMessage.System("Couldn't clean your inbox right now. Please try again."))
        } finally {
            _pendingSpamCardId = null
            _pendingSpamIds = emptyList()
            _pendingSpamSenders = emptyList()
            val i = messages.indexOfFirst { it.id == cardId }
            if (i >= 0) messages.removeAt(i)
            isProcessing = false
            persistMessages()
        }
    }

    // ── Direct reply via POST /email/reply (thread-aware) ─────────────────
    // "reply to {company}" / "reply to {recruiter}" resolves against the most
    // recent inbox conversation matching the hint, then drafts a reply to that
    // specific email thread (to / subject / inReplyTo / threadId).
    private suspend fun handleDirectReply(text: String) {
        try {
            val replyType = when {
                text.contains("interview") -> "interview"
                text.contains("follow") -> "follow_up"
                text.contains("accept") -> "accept_offer"
                text.contains("negotiate") -> "negotiate"
                else -> "generic"
            }

            // Resolve the conversation from the hint after "reply to".
            val hint = text.replace(Regex("(?i)^(reply|respond)(\\s+to)?\\s*"), "")
                .trim().trimEnd('.')
                .lowercase()
                .ifBlank { "" }

            val conversation = messages.indexOfLast { it is ChatMessage.InboxNotificationCard }
                .takeIf { it >= 0 }
                ?.let { messages[it] as ChatMessage.InboxNotificationCard }
                ?.let { card ->
                    // Prefer a card whose from/subject/message contains the hint;
                    // fall back to the most recent card when there is no hint.
                    val matches = messages.filterIsInstance<ChatMessage.InboxNotificationCard>()
                        .filter {
                            hint.isEmpty() ||
                            it.from.lowercase().contains(hint) ||
                            it.subject.lowercase().contains(hint) ||
                            it.message.lowercase().contains(hint) ||
                            it.fromEmail.lowercase().contains(hint)
                        }
                    matches.lastOrNull() ?: card
                }

            if (conversation == null || conversation.fromEmail.isBlank()) {
                removeProcessing()
                isProcessing = false
                messages.add(ChatMessage.System(
                    "\uD83D\uDCE8 No recruiter conversation found to reply to.\n" +
                    "Say **'check inbox'** first — each recruiter message gets a **Reply** button you can tap to draft a reply to that specific conversation."
                ))
                persistMessages()
                return
            }

            draftReplyForThread(
                to = conversation.fromEmail,
                subject = conversation.subject,
                originalBody = conversation.body,
                inReplyTo = conversation.messageId,
                threadId = conversation.threadId,
                replyType = replyType
            )
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Couldn't draft a reply right now. Please try again."))
        }
    }

    // Draft a thread-aware reply to a specific recruiter email and show it as a
    // ReplyDraft card. On send, the full thread context (to/subject/inReplyTo/
    // threadId) goes to /email/reply/send so the reply lands in the SAME thread.
    private suspend fun draftReplyForThread(
        to: String,
        subject: String,
        originalBody: String = "",
        inReplyTo: String = "",
        threadId: String = "",
        replyType: String = "generic"
    ) {
        if (to.isBlank()) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "\uD83D\uDCE8 I couldn't find a verified sender email for that conversation, so I can't draft a reply to it.\n" +
                "Use the **Reply** button on an inbox message, or say **'check inbox'** to reload recruiter conversations."
            ))
            persistMessages()
            return
        }
        try {
            ensureProcessingCard("Drafting reply to ${to.takeBefore("@")}...")
            updateProcessingCard(detail = "Drafting reply...")

            val response = withContext(Dispatchers.IO) {
                api.draftReply(EmailReplyRequest(
                    to = to,
                    subject = subject,
                    body = originalBody,
                    inReplyTo = inReplyTo.ifBlank { null },
                    replyType = replyType
                ))
            }
            removeProcessing()
            isProcessing = false

            val replyBody = response.replyBody
            val replySubject = response.subject.ifBlank { "Re: $subject" }
            val draftTo = response.to.ifBlank { to }
            val draftInReplyTo = (response.inReplyTo ?: inReplyTo).orEmpty()
            val draftThreadId = (response.threadId ?: threadId).orEmpty()

            val replyDraftId = ChatMessage.nextId()
            messages.add(ChatMessage.System(
                "\uD83D\uDCE8 **Reply draft** for **${draftTo.takeBefore("@")}** — tap **Send** below after reviewing."
            ))
            messages.add(ChatMessage.ReplyDraft(
                id = replyDraftId,
                to = draftTo,
                subject = replySubject,
                body = replyBody,
                replyType = replyType,
                inReplyTo = draftInReplyTo,
                threadId = draftThreadId,
                onSend = {
                    viewModelScope.launch {
                        // No repeat sends for the same reply draft.
                        if (replyDraftId in sendingDraftIds || replyDraftId in sentDraftIds) return@launch
                        sendingDraftIds.add(replyDraftId)
                        setDraftSendState(replyDraftId, sending = true, sent = false)
                        try {
                            val sendBody = mutableMapOf(
                                "to" to draftTo,
                                "subject" to replySubject,
                                "body" to replyBody
                            )
                            if (draftInReplyTo.isNotBlank()) sendBody["inReplyTo"] = draftInReplyTo
                            if (draftThreadId.isNotBlank()) sendBody["threadId"] = draftThreadId
                            withContext(Dispatchers.IO) {
                                api.sendReplyDraft(sendBody)
                            }
                            sentDraftIds.add(replyDraftId)
                            setDraftSendState(replyDraftId, sending = false, sent = true)
                            messages.add(ChatMessage.System(
                                "\u2705 **Reply sent** to **${draftTo.takeBefore("@")}** in the same conversation."
                            ))
                        } catch (e: Exception) {
                            setDraftSendState(replyDraftId, sending = false, sent = false)
                            messages.add(ChatMessage.System("\u274C Failed to send reply."))
                        }
                        sendingDraftIds.remove(replyDraftId)
                    }
                },
                onEdit = {
                    openDraftEditor(replyDraftId)
                }
            ))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Couldn't draft a reply right now. Please try again."))
        }
    }

    // Grab the local-part of an email for friendly display.
    private fun String.takeBefore(sep: String): String = substringBefore(sep)

    // ── Direct apply via auto-pipeline + optional auto-send ───────────────
    private fun extractCompanyFromUrl(url: String): String {
        val cleaned = url.lowercase().trimEnd('/')
        // Lever: jobs.lever.co/company/...
        Regex("jobs\\.lever\\.co/([^/]+)").find(cleaned)?.let { return it.groupValues[1] }
        // Greenhouse: boards.greenhouse.io/company/...
        Regex("boards\\.greenhouse\\.io/([^/]+)").find(cleaned)?.let { return it.groupValues[1] }
        // Ashby: jobs.ashbyhq.com/company
        Regex("jobs\\.ashbyhq\\.com/([^/]+)").find(cleaned)?.let { return it.groupValues[1] }
        // Workday: company.wd1.myworkdayjobs.com/...
        Regex("([^.]+\\.wd\\d+\\.myworkdayjobs\\.com)").find(cleaned)?.let { return it.groupValues[1].split(".")[0] }
        // LinkedIn: linkedin.com/jobs/view/... (no company in path)
        // General: company.com/careers or careers.company.com
        Regex("careers\\.([^./]+)\\.").find(cleaned)?.let { return it.groupValues[1] }
        Regex("/([^./]+)\\.com/(careers|jobs)").find(cleaned)?.let { return it.groupValues[1] }
        return ""
    }

    private suspend fun handleDirectApply(text: String) {
        val urlMatch = Regex("https?://\\S+").find(text)
        if (urlMatch == null) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System("Please paste a valid job URL."))
            return
        }
        val url = urlMatch.value
        var company = extractCompanyFromUrl(url)
        var role = ""
        try {
            updateProcessingCard(detail = "Running auto-pipeline for $url...")
            val evalResponse = withContext(Dispatchers.IO) {
                api.autoPipeline(AutoPipelineRequest(url = url, company = company.ifEmpty { null }, role = null))
            }
            company = evalResponse.company?.takeIf { it.isNotEmpty() } ?: company.ifEmpty { "Unknown" }
            role = evalResponse.role?.takeIf { it.isNotEmpty() } ?: role
            val score = evalResponse.score
            val scoreNum = score.replace("/5", "").toFloatOrNull() ?: 0f

            removeProcessing(); isProcessing = false

            val scoreLabel = if (scoreNum > 0) "$score/5" else score

            // Step 2: Check tracker for duplicates
            val tracker = withContext(Dispatchers.IO) { api.getTracker() }
            if (isSpammed(company, role, tracker.applications)) {
                messages.add(ChatMessage.Evaluation(
                    company = company, role = role, score = scoreLabel,
                    summary = "Fit: ${evalResponse.fit}\nStrengths: ${evalResponse.strengths.joinToString(", ")}\nGaps: ${evalResponse.gaps.joinToString(", ")}",
                    reportPath = evalResponse.reportPath
                ))
                messages.add(ChatMessage.System("\u26A0\uFE0F Already applied to **$company** \u2014 skipping duplicate."))
                persistMessages(); return
            }

            // Step 3: Show evaluation card with an Apply button (draft-only, HITL)
            if (scoreNum >= 4.0f) {
                messages.add(ChatMessage.Evaluation(
                    company = company, role = role, score = scoreLabel,
                    summary = "Fit: ${evalResponse.fit}\nStrengths: ${evalResponse.strengths.joinToString(", ")}\nGaps: ${evalResponse.gaps.joinToString(", ")}",
                    reportPath = evalResponse.reportPath,
                    onApply = { viewModelScope.launch { isProcessing = true; val c = ChatMessage.ProcessingCard(steps = emptyList(), currentStep = 0, elapsed = "0s"); processingCardId = c.id; messages.add(c); draftApplication(company, role) } }
                ))
            } else {
                // Score too low or N/A — just show evaluation
                messages.add(ChatMessage.Evaluation(
                    company = company, role = role, score = scoreLabel,
                    summary = "Fit: ${evalResponse.fit}\nStrengths: ${evalResponse.strengths.joinToString(", ")}\nGaps: ${evalResponse.gaps.joinToString(", ")}",
                    reportPath = evalResponse.reportPath
                ))
                val reason = if (scoreNum < 4.0f && scoreNum > 0f) "Score $scoreLabel is below the 4.0 threshold" else "Score unavailable"
                messages.add(ChatMessage.System("\u26A0\uFE0F **$company** \u2014 $reason. Review the evaluation above."))
            }
            persistMessages()
        } catch (e: java.net.SocketTimeoutException) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System("Couldn't reach the server. Make sure your bridge server is running."))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System("Couldn't evaluate that posting. Please check the URL and try again."))
            persistMessages()
        }
    }

    // ── Batch evaluation: /batch evaluates 2-5 URLs, each grounded with JD +
    // recruiter contact and a per-user report, so every result carries a reportNum
    // ready for /cv/tailor. Renders one reviewable BatchReviewCard per job.
    private suspend fun handleDirectBatch(text: String) {
        try {
            val urls = Regex("https?://\\S+")
                .findAll(text)
                .map { it.value.trimEnd(',', ';', ')', ']') }
                .filter { it.startsWith("http") }
                .distinct()
                .toList()
            if (urls.isEmpty()) {
                removeProcessing(); isProcessing = false
                messages.add(ChatMessage.System(
                    "Paste **2 or more job URLs** (or say **'batch'** then the URLs) and I'll evaluate them all in one pass."
                ))
                persistMessages(); return
            }
            val picked = urls.take(5)
            val batch = picked.map { u ->
                val company = extractCompanyFromUrl(u)
                BatchItem(url = u, company = company.ifEmpty { null }, role = null)
            }
            updateProcessingCard(
                detail = "Evaluating ${batch.size} job${if (batch.size != 1) "s" else ""} — this takes a minute or two per job..."
            )
            val response = withContext(Dispatchers.IO) {
                api.batchEvaluate(BatchRequest(urls = batch))
            }
            removeProcessing(); isProcessing = false

            if (response.results.isEmpty()) {
                messages.add(ChatMessage.System("Batch evaluation returned no results. Check the URLs and try again."))
                persistMessages(); return
            }
            messages.add(ChatMessage.System(
                "**Batch evaluation:** ${response.results.size} job(s) evaluated. Tap a card to **Tailor CV** or **Apply** (draft only, never auto-sent)."
            ))
            for (r in response.results) {
                val scoreNum = r.score.replace("/5", "").toFloatOrNull() ?: 0f
                val strong = scoreNum >= 4.0f
                messages.add(ChatMessage.BatchReviewCard(
                    company = r.company.orEmpty().ifBlank { "Unknown" },
                    role = r.role.orEmpty(),
                    score = if (scoreNum > 0) "${r.score}/5" else r.score,
                    fit = r.fit,
                    strengths = r.strengths,
                    gaps = r.gaps,
                    reportNum = r.reportNum,
                    url = r.url,
                    contactPhones = r.contactPhones,
                    onTailorCv = { viewModelScope.launch { tailorCv(r) } },
                    onApply = if (strong) { {
                        viewModelScope.launch {
                            isProcessing = true
                            ensureProcessingCard("Preparing application for ${r.company}...")
                            draftApplication(r.company.orEmpty(), r.role.orEmpty(), r.url)
                        }
                    } } else null,
                    onDiscard = {
                        removeAppliedFromSuggested(r.company.orEmpty(), r.role.orEmpty(), r.url.orEmpty())
                        messages.add(ChatMessage.System("Discarded: ${r.company} — ${r.role}"))
                        persistMessages()
                    }
                ))
            }
            if (response.results.none { (it.score.replace("/5", "").toFloatOrNull() ?: 0f) >= 4.0f }) {
                messages.add(ChatMessage.System(
                    "\u26A0\uFE0F None of these scored 4.0/5 — all below the apply threshold. Review the gaps on each card before applying."
                ))
            }
            persistMessages()
        } catch (e: Exception) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System("Couldn't run the batch evaluation: ${describeError(e)}"))
            persistMessages()
        }
    }

    // ── One-tap tailored CV: POST /cv/tailor anchored to the batch report. The
    // bridge runs the fact gate internally (rejects fabricated claims, re-runs),
    // so the PDF that lands in the user's output/ dir is grounded in cv.md.
    private suspend fun tailorCv(result: AutoPipelineResponse) {
        try {
            isProcessing = true
            ensureProcessingCard("Tailoring CV for ${result.company}...")
            updateProcessingCard(
                detail = "Tailoring CV for ${result.company} — this takes a couple of minutes (fact-checked)..."
            )
            val resp = withContext(Dispatchers.IO) {
                api.tailorCv(TailorCvRequest(
                    reportNum = result.reportNum.takeIf { it > 0 },
                    company = result.company,
                    role = result.role
                ))
            }
            removeProcessing(); isProcessing = false
            if (resp.success) {
                messages.add(ChatMessage.System(
                    "\uD83D\uDCC4 **Tailored CV ready for ${result.company}**${if (result.role.orEmpty().isNotEmpty()) " — ${result.role}" else ""}\n" +
                    "PDF: ${resp.pdfPath}\n\n" +
                    "It's ATS-optimized and fact-checked against your cv.md. To send it with an application, say **'apply ${result.company}'** or paste the job URL."
                ))
            } else {
                messages.add(ChatMessage.System(
                    "\u274C Couldn't tailor the CV for **${result.company}**: ${resp.error ?: "unknown error"}"
                ))
            }
        } catch (e: Exception) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System(
                "\u274C Couldn't tailor the CV for **${result.company}**: ${describeError(e)}"
            ))
        }
        persistMessages()
    }

    // ── Check interviews: detect + list upcoming with reminders ───────────
    private suspend fun handleCheckInterviews() {
        try {
            updateProcessingCard(detail = "Scanning inbox for interview invites...")
            val baseUrl = prefs.bridgeServerUrl.trimEnd('/')
            val client = okhttp3.OkHttpClient.Builder().build()

            val detectBody = org.json.JSONObject()
                .put("email", prefs.userEmail)
                .put("daysBack", 14)
                .put("maxEmails", 40)
                .toString().toRequestBody("application/json".toMediaType())
            val detectReq = okhttp3.Request.Builder()
                .url("$baseUrl/interview/detect")
                .post(detectBody)
                .build()
            withContext(Dispatchers.IO) { client.newCall(detectReq).execute() }

            val listReq = okhttp3.Request.Builder()
                .url("$baseUrl/interviews")
                .get()
                .build()
            val response = withContext(Dispatchers.IO) { client.newCall(listReq).execute() }

            removeProcessing()
            isProcessing = false

            if (response.isSuccessful) {
                val body = response.body?.string() ?: ""
                val json = org.json.JSONObject(body)
                val arr = json.getJSONArray("interviews")
                if (arr.length() == 0) {
                    messages.add(ChatMessage.System(
                        "\uD83D\uDCC5 **Interviews**\nNo interview invites detected in the last 14 days."
                    ))
                } else {
                    val upcoming = (0 until arr.length())
                        .map { arr.getJSONObject(it) }
                        .filter { it.optString("status") == "scheduled" }
                    val sb = StringBuilder("\uD83D\uDCC5 **Interviews (${arr.length()} found, ${upcoming.size} upcoming)**\n")
                    for (i in upcoming.indices) {
                        val iv = upcoming[i]
                        val whenText = iv.optString("scheduledHuman", "time not stated — check email")
                        val whenFinal = whenText.ifBlank { "time not stated — check email" }
                        val reminder = iv.optJSONObject("reminder")
                        val due = reminder?.optBoolean("due", false) == true
                        sb.append("\n${i + 1}. **${iv.optString("from", "?").substringBefore("<").trim()}**\n")
                        sb.append("   ${iv.optString("subject", "")}\n")
                        sb.append("   \u23F0 ${whenFinal}\n")
                        if (due) sb.append("   \u26A0\uFE0F ${reminder.optString("label", "due soon")}\n")
                    }
                    sb.append("\n_Say **'interview prep for {company}'** to prepare._")
                    messages.add(ChatMessage.System(sb.toString()))
                }
            } else {
                messages.add(ChatMessage.System("\u274C Couldn't check interviews right now. Please try again."))
            }
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("\u274C Couldn't check interviews right now. Please try again."))
        }
    }

    // ── Direct interview prep ──────────────────────────────────────────────
    private suspend fun handleInterviewPrep(text: String) {        // Extract company name from text
        val companyMatch = Regex("(?i)(?:interview prep(?:aration)? for|prepare for|research)\\s+(.+?)(?:\\s*$|\\s+(?:role|position|at))").find(text)
        val company = companyMatch?.groupValues?.get(1)?.trim()?.removeSuffix(".") ?: ""
        val roleMatch = Regex("(?i)(?:role|position)\\s+(.+?)(?:\\s*$|\\s+(?:at))").find(text)

        if (company.isEmpty()) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "Which company do you want interview prep for?\n" +
                "Say **'interview prep for {company}'**."
            ))
            return
        }

        val role = roleMatch?.groupValues?.get(1)?.trim()?.removeSuffix(".") ?: ""

        try {
            updateProcessingCard(detail = "Researching $company...")

            val baseUrl = prefs.bridgeServerUrl.trimEnd('/')
            val client = okhttp3.OkHttpClient.Builder().build()
            val json = org.json.JSONObject()
                .put("company", company)
                .put("role", role)
            val body = json.toString().toRequestBody("application/json".toMediaType())
            val request = okhttp3.Request.Builder()
                .url("$baseUrl/interview-prep/generate")
                .post(body)
                .build()

            val response = withContext(Dispatchers.IO) { client.newCall(request).execute() }

            removeProcessing()
            isProcessing = false

            if (response.isSuccessful) {
                val respBody = response.body?.string() ?: ""
                val respJson = try { org.json.JSONObject(respBody) } catch (_: Exception) { null }
                val content = respJson?.optString("preparation", respBody) ?: respBody

                messages.add(ChatMessage.System(
                    "\uD83C\uDF1F **Interview Prep: $company**" +
                    if (role.isNotEmpty()) " — $role" else "" +
                    "\n\n${truncateIfNeeded(content)}"
                ))
            } else {
                messages.add(ChatMessage.System("\u274C Interview prep failed for **$company**"))
            }
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
                messages.add(ChatMessage.System("\u274C Couldn't prepare interview insights. Please try again."))
        }
    }

    // ── Direct auto-fill via POST /apply/open → POST /apply/fill ──────────
    private suspend fun handleDirectAutoFill(text: String) {
        val urlMatch = Regex("https?://\\S+").find(text)
        if (urlMatch == null) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("Please paste a valid job URL to auto-fill."))
            return
        }
        startAutoFill(urlMatch.value)
    }

    // Shared Playwright auto-fill flow: /apply/open → /apply/fill (never auto-submits).
    // Used by the typed "auto-fill <url>" command and by Apply when the job is a
    // portal listing or no contact email exists.
    private suspend fun startAutoFill(url: String, companyHint: String = "", roleHint: String = "") {
        try {
            ensureProcessingCard("Opening application form...")
            updateProcessingCard(detail = "Opening application form...")

            // Step 1: Open Chrome and extract form fields
            val openResponse = withContext(Dispatchers.IO) {
                api.applyOpen(ApplyOpenRequest(url = url, stealth = true))
            }

            val company = openResponse.company.ifEmpty { companyHint.ifEmpty { "Unknown" } }
            _pendingAutoFillRole = roleHint

            // No error AND a real form → continue to the fill flow. If the open
            // step errored, or it came back with ZERO fields (login-walled
            // portal / SPA form that never rendered / multi-step apply), the
            // email-first step already failed too — every method is exhausted.
            // Push a clear "apply manually" instruction (fit is implied: Apply
            // is only reachable for good-fit jobs) instead of a dead "confirm
            // fill" dead-end.
            if (openResponse.error != null || openResponse.fields.isEmpty()) {
                removeProcessing()
                isProcessing = false
                val guide = openResponse.manual_apply_guide
                val manualUrl = guide?.manual_apply_url?.takeIf { it.isNotBlank() }
                    ?: openResponse.manualUrl.takeIf { it.isNotBlank() }
                    ?: url
                val reason = openResponse.error
                    ?: openResponse.message.ifBlank {
                        "The application form couldn't be reached automatically (login required or no visible form)."
                    }
                messages.add(ChatMessage.System(
                    "\u26A0\uFE0F **Auto-fill couldn't complete for $company**\n" +
                    "$reason\n\n" +
                    "I tried every method — drafting an application email and auto-filling the form — " +
                    "but this posting can't be submitted automatically. " +
                    "Please apply manually at the link below."
                ))
                val applyRole = _pendingAutoFillRole
                messages.add(ChatMessage.ManualApplyCard(
                    company = company,
                    url = manualUrl,
                    guide = guide,
                    onMarkApplied = {
                        viewModelScope.launch { handleMarkApplied(company, manualUrl, applyRole) }
                    }
                ))
                return
            }

            val atsType = openResponse.atsType ?: "unknown"
            val fieldCount = openResponse.fields.size
            val answerCount = openResponse.answers.size

            removeProcessing()
            isProcessing = false

            // Show field summary
            messages.add(ChatMessage.System(
                "\uD83E\uDD16 **Got it — I can fill the $company form** ($atsType).\n" +
                "Found **$fieldCount** fields ($answerCount auto-answered from your profile).\n\n" +
                "I'll attach your CV and **won't submit anything** — you review the form, then tap Submit."
            ))

            // Show fields that will be filled
            if (openResponse.fields.isNotEmpty()) {
                val fieldSummary = openResponse.fields.take(10).joinToString("\n") { f ->
                    val req = if (f.required) " *" else ""
                    val val_ = openResponse.answers[f.id]?.let { " → $it" } ?: ""
                    "  \u2022 **${f.label}**${req}$val_"
                }
                messages.add(ChatMessage.System(
                    "**Fields to fill:**\n$fieldSummary" +
                    if (openResponse.fields.size > 10) "\n  ... and ${openResponse.fields.size - 10} more" else ""
                ))
            }

            // Store the URL, answers and questions for the confirm step
            _pendingAutoFillUrl = url
            _pendingAutoFillAnswers = openResponse.answers.toMutableMap()
            _pendingAutoFillCompany = company
            _pendingAutoFillQuestions = openResponse.pending_questions

            // Ask the candidate for any fields we could not auto-fill — inline,
            // before any fill happens. Answers are persisted to config/form-answers.yml
            // so the same question is never asked twice.
            val questions = openResponse.pending_questions
            if (questions.isNotEmpty()) {
                messages.add(ChatMessage.System(
                    "\u2753 **${questions.size} question${if (questions.size != 1) "s" else ""} before I can fill the form for $company:**"
                ))
                for (q in questions) {
                    val cardId = ChatMessage.nextId()
                    messages.add(ChatMessage.FormQuestion(
                        id = cardId,
                        fieldId = q.field_id,
                        category = q.category,
                        label = q.label,
                        required = q.required,
                        options = q.options,
                        hint = q.hint,
                        onAnswer = { value -> answerAutoFillQuestion(cardId, q, value) }
                    ))
                }
                messages.add(ChatMessage.System(
                    "Answer the question${if (questions.size != 1) "s" else ""} above, then say **'confirm fill'** and I'll fill the form for **$company**."
                ))
            } else {
                messages.add(ChatMessage.System(
                    "All set — say **'confirm fill'** and I'll fill the form for **$company**."
                ))
            }

        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("\u274C Couldn't auto-fill the form. Please try manually or check the URL."))
        }
    }

    // Pending auto-fill questions (fields that need the candidate's input)
    private var _pendingAutoFillQuestions: List<ApplyPendingQuestion> = emptyList()

    // Record the candidate's answer to a pending question, persist it to
    // config/form-answers.yml (keyed by category so it is reused everywhere),
    // merge it into the fill answers, and mark the question card answered.
    private fun answerAutoFillQuestion(cardId: Long, q: ApplyPendingQuestion, value: String) {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) {
            messages.add(ChatMessage.System("Please provide an answer for: ${q.label}"))
            return
        }
        // Update the question card to "answered"
        val idx = messages.indexOfFirst { it.id == cardId }
        if (idx >= 0) {
            messages[idx] = ChatMessage.FormQuestion(
                id = cardId,
                fieldId = q.field_id,
                category = q.category,
                label = q.label,
                required = q.required,
                options = q.options,
                hint = q.hint,
                answered = true,
                answer = trimmed,
                onAnswer = { answerAutoFillQuestion(cardId, q, it) }
            )
        }
        // Merge into fill answers
        _pendingAutoFillAnswers = _pendingAutoFillAnswers + (q.field_id to trimmed)
        // Persist keyed by category so future forms are auto-filled
        if (q.category.isNotEmpty()) {
            viewModelScope.launch {
                try {
                    withContext(Dispatchers.IO) {
                        api.saveFormAnswers(FormAnswersRequest(answers = mapOf(q.category to trimmed)))
                    }
                } catch (_: Exception) {}
            }
        }
        messages.add(ChatMessage.System("\u2705 **${q.label}** → $trimmed"))
        persistMessages()
    }

    // Job aggregator / portal hosts. These never expose a direct contact email, so
    // Apply routes them to the auto-fill flow instead of an email draft.
    private fun isPortalListingUrl(url: String): Boolean {
        val host = url.lowercase()
        return listOf(
            "linkedin.com", "shine.com", "internshala.com", "naukri.com", "indeed.com",
            "glassdoor.com", "monster.com", "foundit.com", "timesjobs.com", "cutshort.io",
            "wellfound.com", "hirect.in", "apna.co", "talent.com", "jooble.org"
        ).any { host.contains(it) }
    }

    // Pending auto-fill state
    private var _pendingAutoFillUrl: String = ""
    private var _pendingAutoFillAnswers: Map<String, String> = emptyMap()
    private var _pendingAutoFillCompany: String = ""
    private var _pendingAutoFillRole: String = ""

    // Confirm and execute auto-fill
    private suspend fun handleConfirmFill() {
        if (_pendingAutoFillUrl.isEmpty()) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("No pending auto-fill. Paste a job URL and say 'auto-fill' first."))
            return
        }
        // All required pending questions must be answered before filling
        val unanswered = _pendingAutoFillQuestions
            .filter { it.required && it.field_id !in _pendingAutoFillAnswers }
            .map { it.label }
        if (unanswered.isNotEmpty()) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "Please answer ${unanswered.size} more question${if (unanswered.size != 1) "s" else ""} first: " +
                unanswered.joinToString("; ") + "."
            ))
            return
        }
        try {
            isProcessing = true
            val card = ChatMessage.ProcessingCard(steps = emptyList(), currentStep = 0, elapsed = "0s")
            processingCardId = card.id
            messages.add(card)
            updateProcessingCard(detail = "Filling form for $_pendingAutoFillCompany...")

            val fillResponse = withContext(Dispatchers.IO) {
                api.applyFill(ApplyFillRequest(
                    url = _pendingAutoFillUrl,
                    answers = _pendingAutoFillAnswers,
                    company = _pendingAutoFillCompany
                ))
            }

            removeProcessing()
            isProcessing = false

            if (fillResponse.success) {
                val cvStatus = when {
                    fillResponse.cvAttached -> "CV attached ✅"
                    fillResponse.cvNote.isNotBlank() -> "⚠️ ${fillResponse.cvNote}"
                    else -> "⚠️ No CV found to attach"
                }
                // Show field summary
                messages.add(ChatMessage.System(
                    "✅ **Form filled for $_pendingAutoFillCompany** — review it before submitting.\n" +
                    "Filled ${fillResponse.filled.size}/${fillResponse.filled.size + fillResponse.skipped.size} fields\n" +
                    cvStatus
                ))
                // Show submit confirmation card — proven CLI pattern:
                // /apply/fill (no submit) → review → /apply/fill (submit=true)
                val company = _pendingAutoFillCompany
                val url = _pendingAutoFillUrl
                val answers = _pendingAutoFillAnswers
                val role = _pendingAutoFillRole
                messages.add(ChatMessage.SubmitConfirmation(
                    company = company,
                    atsType = fillResponse.atsType ?: "Unknown",
                    fieldsFilled = fillResponse.filled.size,
                    fieldsTotal = fillResponse.filled.size + fillResponse.skipped.size,
                    cvAttached = fillResponse.cvAttached,
                    onSubmit = {
                        viewModelScope.launch {
                            handleSubmitApplication(url, company, answers, role)
                        }
                    },
                    onReview = {
                        messages.add(ChatMessage.System(
                            "Open this URL in your browser to review the filled form:\n${url}"
                        ))
                    }
                ))
            } else {
                val reason = fillResponse.message.ifBlank { fillResponse.error ?: "Unknown error" }
                val loginVia = fillResponse.loginVia
                val loginHint = if (fillResponse.loginWall) {
                    "\n\n🔑 This portal needs you to sign in before its form appears. " +
                    "We automatically try Google OAuth login (your Google session) and any saved portal password, " +
                    "then fill the form. If it still failed, log in once on the site (Settings → Portal Logins can store a " +
                    "fallback password) and retry — the session is remembered per-account."
                } else if (loginVia == "google-oauth") {
                    "\n\n✅ Logged in with your Google account (OAuth) to reach the form."
                } else if (loginVia == "portal-creds") {
                    "\n\n✅ Logged in using your saved portal credentials to reach the form."
                } else ""
                val manualUrl = fillResponse.manualUrl.ifBlank { _pendingAutoFillUrl }
                messages.add(ChatMessage.System(
                    "\u274C **Form fill failed for $_pendingAutoFillCompany**\n" +
                    "$reason$loginHint\n\n" +
                    "You can try again or apply manually: $manualUrl"
                ))
                val company = _pendingAutoFillCompany
                val role = _pendingAutoFillRole
                messages.add(ChatMessage.ManualApplyCard(
                    company = company,
                    url = manualUrl,
                    guide = null,
                    onMarkApplied = {
                        viewModelScope.launch { handleMarkApplied(company, manualUrl, role) }
                    }
                ))
            }
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("\u274C Couldn't submit the form. Please try manually."))
        } finally {
            _pendingAutoFillUrl = ""
            _pendingAutoFillAnswers = emptyMap()
            _pendingAutoFillCompany = ""
            _pendingAutoFillRole = ""
            _pendingAutoFillQuestions = emptyList()
        }
    }

    // Submit step: re-calls /apply/fill with submit=true. Same proven CLI pattern:
    // fill (no submit) → review → fill (submit=true) → report result.
    // Called from the SubmitConfirmation card's "Submit" button.
    private suspend fun handleSubmitApplication(
        url: String,
        company: String,
        answers: Map<String, String>,
        role: String = ""
    ) {
        try {
            ensureProcessingCard("Submitting application to $company...")
            updateProcessingCard(detail = "Clicking submit on $company form...")

            val fillResponse = withContext(Dispatchers.IO) {
                api.applyFill(ApplyFillRequest(
                    url = url,
                    answers = answers,
                    company = company,
                    stealth = true,
                    submit = true
                ))
            }

            removeProcessing()
            isProcessing = false

            val submitState = fillResponse.submit
            if (submitState?.submissionOk == true) {
                val cvLine = if (fillResponse.cvAttached) " · CV attached" else ""
                messages.add(ChatMessage.System(
                    "🎉 **Application submitted to $company!**\n" +
                    "${fillResponse.filled.size} fields filled$cvLine\n" +
                    "I'll watch your inbox and track their reply."
                ))
                markCompanyApplied(company, role, notes = "Submitted via auto-fill ($url)", jobUrl = url)
            } else if (submitState?.clicked == true && submitState.validationErrors.isNotEmpty()) {
                // Form was submitted but validation blocked it — safe, nothing was sent
                val errorList = submitState.validationErrors.joinToString("\n") { "• $it" }
                val emptyList = submitState.emptyRequired.joinToString("\n") { "• $it" }
                messages.add(ChatMessage.System(
                    "⚠️ **Form validation blocked submission to $company**\n\n" +
                    "The submit button was clicked but the form requires these fields:\n" +
                    "$errorList\n\n" +
                    if (emptyList.isNotBlank()) "Empty required fields:\n$emptyList\n\n" else "" +
                    "The form did NOT submit — nothing was sent. " +
                    "Fill the remaining fields on the site, then tap below to mark it applied."
                ))
                messages.add(ChatMessage.ManualApplyCard(
                    company = company,
                    url = url,
                    onMarkApplied = {
                        viewModelScope.launch { handleMarkApplied(company, url, role) }
                    }
                ))
            } else {
                messages.add(ChatMessage.System(
                    "❌ **Submit failed for $company**\n" +
                    "${fillResponse.message.ifBlank { fillResponse.error ?: "Submit button not found" }}\n\n" +
                    "Please apply manually at this link:\n$url"
                ))
                messages.add(ChatMessage.ManualApplyCard(
                    company = company,
                    url = url,
                    onMarkApplied = {
                        viewModelScope.launch { handleMarkApplied(company, url, role) }
                    }
                ))
            }
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "❌ **Submit failed for $company**: ${e.message}\n" +
                "Please apply manually at this link:\n$url"
            ))
            messages.add(ChatMessage.ManualApplyCard(
                company = company,
                url = url,
                onMarkApplied = {
                    viewModelScope.launch { handleMarkApplied(company, url, role) }
                }
            ))
        }
    }

    // Find the most recent tracker entry for a company AND role (both
    // case-insensitive). Role-aware so applying to a different role at the same
    // company adds its own row instead of overwriting another role's row.
    private suspend fun findTrackerId(company: String, role: String = ""): String? {
        return try {
            val resp = withContext(Dispatchers.IO) { api.getTracker() }
            resp.applications
                .filter { it.company.equals(company, ignoreCase = true) }
                .filter { role.isBlank() || it.role.equals(role, ignoreCase = true) }
                .maxByOrNull { it.id.toIntOrNull() ?: 0 }
                ?.id
        } catch (_: Exception) { null }
    }

    // Mark a company as Applied in the tracker. If a tracker entry already
    // exists for the exact company+role its status is updated to Applied;
    // otherwise a new entry is added as Applied (so a second role at the same
    // company gets its own truthful row). Every apply path (email send,
    // auto-fill submit, manual apply) funnels through here so the tracker
    // always reflects what was actually done — no stale "Evaluated" entries
    // left behind, and different roles at one company stay distinct.
    private suspend fun markCompanyApplied(
        company: String,
        role: String = "",
        contactEmail: String = "",
        notes: String = "",
        jobUrl: String = ""
    ) {
        try {
            val existingId = findTrackerId(company, role)
            if (existingId != null) {
                withContext(Dispatchers.IO) {
                    api.updateStatus(existingId, mapOf("status" to ApplicationStatus.APPLIED.name))
                }
                messages.add(ChatMessage.System(
                    "\uD83D\uDCCB **Tracker updated**: $company → Applied"
                ))
            } else {
                withContext(Dispatchers.IO) {
                    api.addTrackerEntry(TrackerAddRequest(
                        company = company,
                        role = role.ifBlank { "Applied via career-ops app" },
                        contactEmail = contactEmail,
                        notes = notes
                    ))
                }
                messages.add(ChatMessage.System(
                    "\uD83D\uDCCB **Added $company to your tracker as Applied**"
                ))
            }
            removeAppliedFromSuggested(company, role, jobUrl)
        } catch (e: Exception) {
            messages.add(ChatMessage.System(
                "\uD83D\uDCCB Couldn't update the tracker for $company (${e.message}). Update it from your tracker view."
            ))
        }
    }

    // Called from the ManualApplyCard's "I applied manually" button.
    private suspend fun handleMarkApplied(company: String, url: String, role: String = "") {
        markCompanyApplied(company, role, notes = "Marked applied manually — $url", jobUrl = url)
    }

    // ── Direct follow-up via POST /followup/draft ──────────────────────────
    private suspend fun handleDirectFollowUp(text: String) {
        // Extract company name — look for company after "follow up with" or "followup"
        val companyMatch = Regex("(?i)(?:follow up with|follow up on|followup with|followup on)\\s+(.+?)(?:\\s*$|\\s+(?:about|regarding|for))").find(text)
        val company = companyMatch?.groupValues?.get(1)?.trim()?.removeSuffix(".") ?: ""

        if (company.isEmpty()) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "Which company do you want to follow up with?\n" +
                "Say **'follow up with {company name}'**."
            ))
            return
        }

        try {
            updateProcessingCard(detail = "Drafting follow-up for $company...")

            val draftResponse = withContext(Dispatchers.IO) {
                api.draftReply(EmailReplyRequest(
                    to = "",
                    subject = "",
                    body = "",
                    replyType = "follow_up"
                ))
            }

            removeProcessing()
            isProcessing = false

            messages.add(ChatMessage.System(
                "\u23F0 **Follow-up Draft for $company**\n\n" +
                "${draftResponse.replyBody}\n\n" +
                "Say **'send follow-up to $company'** to send it. If we don't have the hiring email yet, add it: **'send follow-up to $company at hr@$company.com'**."
            ))

            _pendingFollowUpCompany = company
            _pendingFollowUpBody = draftResponse.replyBody

        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("\u274C Couldn't draft a follow-up for $company. Please try again."))
        }
    }

    // ── Schedule status ──────────────────────────────────────────────────
    private suspend fun handleDirectSchedule() {
        try {
            updateProcessingCard(detail = "Checking scheduler status...")
            val baseUrl = prefs.bridgeServerUrl.trimEnd('/')
            var schedulerInfo = "unknown"
            try {
                val client = okhttp3.OkHttpClient.Builder().connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS).build()
                val req = okhttp3.Request.Builder().url("$baseUrl/scheduler/status").get().build()
                val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
                if (resp.isSuccessful) {
                    val json = org.json.JSONObject(resp.body?.string() ?: "{}")
                    schedulerInfo = json.optString("status", "running")
                }
            } catch (_: Exception) {
                schedulerInfo = "running (bridge has it)"
            }
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System(
                "\u23F0 **Automation Schedule**\n\n" +
                "Bridge server scheduler: **$schedulerInfo**\n" +
                "Auto-Apply: **${if (prefs.autoApply) "ON" else "OFF"}**\n" +
                "Auto-Reply: **${if (prefs.autoReply) "ON" else "OFF"}**\n\n" +
                "The bridge server runs daily at 6AM (scan, evaluate, follow-ups).\n" +
                "Toggle automation in Settings \u2192 Automation."
            ))
            persistMessages()
        } catch (e: Exception) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System("Couldn't check scheduler status."))
        }
    }

    // Pending follow-up state
    private var _pendingFollowUpCompany: String = ""
    private var _pendingFollowUpBody: String = ""
    private var _pendingFollowUpTo: String = ""

    // User supplied a recipient email for the pending follow-up — hold it for
    // explicit confirmation via "send follow-up to {company}".
    private suspend fun handleCaptureFollowUpTo(text: String) {
        val email = extractEmail(text)
        if (email == null) return
        _pendingFollowUpTo = email
        messages.add(ChatMessage.System(
            "Got it — recipient for the follow-up is set to **$email**.\n" +
            "Say **'send follow-up to ${_pendingFollowUpCompany}'** to send it."
        ))
    }

    // Send the pending follow-up
    private suspend fun handleSendFollowUp(text: String = "") {
        if (_pendingFollowUpCompany.isEmpty() || _pendingFollowUpBody.isEmpty()) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "No pending follow-up draft. Say **'follow up with {company}'** to create one first."
            ))
            return
        }
        val company = _pendingFollowUpCompany

        // Resolve the recipient: stored one > from the user's message > tracker notes.
        var to = _pendingFollowUpTo.ifBlank { null } ?: extractEmail(text)
        if (to == null) {
            try {
                val trackerResp = withContext(Dispatchers.IO) { api.getTracker() }
                to = trackerResp.applications
                    .filter { it.company.equals(company, ignoreCase = true) }
                    .mapNotNull { extractEmail(it.notes) }
                    .firstOrNull()
            } catch (_: Exception) {}
        }

        if (to == null) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System(
                "\u26A0\uFE0F **Follow-up draft ready for $company**, but I couldn't find the hiring email.\n\n" +
                _pendingFollowUpBody + "\n\n" +
                "Tell me the recipient and I'll send it, e.g. **'send follow-up to $company at hr@$company.com'**."
            ))
            return
        }

        try {
            updateProcessingCard(detail = "Sending follow-up to $company...")

            val response = withContext(Dispatchers.IO) {
                api.sendEmail(EmailSendRequest(
                    to = to,
                    subject = "Follow-up: Application at $company",
                    body = _pendingFollowUpBody,
                    company = company,
                    role = ""
                ))
            }

            removeProcessing()
            isProcessing = false

            if ((response["success"] as? Boolean) == true) {
                messages.add(ChatMessage.System("\u2705 **Follow-up sent to $company** ($to)"))
            } else {
                val errorMsg = (response["error"] as? String) ?: "Unknown error"
                messages.add(ChatMessage.System(
                    "\u274C Failed to send follow-up to $company.\nError: $errorMsg"
                ))
            }
            _pendingFollowUpCompany = ""
            _pendingFollowUpBody = ""
            _pendingFollowUpTo = ""
        } catch (e: Exception) {
            removeProcessing()
            isProcessing = false
            messages.add(ChatMessage.System("\u274C Couldn't send the follow-up: ${describeError(e)}"))
        }
    }

    private fun extractEmail(text: String?): String? {
        if (text.isNullOrBlank()) return null
        return Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
            .find(text)?.value?.takeIf { !it.contains("@your") && !it.contains("example") }
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
            messages.add(ChatMessage.System("Couldn't fetch your tracker data. Please try again."))
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
                    messages.add(ChatMessage.System("Couldn't complete that right now. Please try again."))
                    isProcessing = false
                    return
                }

                val body = response.body()
                if (body == null) {
                    removeProcessing()
                    debugLog.add(DebugEntry("error", "Empty response body"))
                    messages.add(ChatMessage.System("The service didn't return a response. Please try again."))
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
                    withTimeout(180_000) { parseSSEStreamIncremental(body) }
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
                                                    job["role"] ?: "",
                                                    job["url"] ?: ""
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
                                            action.data["role"] ?: "",
                                            action.data["url"] ?: ""
                                        )
                                    }
                                },
                                onSkip = {
                                    messages.add(ChatMessage.System("Skipped: ${action.data["company"]}"))
                                }
                            ))
                        }
                        "email_draft" -> {
                            val draftId = ChatMessage.nextId()
                            messages.add(ChatMessage.EmailDraft(
                                id = draftId,
                                to = action.data["to"] ?: "",
                                company = action.data["company"] ?: "",
                                role = action.data["role"] ?: "",
                                body = action.data["body"] ?: "",
                                subject = action.data["subject"] ?: "",
                                contactBlock = action.data["contactBlock"] ?: "",
                                onSend = {
                                    viewModelScope.launch {
                                        sendEmail(
                                            draftId = draftId,
                                            to = action.data["to"] ?: "",
                                            subject = action.data["subject"] ?: "",
                                            body = action.data["body"] ?: "",
                                            company = action.data["company"] ?: "",
                                            role = action.data["role"] ?: ""
                                        )
                                    }
                                },
                                onEdit = {
                                    openDraftEditor(draftId)
                                }
                            ))
                        }
                        "evaluation" -> {
                            val company = action.data["company"] ?: ""
                            val role = action.data["role"] ?: ""
                            messages.add(ChatMessage.Evaluation(
                                company = company,
                                role = role,
                                score = action.data["score"] ?: "",
                                summary = action.data["summary"] ?: "",
                                reportPath = action.data["reportPath"] ?: "",
                                onApply = if (company.isNotEmpty()) {
                                    { viewModelScope.launch { draftApplication(company, role, action.data["url"] ?: "") } }
                                } else null
                            ))
                        }
                    }
                }

                if (streamResult.error != null) {
                    messages.add(ChatMessage.System("There was an issue processing your request. Please try again."))
                }

                if (displayText.isBlank() && actions.isEmpty() && streamResult.error == null) {
                    addDebug(DebugEntry("warn", "Empty stream — no text, no actions"))
                    messages.add(ChatMessage.System("I couldn't generate a response. Could you rephrase your request?"))
                }
            } catch (e: Exception) {
                removeProcessing()
                _streamingText.value = ""
                _progressText.value = ""
                val elapsed = System.currentTimeMillis() - startTime
                val errorMsg = "${e.javaClass.simpleName}: ${e.message}"
                addDebug(DebugEntry("error", "$errorMsg (${elapsed}ms)"))
                Log.e(TAG, "Chat stream error", e)
                messages.add(ChatMessage.System("Something went wrong. Please try again."))

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
        processingCardId = null
        val idx = messages.indexOfFirst { it.id == cardId }
        if (idx >= 0) {
            messages.removeAt(idx)
        }
    }

    // ── Persistent HITL quick actions: Stop / Retry / Edit ─────────────
    // These buttons live above the input bar and are ALWAYS visible. They are
    // the user's escape hatch for anything the agent is doing.

    val canStop: Boolean get() = isProcessing
    val canRetry: Boolean get() = lastUserMessage.isNotBlank() && !isProcessing
    /** After a Stop, the Retry button relabels itself "Resume". */
    val canResume: Boolean get() = wasInterrupted && canRetry
    val hasLastDraft: Boolean
        get() = messages.indexOfLast { it is ChatMessage.EmailDraft || it is ChatMessage.ReplyDraft } >= 0

    fun stopProcessing() {
        activeJob?.cancel()
        activeJob = null
        activeScanCall?.cancel()
        activeScanCall = null
        suppressDrain = true
        removeProcessing()
        isProcessing = false
        suppressDrain = false
        wasInterrupted = true
        messages.add(ChatMessage.System("\u23F9\uFE0F **Stopped** \u2014 cancelled the current operation."))
        persistMessages()
    }

    /** Re-run the last task. Acts as "Resume" right after an interruption. */
    fun retryLast() {
        if (canRetry) {
            wasInterrupted = false
            sendMessage(lastUserMessage)
        }
    }

    private fun drainQueue() {
        if (queuedMessages.isEmpty()) return
        val next = queuedMessages.removeAt(0)
        viewModelScope.launch {
            messages.add(ChatMessage.System(
                "\u25B6\uFE0F **Running queued task:** \"${next.take(60)}\""
            ))
            persistMessages()
            sendMessage(next)
        }
    }

    /** Open the draft editor for the most recent draft (used by the Edit quick action). */
    fun editLastDraft() {
        val idx = messages.indexOfLast { it is ChatMessage.EmailDraft || it is ChatMessage.ReplyDraft }
        if (idx >= 0) openDraftEditor(messages[idx].id)
    }

    fun openDraftEditor(id: Long) {
        val body = when (val m = messages.firstOrNull { it.id == id }) {
            is ChatMessage.EmailDraft -> m.body
            is ChatMessage.ReplyDraft -> m.body
            else -> return
        }
        editingDraftId = id
        editingDraftText = body
    }

    fun saveDraftEdit() {
        val id = editingDraftId ?: return
        val idx = messages.indexOfFirst { it.id == id }
        if (idx >= 0) {
            val updated = when (val cur = messages[idx]) {
                is ChatMessage.EmailDraft -> cur.copy(body = editingDraftText)
                is ChatMessage.ReplyDraft -> cur.copy(body = editingDraftText)
                else -> null
            }
            if (updated != null) messages[idx] = updated
        }
        editingDraftId = null
        editingDraftText = ""
        persistMessages()
    }

    fun updateEditingDraftText(text: String) {
        editingDraftText = text
    }

    fun closeDraftEditor() {
        editingDraftId = null
        editingDraftText = ""
    }

    /**
     * Create a processing card only if none exists. Some entry points (sendMessage)
     * already add one before routing; reusing it prevents a duplicate "stuck" card
     * that never gets removed.
     */
    private fun ensureProcessingCard(detail: String = "Working..."): Long {
        if (processingCardId != null) {
            val idx = messages.indexOfFirst { it.id == processingCardId }
            if (idx >= 0 && messages[idx] is ChatMessage.ProcessingCard) {
                return processingCardId!!
            }
            processingCardId = null
        }
        val card = ChatMessage.ProcessingCard(steps = emptyList(), currentStep = 0, elapsed = "0s", detail = detail)
        processingCardId = card.id
        messages.add(card)
        return card.id
    }

    private data class StreamResult(
        val fullText: String = "",
        val sessionId: String? = null,
        val actions: List<ActionBlock> = emptyList(),
        val error: String? = null
    )

    /**
     * Parse SSE stream incrementally using raw InputStream + BufferedReader
     * (bypasses OkHttp internal buffering) — emits text deltas and tool
     * status events to _streamingText / _progressText as they arrive.
     */
    private fun parseSSEStreamIncremental(body: ResponseBody): StreamResult {
        val textBuilder = StringBuilder()
        var sessionId: String? = null
        var error: String? = null
        val actions = mutableListOf<ActionBlock>()
        var currentEvent = ""
        val dataBuffer = StringBuilder()

        try {
            body.byteStream().bufferedReader().use { reader ->
                var line = reader.readLine()
                while (line != null) {
                    when {
                        line.startsWith("event: ") -> {
                            currentEvent = line.removePrefix("event: ").trim()
                        }
                        line.startsWith("data: ") -> {
                            dataBuffer.clear()
                            dataBuffer.append(line.removePrefix("data: "))
                        }
                        line.isEmpty() && currentEvent.isNotEmpty() -> {
                            val dataStr = dataBuffer.toString()
                            try {
                                val json = org.json.JSONObject(dataStr)
                                when (currentEvent) {
                                    "text_delta" -> {
                                        val delta = json.optString("text", "")
                                        if (delta.isNotEmpty()) {
                                            textBuilder.append(delta)
                                            val displayText = textBuilder.toString()
                                            _streamingText.value = if (displayText.length > MAX_STREAMING_TEXT)
                                                displayText.takeLast(MAX_STREAMING_TEXT) else displayText
                                        }
                                    }
                                    "progress" -> {
                                        val progressText = json.optString("text", "")
                                        _progressText.value = progressText

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
                                        sessionId = json.optString("sessionId", sessionId ?: "")
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
                    line = reader.readLine()
                }
            }
        } catch (e: Exception) {
            if (error == null) {
                error = "Stream read error: ${e.message}"
            }
        }

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

    fun persistMessages() {
        try {
            val arr = JSONArray()
            for (msg in messages) {
                val entry = when (msg) {
                    is ChatMessage.User -> JSONObject().put("type", "user").put("text", msg.text)
                    is ChatMessage.System -> JSONObject().put("type", "system").put("text", msg.text)
                    is ChatMessage.JobCard -> JSONObject().put("type", "job_card")
                        .put("text", "${msg.company} — ${msg.role}${if (msg.score.isNotEmpty()) " (${msg.score})" else ""}${if (msg.location.isNotEmpty()) " · ${msg.location}" else ""}")
                    is ChatMessage.Evaluation -> JSONObject().put("type", "eval")
                        .put("text", "${msg.company} — ${msg.role}: ${msg.score}\n${msg.summary.take(200)}")
                    is ChatMessage.ScanActions -> {
                        val parts = mutableListOf<String>()
                        if (msg.expandLocationLabel.isNotEmpty()) parts.add(msg.expandLocationLabel)
                        if (msg.tryKeywordsLabel.isNotEmpty()) parts.add(msg.tryKeywordsLabel)
                        if (msg.deepScanLabel.isNotEmpty()) parts.add(msg.deepScanLabel)
                        JSONObject().put("type", "scan_actions").put("text", parts.joinToString(" | "))
                    }
                    is ChatMessage.ScanResultsCard -> JSONObject().put("type", "scan_results")
                        .put("text", "${msg.summary} (${msg.results.size} shown in app)")
                    is ChatMessage.EmailDraft -> JSONObject().put("type", "email_draft")
                        .put("text", "Draft for ${msg.company} — ${msg.role}")
                    is ChatMessage.ReplyDraft -> JSONObject().put("type", "reply_draft")
                        .put("text", "Reply to ${msg.to}: ${msg.subject}")
                    is ChatMessage.ActivityLog -> JSONObject().put("type", "activity")
                        .put("text", msg.title)
                    is ChatMessage.ProcessingCard -> null // ephemeral, skip
                    is ChatMessage.ToolStatus -> null // ephemeral, skip
                    is ChatMessage.Typing -> null // ephemeral, skip
                    else -> null
                }
                if (entry != null) arr.put(entry)
            }
            // Keep last 80 messages max
            val trimmed = if (arr.length() > 80) {
                val t = JSONArray()
                for (i in arr.length() - 80 until arr.length()) t.put(arr.get(i))
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
                    "job_card", "eval", "scan_actions", "scan_results", "email_draft", "reply_draft", "activity" -> {
                        val prefix = when (type) {
                            "job_card" -> "\uD83D\uDD0D "
                            "eval" -> "\uD83D\uDCC4 "
                            "scan_actions" -> "\uD83D\uDD04 "
                            "scan_results" -> "\uD83D\uDD0D "
                            "email_draft" -> "\uD83D\uDCE8 "
                            "reply_draft" -> "\u2709\uFE0F "
                            "activity" -> "\uD83D\uDCCA "
                            else -> ""
                        }
                        result.add(ChatMessage.System("$prefix$text"))
                    }
                    "system" -> result.add(ChatMessage.System(text))
                }
            }
        } catch (_: Exception) {}
        return result
    }

    // Anti-duplicate gate: blocks only the EXACT opening (company AND role)
    // already in the tracker with an active status. A different role at the
    // same company is a separate job and remains applyable.
    private fun isSpammed(company: String, role: String, entries: List<TrackerEntry>): Boolean {
        val cNorm = normalizeCompanyName(company)
        val rNorm = normalizeRoleName(role)
        if (cNorm.isEmpty() || rNorm.isEmpty()) return false
        return entries.any { e ->
            normalizeCompanyName(e.company) == cNorm &&
                normalizeRoleName(e.role) == rNorm &&
                e.status in setOf("Applied", "Interview", "Offer", "Responded", "Discarded")
        }
    }

    private suspend fun draftApplication(company: String, role: String, url: String = "") {
        if (processingCardId == null) {
            val card = ChatMessage.ProcessingCard(steps = emptyList(), currentStep = 0, elapsed = "0s")
            processingCardId = card.id
            messages.add(card)
        }
        try {
            // Step 1: Check tracker for duplicates (anti-spam)
            updateProcessingCard(detail = "Checking tracker for $company...")
            val tracker = withContext(Dispatchers.IO) { api.getTracker() }
            if (isSpammed(company, role, tracker.applications)) {
                removeProcessing(); isProcessing = false
                messages.add(ChatMessage.System(
                    "\u26A0\uFE0F Already applied to **$company** \u2014 skipping to avoid duplicate."
                ))
                persistMessages(); return
            }

            // Step 2: Draft the application email first. The bridge scrapes the
            // posting page itself (fetchJdAndContact) to pull a real application
            // email — many Indian portals (Naukri/Internshala/Shine/foundit)
            // expose one even though a contact list is never visible. This is the
            // proven email-first path from the CLI. Only when the page exposes no
            // suitable email do we fall back to Playwright auto-fill.
            updateProcessingCard(detail = "Drafting application for $company — $role...")
            val response = withContext(Dispatchers.IO) {
                api.draftEmail(EmailDraftRequest(company = company, role = role, type = "application", jd = url.ifEmpty { null }))
            }
            removeProcessing(); isProcessing = false

            if (response.body.isNotEmpty()) {
                if (response.to.isBlank()) {
                    if (response.phone.isNotBlank()) {
                        // No contact email, but the recruiter's phone is on the
                        // posting — send the drafted letter straight to WhatsApp.
                        // A posting can list several phones, so each one becomes
                        // its own one-tap target (never concatenated into one
                        // invalid number); the message is pre-typed for each.
                        val targets = splitPhones(response.phone)
                            .map { num ->
                                val digits = normalizeWhatsAppNumber(num)
                                ChatMessage.WhatsAppTarget(
                                    label = num.trim(),
                                    digits = digits,
                                    link = if (digits.isNotEmpty()) buildWhatsAppLink(digits, response.body) else ""
                                )
                            }
                            .filter { it.digits.isNotEmpty() }
                        if (targets.isNotEmpty()) {
                            messages.add(ChatMessage.System(
                                "\uD83D\uDCF1 **Draft ready** for **$company** \u2014 **$role**, but no contact email was found on the posting page.\n" +
                                "Recruiter phone found: **${response.phone}** \u2014 I've prepared a WhatsApp application you can send with one tap."
                            ))
                            messages.add(ChatMessage.WhatsAppApply(
                                company = company,
                                role = role,
                                url = url,
                                phone = response.phone,
                                waTargets = targets,
                                waLink = targets.first().link,
                                message = response.body,
                                onMarkApplied = {
                                    viewModelScope.launch { handleMarkApplied(company, url, role) }
                                }
                            ))
                        } else if (url.isNotBlank()) {
                            messages.add(ChatMessage.System(
                                "\u26A0\uFE0F **Draft ready** for **$company** \u2014 **$role**, but no contact email was found and the recruiter phone could not be parsed.\n" +
                                "I'll try auto-filling the application form on the job page instead."
                            ))
                            startAutoFill(url, company, role)
                        } else {
                            messages.add(ChatMessage.System(
                                "\u26A0\uFE0F **Draft ready** for **$company** \u2014 **$role**, but no contact email was found.\n" +
                                "Apply via the portal directly, or paste a URL with the contact details and I'll draft again."
                            ))
                        }
                    } else if (url.isNotBlank()) {
                        messages.add(ChatMessage.System(
                            "\u26A0\uFE0F **Draft ready** for **$company** \u2014 **$role**, but no contact email was found on the posting page.\n" +
                            "I'll try auto-filling the application form on the job page instead."
                        ))
                        startAutoFill(url, company, role)
                    } else {
                        messages.add(ChatMessage.System(
                            "\u26A0\uFE0F **Draft ready** for **$company** \u2014 **$role**, but no contact email was found.\n" +
                            "Apply via the portal directly, or paste a URL with the contact details and I'll draft again."
                        ))
                    }
                } else {
                    messages.add(ChatMessage.System(
                        "\uD83D\uDCE8 **Draft ready** for **$company** \u2014 **$role**"
                    ))
                    val draftId = ChatMessage.nextId()
                    messages.add(ChatMessage.EmailDraft(
                        id = draftId,
                        to = response.to, company = company, role = role,
                        body = response.body, subject = response.subject,
                        contactBlock = response.contactBlock,
                        onSend = { viewModelScope.launch { sendEmail(draftId, response.to, response.subject, response.body, company, role) } },
                        onEdit = { openDraftEditor(draftId) }
                    ))
                }
            } else {
                messages.add(ChatMessage.System(
                    "\u26A0\uFE0F Could not generate an email draft for **$company**.\n" +
                    (response.error?.let { "Server error: $it" }
                        ?: "The draft came back empty. Check the bridge server and try again.")
                ))
            }
        } catch (e: Exception) {
            removeProcessing(); isProcessing = false
            messages.add(ChatMessage.System(
                "\u274C Couldn't prepare the application for **$company**: ${describeError(e)}"
            ))
        }
        persistMessages()
    }

    // Build a wa.me deep link from a recruiter phone + prefilled message.
    // Portal phone numbers are usually local (10-digit Indian mobiles), but
    // wa.me requires the full international number, so strip separators and
    // prepend the IN country code for bare 10-digit numbers.
    private fun buildWhatsAppLink(phone: String, message: String): String {
        val digits = normalizeWhatsAppNumber(phone)
        if (digits.isEmpty()) return ""
        val encoded = java.net.URLEncoder.encode(message, "UTF-8")
        return "https://wa.me/$digits?text=$encoded"
    }

    // Normalize one recruiter phone to the digits wa.me expects: strip all
    // non-digits, drop a leading 0 from 11-digit local numbers, prepend the
    // IN country code to bare 10-digit mobiles, and reject anything outside
    // E.164 length so a bad value yields no link instead of a broken one.
    private fun normalizeWhatsAppNumber(raw: String): String {
        var digits = raw.replace(Regex("[^\\d]"), "")
        if (digits.length == 11 && digits.startsWith("0")) digits = digits.substring(1)
        if (digits.length == 10) digits = "91$digits"
        return if (digits.length in 10..15) digits else ""
    }

    // A posting can expose several recruiter phones (comma/semicolon/newline
    // separated). Split into individual numbers — each gets its own wa.me
    // link so one malformed entry never breaks the others.
    private fun splitPhones(raw: String): List<String> =
        raw.split(Regex("[,\\n;&]+"))
            .map { it.trim() }
            .filter { it.isNotEmpty() }

    private suspend fun sendEmail(draftId: Long?, to: String, subject: String, body: String, company: String, role: String) {
        // No repeat sends: ignore taps while a send is in flight or already done.
        if (draftId != null && (draftId in sendingDraftIds || draftId in sentDraftIds)) return
        if (draftId != null) sendingDraftIds.add(draftId)
        setDraftSendState(draftId, sending = true, sent = false)
        try {
            removeProcessing()

            val response = withContext(Dispatchers.IO) {
                api.sendEmail(EmailSendRequest(
                    to = to, subject = subject, body = body, company = company, role = role
                ))
            }

            if ((response["success"] as? Boolean) == true) {
                if (draftId != null) sentDraftIds.add(draftId)
                setDraftSendState(draftId, sending = false, sent = true)
                markCompanyApplied(
                    company = company,
                    role = role,
                    contactEmail = to,
                    notes = "Emailed $to via career-ops app"
                )

                messages.add(ChatMessage.System(
                    "\u2705 **Step 3/3** — Application sent to **$company**!\n" +
                    "Role: **$role**\n" +
                    "I'll watch your inbox for their reply."
                ))
            } else {
                val errorMsg = (response["error"] as? String) ?: "Unknown error"
                setDraftSendState(draftId, sending = false, sent = false)
                messages.add(ChatMessage.System(
                    "\u274C Failed to send application to **$company**.\n" +
                    "Error: $errorMsg\n" +
                    "You can try again or apply manually."
                ))
            }
        } catch (e: Exception) {
            setDraftSendState(draftId, sending = false, sent = false)
            messages.add(ChatMessage.System(
                "\u274C Couldn't send the application to **$company**: ${describeError(e)}\n" +
                "If Gmail is disconnected, open **Settings → Reconnect Gmail** and try again."
            ))
        }
        if (draftId != null) sendingDraftIds.remove(draftId)
        isProcessing = false
    }

    private fun setDraftSendState(draftId: Long?, sending: Boolean, sent: Boolean) {
        if (draftId == null) return
        val idx = messages.indexOfFirst { it.id == draftId }
        if (idx < 0) return
        messages[idx] = when (val m = messages[idx]) {
            is ChatMessage.EmailDraft -> m.copy(sending = sending, sent = sent)
            is ChatMessage.ReplyDraft -> m.copy(sending = sending, sent = sent)
            else -> return
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
                messages.add(ChatMessage.System("Couldn't reset the session. Please try again."))
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
        persistMessages()
        inboxPollJob?.cancel()
        super.onCleared()
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

    /** Extract a readable message from any exception, including HTTP error bodies. */
    private fun describeError(e: Exception): String {
        val http = e as? HttpException
        if (http != null) {
            return try {
                http.response()?.errorBody()?.string()?.let { body ->
                    org.json.JSONObject(body).optString("error", body.take(200))
                } ?: http.message()
            } catch (_: Exception) {
                http.message()
            }
        }
        return e.message ?: e.javaClass.simpleName
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
