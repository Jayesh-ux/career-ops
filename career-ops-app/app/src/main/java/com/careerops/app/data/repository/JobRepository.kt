package com.careerops.app.data.repository

import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.model.ApplicationStatus
import com.careerops.app.data.model.JobPosting
import com.careerops.app.data.model.PipelineItem
import com.careerops.app.data.model.PortalScanResult
import com.careerops.app.data.remote.AshbyApi
import com.careerops.app.data.remote.GreenhouseApi
import com.careerops.app.data.remote.LeverApi
import com.careerops.app.util.TimestampProvider
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class JobRepository @Inject constructor(
    private val greenhouseApi: GreenhouseApi,
    private val ashbyApi: AshbyApi,
    private val leverApi: LeverApi,
    private val timestampProvider: TimestampProvider,
) {
    private val _applications = MutableStateFlow<List<ApplicationEntry>>(emptyList())
    val applications: Flow<List<ApplicationEntry>> = _applications.asStateFlow()

    private val _pipeline = MutableStateFlow<List<PipelineItem>>(emptyList())
    val pipeline: Flow<List<PipelineItem>> = _pipeline.asStateFlow()

    private val _scanHistory = MutableStateFlow<List<PortalScanResult>>(emptyList())
    val scanHistory: Flow<List<PortalScanResult>> = _scanHistory.asStateFlow()

    fun getApplicationsByStatus(status: ApplicationStatus): Flow<List<ApplicationEntry>> {
        return _applications.map { list -> list.filter { it.status == status } }
    }

    fun addApplication(job: JobPosting, score: Float? = null, notes: String = ""): ApplicationEntry {
        val entry = ApplicationEntry(
            id = UUID.randomUUID().toString(),
            jobId = job.id,
            company = job.company,
            role = job.title,
            status = ApplicationStatus.EVALUATED,
            score = score,
            notes = notes,
            updatedAt = timestampProvider.now(),
        )
        _applications.value = _applications.value + entry
        return entry
    }

    fun updateStatus(applicationId: String, status: ApplicationStatus, notes: String? = null) {
        _applications.value = _applications.value.map {
            if (it.id == applicationId) {
                it.copy(
                    status = status,
                    notes = notes ?: it.notes,
                    updatedAt = timestampProvider.now(),
                )
            } else it
        }
    }

    fun addToPipeline(url: String, source: String = "") {
        val item = PipelineItem(
            url = url,
            source = source,
            addedAt = timestampProvider.now(),
        )
        _pipeline.value = _pipeline.value + item
    }

    fun removeFromPipeline(url: String) {
        _pipeline.value = _pipeline.value.filter { it.url != url }
    }

    suspend fun scanGreenhouse(boardToken: String): PortalScanResult {
        val response = greenhouseApi.getJobs(boardToken)
        val postings = response.jobs.map { job ->
            JobPosting(
                id = "gh-${boardToken}-${job.id}",
                company = boardToken.replace("-", " ").replaceFirstChar { it.uppercase() },
                title = job.title,
                description = job.description ?: "",
                url = job.absolute_url,
                location = job.location?.name ?: "",
                portal = "greenhouse",
                postedAt = job.updated_at,
                createdAt = timestampProvider.now(),
            )
        }
        val result = PortalScanResult(
            portal = "greenhouse",
            totalFound = postings.size,
            newPostings = postings.size,
            postings = postings,
            scannedAt = timestampProvider.now(),
        )
        _scanHistory.value = _scanHistory.value + result
        return result
    }

    suspend fun scanAshby(): PortalScanResult {
        val response = ashbyApi.getJobs()
        val postings = response.jobs.map { job ->
            JobPosting(
                id = "ashby-${job.id}",
                company = "Ashby",
                title = job.title,
                description = job.descriptionHtml ?: "",
                url = job.url,
                location = job.locationName ?: "",
                portal = "ashby",
                postedAt = job.updatedAt,
                createdAt = timestampProvider.now(),
            )
        }
        val result = PortalScanResult(
            portal = "ashby",
            totalFound = postings.size,
            newPostings = postings.size,
            postings = postings,
            scannedAt = timestampProvider.now(),
        )
        _scanHistory.value = _scanHistory.value + result
        return result
    }

    suspend fun scanLever(): PortalScanResult {
        val postings = leverApi.getPostings()
        val mapped = postings.map { posting ->
            JobPosting(
                id = "lever-${posting.id}",
                company = posting.categories?.team ?: "Unknown",
                title = posting.text,
                description = posting.descriptionPlain ?: "",
                url = posting.hostedUrl,
                location = posting.categories?.location ?: "",
                portal = "lever",
                createdAt = timestampProvider.now(),
            )
        }
        val result = PortalScanResult(
            portal = "lever",
            totalFound = mapped.size,
            newPostings = mapped.size,
            postings = mapped,
            scannedAt = timestampProvider.now(),
        )
        _scanHistory.value = _scanHistory.value + result
        return result
    }
}
