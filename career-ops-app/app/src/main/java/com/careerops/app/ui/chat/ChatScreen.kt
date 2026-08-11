package com.careerops.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import android.content.Intent
import android.net.Uri

// One source of truth for quick actions. Playwright scraping is part of
// scanning jobs, so it is intentionally NOT a separate action here.
// The SCAN prompt is intentionally generic — scanning is profile-driven, so
// the server iterates the user's OWN target roles, never a hardcoded one.
private enum class QuickActionKind(val label: String, val prompt: String) {
    SCAN("Scan jobs", "scan"),
    INBOX("Check inbox", "check my inbox for new emails"),
    SPAM("Clean spam", "clean spam"),
    EVALUATE("Evaluate job", "evaluate this job: "),
    TRACKER("Show tracker", "show my applications tracker")
}

private fun quickActionIcon(action: QuickActionKind) = when (action) {
    QuickActionKind.SCAN -> Icons.Default.Search
    QuickActionKind.INBOX -> Icons.Default.Email
    QuickActionKind.SPAM -> Icons.Default.Delete
    QuickActionKind.EVALUATE -> Icons.Default.Star
    QuickActionKind.TRACKER -> Icons.Default.List
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    onNavigateToSettings: () -> Unit = {},
    onNavigateToDashboard: () -> Unit = {},
    onNavigateToApplications: () -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel()
) {
    val messages = viewModel.messages
    val isProcessing = viewModel.isProcessing
    val showDebug = viewModel.showDebug
    val debugLog = viewModel.debugLog
    val responseTimes = viewModel.responseTimes
    val streamingText by viewModel.streamingText.collectAsState()
    val progressText by viewModel.progressText.collectAsState()
    var inputText by remember { mutableStateOf("") }
    var showQueueDialog by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val debugListState = rememberLazyListState()
    val focusManager = LocalFocusManager.current

    // Auto-scroll to bottom when streaming text updates or new messages arrive
    LaunchedEffect(streamingText) {
        if (streamingText.isNotEmpty() && messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size)
        }
    }
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            kotlinx.coroutines.delay(100)
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    LaunchedEffect(debugLog.size) {
        if (debugLog.isNotEmpty()) {
            debugListState.animateScrollToItem(debugLog.size - 1)
        }
    }

    // Persist chat history when leaving the screen (background, navigation, etc.)
    DisposableEffect(Unit) {
        onDispose {
            viewModel.persistMessages()
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("career-ops", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text("AI Job Search Assistant", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                actions = {
                    IconButton(onClick = onNavigateToDashboard) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Home, contentDescription = "Home")
                            Text("Home", fontSize = 9.sp)
                        }
                    }
                    IconButton(onClick = onNavigateToApplications) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.List, contentDescription = "Jobs")
                            Text("Jobs", fontSize = 9.sp)
                        }
                    }
                    IconButton(onClick = { viewModel.toggleDebug() }) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Warning, contentDescription = "Debug", tint = MaterialTheme.colorScheme.onSurface)
                            Text("Debug", fontSize = 9.sp)
                        }
                    }
                    IconButton(onClick = { viewModel.resetSession() }) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Refresh, contentDescription = "Reset")
                            Text("Reset", fontSize = 9.sp)
                        }
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.Settings, contentDescription = "Settings")
                            Text("Settings", fontSize = 9.sp)
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                Column {
                    // Always-available quick actions — horizontally scrollable.
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Permanent "View Jobs" access — FIRST in the row so it is
                        // always on screen without horizontal scroll. Opens the
                        // live job list; appears once the first scan has run and
                        // never goes away, so no scrolling the chat to find it.
                        if (viewModel.hasScannedOnce) {
                            AssistChip(
                                onClick = { viewModel.openSuggestedJobs() },
                                label = {
                                    Text(
                                        text = "View Jobs (${viewModel.suggestedJobs.size})",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        Icons.Default.Search,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                },
                                shape = RoundedCornerShape(8.dp)
                            )
                        }
                        QuickActionKind.values().forEach { action ->
                            AssistChip(
                                onClick = { viewModel.sendMessage(action.prompt) },
                                label = { Text(action.label, fontSize = 12.sp) },
                                leadingIcon = {
                                    Icon(
                                        quickActionIcon(action),
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                },
                                shape = RoundedCornerShape(8.dp)
                            )
                        }
                    }
                    // Persistent HITL quick actions — always visible, never disappear.
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedButton(
                            onClick = { viewModel.stopProcessing() },
                            enabled = viewModel.canStop,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 2.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(Icons.Default.Close, null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Stop", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = { viewModel.retryLast() },
                            enabled = viewModel.canRetry,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 2.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(Icons.Default.Refresh, null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(if (viewModel.canResume) "Resume" else "Retry", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = { viewModel.editLastDraft() },
                            enabled = viewModel.hasLastDraft,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 2.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(Icons.Default.Edit, null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Edit", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = { showQueueDialog = true },
                            enabled = viewModel.hasQueued,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(vertical = 2.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(Icons.Default.List, null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                if (viewModel.queued.isEmpty()) "Queue" else "Queue (${viewModel.queued.size})",
                                fontSize = 12.sp
                            )
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                            .imePadding(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        modifier = Modifier.weight(1f),
                        placeholder = { Text("Paste a job URL, say 'scan', 'inbox', or ask anything...") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = {
                            if (inputText.isNotBlank() && !isProcessing) {
                                viewModel.sendMessage(inputText.trim())
                                inputText = ""
                                focusManager.clearFocus()
                            }
                        }),
                        singleLine = false,
                        maxLines = 4,
                        shape = RoundedCornerShape(24.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    FilledIconButton(
                        onClick = {
                            if (inputText.isNotBlank() && !isProcessing) {
                                viewModel.sendMessage(inputText.trim())
                                inputText = ""
                                focusManager.clearFocus()
                            }
                        },
                        enabled = inputText.isNotBlank() && !isProcessing
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                    }
                }
            }
        }
        }
    ) { paddingValues ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // Chat messages — fills remaining space between topBar and bottomBar
                LazyColumn(
                        state = listState,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(vertical = 12.dp)
                    ) {
                        items(messages, key = { it.id }) { message ->
                            when (message) {
                                is ChatMessage.User -> UserBubble(message)
                                is ChatMessage.System -> SystemBubble(message)
                                is ChatMessage.Typing -> TypingBubble(message)
                                is ChatMessage.ToolStatus -> ToolStatusBubble(message)
                                is ChatMessage.JobCard -> JobCardBubble(message)
                                 is ChatMessage.EmailDraft -> EmailDraftBubble(message)
                                 is ChatMessage.ReplyDraft -> ReplyDraftBubble(message)
                                is ChatMessage.Evaluation -> EvaluationCard(message)
                                is ChatMessage.BatchReviewCard -> BatchReviewCard(message)
                                is ChatMessage.ActivityLog -> ActivityLogCard(message)
                                 is ChatMessage.ProcessingCard -> ProcessingCard(message)
                                 is ChatMessage.ScanActions -> ScanActionsCard(message)
                                 is ChatMessage.ScanResultsCard -> ScanResultsSummaryCard(message)
                                 is ChatMessage.FormQuestion -> FormQuestionCard(message)
                                 is ChatMessage.SubmitConfirmation -> SubmitConfirmationCard(message)
                                is ChatMessage.ManualApplyCard -> ManualApplyCard(message)
                                is ChatMessage.WhatsAppApply -> WhatsAppApplyCard(message)
                                is ChatMessage.SpamConfirm -> SpamConfirmCard(message)
                                is ChatMessage.InboxNotificationCard -> InboxNotificationCard(message)
                            }
                        }
                        // Live-updating streaming bubble
                        if (streamingText.isNotEmpty()) {
                            item(key = "streaming") {
                                StreamingBubble(streamingText)
                            }
                        }
                        // Progress indicator — always show when processing, even alongside streaming
                        if (progressText.isNotEmpty()) {
                            item(key = "progress") {
                                ProgressBubble(progressText)
                            }
                        }
                    }

                // Debug panel (overlays on top of chat)
                AnimatedVisibility(
                    visible = showDebug,
                    modifier = Modifier.align(Alignment.TopCenter)
                ) {
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                            .heightIn(min = 100.dp, max = 220.dp),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surface,
                        shadowElevation = 8.dp
                    ) {
                        Column(modifier = Modifier.padding(8.dp)) {
                            Text(
                                "DEBUG",
                                color = MaterialTheme.colorScheme.onSurface,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            if (responseTimes.isNotEmpty()) {
                                val avgTime = viewModel.getAverageResponseTime()
                                val lastTime = viewModel.getLastResponseTime()
                                val successCount = responseTimes.count { it.success }
                                val failCount = responseTimes.count { !it.success }
                                Text(
                                    text = "Avg: ${avgTime}ms | Last: ${lastTime}ms | OK: $successCount | Fail: $failCount",
                                    color = MaterialTheme.colorScheme.onSurface,
                                    fontSize = 9.sp,
                                    fontFamily = FontFamily.Monospace
                                )
                            }
                            Spacer(modifier = Modifier.height(2.dp))
                            LazyColumn(
                                state = debugListState,
                                modifier = Modifier.fillMaxSize()
                            ) {
                                items(debugLog, key = { "${it.timestamp}-${it.tag}" }) { entry ->
                                    Text(
                                        text = entry.formatted(),
                                        color = when (entry.tag) {
                                            "error" -> MaterialTheme.colorScheme.error
                                            "warn" -> MaterialTheme.colorScheme.onSurface
                                            "response" -> MaterialTheme.colorScheme.onSurface
                                            "action" -> MaterialTheme.colorScheme.onSurface
                                            else -> MaterialTheme.colorScheme.onSurface
                                        },
                                        fontSize = 9.sp,
                                        fontFamily = FontFamily.Monospace,
                                        lineHeight = 12.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Pinned "View Jobs" button — re-opens the full job list in a modal
            // so you never have to scroll the chat back up to find it. Shown
            // permanently once the first scan runs (even when the list is empty,
            // so it never "goes away"); the list updates live — applying to a
            // company removes it instantly.
            if (viewModel.hasScannedOnce) {
                ExtendedFloatingActionButton(
                    onClick = { viewModel.openSuggestedJobs() },
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(16.dp),
                    icon = { Icon(Icons.Default.Search, contentDescription = null) },
                    text = {
                        Text(
                            text = "View Jobs (${viewModel.suggestedJobs.size})",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                )
            }
    }

    // Full-screen scan results list (all found jobs, apply/discard)
    val overlay = viewModel.scanResultsOverlay
    if (overlay != null) {
        ScanResultsScreen(
            summary = viewModel.scanResultsOverlaySummary(),
            jobs = overlay,
            onBack = { viewModel.closeScanResults() },
            onApply = { viewModel.applyFromScanResults(it) },
            onDiscard = { viewModel.discardFromScanResults(it) }
        )
    }

    // Pinned "View Jobs" screen — the live job list. Bound directly to
    // suggestedJobs state, so applying to or discarding a company removes it in
    // real time while the screen is open. Opened from the pinned FAB / chip and
    // from any scan's "View all" — never lives inside the chat, so there is no
    // scrolling to find it.
    if (viewModel.suggestedJobsOverlay) {
        JobsScreen(
            jobs = viewModel.suggestedJobs,
            onBack = { viewModel.closeSuggestedJobs() },
            onApply = { viewModel.applyFromSuggestedJobs(it) },
            onDiscard = { viewModel.discardFromScanResults(it) }
        )
    }

    // Draft editor — opened by the persistent "Edit" quick action or the
    // Edit button on any email/reply draft card.
    val editingDraftId = viewModel.editingDraftId
    if (editingDraftId != null) {
        AlertDialog(
            onDismissRequest = { viewModel.closeDraftEditor() },
            title = { Text("Edit Draft") },
            text = {
                Column {
                    Text("Edits apply to this draft. You still confirm before sending.", fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = viewModel.editingDraftText,
                        onValueChange = { viewModel.updateEditingDraftText(it) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 180.dp),
                        placeholder = { Text("Edit the email body...") },
                        maxLines = 15
                    )
                }
            },
            confirmButton = {
                Button(onClick = { viewModel.saveDraftEdit() }) {
                    Text("Save")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { viewModel.closeDraftEditor() }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Queue viewer — shows tasks queued while the agent was busy.
    if (showQueueDialog) {
        AlertDialog(
            onDismissRequest = { showQueueDialog = false },
            title = { Text("Queued Tasks") },
            text = {
                val queued = viewModel.queued
                if (queued.isEmpty()) {
                    Text("Nothing queued right now.")
                } else {
                    Column(
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        queued.forEachIndexed { index, task ->
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    text = "${index + 1}. $task",
                                    modifier = Modifier.padding(10.dp),
                                    fontSize = 13.sp
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        showQueueDialog = false
                        viewModel.clearQueue()
                    },
                    enabled = viewModel.hasQueued
                ) {
                    Text("Clear Queue")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { showQueueDialog = false }) {
                    Text("Close")
                }
            }
        )
    }
}
}

@Composable
fun UserBubble(message: ChatMessage.User) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth(0.85f)
        ) {
            SelectionContainer {
                Text(
                    text = message.text,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    fontSize = 15.sp
                )
            }
        }
    }
}

@Composable
fun SystemBubble(message: ChatMessage.System) {
    var expanded by remember { mutableStateOf(false) }
    val isLong = message.text.length > 3000
    val displayText = if (!expanded && isLong) message.text.take(3000) else message.text

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .heightIn(max = if (expanded) 2000.dp else 800.dp)
        ) {
            SelectionContainer {
                Column(
                    modifier = Modifier
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                ) {
                    // Parse and render markdown-like content
                val lines = displayText.split("\n")
                for (line in lines) {
                    val trimmed = line.trim()
                    when {
                        trimmed.startsWith("**") && trimmed.endsWith("**") -> {
                            Text(
                                text = trimmed.removeSurrounding("**"),
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)
                            )
                        }
                        trimmed.startsWith("•") || trimmed.startsWith("- ") || trimmed.startsWith("* ") -> {
                            val content = trimmed.dropWhile { it == '•' || it == '-' || it == '*' || it == ' ' }
                            Text(
                                text = "  \u2022 $content",
                                fontSize = 13.sp,
                                lineHeight = 18.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        trimmed.startsWith("# ") -> {
                            Text(
                                text = trimmed.removePrefix("# "),
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.padding(top = 6.dp, bottom = 3.dp)
                            )
                        }
                        trimmed.startsWith("## ") -> {
                            Text(
                                text = trimmed.removePrefix("## "),
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.padding(top = 5.dp, bottom = 2.dp)
                            )
                        }
                        trimmed.startsWith("|") -> {
                            // Table row — render in monospace
                            Text(
                                text = trimmed,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurface,
                                lineHeight = 14.sp
                            )
                        }
                        trimmed.isBlank() -> {
                            Spacer(modifier = Modifier.height(4.dp))
                        }
                        else -> {
                            val annotated = buildAnnotatedString {
                                var remaining = trimmed
                                while (remaining.isNotEmpty()) {
                                    val boldStart = remaining.indexOf("**")
                                    if (boldStart < 0) {
                                        append(remaining)
                                        break
                                    }
                                    if (boldStart > 0) append(remaining.substring(0, boldStart))
                                    val boldEnd = remaining.indexOf("**", boldStart + 2)
                                    if (boldEnd < 0) {
                                        append(remaining)
                                        break
                                    }
                                    val boldText = remaining.substring(boldStart + 2, boldEnd)
                                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(boldText) }
                                    remaining = remaining.substring(boldEnd + 2)
                                }
                            }
                            Text(
                                text = annotated,
                                fontSize = 13.sp,
                                lineHeight = 18.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }
                // Show more/less for long text
                if (isLong) {
                    Spacer(modifier = Modifier.height(8.dp))
                    TextButton(onClick = { expanded = !expanded }) {
                        Text(
                            if (expanded) "Show less" else "Show more (${message.text.length} chars)",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                }
                }
            }
        }
    }
}
@Composable
fun TypingBubble(message: ChatMessage.Typing) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(min = 140.dp, max = 280.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    message.label,
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2
                )
            }
        }
    }
}

@Composable
fun StreamingBubble(text: String) {
    SelectionContainer {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Start
        ) {
            Surface(
                shape = RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier
                    .fillMaxWidth(0.95f)
                    .heightIn(min = 48.dp, max = 600.dp)
            ) {
                Column(
                    modifier = Modifier
                        .verticalScroll(rememberScrollState())
                        .padding(12.dp)
                ) {
                    // Streaming indicator — live typing feel
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(10.dp), strokeWidth = 1.5.dp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            "Generating...",
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    // Live text content — render markdown-like
                    val lines = text.split("\n")
                    for (line in lines) {
                        val trimmed = line.trim()
                        when {
                            trimmed.startsWith("**") && trimmed.endsWith("**") -> {
                                Text(
                                    text = trimmed.removeSurrounding("**"),
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)
                                )
                            }
                            trimmed.startsWith("•") || trimmed.startsWith("- ") || trimmed.startsWith("* ") -> {
                                val content = trimmed.dropWhile { it == '•' || it == '-' || it == '*' || it == ' ' }
                                Text(
                                    text = "  • $content",
                                    fontSize = 13.sp,
                                    lineHeight = 18.sp,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                            trimmed.startsWith("# ") -> {
                                Text(
                                    text = trimmed.removePrefix("# "),
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.padding(top = 6.dp, bottom = 3.dp)
                                )
                            }
                            trimmed.isBlank() -> {
                                Spacer(modifier = Modifier.height(4.dp))
                            }
                            else -> {
                                Text(
                                    text = trimmed,
                                    fontSize = 13.sp,
                                    lineHeight = 18.sp,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ProgressBubble(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.7f),
            modifier = Modifier.widthIn(min = 160.dp, max = 320.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 1.5.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = text,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                    maxLines = 2
                )
            }
        }
    }
}

@Composable
fun JobCardBubble(message: ChatMessage.JobCard) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Person, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = message.company, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(text = message.role, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            
            if (message.score.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                AssistChip(onClick = {}, label = { Text(message.score, fontSize = 12.sp) })
            }
            
            if (message.location.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = message.location, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            if (message.url.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = message.url.replaceFirst("https://", "").replaceFirst("http://", "").take(70),
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { message.onApply?.invoke() }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Apply")
                }
                OpenJobUrlButton(url = message.url, modifier = Modifier.weight(1f))
                OutlinedButton(onClick = { message.onSkip?.invoke() }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Close, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Skip")
                }
            }
        }
    }
}

@Composable
fun EmailDraftBubble(message: ChatMessage.EmailDraft) {
    var showConfirm by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Email, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text("Draft: ${message.company} - ${message.role}", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("To: ${message.to}", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    if (message.subject.isNotEmpty()) {
                        Text("Subject: ${message.subject}", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = message.body,
                    modifier = Modifier.padding(12.dp),
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val sending = message.sending
                val sent = message.sent
                Button(
                    onClick = { if (!sending && !sent) showConfirm = true },
                    enabled = !sending && !sent,
                    modifier = Modifier.weight(1f)
                ) {
                    if (sending) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Sending...")
                    } else if (sent) {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Sent")
                    } else {
                        Icon(Icons.Default.Send, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Send")
                    }
                }
                OutlinedButton(
                    onClick = { message.onEdit?.invoke() },
                    enabled = !sending && !sent,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Edit, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Edit")
                }
            }
        }
    }

    // Confirmation dialog before sending
    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("Send Email?") },
            text = {
                Column {
                    Text("To: ${message.to}")
                    if (message.subject.isNotEmpty()) {
                        Text("Subject: ${message.subject}", fontSize = 12.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("This will send the email immediately. Continue?", fontSize = 13.sp)
                }
            },
            confirmButton = {
                Button(onClick = {
                    showConfirm = false
                    message.onSend?.invoke()
                }) {
                    Text("Send")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { showConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
fun ReplyDraftBubble(message: ChatMessage.ReplyDraft) {
    var showConfirm by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Email, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text("Reply (${message.replyType})", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("To: ${message.to}", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    if (message.subject.isNotEmpty()) {
                        Text("Subject: ${message.subject}", fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = message.body,
                    modifier = Modifier.padding(12.dp),
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )
            }

            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val sending = message.sending
                val sent = message.sent
                Button(
                    onClick = { if (!sending && !sent) showConfirm = true },
                    enabled = !sending && !sent,
                    modifier = Modifier.weight(1f)
                ) {
                    if (sending) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Sending...")
                    } else if (sent) {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Sent")
                    } else {
                        Icon(Icons.Default.Send, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Send")
                    }
                }
                OutlinedButton(
                    onClick = { message.onEdit?.invoke() },
                    enabled = !sending && !sent,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Edit, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Edit")
                }
            }
        }
    }

    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("Send Reply?") },
            text = {
                Column {
                    Text("To: ${message.to}")
                    if (message.subject.isNotEmpty()) {
                        Text("Subject: ${message.subject}", fontSize = 12.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("This will send the reply immediately. Continue?", fontSize = 13.sp)
                }
            },
            confirmButton = {
                Button(onClick = {
                    showConfirm = false
                    message.onSend?.invoke()
                }) {
                    Text("Send")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { showConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

// Opens a job posting URL in the system browser. Shared by the chat job card,
// the scan results rows and the suggested-jobs modal.
@Composable
fun OpenJobUrlButton(url: String, modifier: Modifier = Modifier) {
    if (url.isBlank()) return
    val context = LocalContext.current
    OutlinedButton(
        onClick = {
            runCatching {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
        },
        modifier = modifier
    ) {
        Icon(Icons.Default.ExitToApp, null, modifier = Modifier.size(14.dp))
        Spacer(modifier = Modifier.width(4.dp))
        Text("Open", fontSize = 13.sp)
    }
}

@Composable
fun InboxNotificationCard(message: ChatMessage.InboxNotificationCard) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.4f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Email, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (message.title.isNotEmpty()) message.title else message.type,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    if (message.date.isNotEmpty()) {
                        Text(text = message.date, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = message.message,
                fontSize = 13.sp,
                lineHeight = 18.sp
            )

            if (message.from.isNotEmpty() || message.fromEmail.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = buildString {
                        if (message.from.isNotEmpty()) append(message.from)
                        if (message.fromEmail.isNotEmpty()) append(if (message.from.isNotEmpty()) " <" else "<").append(message.fromEmail).append(">")
                    },
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (message.subject.isNotEmpty()) {
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = "Re: ${message.subject}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            if (message.onReply != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = { message.onReply?.invoke() },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Reply")
                }
            }
        }
    }
}

@Composable
fun FormQuestionCard(message: ChatMessage.FormQuestion) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = message.label.ifEmpty { "Question" },
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    if (message.required) {
                        Text(
                            "Required",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            }

            if (message.answered) {
                Spacer(modifier = Modifier.height(10.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "\u2713 ${message.answer}",
                        modifier = Modifier.padding(12.dp),
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            } else {
                if (message.hint.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = message.hint,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                if (message.options.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        message.options.forEach { option ->
                            OutlinedButton(
                                onClick = { message.onAnswer?.invoke(option) },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(option, fontSize = 13.sp)
                            }
                        }
                    }
                } else {
                    var text by remember { mutableStateOf("") }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = text,
                            onValueChange = { text = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Type your answer...") },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        FilledIconButton(
                            onClick = { message.onAnswer?.invoke(text) },
                            enabled = text.isNotBlank()
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Answer")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SubmitConfirmationCard(message: ChatMessage.SubmitConfirmation) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Send,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Form filled for ${message.company}",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "ATS: ${message.atsType} · ${message.fieldsFilled}/${message.fieldsTotal} fields · CV ${if (message.cvAttached) "attached" else "not attached"}",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "Ready to submit? The form is filled and your CV is attached. Submitting sends your application to the company.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { message.onSubmit?.invoke() },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Submit Application", fontSize = 13.sp)
                }
                OutlinedButton(
                    onClick = { message.onReview?.invoke() },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Review in Browser", fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
fun SpamConfirmCard(message: ChatMessage.SpamConfirm) {
    var showConfirm by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.35f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text(
                        text = "Delete ${message.count} spam email${if (message.count == 1) "" else "s"}?",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    Text(
                        text = "This permanently deletes them from your Gmail.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            if (message.senders.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "From:",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                message.senders.forEach { s ->
                    Text(
                        text = "\u2022 $s",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = { message.onCancel?.invoke() },
                    enabled = !message.deleting,
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Cancel")
                }
                Button(
                    onClick = { if (!message.deleting) showConfirm = true },
                    enabled = !message.deleting,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    if (message.deleting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Deleting...")
                    } else {
                        Icon(Icons.Default.Delete, null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Delete")
                    }
                }
            }
        }
    }

    if (showConfirm) {
        AlertDialog(
            onDismissRequest = { showConfirm = false },
            title = { Text("Delete Spam?") },
            text = { Text("This permanently deletes ${message.count} email${if (message.count == 1) "" else "s"} from your Gmail. This cannot be undone. Continue?") },
            confirmButton = {
                Button(onClick = {
                    showConfirm = false
                    message.onConfirm?.invoke()
                }) {
                    Text("Delete")
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { showConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

@Composable
fun ManualApplyCard(message: ChatMessage.ManualApplyCard) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.45f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "Manual apply — ${message.company}",
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Every automated method was tried and couldn't finish this application. Complete the form on the site. Open this link in your browser:",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = message.url,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.primary
            )
            val guide = message.guide
            if (guide != null) {
                if (guide.manual_apply_url.isNotBlank() && guide.manual_apply_url != message.url) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Direct apply link:",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = guide.manual_apply_url,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                if (guide.fields.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Fields to fill on the site:",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    guide.fields.take(12).forEach { f ->
                        val req = if (f.required == true) " *" else ""
                        val val_ = f.value.takeIf { it.isNotBlank() }?.let { " → $it" } ?: ""
                        Text(
                            text = "\u2022 ${f.field}$req$val_",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (guide.fields.size > 12) {
                        Text(
                            text = "... and ${guide.fields.size - 12} more",
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                if (guide.notes.isNotBlank()) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = guide.notes,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = { message.onMarkApplied?.invoke() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary
                )
            ) {
                Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("I applied manually — update tracker to Applied", fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun WhatsAppApplyCard(message: ChatMessage.WhatsAppApply) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.45f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "WhatsApp application — ${message.company}",
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "No contact email on this posting, but I found the recruiter on WhatsApp. Tap the number below — your application is already typed out, just hit send.",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "\uD83D\uDCDE ${message.phone}${if (message.role.isNotBlank()) " · ${message.role}" else ""}",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (message.url.isNotBlank()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = message.url,
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            if (message.message.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                SelectionContainer {
                    Text(
                        text = message.message.take(240) + if (message.message.length > 240) "…" else "",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            val context = LocalContext.current
            val targets = message.waTargets.ifEmpty {
                listOf(
                    ChatMessage.WhatsAppTarget(
                        label = message.phone,
                        digits = message.phone.replace(Regex("[^\\d]"), ""),
                        link = message.waLink
                    )
                )
            }
            targets.forEachIndexed { idx, t ->
                Button(
                    onClick = {
                        val uri = Uri.parse(t.link.ifBlank { "https://wa.me/" })
                        val intent = Intent(Intent.ACTION_VIEW, uri)
                        runCatching { context.startActivity(intent) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary
                    )
                ) {
                    Icon(Icons.Default.Phone, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = if (targets.size > 1) "Send to ${t.label}" else "Open WhatsApp with my application",
                        fontSize = 12.sp
                    )
                }
                if (idx < targets.size - 1) Spacer(modifier = Modifier.height(6.dp))
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = { message.onMarkApplied?.invoke() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("I sent it — update tracker to Applied", fontSize = 12.sp)
            }
        }
    }
}

@Composable
fun ToolStatusBubble(message: ChatMessage.ToolStatus) {    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp),
            color = MaterialTheme.colorScheme.tertiaryContainer,
            modifier = Modifier.fillMaxWidth(0.7f)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text(
                        text = message.label,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                    if (message.detail.isNotEmpty()) {
                        Text(
                            text = message.detail,
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.7f)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun EvaluationCard(message: ChatMessage.Evaluation) {
    Card(
        modifier = Modifier.fillMaxWidth(0.92f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Star,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    if (message.company.isNotEmpty()) {
                        Text(
                            text = message.company,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        )
                    }
                    if (message.role.isNotEmpty()) {
                        Text(
                            text = message.role,
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            
            if (message.score.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Score",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = message.score,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
            
            if (message.summary.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = message.summary,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
fun BatchReviewCard(message: ChatMessage.BatchReviewCard) {
    Card(
        modifier = Modifier.fillMaxWidth(0.94f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Star,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = message.company,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    if (message.role.isNotEmpty()) {
                        Text(
                            text = message.role,
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                if (message.reportNum > 0) {
                    Text(
                        text = "#${message.reportNum}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (message.score.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Score",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = message.score,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            if (message.fit.isNotEmpty()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = message.fit,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (message.strengths.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text("Strengths", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                message.strengths.take(3).forEach { s ->
                    Text(
                        text = "\u2022 $s",
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (message.gaps.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text("Gaps", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                message.gaps.take(3).forEach { g ->
                    Text(
                        text = "\u2022 $g",
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }

            if (message.contactPhones.isNotEmpty()) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = "\uD83D\uDCDE Recruiter: ${message.contactPhones.joinToString(", ")}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (message.onTailorCv != null || message.onApply != null || message.onDiscard != null) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(modifier = Modifier.fillMaxWidth()) {
                    message.onTailorCv?.let { onTailor ->
                        Button(
                            onClick = onTailor,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Tailor CV", fontSize = 12.sp)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    message.onApply?.let { onApply ->
                        Button(
                            onClick = onApply,
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            )
                        ) {
                            Text("Apply", fontSize = 12.sp)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                    }
                    message.onDiscard?.let { onDiscard ->
                        OutlinedButton(
                            onClick = onDiscard,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Discard", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun ActivityLogCard(message: ChatMessage.ActivityLog) {
    Card(
        modifier = Modifier.fillMaxWidth(0.95f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Title
            Text(
                text = message.title,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                color = MaterialTheme.colorScheme.onSurface
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Steps
            message.steps.forEach { step ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    // Icon
                    Text(
                        text = step.icon,
                        fontSize = 16.sp,
                        modifier = Modifier.width(28.dp)
                    )

                    // Step content
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = step.label,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            if (step.status == StepStatus.IN_PROGRESS) {
                                Spacer(modifier = Modifier.width(8.dp))
                                CircularProgressIndicator(
                                    modifier = Modifier.size(12.dp),
                                    strokeWidth = 1.5.dp,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                            if (step.status == StepStatus.DONE) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("✓", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                            }
                            if (step.status == StepStatus.FAILED) {
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("✗", fontSize = 12.sp, color = MaterialTheme.colorScheme.error)
                            }
                        }
                        if (step.detail.isNotEmpty()) {
                            Text(
                                text = step.detail,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 4.dp)
                            )
                        }
                    }
                }
            }

            // Summary
            if (message.summary.isNotEmpty()) {
                Spacer(modifier = Modifier.height(12.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = message.summary,
                        modifier = Modifier.padding(12.dp),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }
        }
    }
}

@Composable
fun ProcessingCard(message: ChatMessage.ProcessingCard) {
    val steps = message.workflowSteps
    val hasSteps = steps.isNotEmpty()

    // Determine header label: portal name > detail > step label
    val headerLabel = when {
        message.portalName.isNotEmpty() -> message.portalName
        hasSteps -> steps.firstOrNull { !it.done }?.label ?: "Processing..."
        else -> "Processing..."
    }

    Card(
        modifier = Modifier.fillMaxWidth(0.95f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header: spinner + step label + elapsed
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f, fill = false)) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = headerLabel,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (message.elapsed.isNotEmpty()) {
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = message.elapsed,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Live detail text — what's happening RIGHT NOW
            if (message.detail.isNotEmpty()) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = message.detail,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            // Workflow steps with checkmarks
            if (hasSteps) {
                Spacer(modifier = Modifier.height(10.dp))
                steps.forEachIndexed { index, step ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (step.done) {
                            Text("✓", fontSize = 13.sp, color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.width(18.dp))
                        } else if (index == steps.indexOfFirst { !it.done }) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(13.dp),
                                strokeWidth = 1.5.dp,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.width(2.5.dp))
                        } else {
                            Text("○", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.width(18.dp))
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = step.label,
                            fontSize = 12.sp,
                            color = if (step.done) MaterialTheme.colorScheme.onSurfaceVariant
                                    else MaterialTheme.colorScheme.onSurface,
                            fontWeight = if (!step.done && index == steps.indexOfFirst { !it.done })
                                FontWeight.Medium else FontWeight.Normal
                        )
                    }
                }
            }

            // Progress bar
            if (message.progress > 0f) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { message.progress },
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
            }
        }
    }
}

@Composable
fun ScanResultsSummaryCard(message: ChatMessage.ScanResultsCard) {
    Card(
        modifier = Modifier.fillMaxWidth(0.95f),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "🔍 ${message.summary}",
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurface
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "${message.results.size} opportunities to review · ${message.scanned} roles found",
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(10.dp))

            // Preview the top 3 matches so the user can see quality at a glance
            for (job in message.results.take(3)) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "• ${job.company} — ${job.role}",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (job.score.isNotEmpty() && job.score != "N/A") {
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = job.score,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }
            if (message.results.size > 3) {
                Spacer(modifier = Modifier.height(3.dp))
                Text(
                    text = "…and ${message.results.size - 3} more",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = { message.onViewAll?.invoke() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("View all ${message.results.size} jobs →", fontSize = 14.sp)
            }
        }
    }
}

@Composable
fun ScanActionsCard(message: ChatMessage.ScanActions) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        if (message.expandLocationLabel.isNotEmpty()) {
            OutlinedButton(
                onClick = { message.onExpandLocation?.invoke() },
                modifier = Modifier.fillMaxWidth(0.9f)
            ) {
                Text(message.expandLocationLabel, fontSize = 13.sp)
            }
        }
        if (message.tryKeywordsLabel.isNotEmpty()) {
            OutlinedButton(
                onClick = { message.onTryKeywords?.invoke() },
                modifier = Modifier.fillMaxWidth(0.9f)
            ) {
                Text(message.tryKeywordsLabel, fontSize = 13.sp)
            }
        }
        if (message.deepScanLabel.isNotEmpty()) {
            OutlinedButton(
                onClick = { message.onDeepScan?.invoke() },
                modifier = Modifier.fillMaxWidth(0.9f)
            ) {
                Text(message.deepScanLabel, fontSize = 13.sp)
            }
        }
    }
}
