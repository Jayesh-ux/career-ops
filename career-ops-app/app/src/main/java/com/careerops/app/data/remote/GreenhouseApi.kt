package com.careerops.app.data.remote

import com.careerops.app.data.model.JobPosting
import com.careerops.app.data.model.ScanResult
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface GreenhouseApi {

    @GET("boards/{board_token}/jobs.json")
    suspend fun getJobs(
        @Path("board_token") boardToken: String,
        @Query("content") content: Boolean = false,
    ): GreenhouseJobResponse

    @GET("boards/{board_token}/jobs/{job_id}.json")
    suspend fun getJob(
        @Path("board_token") boardToken: String,
        @Path("job_id") jobId: Long,
    ): GreenhouseSingleJobResponse
}

@kotlinx.serialization.Serializable
data class GreenhouseJobResponse(
    val jobs: List<GreenhouseJob> = emptyList(),
)

@kotlinx.serialization.Serializable
data class GreenhouseSingleJobResponse(
    val content: GreenhouseJob? = null,
)

@kotlinx.serialization.Serializable
data class GreenhouseJob(
    val id: Long,
    val title: String,
    val name: String? = null,
    val description: String? = null,
    val absolute_url: String = "",
    val location: GreenhouseLocation? = null,
    val updated_at: String? = null,
)

@kotlinx.serialization.Serializable
data class GreenhouseLocation(
    val name: String = "",
)
