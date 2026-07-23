package com.careerops.app.data.remote

import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface LeverApi {

    @GET("api/lever/v0/postings")
    suspend fun getPostings(
        @Query("mode") mode: String = "json",
        @Query("team") team: String? = null,
    ): List<LeverPosting>

    @GET("api/lever/v0/postings/{posting_id}")
    suspend fun getPosting(
        @Path("posting_id") postingId: String,
    ): LeverPosting
}

@kotlinx.serialization.Serializable
data class LeverPosting(
    val id: String,
    val text: String,
    val categories: LeverCategories? = null,
    val descriptionPlain: String? = null,
    val hostedUrl: String = "",
    val createdAt: Long? = null,
    val updatedAt: Long? = null,
)

@kotlinx.serialization.Serializable
data class LeverCategories(
    val team: String? = null,
    val department: String? = null,
    val location: String? = null,
)
