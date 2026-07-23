package com.careerops.app.service

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.careerops.app.data.model.*
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.UserPrefs
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

@HiltWorker
class DailyAutomationWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val api: CareerOpsApi,
    private val userPrefs: UserPrefs
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "DailyAutomation"
        const val WORK_NAME = "daily_job_search"
        const val KEY_EVENT_TYPE = "event_type"
        const val KEY_EVENT_MESSAGE = "event_message"
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (!userPrefs.isLoggedIn) {
            Log.w(TAG, "User not logged in, skipping")
            return@withContext Result.success()
        }

        try {
            Log.i(TAG, "Starting daily automation for ${userPrefs.userEmail}")

            val tracker = api.getTracker()
            val hasActiveInterview = tracker.applications.any {
                it.status == "Interview"
            }
            if (hasActiveInterview) {
                Log.i(TAG, "User has active interview — pausing automation")
                sendDataNotification("interview_active",
                    "You have an active interview — daily automation paused.")
                return@withContext Result.success()
            }

            Log.i(TAG, "Step 1: Scanning portals via bridge...")
            val scanResult = try {
                api.scan(null)
            } catch (e: Exception) {
                Log.e(TAG, "Scan failed: ${e.message}")
                ScanResponse(results = emptyList(), total = 0, newFound = 0)
            }

            val existingCompanies = tracker.applications.map { it.company.lowercase() }.toSet()
            val newJobs = scanResult.results.filter { result ->
                result.company.lowercase() !in existingCompanies
            }

            if (newJobs.isNotEmpty()) {
                Log.i(TAG, "Found ${newJobs.size} new matching jobs from ${scanResult.total} scanned")
                for (job in newJobs.take(5)) {
                    sendDraftNotification(
                        "${job.company} — ${job.role}",
                        "New match found (${job.source}). Review in the app to evaluate."
                    )
                }
            } else {
                Log.i(TAG, "Scan complete: ${scanResult.total} checked, 0 new matches")
            }

            Log.i(TAG, "Step 2: Checking inbox via IMAP...")
            try {
                val inbox = api.getInbox(
                    email = userPrefs.userEmail,
                    daysBack = 1,
                    maxEmails = 20
                )
                val recruiterReplies = inbox.emails.filter { email ->
                    !email.isSpam && (
                        email.subject.contains(Regex("(?i)(interview|schedule|offer|selected|shortlist|next steps)")) ||
                        email.body.contains(Regex("(?i)(interview|schedule|offer|next round|phone screen)")
                    ))
                }

                if (recruiterReplies.isNotEmpty()) {
                    Log.i(TAG, "Found ${recruiterReplies.size} recruiter replies — classifying via opencode...")
                    for (reply in recruiterReplies) {
                        try {
                            val classification = api.classifyEmail(ClassifyRequest(
                                from = reply.from,
                                subject = reply.subject,
                                preview = reply.body.take(500)
                            ))
                            sendDraftNotification(
                                "[${classification.classification.uppercase()}] ${reply.from}",
                                "Subject: ${reply.subject}\n${classification.reason}"
                            )
                        } catch (e: Exception) {
                            sendDraftNotification(
                                "Reply from: ${reply.from}",
                                "Subject: ${reply.subject}"
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Inbox check failed: ${e.message}")
            }

            Log.i(TAG, "Step 3: Checking follow-up cadence...")
            try {
                val followups = api.getFollowups()
                if (followups.entries.isNotEmpty()) {
                    val overdue = followups.entries.filter { it.daysSince > 7 }
                    if (overdue.isNotEmpty()) {
                        sendDataNotification("followups",
                            "${overdue.size} applications are overdue for follow-up (oldest: ${overdue.maxOfOrNull { it.daysSince }} days)")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Follow-up check failed: ${e.message}")
            }

            Log.i(TAG, "Step 4: Checking liveness of tracked URLs...")
            try {
                val trackerEntries = tracker.applications
                    .filter { it.status == "Evaluated" || it.status == "Applied" }
                    .take(20)

                if (trackerEntries.isNotEmpty()) {
                    val urls = trackerEntries.mapNotNull { entry ->
                        val urlMatch = Regex("https?://[^\\s)]+").find(entry.notes)
                        urlMatch?.value
                    }.filter { it.isNotEmpty() }

                    if (urls.isNotEmpty()) {
                        val livenessResult = api.checkLiveness(LivenessRequest(urls = urls))
                        val deadUrls = livenessResult.results.filter { !it.alive }

                        if (deadUrls.isNotEmpty()) {
                            sendDataNotification("liveness",
                                "${deadUrls.size} job URLs are now dead/expired out of ${urls.size} checked")
                        } else {
                            Log.i(TAG, "All ${urls.size} URLs still alive")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Liveness check failed: ${e.message}")
            }

            Log.i(TAG, "Daily automation completed successfully")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Daily automation failed", e)
            if (runAttemptCount < 3) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }

    private fun sendDataNotification(type: String, message: String) {
        val data = Data.Builder()
            .putString(KEY_EVENT_TYPE, type)
            .putString(KEY_EVENT_MESSAGE, message)
            .build()
        WorkManager.getInstance(applicationContext)
            .enqueueUniqueWork(
                "notification_$type",
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<NotificationWorker>()
                    .setInputData(data)
                    .build()
            )
    }

    private fun sendDraftNotification(title: String, body: String) {
        val data = Data.Builder()
            .putString(KEY_EVENT_TYPE, "draft")
            .putString(KEY_EVENT_MESSAGE, "$title\n$body")
            .build()
        WorkManager.getInstance(applicationContext)
            .enqueueUniqueWork(
                "notification_draft_${title.hashCode()}",
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<NotificationWorker>()
                    .setInputData(data)
                    .setInitialDelay(5, TimeUnit.SECONDS)
                    .build()
            )
    }
}
