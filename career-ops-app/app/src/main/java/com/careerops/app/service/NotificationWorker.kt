package com.careerops.app.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class NotificationWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val CHANNEL_ID = "career_ops_automation"
        private const val CHANNEL_NAME = "Job Search Updates"
    }

    override suspend fun doWork(): Result {
        val type = inputData.getString(DailyAutomationWorker.KEY_EVENT_TYPE) ?: return Result.failure()
        val message = inputData.getString(DailyAutomationWorker.KEY_EVENT_MESSAGE) ?: return Result.failure()

        val notificationManager = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notifications from career-ops job search automation"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val title = when (type) {
            "draft" -> "\uD83D\uDCC3 New Job Match"
            "followups" -> "\u23F0 Follow-up Reminder"
            "interview_active" -> "\uD83C\uDF1F Interview Active"
            else -> "career-ops Update"
        }

        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
        return Result.success()
    }
}
