package com.careerops.app.ui.screens.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsState(
    val name: String = "",
    val targetRole: String = "",
    val language: String = "en",
    val configuredPortals: Set<String> = emptySet(),
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val dataStore: DataStore<Preferences>,
) : ViewModel() {

    private object Keys {
        val NAME = stringPreferencesKey("user_name")
        val TARGET_ROLE = stringPreferencesKey("target_role")
        val LANGUAGE = stringPreferencesKey("language")
        val PORTALS = stringSetPreferencesKey("configured_portals")
    }

    val settings: StateFlow<SettingsState> = dataStore.data
        .map { prefs ->
            SettingsState(
                name = prefs[Keys.NAME] ?: "",
                targetRole = prefs[Keys.TARGET_ROLE] ?: "",
                language = prefs[Keys.LANGUAGE] ?: "en",
                configuredPortals = prefs[Keys.PORTALS] ?: emptySet(),
            )
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = SettingsState(),
        )

    fun updateName(name: String) {
        viewModelScope.launch {
            dataStore.edit { it[Keys.NAME] = name }
        }
    }

    fun updateTargetRole(role: String) {
        viewModelScope.launch {
            dataStore.edit { it[Keys.TARGET_ROLE] = role }
        }
    }

    fun updateLanguage(lang: String) {
        viewModelScope.launch {
            dataStore.edit { it[Keys.LANGUAGE] = lang }
        }
    }
}
