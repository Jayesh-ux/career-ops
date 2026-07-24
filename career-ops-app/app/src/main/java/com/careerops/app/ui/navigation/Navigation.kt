package com.careerops.app.ui.navigation

import android.util.Log
import androidx.compose.runtime.Composable
import com.careerops.app.BuildConfig
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.careerops.app.data.model.OAuthExchangeRequest
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.ui.chat.ChatScreen
import com.careerops.app.ui.onboarding.ConfirmStartScreen
import com.careerops.app.ui.onboarding.GoogleSignInScreen
import com.careerops.app.ui.onboarding.ProfileFormScreen
import com.careerops.app.ui.onboarding.UploadResumeScreen
import com.careerops.app.ui.screens.applications.ApplicationsScreen
import com.careerops.app.ui.screens.dashboard.DashboardScreen
import com.careerops.app.ui.screens.settings.SettingsScreen
import com.careerops.app.util.UserPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val TAG = "CareerOpsNav"

object Routes {
    const val ONBOARDING_GOOGLE = "onboarding/google"
    const val ONBOARDING_RESUME = "onboarding/resume"
    const val ONBOARDING_PROFILE = "onboarding/profile"
    const val ONBOARDING_CONFIRM = "onboarding/confirm"
    const val CHAT = "chat"
    const val DASHBOARD = "dashboard"
    const val APPLICATIONS = "applications"
    const val SETTINGS = "settings"
}

@Composable
fun CareerOpsNavHost(
    userPrefs: UserPrefs,
    api: CareerOpsApi,
    startDestination: String = Routes.ONBOARDING_GOOGLE
) {
    val navController = rememberNavController()
    val scope = rememberCoroutineScope()

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Routes.ONBOARDING_GOOGLE) {
            var oauthError by remember { mutableStateOf<String?>(null) }

            GoogleSignInScreen(
                oauthError = oauthError,
                onSignInSuccess = { email, authCode ->
                    userPrefs.userEmail = email
                    // Static bridge token — must match BRIDGE_TOKEN in .bridge.env on server
                    if (userPrefs.bridgeToken.isEmpty()) {
                        userPrefs.bridgeToken = BuildConfig.BRIDGE_TOKEN
                    }
                    oauthError = null
                    scope.launch(Dispatchers.IO) {
                        try {
                            Log.d(TAG, "Exchanging OAuth code for $email")
                            val resp = api.exchangeOAuth(
                                email,
                                OAuthExchangeRequest(
                                    code = authCode,
                                    clientId = "221656652451-5cb11e7qhkkngdjbs6emaiqidt4a93dr.apps.googleusercontent.com"
                                )
                            )
                            Log.d(TAG, "OAuth exchange response: success=${resp.success}, hasRefreshToken=${resp.hasRefreshToken}")
                            if (resp.success) {
                                scope.launch(Dispatchers.Main) {
                                    navController.navigate(Routes.ONBOARDING_RESUME) {
                                        popUpTo(Routes.ONBOARDING_GOOGLE) { inclusive = true }
                                    }
                                }
                            } else {
                                oauthError = "Token exchange failed. Please try again."
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "OAuth exchange failed", e)
                            oauthError = "OAuth exchange failed: ${e.message}"
                        }
                    }
                },
                onSignInError = { oauthError = it }
            )
        }

        composable(Routes.ONBOARDING_RESUME) {
            UploadResumeScreen(
                email = userPrefs.userEmail,
                api = api,
                userPrefs = userPrefs,
                onUploadSuccess = { _, _ ->
                    navController.navigate(Routes.ONBOARDING_PROFILE) {
                        popUpTo(Routes.ONBOARDING_RESUME) { inclusive = true }
                    }
                },
                onSkip = {
                    navController.navigate(Routes.ONBOARDING_PROFILE) {
                        popUpTo(Routes.ONBOARDING_RESUME) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.ONBOARDING_PROFILE) {
            ProfileFormScreen(
                email = userPrefs.userEmail,
                api = api,
                userPrefs = userPrefs,
                onComplete = {
                    navController.navigate(Routes.ONBOARDING_CONFIRM) {
                        popUpTo(Routes.ONBOARDING_PROFILE) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.ONBOARDING_CONFIRM) {
            ConfirmStartScreen(
                email = userPrefs.userEmail,
                api = api,
                userPrefs = userPrefs,
                onStart = {
                    userPrefs.isOnboarded = true
                    navController.navigate(Routes.CHAT) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.CHAT) {
            ChatScreen(
                onNavigateToSettings = {
                    navController.navigate(Routes.SETTINGS)
                },
                onNavigateToDashboard = {
                    navController.navigate(Routes.DASHBOARD)
                },
                onNavigateToApplications = {
                    navController.navigate(Routes.APPLICATIONS)
                }
            )
        }

        composable(Routes.DASHBOARD) {
            DashboardScreen()
        }

        composable(Routes.APPLICATIONS) {
            ApplicationsScreen()
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                userPrefs = userPrefs
            )
        }
    }
}
