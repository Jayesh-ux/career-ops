package com.careerops.app.ui.screens.applications

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.careerops.app.data.model.ApplicationEntry
import com.careerops.app.data.model.ApplicationStatus

@Composable
fun ApplicationsScreen(
    viewModel: ApplicationsViewModel = hiltViewModel(),
) {
    val applications by viewModel.applications.collectAsState(initial = emptyList())
    var selectedFilter by remember { mutableStateOf<ApplicationStatus?>(null) }

    val filteredApps = if (selectedFilter != null) {
        applications.filter { it.status == selectedFilter }
    } else {
        applications
    }.sortedByDescending { it.updatedAt }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
    ) {
        Text(
            text = "Applications",
            style = MaterialTheme.typography.headlineLarge,
        )
        Spacer(modifier = Modifier.height(12.dp))

        androidx.compose.foundation.lazy.LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                FilterChip(
                    selected = selectedFilter == null,
                    onClick = { selectedFilter = null },
                    label = { Text("All") },
                )
            }
            items(ApplicationStatus.entries.toList()) { status ->
                FilterChip(
                    selected = selectedFilter == status,
                    onClick = { selectedFilter = status },
                    label = { Text(status.name) },
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (filteredApps.isEmpty()) {
                item {
                    Text(
                        text = "No applications match this filter.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(filteredApps, key = { it.id }) { app ->
                ApplicationCard(app)
            }
        }
    }
}

@Composable
private fun ApplicationCard(app: ApplicationEntry) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = app.role,
                    style = MaterialTheme.typography.titleMedium,
                )
                app.score?.let { score ->
                    Text(
                        text = String.format("%.1f/5", score),
                        style = MaterialTheme.typography.labelLarge,
                        color = when {
                            score >= 4.0f -> MaterialTheme.colorScheme.primary
                            score >= 3.0f -> MaterialTheme.colorScheme.tertiary
                            else -> MaterialTheme.colorScheme.error
                        },
                    )
                }
            }
            Text(
                text = app.company,
                style = MaterialTheme.typography.bodyMedium,
            )
            if (app.notes.isNotBlank()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = app.notes,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
