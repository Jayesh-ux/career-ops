package com.careerops.app.data.remote

import com.careerops.app.data.model.JobPosting
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface AshbyApi {

    @GET("api/jobs")
    suspend fun getJobs(
        @Query("limit") limit: Int = 100,
    ): AshbyJobResponse
}

@kotlinx.serialization.Serializable
data class AshbyJobResponse(
    val jobs: List<AshbyJob> = emptyList(),
)

@kotlinx.serialization.Serializable
data class AshbyJob(
    val id: String,
    val title: String,
    val locationName: String? = null,
    val descriptionHtml: String? = null,
    val url: String = "",
    val updatedAt: String? = null,
)
