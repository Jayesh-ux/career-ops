package com.careerops.app.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStoreFile
import com.careerops.app.data.remote.AshbyApi
import com.careerops.app.data.remote.GreenhouseApi
import com.careerops.app.data.remote.LeverApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import retrofit2.Retrofit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DataModule {

    @Provides
    @Singleton
    fun provideDataStore(@ApplicationContext context: Context): DataStore<Preferences> {
        return PreferenceDataStoreFactory.create {
            context.preferencesDataStoreFile("career_ops_prefs")
        }
    }

    @Provides
    @Singleton
    fun provideGreenhouseApi(retrofit: Retrofit): GreenhouseApi {
        return retrofit.create(GreenhouseApi::class.java)
    }

    @Provides
    @Singleton
    fun provideAshbyApi(retrofit: Retrofit): AshbyApi {
        return retrofit.create(AshbyApi::class.java)
    }

    @Provides
    @Singleton
    fun provideLeverApi(retrofit: Retrofit): LeverApi {
        return retrofit.create(LeverApi::class.java)
    }
}
