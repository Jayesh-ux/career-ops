package com.careerops.app.data.repository

import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.model.ApplicationStatus
import com.careerops.app.data.model.JobPosting
import com.careerops.app.data.model.PipelineItem
import com.careerops.app.data.model.PortalScanResult
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.TimestampProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class JobRepository @Inject constructor(
    private val api: CareerOpsApi,
    private val timestampProvider: TimestampProvider,
) {
    private val _applications = MutableStateFlow<List<ApplicationEntry>>(emptyList())
    val applications: Flow<List<ApplicationEntry>> = _applications.asStateFlow()

    private val _pipeline = MutableStateFlow<List<PipelineItem>>(emptyList())
    val pipeline: Flow<List<PipelineItem>> = _pipeline.asStateFlow()

    private val _scanHistory = MutableStateFlow<List<PortalScanResult>>(emptyList())
    val scanHistory: Flow<List<PortalScanResult>> = _scanHistory.asStateFlow()

    private val _lastSyncTime = MutableStateFlow(0L)
    val lastSyncTime: Flow<Long> = _lastSyncTime.asStateFlow()

    private val _syncError = MutableStateFlow<String?>(null)
    val syncError: Flow<String?> = _syncError.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        // Auto-sync from bridge on creation
        scope.launch {
            try {
                syncFromBridge()
            } catch (e: Exception) {
                _syncError.value = e.message
            }
        }
    }

    /**
     * Sync applications from bridge server's /tracker endpoint.
     * This replaces the in-memory list with the canonical tracker data.
     */
    suspend fun syncFromBridge() {
        try {
            val response = api.getTracker()
            val entries = response.applications.mapNotNull { trackerEntry ->
                try {
                    val id = trackerEntry.id.ifEmpty { return@mapNotNull null }
                    val status = parseStatus(trackerEntry.status)
                    val score = trackerEntry.score.replace("/5", "").replace("N/A", "").replace("—", "").replace("-", "").trim()
                        .toFloatOrNull()

                    ApplicationEntry(
                        id = id,
                        jobId = null,
                        company = trackerEntry.company,
                        role = trackerEntry.role,
                        status = status,
                        score = score,
                        reportPath = null,
                        notes = trackerEntry.notes,
                        appliedAt = trackerEntry.date.ifEmpty { null },
                        updatedAt = trackerEntry.date.ifEmpty { timestampProvider.now() }
                    )
                } catch (e: Exception) {
                    null
                }
            }
            _applications.value = entries
            _lastSyncTime.value = System.currentTimeMillis()
            _syncError.value = null
        } catch (e: Exception) {
            _syncError.value = e.message
            throw e
        }
    }

    /**
     * Update application status via bridge server.
     */
    suspend fun updateStatusViaBridge(applicationId: String, status: ApplicationStatus) {
        try {
            api.updateStatus(applicationId, mapOf("status" to status.name))
            // Re-sync after update
            syncFromBridge()
        } catch (e: Exception) {
            _syncError.value = e.message
            throw e
        }
    }

    /**
     * Add a new entry via bridge server.
     */
    suspend fun addEntryViaBridge(company: String, role: String, location: String = "", notes: String = "") {
        try {
            api.addTrackerEntry(
                com.careerops.app.data.model.TrackerAddRequest(
                    company = company,
                    role = role,
                    location = location,
                    notes = notes
                )
            )
            syncFromBridge()
        } catch (e: Exception) {
            _syncError.value = e.message
            throw e
        }
    }

    /**
     * Force refresh from bridge server.
     */
    suspend fun refresh() {
        syncFromBridge()
    }

    fun getApplicationsByStatus(status: ApplicationStatus): Flow<List<ApplicationEntry>> {
        return _applications.map { list -> list.filter { it.status == status } }
    }

    private fun parseStatus(statusStr: String): ApplicationStatus {
        return when (statusStr.trim().lowercase()) {
            "evaluated" -> ApplicationStatus.EVALUATED
            "applied" -> ApplicationStatus.APPLIED
            "responded" -> ApplicationStatus.RESPONDED
            "interview" -> ApplicationStatus.INTERVIEW
            "offer" -> ApplicationStatus.OFFER
            "rejected" -> ApplicationStatus.REJECTED
            "discarded" -> ApplicationStatus.DISCARDED
            "skip" -> ApplicationStatus.SKIP
            else -> ApplicationStatus.EVALUATED
        }
    }
}
