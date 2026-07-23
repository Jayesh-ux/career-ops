package com.careerops.app.ui.screens.dashboard

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.careerops.app.data.model.ApplicationStatus

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val applications by viewModel.applications.collectAsState(initial = emptyList())
    val stats = viewModel.computeStats(applications)

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                text = "Dashboard",
                style = MaterialTheme.typography.headlineLarge,
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    title = "Total",
                    value = "${stats.total}",
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    title = "Applied",
                    value = "${stats.applied}",
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    title = "Interviews",
                    value = "${stats.interviews}",
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    title = "Offers",
                    value = "${stats.offers}",
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    title = "Rejected",
                    value = "${stats.rejected}",
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    title = "Avg Score",
                    value = String.format("%.1f", stats.avgScore),
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Recent Activity",
                style = MaterialTheme.typography.titleLarge,
            )
        }

        val recentApps = applications.sortedByDescending { it.updatedAt }.take(5)
        if (recentApps.isEmpty()) {
            item {
                Text(
                    text = "No applications yet. Scan for jobs or paste a URL to get started.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(recentApps, key = { it.id }) { app ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    ),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = app.role,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = app.company,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            text = "Status: ${app.status.name}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatCard(
    title: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

data class DashboardStats(
    val total: Int = 0,
    val applied: Int = 0,
    val interviews: Int = 0,
    val offers: Int = 0,
    val rejected: Int = 0,
    val avgScore: Float = 0f,
)
