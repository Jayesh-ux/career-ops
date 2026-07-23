package com.careerops.app.ui.screens.dashboard

import androidx.lifecycle.ViewModel
import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.model.ApplicationStatus
import com.careerops.app.data.repository.JobRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val jobRepository: JobRepository,
) : ViewModel() {

    val applications: Flow<List<ApplicationEntry>> = jobRepository.applications

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
