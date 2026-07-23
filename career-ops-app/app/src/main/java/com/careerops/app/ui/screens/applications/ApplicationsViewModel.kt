package com.careerops.app.ui.screens.applications

import androidx.lifecycle.ViewModel
import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.repository.JobRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

@HiltViewModel
class ApplicationsViewModel @Inject constructor(
    private val jobRepository: JobRepository,
) : ViewModel() {

    val applications: Flow<List<ApplicationEntry>> = jobRepository.applications
}
