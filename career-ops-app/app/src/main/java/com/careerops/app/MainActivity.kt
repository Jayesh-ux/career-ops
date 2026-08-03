package com.careerops.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
import kotlinx.coroutines.delay

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
                    // Resolve where the user goes next. Chat only opens once every
                    // dependency is resolved — on cold start / reopen from Recents,
                    // an onboarded user with no saved Google portal session is routed
                    // to the one-tap "Connect your portals" step instead of Chat.
                    var resolved by remember { mutableStateOf<String?>(null) }
                    LaunchedEffect(Unit) {
                        resolved = resolveStartDestination()
                    }
                    val dest = resolved
                    if (dest == null) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("career-ops", style = MaterialTheme.typography.headlineMedium)
                                Spacer(Modifier.height(16.dp))
                                CircularProgressIndicator()
                            }
                        }
                    } else {
                        CareerOpsNavHost(
                            userPrefs = userPrefs,
                            api = api,
                            startDestination = dest
                        )
                    }
                }
            }
        }
    }

    private suspend fun resolveStartDestination(): String {
        if (!userPrefs.isOnboarded || !userPrefs.isLoggedIn) return Routes.ONBOARDING_GOOGLE
        // Give the bridge a moment if it is still starting up.
        repeat(4) {
            try {
                val st = api.getPortalSessionStatus()
                if ((st["success"] as? Boolean) == true) {
                    return if ((st["googleSession"] as? Boolean) == true) Routes.CHAT
                    else "${Routes.ONBOARDING_PORTAL}?next=${Routes.CHAT}"
                }
            } catch (_: Exception) { }
            delay(1000)
        }
        // Bridge unreachable — route through the portal step so the dependency
        // is never silently skipped; that screen offers a friendly retry.
        return "${Routes.ONBOARDING_PORTAL}?next=${Routes.CHAT}"
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
