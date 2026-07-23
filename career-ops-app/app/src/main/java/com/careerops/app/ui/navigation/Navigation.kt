package com.careerops.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.ui.chat.ChatScreen
import com.careerops.app.ui.onboarding.ConfirmStartScreen
import com.careerops.app.ui.onboarding.GoogleSignInScreen
import com.careerops.app.ui.onboarding.ProfileFormScreen
import com.careerops.app.ui.onboarding.UploadResumeScreen
import com.careerops.app.ui.screens.settings.SettingsScreen
import com.careerops.app.util.UserPrefs

object Routes {
    const val ONBOARDING_GOOGLE = "onboarding/google"
    const val ONBOARDING_RESUME = "onboarding/resume"
    const val ONBOARDING_PROFILE = "onboarding/profile"
    const val ONBOARDING_CONFIRM = "onboarding/confirm"
    const val CHAT = "chat"
    const val SETTINGS = "settings"
}

@Composable
fun CareerOpsNavHost(
    userPrefs: UserPrefs,
    api: CareerOpsApi,
    startDestination: String = Routes.ONBOARDING_GOOGLE
) {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Routes.ONBOARDING_GOOGLE) {
            GoogleSignInScreen(
                onSignInSuccess = { email, _ ->
                    userPrefs.userEmail = email
                    navController.navigate(Routes.ONBOARDING_RESUME) {
                        popUpTo(Routes.ONBOARDING_GOOGLE) { inclusive = true }
                    }
                },
                onSignInError = { }
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
                }
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                userPrefs = userPrefs
            )
        }
    }
}
