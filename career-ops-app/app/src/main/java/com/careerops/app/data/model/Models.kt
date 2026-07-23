package com.careerops.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class JobPosting(
    val id: String,
    val company: String,
    val title: String,
    val description: String = "",
    val url: String = "",
    val location: String = "",
    @SerialName("salary_min") val salaryMin: Long? = null,
    @SerialName("salary_max") val salaryMax: Long? = null,
    val remote: Boolean = false,
    val portal: String = "",
    @SerialName("posted_at") val postedAt: String? = null,
    @SerialName("created_at") val createdAt: String = "",
)

@Serializable
data class ApplicationEntry(
    val id: String,
    @SerialName("job_id") val jobId: String? = null,
    val company: String,
    val role: String,
    val status: ApplicationStatus = ApplicationStatus.EVALUATED,
    val score: Float? = null,
    val reportPath: String? = null,
    val notes: String = "",
    @SerialName("applied_at") val appliedAt: String? = null,
    @SerialName("updated_at") val updatedAt: String = "",
)

@Serializable
enum class ApplicationStatus {
    @SerialName("Evaluated") EVALUATED,
    @SerialName("Applied") APPLIED,
    @SerialName("Responded") RESPONDED,
    @SerialName("Interview") INTERVIEW,
    @SerialName("Offer") OFFER,
    @SerialName("Rejected") REJECTED,
    @SerialName("Discarded") DISCARDED,
    @SerialName("SKIP") SKIP,
}

@Serializable
data class PortalScanResult(
    val portal: String,
    @SerialName("total_found") val totalFound: Int,
    @SerialName("new_postings") val newPostings: Int,
    val postings: List<JobPosting> = emptyList(),
    @SerialName("scanned_at") val scannedAt: String = "",
)

@Serializable
data class PipelineItem(
    val url: String,
    val source: String = "",
    @SerialName("added_at") val addedAt: String = "",
    val status: String = "pending",
)
