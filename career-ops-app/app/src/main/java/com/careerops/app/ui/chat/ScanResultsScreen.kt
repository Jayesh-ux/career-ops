package com.careerops.app.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ExitToApp
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.careerops.app.data.model.ScanResult
import android.content.Intent
import android.net.Uri
import java.net.URI

private enum class ScoreFilter(val label: String, val minScore: Float?) {
    TOP("Top 4.0+", 4.0f),
    GOOD("Good 3.0+", 3.0f),
    ALL("All", null)
}

private fun scoreOf(job: ScanResult): Float =
    job.score.removeSuffix("/5").toFloatOrNull() ?: -1f

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanResultsScreen(
    summary: String,
    jobs: List<ScanResult>,
    onBack: () -> Unit,
    onApply: (ScanResult) -> Unit,
    onDiscard: (ScanResult) -> Unit
) {
    val remaining = remember { mutableStateListOf(*jobs.toTypedArray()) }
    var filter by remember { mutableStateOf(ScoreFilter.ALL) }
    var query by remember { mutableStateOf("") }

    val shown = remember(remaining.size, filter, query) {
        val q = query.trim().lowercase()
        val minScore = filter.minScore
        remaining.filter { job ->
            val passesScore = minScore == null || scoreOf(job) >= minScore
            val passesQuery = q.isEmpty() ||
                job.company.lowercase().contains(q) ||
                job.role.lowercase().contains(q) ||
                job.location.lowercase().contains(q)
            passesScore && passesQuery
        }
    }
    val topMatches = remember(shown.size, filter) {
        if (filter == ScoreFilter.ALL) shown.filter { scoreOf(it) >= 4.0f } else emptyList()
    }
    val rest = remember(shown.size, topMatches.size) {
        shown.filter { job -> topMatches.none { it === job } }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Scan Results", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            "$summary  ·  ${remaining.size} jobs",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "${shown.size} of ${remaining.size} shown",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    TextButton(onClick = onBack) {
                        Text("Back to chat")
                    }
                }
            }
        }
    ) { paddingValues ->
        if (remaining.isEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(32.dp)
                    .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("No jobs left — you reviewed them all.", fontSize = 15.sp)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "Applied or discarded every opportunity from this scan. Run another scan to find more.",
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    for (f in ScoreFilter.entries) {
                        FilterChip(
                            selected = filter == f,
                            onClick = { filter = f },
                            label = { Text(f.label, fontSize = 12.sp) }
                        )
                    }
                }
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 2.dp),
                    placeholder = { Text("Search company, role, location…", fontSize = 13.sp) },
                    leadingIcon = { Icon(Icons.Filled.Search, contentDescription = "Search") },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant
                    ),
                    textStyle = MaterialTheme.typography.bodyMedium
                )

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(vertical = 12.dp)
                ) {
                    if (topMatches.isNotEmpty()) {
                        item(key = "top-matches-header") {
                            Text(
                                text = "⭐ Top matches (4.0+)",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.padding(top = 2.dp, bottom = 2.dp)
                            )
                        }
                        items(topMatches, key = { "top|${it.url.ifEmpty { "${it.company}|${it.role}" }}" }) { job ->
                            ScanResultRow(
                                job = job,
                                highlighted = true,
                                onApply = { onApply(job); remaining.remove(job) },
                                onDiscard = { onDiscard(job); remaining.remove(job) }
                            )
                        }
                    }
                    if (rest.isNotEmpty()) {
                        if (topMatches.isNotEmpty()) {
                            item(key = "rest-header") {
                                Text(
                                    text = "More opportunities",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.padding(top = 8.dp, bottom = 2.dp)
                                )
                            }
                        }
                        items(rest, key = { it.url.ifEmpty { "${it.company}|${it.role}" } }) { job ->
                            ScanResultRow(
                                job = job,
                                highlighted = false,
                                onApply = { onApply(job); remaining.remove(job) },
                                onDiscard = { onDiscard(job); remaining.remove(job) }
                            )
                        }
                    }
                    if (shown.isEmpty() && remaining.isNotEmpty()) {
                        item(key = "no-filter-match") {
                            Text(
                                text = "No roles match this filter/search. Try 'All' or clear the search.",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 16.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ScanResultRow(
    job: ScanResult,
    highlighted: Boolean,
    onApply: () -> Unit,
    onDiscard: () -> Unit
) {
    val scoreNum = scoreOf(job)
    val scoreColor = when {
        scoreNum >= 4.0f -> Color(0xFF4CAF50)
        scoreNum >= 3.0f -> Color(0xFFFFB74D)
        scoreNum >= 0f -> Color(0xFFEF5350)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = if (highlighted) 3.dp else 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (highlighted) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.35f)
            else MaterialTheme.colorScheme.surfaceContainerHigh
        )
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = job.company,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(3.dp))
                    Text(
                        text = job.role,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (job.score.isNotEmpty() && job.score != "N/A") {
                    Spacer(modifier = Modifier.width(10.dp))
                    Surface(
                        color = scoreColor.copy(alpha = 0.18f),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = job.score,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = scoreColor,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }
                }
            }

            if (job.location.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = job.location,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            val host = runCatching { URI(job.url).host?.removePrefix("www.") }.getOrNull()
            if (host != null && host.isNotEmpty()) {
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = host,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Spacer(modifier = Modifier.height(10.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = onApply,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Apply", fontSize = 13.sp)
                }
                OutlinedButton(
                    onClick = onDiscard,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Discard", fontSize = 13.sp)
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            if (job.url.isNotBlank()) {
                val context = LocalContext.current
                OutlinedButton(
                    onClick = {
                        runCatching {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(job.url)))
                        }
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.ExitToApp, null, modifier = Modifier.size(14.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Open job posting", fontSize = 13.sp)
                }
            }
        }
    }
}
