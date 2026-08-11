package com.careerops.app.data.model

import com.google.gson.annotations.SerializedName

data class DoctorResponse(
    val onboardingNeeded: Boolean = false,
    val missing: List<String> = emptyList(),
    val warnings: List<String> = emptyList()
)

data class TrackerResponse(
    val applications: List<TrackerEntry> = emptyList()
)

data class TrackerEntry(
    val id: String = "",
    val date: String = "",
    val company: String = "",
    val role: String = "",
    val score: String = "",
    val status: String = "",
    val pdf: String = "",
    val report: String = "",
    val notes: String = ""
)

data class TrackerAddRequest(
    val company: String,
    val role: String,
    val location: String = "",
    val contactEmail: String = "",
    val notes: String = ""
)

data class ProfileResponse(
    val name: String = "",
    val email: String = "",
    val phone: String = "",
    val linkedin: String = "",
    val headline: String = "",
    val targetRoles: List<String> = emptyList(),
    val archetypes: List<String> = emptyList(),
    val location: String = "",
    val compensation: String = ""
)

data class ProfileUpdateRequest(
    val name: String? = null,
    val email: String? = null,
    val phone: String? = null,
    val linkedin: String? = null,
    val targetRoles: List<String>? = null,
    val location: String? = null,
    val compensation: String? = null,
    val headline: String? = null,
    val searchKeywords: List<String>? = null,
    val searchLocations: List<String>? = null
)

data class CvResponse(
    val content: String = ""
)

data class ResumeUploadResponse(
    val success: Boolean = false,
    val name: String = "",
    val email: String = "",
    val phone: String = "",
    val skills: List<String> = emptyList(),
    val profile: ProfileResponse = ProfileResponse()
)

data class InboxResponse(
    val emails: List<InboxEmail> = emptyList(),
    val total: Int = 0,
    val legitimateCount: Int = 0,
    val spamCount: Int = 0,
    val method: String = ""
)

data class InboxEmail(
    val id: String = "",
    val uid: String = "",
    val gmailId: String = "",
    val from: String = "",
    val subject: String = "",
    val date: String = "",
    val body: String = "",
    val isSpam: Boolean = false,
    val category: String = "",
    // The bridge nests spam detection under `spam:{isSpam,spamScore,signals}` —
    // the flat `isSpam` above is never populated by the server.
    val spam: SpamInfo? = null
)

data class SpamInfo(
    val isSpam: Boolean = false,
    val spamScore: Int = 0,
    val signals: List<String> = emptyList()
)

data class TriageResponse(
    val interviews: List<InboxEmail> = emptyList(),
    val responses: List<InboxEmail> = emptyList(),
    val spam: List<InboxEmail> = emptyList(),
    val other: List<InboxEmail> = emptyList()
)

data class CredentialsRequest(
    val gmailUser: String,
    val appPassword: String? = null,
    val clientId: String? = null,
    val clientSecret: String? = null,
    val refreshToken: String? = null
)

data class BlacklistResponse(
    val companies: List<String> = emptyList()
)

data class GoogleIdTokenRequest(
    val idToken: String
)

data class GoogleIdTokenResponse(
    val success: Boolean = false,
    val email: String = "",
    val hasGmailAuth: Boolean = false,
    val name: String = "",
    val picture: String = ""
)

data class OAuthExchangeRequest(
    val code: String,
    val clientId: String = "",
    val clientSecret: String = "",
    val redirectUri: String? = null,
    val cookies: String = ""
)

data class OAuthExchangeResponse(
    val success: Boolean = false,
    val email: String = "",
    val hasRefreshToken: Boolean = false,
    val expiresIn: Int = 0
)

data class OAuthStatusResponse(
    val configured: Boolean = false,
    val email: String = "",
    val hasRefreshToken: Boolean = false,
    val isExpired: Boolean = false,
    val expiresAt: String? = null
)

data class UserSetupRequest(
    val name: String,
    val targetRoles: List<String>,
    val location: String = "",
    val compensation: String = ""
)

data class UserSetupResponse(
    val success: Boolean = false,
    val email: String = "",
    val userDir: String = "",
    val files: List<String> = emptyList()
)

data class UserFilesResponse(
    val email: String = "",
    val files: List<UserFile> = emptyList()
)

data class UserFile(
    val path: String = "",
    val size: Long = 0,
    val modified: String = ""
)

data class ScanResult(
    val company: String = "",
    val role: String = "",
    val url: String = "",
    val source: String = "",
    val location: String = "",
    val salary: String = "",
    val score: String = "",
    val fit: String = ""
)

data class AutoPipelineRequest(
    val url: String,
    val company: String? = null,
    val role: String? = null
)

data class AutoPipelineResponse(
    val url: String = "",
    val company: String? = null,
    val role: String? = null,
    val score: String = "N/A",
    val reportNum: Int = 0,
    val reportPath: String = "",
    val fit: String = "",
    val strengths: List<String> = emptyList(),
    val gaps: List<String> = emptyList(),
    val contactEmails: List<String> = emptyList(),
    val contactPhones: List<String> = emptyList()
)

data class ClassifyRequest(
    val from: String? = null,
    val fromEmail: String? = null,
    val subject: String,
    val preview: String? = null
)

data class ClassifyResponse(
    val classification: String = "spam",
    val confidence: Double = 0.0,
    val reason: String = ""
)

data class ScanInboxEmailData(
    val gmailId: String = "",
    val threadId: String = "",
    val messageId: String = "",
    val inReplyTo: String = "",
    val from: String = "",
    val fromEmail: String = "",
    val subject: String = "",
    val body: String = "",
    val preview: String = "",
    val date: String = ""
)

data class ScanInboxNotification(
    val type: String = "",
    val title: String = "",
    val message: String = "",
    val gmailId: String = "",
    val from: String = "",
    val fromEmail: String = "",
    val subject: String = "",
    val threadId: String = "",
    val messageId: String = "",
    val body: String = "",
    val date: String = "",
    val email: ScanInboxEmailData? = null
)

data class ScanInboxResponse(
    val notifications: List<ScanInboxNotification> = emptyList(),
    val count: Int = 0,
    val scanned: Int = 0,
    val backfill: Boolean = false
)

// Retrofit rejects `Map<String, Any>` as a @Body (Kotlin emits it as
// `Map<String, ?>`, a wildcard). Every such endpoint uses a concrete request
// class instead.
data class ScanInboxRequest(
    val daysBack: Int? = null,
    val forceBackfill: Boolean? = null
)

data class SpamDeleteRequest(
    val messageIds: List<String> = emptyList(),
    val markAsRead: Boolean? = null
)

data class FormAnswersRequest(
    val answers: Map<String, String> = emptyMap()
)

data class LoginSessionTapRequest(
    val x: Int,
    val y: Int
)

data class SeedLoginSessionRequest(
    val cookieString: String = ""
)

data class CoverLetterRequest(
    val company: String,
    val role: String,
    val resume: String? = null,
    val jd: String? = null
)

data class CoverLetterResponse(
    val coverLetter: String = ""
)

data class OutreachRequest(
    val company: String? = null,
    val role: String? = null,
    val contactType: String = "recruiter",
    val jd: String? = null,
    val contactName: String? = null
)

data class OutreachResponse(
    val message: String = "",
    val charCount: Int = 0,
    val contactType: String = "recruiter"
)

data class DeepResearchRequest(
    val company: String,
    val role: String? = null
)

data class DeepResearchResponse(
    val ai_strategy: String = "",
    val recent_moves: String = "",
    val engineering_culture: String = "",
    val challenges: String = "",
    val competitors: String = "",
    val candidate_angle: String = "",
    val summary: String = ""
)

data class InterviewPrepRequest(
    val company: String,
    val role: String? = null,
    val reportNum: Int? = null
)

data class InterviewPrepResponse(
    val likely_questions: List<String> = emptyList(),
    val star_stories: List<StarStory> = emptyList(),
    val company_red_flags: List<String> = emptyList(),
    val questions_to_ask: List<String> = emptyList(),
    val key_talking_points: List<String> = emptyList(),
    val summary: String = ""
)

data class StarStory(
    val situation: String = "",
    val task: String = "",
    val action: String = "",
    val result: String = ""
)

data class BatchRequest(
    val urls: List<BatchItem>
)

data class BatchItem(
    val url: String,
    val company: String? = null,
    val role: String? = null
)

data class BatchResponse(
    val results: List<AutoPipelineResponse> = emptyList()
)

data class FollowupResponse(
    val entries: List<FollowupEntry> = emptyList()
)

data class FollowupEntry(
    val company: String = "",
    val role: String = "",
    val daysSince: Int = 0,
    val lastContact: String = ""
)

data class FollowupDraftRequest(
    val company: String,
    val role: String? = null,
    val followupCount: Int = 0,
    val contactEmail: String? = null,
    val appliedDate: String? = null
)

data class FollowupDraftResponse(
    val subject: String = "",
    val body: String = ""
)

data class PasteReplyRequest(
    val from: String? = null,
    val fromEmail: String? = null,
    val subject: String? = null,
    val body: String? = null
)

data class PasteReplyResponse(
    val classification: String = "noise",
    val confidence: Double = 0.0,
    val summary: String = "",
    val suggestedAction: String = ""
)

data class PipelineEvaluateRequest(
    val url: String,
    val company: String? = null,
    val role: String? = null
)

data class ScanRequest(
    val keywords: List<String> = emptyList(),
    val locations: List<String> = emptyList()
)

data class PortalResult(
    val company: String = "",
    val status: String = "",
    val keywordMatches: Int = 0,
    val exactMatches: Int = 0,
    val error: String = ""
)

data class ScanResponse(
    val results: List<ScanResult> = emptyList(),
    val total: Int = 0,
    val newFound: Int = 0,
    val portalsScanned: Int = 0,
    val locationExactMatch: Boolean? = null,
    val portalResults: List<PortalResult> = emptyList(),
    val wideningSteps: List<String> = emptyList(),
    val otherLocations: List<ScanResult> = emptyList()
)

// GET /scan/results — the last scan's job list, cached per-user on the bridge
// server. Restored on app open (instant, no re-scan); overwritten whenever the
// user runs a scan again.
data class ScanResultsCacheResponse(
    val results: List<ScanResult> = emptyList(),
    val total: Int = 0,
    val newFound: Int = 0,
    val otherLocations: List<ScanResult> = emptyList(),
    val locationExactMatch: Boolean? = null,
    val cached: Boolean = false,
    val savedAt: String? = null
)

data class LivenessRequest(
    val urls: List<String>
)

data class LivenessResponse(
    val results: List<LivenessResult> = emptyList()
)

data class LivenessResult(
    val url: String = "",
    val alive: Boolean = false,
    val status: String = ""
)

data class PdfResponse(
    val success: Boolean = false,
    val pdfPath: String = "",
    val outputDir: String = ""
)

data class TailorCvRequest(
    val url: String? = null,
    val reportNum: Int? = null,
    val company: String? = null,
    val role: String? = null
)

data class TailorCvResponse(
    val success: Boolean = false,
    val pdfPath: String = "",
    val htmlPath: String = "",
    val reportNum: Int? = null,
    val company: String = "",
    val role: String = "",
    val output: String = "",
    val error: String? = null
)

data class SalaryGapResponse(
    val observations: List<Any> = emptyList(),
    val gaps: List<Any> = emptyList()
)

data class TrackerStatsResponse(
    val total: Int = 0,
    val byStatus: Map<String, Int> = emptyMap(),
    val avgScore: String = "N/A",
    val pdfPercent: Int = 0,
    val reportPercent: Int = 0
)

data class ReportEntry(
    val id: String = "",
    val filename: String = "",
    val company: String = "",
    val date: String = "",
    val score: String = "N/A",
    val preview: String = ""
)

data class ReportsListResponse(
    val reports: List<ReportEntry> = emptyList()
)

data class ReportDetailResponse(
    val id: String = "",
    val filename: String = "",
    val content: String = ""
)

data class PipelineEntry(
    val url: String = "",
    val label: String = "",
    val evaluated: Boolean = false
)

data class PipelineResponse(
    val entries: List<PipelineEntry> = emptyList()
)

data class FollowUpEntry(
    val company: String = "",
    val role: String = "",
    val contactEmail: String = "",
    val appliedDate: String = "",
    val daysSince: Int = 0,
    val nextFollowup: String = "",
    val followupCount: Int = 0
)

data class FollowUpsResponse(
    val entries: List<FollowUpEntry> = emptyList()
)

data class DedupResponse(
    val dedup: String = "",
    val normalize: String = ""
)

data class ExportResponse(
    val name: String = "",
    val filename: String = "",
    val content: String = "",
    val size: Long = 0,
    val modified: String = ""
)

data class ScanHistoryEntry(
    val url: String = "",
    val date: String = "",
    val company: String = ""
)

data class ScanHistoryResponse(
    val entries: List<ScanHistoryEntry> = emptyList()
)

data class PortalEntry(
    val name: String = "",
    val url: String = "",
    val type: String = "",
    val queries: List<String> = emptyList()
)

data class PortalsResponse(
    val portals: List<PortalEntry> = emptyList(),
    val queries: List<String> = emptyList()
)

data class EmailReplyRequest(
    val to: String = "",
    val subject: String = "",
    val body: String = "",
    val inReplyTo: String? = null,
    val replyType: String? = null
)

// ── Chat (opencode integration) ─────────────────────────
data class ChatRequest(
    val message: String,
    val sessionId: String? = null
)

data class ChatResponse(
    val success: Boolean = false,
    val sessionId: String = "",
    val content: String = "",
    val toolCalls: List<ToolCallInfo> = emptyList(),
    val actions: List<ActionBlock> = emptyList(),
    val error: String? = null
)

data class ToolCallInfo(
    val id: String = "",
    val name: String = "",
    val arguments: Map<String, Any> = emptyMap(),
    val result: String = ""
)

// ── Action block for TUI-to-GUI rendering ────────────────────────────
data class ActionBlock(
    val type: String = "",
    val data: Map<String, String> = emptyMap()
)

// ── Email draft request/response ─────────────────────────────────────
data class EmailDraftRequest(
    val company: String,
    val role: String? = null,
    val type: String = "application",
    val jd: String? = null
)

data class EmailDraftResponse(
    val success: Boolean = false,
    val to: String = "",
    val subject: String = "",
    val body: String = "",
    val contactBlock: String = "",
    val phone: String = "",
    val error: String? = null
)

// ── Email send request (HITL enforced) ───────────────────────────────
data class EmailSendRequest(
    val to: String,
    val subject: String,
    val body: String,
    val company: String? = null,
    val role: String? = null,
    val pdfPath: String? = null
)

// ── Reply draft response ─────────────────────────────────────────────
data class ReplyDraftResponse(
    val replyBody: String = "",
    val subject: String = "",
    val to: String = "",
    val inReplyTo: String? = null,
    val threadId: String? = null
)

// ── Playwright Apply endpoints (bridge-server /apply/*) ──────────────
data class ApplyOpenRequest(
    val url: String,
    val stealth: Boolean = false
)

data class ApplyOpenResponse(
    val success: Boolean = false,
    val mode: String = "",
    val url: String = "",
    val title: String = "",
    val company: String = "",
    val atsType: String? = null,
    val fields: List<ApplyField> = emptyList(),
    val answers: Map<String, String> = emptyMap(),
    val pending_questions: List<ApplyPendingQuestion> = emptyList(),
    val manual_apply_guide: ManualApplyGuide? = null,
    val message: String = "",
    val manualUrl: String = "",
    val error: String? = null
)

data class ApplyField(
    val id: String = "",
    val type: String = "",
    val label: String = "",
    val required: Boolean = false,
    val options: List<String>? = null
)

// A form field the app could not auto-fill and must ask the candidate about
// (salary, years of experience, office commute, work authorization, etc).
data class ApplyPendingQuestion(
    val field_id: String = "",
    val category: String = "",
    val label: String = "",
    val required: Boolean = false,
    val type: String = "text",
    val options: List<String> = emptyList(),
    val hint: String = "",
    val source: String = ""
)

data class ApplyFillRequest(
    val url: String,
    val answers: Map<String, String> = emptyMap(),
    val company: String? = null,
    val stealth: Boolean = false,
    val submit: Boolean = false
)

data class ApplySubmitState(
    val clicked: Boolean = false,
    val buttonText: String = "",
    val validationErrors: List<String> = emptyList(),
    val emptyRequired: List<String> = emptyList(),
    val submissionOk: Boolean = false,
    val pageAfter: String = ""
)

data class ApplyFillResponse(
    val success: Boolean = false,
    val mode: String = "",
    val url: String = "",
    val company: String = "",
    val title: String = "",
    val atsType: String? = null,
    val filled: List<String> = emptyList(),
    val skipped: List<String> = emptyList(),
    val cvAttached: Boolean = false,
    val cvNote: String = "",
    val loginWall: Boolean = false,
    val loginVia: String? = null,
    val message: String = "",
    val error: String? = null,
    val submit: ApplySubmitState? = null,
    val manualUrl: String = ""
)

data class ManualApplyGuide(
    val ats_type: String = "",
    val ats_platform: String = "",
    val confidence: String = "",
    val url: String = "",
    val manual_apply_url: String = "",
    val fields: List<ApplyGuideField> = emptyList(),
    val estimated_fill_minutes: Int = 5,
    val notes: String = ""
)

data class ApplyGuideField(
    val field: String = "",
    val value: String = "",
    val source: String = "",
    val required: Boolean? = null
)

data class InterviewRecord(
    val key: String = "",
    val id: String = "",
    val from: String = "",
    val subject: String = "",
    val bodyPreview: String = "",
    val detectedAt: String = "",
    val scheduledAt: String? = null,
    val scheduledHuman: String? = null,
    val date: String? = null,
    val time: String? = null,
    val confidence: Int? = null,
    val reminderSentAt: String? = null,
    val status: String = "scheduled",
    val reminder: InterviewReminder? = null
)

data class InterviewReminder(
    val due: Boolean = false,
    val label: String = ""
)

data class InterviewDetectResponse(
    val interviews: List<InterviewRecord> = emptyList(),
    val newCount: Int = 0,
    val total: Int = 0
)

data class InterviewsResponse(
    val interviews: List<InterviewRecord> = emptyList(),
    val count: Int = 0
)

// ── Portal logins (bridge-server /portals/* and /portal-creds/*) ─────
// Google OAuth is the preferred login method for auto-fill on login-gated
// job portals. Portal email/password is the fallback for portals without
// Google sign-in. Credentials are stored encrypted per-user.
data class PortalRequirement(
    val portal: String = "",
    val loginRequired: Any? = null,
    val needsProfile: Boolean = false,
    val googleOAuth: Boolean = false
)

data class PortalRequirementsResponse(
    val googleOAuth: Boolean = false,
    val loginMethod: String = "",
    val loginNote: String = "",
    val portals: List<PortalRequirement> = emptyList()
)

data class PortalCredsEntry(
    val portal: String = "",
    val email: String = "",
    val hasPassword: Boolean = false,
    val hasProfile: Boolean = false
)

data class PortalCredsResponse(
    val success: Boolean = false,
    val creds: List<PortalCredsEntry> = emptyList()
)

data class PortalCredsRequest(
    val portal: String,
    val email: String,
    val password: String = "",
    val fullName: String = "",
    val phone: String = ""
)
