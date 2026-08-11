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
import androidx.navigation.navArgument
import com.careerops.app.data.model.GoogleIdTokenRequest
import com.careerops.app.data.model.OAuthExchangeRequest
import com.careerops.app.data.model.SeedLoginSessionRequest
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.ui.chat.ChatScreen
import com.careerops.app.ui.onboarding.ConfirmStartScreen
import com.careerops.app.ui.onboarding.GoogleSignInScreen
import com.careerops.app.ui.onboarding.ProfileFormScreen
import com.careerops.app.ui.onboarding.UploadResumeScreen
import com.careerops.app.ui.screens.applications.ApplicationsScreen
import com.careerops.app.ui.screens.dashboard.DashboardScreen
import com.careerops.app.ui.screens.settings.PortalLoginScreen
import com.careerops.app.ui.screens.settings.SettingsScreen
import com.careerops.app.util.UserPrefs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val TAG = "CareerOpsNav"

object Routes {
    const val ONBOARDING_GOOGLE = "onboarding/google"
    const val ONBOARDING_RESUME = "onboarding/resume"
    const val ONBOARDING_PROFILE = "onboarding/profile"
    const val ONBOARDING_PORTAL = "onboarding/portal"
    const val ONBOARDING_CONFIRM = "onboarding/confirm"
    const val CHAT = "chat"
    const val DASHBOARD = "dashboard"
    const val APPLICATIONS = "applications"
    const val SETTINGS = "settings"
    const val PROFILE = "profile"
    const val PORTAL_LOGIN = "portal_login"
}

/**
 * A user is "onboarded" if local prefs say so OR the bridge already has a
 * profile with a name for them. Falls back to local prefs when the bridge is
 * unreachable, so a network blip never re-runs onboarding.
 */
private suspend fun hasOnboardedProfile(api: CareerOpsApi, userPrefs: UserPrefs): Boolean {
    if (userPrefs.isOnboarded) return true
    return try {
        val onboarded = api.getProfile().name.isNotBlank()
        if (onboarded) userPrefs.isOnboarded = true
        onboarded
    } catch (_: Exception) {
        false
    }
}

/**
 * Decide where a signed-in user goes next.
 *
 * Fresh users continue the onboarding chain (resume → profile → portal).
 * Existing users with no saved Google portal session are routed through the
 * portal step until a session is captured. Chat opens ONLY when every
 * dependency (Google account, resume, profile, portal session) is resolved —
 * an unreachable bridge never fail-opens straight to Chat.
 */
private suspend fun nextRouteAfterAuth(api: CareerOpsApi, userPrefs: UserPrefs): String {
    if (!hasOnboardedProfile(api, userPrefs)) return Routes.ONBOARDING_RESUME
    // The WebView cookie seed is fire-and-forget; give it a moment to land so
    // the user isn't asked to sign in again right after signing in.
    val googleSessionReady = try {
        var ready = false
        repeat(5) {
            val st = api.getPortalSessionStatus()
            if ((st["googleSession"] as? Boolean) == true) { ready = true; return@repeat }
            delay(600)
        }
        ready
    } catch (_: Exception) {
        false // bridge unreachable — route through portal step, never straight to Chat
    }
    return if (googleSessionReady) Routes.CHAT
    else "${Routes.ONBOARDING_PORTAL}?next=${Routes.CHAT}"
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
            // Cookies captured from the WebView login. Seeded only AFTER the
            // OAuth exchange resolves userEmail — otherwise the seed POST goes
            // out without X-User-Id and lands in the wrong user dir.
            var pendingCookies by remember { mutableStateOf("") }

            suspend fun seedPendingCookies() {
                val cs = pendingCookies
                if (cs.isNotBlank()) {
                    try { api.seedLoginSession(SeedLoginSessionRequest(cookieString = cs)) } catch (_: Exception) { }
                    pendingCookies = ""
                }
            }

            GoogleSignInScreen(
                oauthError = oauthError,
                onSignInSuccess = { email, authToken ->
                    if (userPrefs.bridgeToken.isEmpty()) {
                        userPrefs.bridgeToken = BuildConfig.BRIDGE_TOKEN
                    }
                    oauthError = null
                    scope.launch(Dispatchers.IO) {
                        try {
                            if (authToken.length > 200) {
                                // This is an ID token from Credential Manager
                                Log.d(TAG, "Verifying Google ID token")
                                val resp = api.verifyGoogleIdToken(
                                    GoogleIdTokenRequest(idToken = authToken)
                                )
                                Log.d(TAG, "ID token verify: success=${resp.success}, email=${resp.email}, hasGmailAuth=${resp.hasGmailAuth}")
                                if (resp.success) {
                                    userPrefs.userEmail = resp.email
                                    seedPendingCookies()
                                    if (resp.hasGmailAuth) {
                                        // Already has Gmail access — done
                                        scope.launch(Dispatchers.Main) {
                                            val next = nextRouteAfterAuth(api, userPrefs)
                                            navController.navigate(next) {
                                                popUpTo(Routes.ONBOARDING_GOOGLE) { inclusive = true }
                                            }
                                        }
                                    } else {
                                        // Needs Gmail OAuth — pass email to WebView flow
                                        oauthError = "NEEDS_GMAIL_AUTH:${resp.email}"
                                    }
                                } else {
                                    oauthError = "Failed to verify Google account."
                                }
                            } else {
                                // This is an auth code from WebView OAuth
                                Log.d(TAG, "Exchanging OAuth code")
                                val resp = api.exchangeOAuth(
                                    email.ifEmpty { "pending" },
                                    OAuthExchangeRequest(
                                        code = authToken,
                                        clientId = "221656652451-5cb11e7qhkkngdjbs6emaiqidt4a93dr.apps.googleusercontent.com",
                                        cookies = pendingCookies
                                    )
                                )
                                Log.d(TAG, "OAuth exchange: success=${resp.success}, email=${resp.email}")
                                if (resp.success) {
                                    val resolvedEmail = resp.email
                                    if (!resolvedEmail.isNullOrEmpty()) {
                                        userPrefs.userEmail = resolvedEmail
                                    }
                                    // Seed the portal session NOW that the user
                                    // id is known (X-User-Id is present).
                                    seedPendingCookies()
                                    scope.launch(Dispatchers.Main) {
                                        val next = nextRouteAfterAuth(api, userPrefs)
                                        navController.navigate(next) {
                                            popUpTo(Routes.ONBOARDING_GOOGLE) { inclusive = true }
                                        }
                                    }
                                } else {
                                    oauthError = "Token exchange failed. Please try again."
                                }
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Auth flow failed", e)
                            oauthError = "Auth failed: ${e.message}"
                        }
                    }
                },
                onSignInError = { oauthError = it },
                onSessionCookies = { cookieString ->
                    // Defer seeding until the exchange has set userPrefs.userEmail.
                    if (cookieString.isNotBlank()) pendingCookies = cookieString
                }
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
                }
            )
        }

        composable(Routes.ONBOARDING_PROFILE) {
            ProfileFormScreen(
                email = userPrefs.userEmail,
                api = api,
                userPrefs = userPrefs,
                onComplete = {
                    navController.navigate("${Routes.ONBOARDING_PORTAL}?next=${Routes.ONBOARDING_CONFIRM}") {
                        popUpTo(Routes.ONBOARDING_PROFILE) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = "${Routes.ONBOARDING_PORTAL}?next={next}",
            arguments = listOf(
                navArgument("next") { defaultValue = Routes.ONBOARDING_CONFIRM }
            )
        ) { entry ->
            val next = entry.arguments?.getString("next") ?: Routes.ONBOARDING_CONFIRM
            PortalLoginScreen(
                portalName = "Google",
                startUrl = "https://accounts.google.com/AccountChooser",
                api = api,
                userPrefs = userPrefs,
                inOnboarding = true,
                onDone = {
                    navController.navigate(next) {
                        popUpTo(Routes.ONBOARDING_PORTAL) { inclusive = true }
                    }
                },
                onClose = {
                    navController.navigate(next) {
                        popUpTo(Routes.ONBOARDING_PORTAL) { inclusive = true }
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
                onReconnectGmail = {
                    navController.navigate(Routes.ONBOARDING_GOOGLE) {
                        launchSingleTop = true
                    }
                },
                onEditProfile = {
                    navController.navigate(Routes.PROFILE)
                },
                onStartPortalLogin = { portal, url ->
                    navController.navigate("${Routes.PORTAL_LOGIN}?url=${android.net.Uri.encode(url)}&portal=${android.net.Uri.encode(portal)}")
                },
                userPrefs = userPrefs,
                api = api
            )
        }

        composable(
            route = "${Routes.PORTAL_LOGIN}?url={url}&portal={portal}",
            arguments = listOf(
                navArgument("url") { defaultValue = "https://accounts.google.com/AccountChooser" },
                navArgument("portal") { defaultValue = "Google" }
            )
        ) { entry ->
            val url = entry.arguments?.getString("url") ?: "https://accounts.google.com/AccountChooser"
            val portal = entry.arguments?.getString("portal") ?: "Google"
            PortalLoginScreen(
                portalName = portal,
                startUrl = url,
                api = api,
                userPrefs = userPrefs,
                onDone = { navController.popBackStack() },
                onClose = { navController.popBackStack() }
            )
        }

        composable(Routes.PROFILE) {
            ProfileFormScreen(
                email = userPrefs.userEmail,
                api = api,
                userPrefs = userPrefs,
                onComplete = { navController.popBackStack() },
                title = "Edit Profile",
                subtitle = "Update your job search details.",
                saveLabel = "Save"
            )
        }
    }
}
