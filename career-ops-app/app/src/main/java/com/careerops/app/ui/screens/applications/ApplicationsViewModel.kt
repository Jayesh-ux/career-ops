package com.careerops.app.ui.screens.applications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.repository.JobRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ApplicationsViewModel @Inject constructor(
    private val jobRepository: JobRepository,
) : ViewModel() {

    val applications: Flow<List<ApplicationEntry>> = jobRepository.applications

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                jobRepository.refresh()
            } catch (e: Exception) {
                // Sync error will be reflected in repository state
            }
        }
    }
}
