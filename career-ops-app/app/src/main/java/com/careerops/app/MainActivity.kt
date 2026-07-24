package com.careerops.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.work.*
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.service.DailyAutomationWorker
import com.careerops.app.service.NotificationWorker
import com.careerops.app.ui.navigation.CareerOpsNavHost
import com.careerops.app.ui.navigation.Routes
import com.careerops.app.ui.theme.CareerOpsTheme
import com.careerops.app.util.UserPrefs
import dagger.hilt.android.AndroidEntryPoint
import java.util.concurrent.TimeUnit
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject lateinit var userPrefs: UserPrefs
    @Inject lateinit var api: CareerOpsApi

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Ensure bridge token is set on every launch (not just during sign-in)
        // Always force-set from BuildConfig to avoid stale/empty tokens
        userPrefs.bridgeToken = BuildConfig.BRIDGE_TOKEN

        scheduleDailyAutomation()
        scheduleNotificationWorker()

        setContent {
            CareerOpsTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val isOnboarded = userPrefs.isOnboarded && userPrefs.isLoggedIn
                    val startDestination = if (isOnboarded) Routes.CHAT else Routes.ONBOARDING_GOOGLE

                    CareerOpsNavHost(
                        userPrefs = userPrefs,
                        api = api,
                        startDestination = startDestination
                    )
                }
            }
        }
    }

    private fun scheduleDailyAutomation() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val workRequest = PeriodicWorkRequestBuilder<DailyAutomationWorker>(
            1, TimeUnit.DAYS
        )
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                1, TimeUnit.HOURS
            )
            .build()

        WorkManager.getInstance(this)
            .enqueueUniquePeriodicWork(
                DailyAutomationWorker.WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
    }

    private fun scheduleNotificationWorker() {
        WorkManager.getInstance(this)
            .enqueueUniqueWork(
                "career_ops_notification_init",
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<NotificationWorker>()
                    .build()
            )
    }
}
