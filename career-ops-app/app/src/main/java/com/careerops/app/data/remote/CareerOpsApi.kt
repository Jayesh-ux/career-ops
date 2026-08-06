package com.careerops.app.data.remote

import com.careerops.app.data.model.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.*

interface CareerOpsApi {

    @GET("health")
    suspend fun health(): Map<String, Any>

    @GET("doctor")
    suspend fun doctor(): DoctorResponse

    // ── Tracker ────────────────────────────────────────────────
    @GET("tracker")
    suspend fun getTracker(): TrackerResponse

    @PUT("tracker/{id}/status")
    suspend fun updateStatus(@Path("id") id: String, @Body body: Map<String, String>): TrackerResponse

    @POST("tracker/add")
    suspend fun addTrackerEntry(@Body entry: TrackerAddRequest): Map<String, Any>

    @GET("tracker/stats")
    suspend fun getTrackerStats(): TrackerStatsResponse

    @POST("dedup")
    suspend fun dedupTracker(): DedupResponse

    // ── Profile & CV ───────────────────────────────────────────
    @GET("profile")
    suspend fun getProfile(): ProfileResponse

    @PUT("profile")
    suspend fun updateProfile(@Body profile: ProfileUpdateRequest): Map<String, Any>

    @GET("cv")
    suspend fun getCV(): CvResponse

    @PUT("cv")
    suspend fun updateCV(@Body body: Map<String, String>): Map<String, Any>

    @Multipart
    @POST("resume/upload")
    suspend fun uploadResume(
        @Part file: MultipartBody.Part,
        @Part("email") email: RequestBody
    ): ResumeUploadResponse

    // ── Scan ───────────────────────────────────────────────────
    @POST("scan")
    suspend fun scan(@Body request: ScanRequest? = null): ScanResponse

    // ── AI: Evaluation & Pipeline ──────────────────────────────
    @POST("auto-pipeline")
    suspend fun autoPipeline(@Body request: AutoPipelineRequest): AutoPipelineResponse

    @POST("pipeline/evaluate")
    suspend fun pipelineEvaluate(@Body request: PipelineEvaluateRequest): AutoPipelineResponse

    @GET("pipeline")
    suspend fun getPipeline(): PipelineResponse

    @POST("batch")
    suspend fun batchEvaluate(@Body request: BatchRequest): BatchResponse

    @POST("cv/tailor")
    suspend fun tailorCv(@Body request: TailorCvRequest): TailorCvResponse

    // ── AI: Email Drafting ─────────────────────────────────────
    @POST("email/draft")
    suspend fun draftEmail(@Body request: EmailDraftRequest): EmailDraftResponse

    @POST("email/cover-letter")
    suspend fun generateCoverLetter(@Body request: CoverLetterRequest): CoverLetterResponse

    @POST("email/classify")
    suspend fun classifyEmail(@Body request: ClassifyRequest): ClassifyResponse

    // ── Email Inbox ────────────────────────────────────────────
    @GET("email/inbox")
    suspend fun getInbox(
        @Query("email") email: String,
        @Query("daysBack") daysBack: Int = 14,
        @Query("maxEmails") maxEmails: Int = 30,
        @Query("includeSpam") includeSpam: Boolean = false,
        @Query("query") query: String? = null
    ): InboxResponse

    @POST("email/reply")
    suspend fun draftReply(@Body request: EmailReplyRequest): ReplyDraftResponse

    @POST("email/reply/send")
    suspend fun sendReplyDraft(@Body body: Map<String, String>): Map<String, Any>

    // ── Spam ───────────────────────────────────────────────────
    @POST("email/spam/delete")
    suspend fun deleteSpam(@Body body: Map<String, Any>): Map<String, Any>

    // ── Email Send ─────────────────────────────────────────────
    @POST("email/send")
    suspend fun sendEmail(@Body request: EmailSendRequest): Map<String, Any>

    // ── Followups ──────────────────────────────────────────────
    @GET("followups")
    suspend fun getFollowups(): FollowupResponse

    // ── Liveness ───────────────────────────────────────────────
    @POST("liveness/check")
    suspend fun checkLiveness(@Body request: LivenessRequest): LivenessResponse

    // ── Email Triage ───────────────────────────────────────────
    @POST("email/triage")
    suspend fun triageEmails(@Body body: Map<String, String>): TriageResponse

    // ── Export ─────────────────────────────────────────────────
    @GET("export/{file}")
    suspend fun exportFile(@Path("file") file: String): ExportResponse

    // ── Multi-user OAuth ───────────────────────────────────────
    @POST("auth/google-id-token")
    suspend fun verifyGoogleIdToken(@Body request: GoogleIdTokenRequest): GoogleIdTokenResponse

    @POST("users/{email}/oauth/exchange")
    suspend fun exchangeOAuth(
        @Path("email") email: String,
        @Body request: OAuthExchangeRequest
    ): OAuthExchangeResponse

    @GET("users/{email}/oauth/status")
    suspend fun getOAuthStatus(@Path("email") email: String): OAuthStatusResponse

    @POST("users/{email}/setup")
    suspend fun setupUser(
        @Path("email") email: String,
        @Body request: UserSetupRequest
    ): UserSetupResponse

    @GET("users/{email}/files")
    suspend fun getUserFiles(@Path("email") email: String): UserFilesResponse

    // ── Chat (opencode integration) ─────────────────────────
    @POST("chat")
    suspend fun chat(@Body request: ChatRequest): ChatResponse

    @POST("chat/stream")
    suspend fun chatStream(@Body request: ChatRequest): retrofit2.Response<okhttp3.ResponseBody>

    @POST("chat/reset")
    suspend fun resetChat(): Map<String, Any>

    // ── Playwright Apply ───────────────────────────────────────────
    @POST("apply/open")
    suspend fun applyOpen(@Body request: ApplyOpenRequest): ApplyOpenResponse

    @POST("apply/fill")
    suspend fun applyFill(@Body request: ApplyFillRequest): ApplyFillResponse

    @POST("apply/guide")
    suspend fun applyGuide(@Body body: Map<String, String>): Map<String, Any>

    @POST("apply/close")
    suspend fun applyClose(): Map<String, Any>

    // ── Candidate form answers (persisted config/form-answers.yml) ──
    @POST("form-answers")
    suspend fun saveFormAnswers(@Body body: Map<String, Any>): Map<String, Any>

    // ── Portal logins (Google OAuth primary, portal password fallback) ──
    @GET("portals/requirements")
    suspend fun getPortalRequirements(): PortalRequirementsResponse

    @GET("portal-creds")
    suspend fun getPortalCreds(): PortalCredsResponse

    @POST("portal-creds")
    suspend fun savePortalCreds(@Body request: PortalCredsRequest): Map<String, Any>

    @DELETE("portal-creds/{portal}")
    suspend fun deletePortalCreds(@Path("portal") portal: String): Map<String, Any>

    // ── One-time interactive login session (Google OAuth) ─────────────
    @POST("login/session/open")
    suspend fun openLoginSession(@Body body: Map<String, String>): Map<String, Any>

    @GET("login/session/state")
    suspend fun getLoginSessionState(): Map<String, Any>

    @POST("login/session/tap")
    suspend fun loginSessionTap(@Body body: Map<String, Any>): Map<String, Any>

    @POST("login/session/type")
    suspend fun loginSessionType(@Body body: Map<String, String>): Map<String, Any>

    @POST("login/session/navigate")
    suspend fun loginSessionNavigate(@Body body: Map<String, String>): Map<String, Any>

    @POST("login/session/back")
    suspend fun loginSessionBack(): Map<String, Any>

    @POST("login/session/account")
    suspend fun loginSessionAccount(@Body body: Map<String, String>): Map<String, Any>

    @POST("login/session/finish")
    suspend fun finishLoginSession(): Map<String, Any>

    @POST("login/session/seed")
    suspend fun seedLoginSession(@Body body: Map<String, Any>): Map<String, Any>

    @GET("portal/session/status")
    suspend fun getPortalSessionStatus(): Map<String, Any>

    @GET("debug")
    suspend fun debug(): Map<String, Any>

    // ── Interviews ────────────────────────────────────────────────
    @POST("interview/detect")
    suspend fun detectInterviews(@Body body: Map<String, String>): InterviewDetectResponse

    @GET("interviews")
    suspend fun getInterviews(): InterviewsResponse
}
