package com.careerops.app.ui.screens.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.model.ApplicationStatus
import com.careerops.app.data.repository.JobRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val jobRepository: JobRepository,
) : ViewModel() {

    val applications: Flow<List<ApplicationEntry>> = jobRepository.applications

    private val _isLoading = MutableStateFlow(false)
    val isLoading: Flow<Boolean> = _isLoading.asStateFlow()

    private val _syncError = MutableStateFlow<String?>(null)
    val syncError: Flow<String?> = _syncError.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                jobRepository.refresh()
                _syncError.value = null
            } catch (e: Exception) {
                _syncError.value = e.message
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun computeStats(apps: List<ApplicationEntry>): DashboardStats {
        if (apps.isEmpty()) return DashboardStats()

        val scored = apps.filter { it.score != null }
        val avgScore = if (scored.isNotEmpty()) {
            scored.mapNotNull { it.score }.average().toFloat()
        } else 0f

        return DashboardStats(
            total = apps.size,
            applied = apps.count { it.status == ApplicationStatus.APPLIED },
            interviews = apps.count { it.status == ApplicationStatus.INTERVIEW },
            offers = apps.count { it.status == ApplicationStatus.OFFER },
            rejected = apps.count { it.status == ApplicationStatus.REJECTED },
            avgScore = avgScore,
        )
    }
}
