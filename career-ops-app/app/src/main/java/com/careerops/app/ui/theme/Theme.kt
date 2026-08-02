package com.careerops.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColorScheme = lightColorScheme(
    primary = White,
    onPrimary = Black,
    primaryContainer = Gray15,
    onPrimaryContainer = White,
    secondary = Gray75,
    onSecondary = Black,
    secondaryContainer = Gray20,
    onSecondaryContainer = White,
    tertiary = Gray60,
    onTertiary = Black,
    tertiaryContainer = Gray20,
    onTertiaryContainer = White,
    error = White,
    onError = Black,
    errorContainer = Gray30,
    onErrorContainer = White,
    background = PitchBlack,
    onBackground = White,
    surface = PitchBlack,
    onSurface = White,
    surfaceVariant = Gray15,
    onSurfaceVariant = Gray75,
    outline = Gray60,
    outlineVariant = Gray20,
    surfaceTint = White,
    inverseSurface = Gray90,
    inverseOnSurface = Black,
    inversePrimary = Black,
    surfaceDim = PitchBlack,
    surfaceBright = Gray10,
    surfaceContainerLowest = Black,
    surfaceContainerLow = Gray5,
    surfaceContainer = Gray10,
    surfaceContainerHigh = Gray15,
    surfaceContainerHighest = Gray20,
)

private val DarkColorScheme = darkColorScheme(
    primary = White,
    onPrimary = Black,
    primaryContainer = Gray15,
    onPrimaryContainer = White,
    secondary = Gray75,
    onSecondary = Black,
    secondaryContainer = Gray20,
    onSecondaryContainer = White,
    tertiary = Gray60,
    onTertiary = Black,
    tertiaryContainer = Gray20,
    onTertiaryContainer = White,
    error = White,
    onError = Black,
    errorContainer = Gray30,
    onErrorContainer = White,
    background = PitchBlack,
    onBackground = White,
    surface = PitchBlack,
    onSurface = White,
    surfaceVariant = Gray15,
    onSurfaceVariant = Gray75,
    outline = Gray60,
    outlineVariant = Gray20,
    surfaceTint = White,
    inverseSurface = Gray90,
    inverseOnSurface = Black,
    inversePrimary = Black,
    surfaceDim = PitchBlack,
    surfaceBright = Gray10,
    surfaceContainerLowest = Black,
    surfaceContainerLow = Gray5,
    surfaceContainer = Gray10,
    surfaceContainerHigh = Gray15,
    surfaceContainerHighest = Gray20,
)

@Composable
fun CareerOpsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            // App is always dark — match the status bar to the background
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            val insetsController = WindowCompat.getInsetsController(window, view)
            insetsController.isAppearanceLightStatusBars = false
            insetsController.isAppearanceLightNavigationBars = false
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content,
    )
}
