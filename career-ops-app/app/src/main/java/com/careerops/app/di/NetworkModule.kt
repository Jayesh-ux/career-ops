package com.careerops.app.di

import android.content.Context
import com.careerops.app.data.remote.CareerOpsApi
import com.careerops.app.util.UserPrefs
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    private const val DEFAULT_BRIDGE_URL = "http://127.0.0.1:8787"

    @Provides
    @Singleton
    fun provideUserPrefs(@ApplicationContext context: Context): UserPrefs {
        return UserPrefs(context)
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(userPrefs: UserPrefs): OkHttpClient {
        return OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val original = chain.request()
                val userId = userPrefs.userEmail
                val request = if (userId.isNotEmpty()) {
                    original.newBuilder()
                        .header("X-User-Id", userId)
                        .build()
                } else {
                    original
                }
                chain.proceed(request)
            }
            .addInterceptor(
                HttpLoggingInterceptor().apply {
                    level = HttpLoggingInterceptor.Level.BASIC
                }
            )
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient, userPrefs: UserPrefs): Retrofit {
        val baseUrl = userPrefs.bridgeServerUrl.trimEnd('/') + "/"
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }

    @Provides
    @Singleton
    fun provideCareerOpsApi(retrofit: Retrofit): CareerOpsApi {
        return retrofit.create(CareerOpsApi::class.java)
    }
}
