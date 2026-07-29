package com.careerops.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
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
import androidx.hilt.navigation.compose.hiltViewModel

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

    Scaffold(
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
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        },
        bottomBar = {
            Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
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
    ) { paddingValues ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // Chat messages — fills remaining space between topBar and bottomBar
                SelectionContainer {
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
                                is ChatMessage.Evaluation -> EvaluationCard(message)
                                is ChatMessage.ActivityLog -> ActivityLogCard(message)
                                is ChatMessage.ProcessingCard -> ProcessingCard(message)
                            }
                        }
                        // Quick action cards for empty state
                        if (messages.size <= 1 && streamingText.isEmpty() && progressText.isEmpty()) {
                            item(key = "quick-actions") {
                                QuickActionCards(onAction = { text ->
                                    viewModel.sendMessage(text)
                                })
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
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.fillMaxWidth(0.85f)
        ) {
            Text(
                text = message.text,
                color = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                fontSize = 15.sp
            )
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
                            color = MaterialTheme.colorScheme.primary
                        )
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
                Text(text = message.location, fontSize = 12.sp, color = MaterialTheme.colorScheme.outline)
            }
            
            Spacer(modifier = Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { message.onApply?.invoke() }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Check, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Apply")
                }
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
                Button(onClick = { showConfirm = true }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Send, null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Send")
                }
                OutlinedButton(onClick = { message.onEdit?.invoke() }, modifier = Modifier.weight(1f)) {
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
fun ToolStatusBubble(message: ChatMessage.ToolStatus) {
    Row(
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
fun QuickActionCards(onAction: (String) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(
            text = "Quick actions",
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 4.dp, bottom = 2.dp)
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AssistChip(
                onClick = { onAction("scan for full stack developer jobs") },
                label = { Text("Scan jobs", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(16.dp))
                },
                modifier = Modifier.weight(1f)
            )
            AssistChip(
                onClick = { onAction("search more opportunities using Playwright") },
                label = { Text("Playwright search", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(16.dp))
                },
                modifier = Modifier.weight(1f)
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AssistChip(
                onClick = { onAction("check my inbox for new emails") },
                label = { Text("Check inbox", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(Icons.Default.Email, contentDescription = null, modifier = Modifier.size(16.dp))
                },
                modifier = Modifier.weight(1f)
            )
            AssistChip(
                onClick = { onAction("clean spam from my inbox") },
                label = { Text("Clean spam", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                },
                modifier = Modifier.weight(1f)
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            AssistChip(
                onClick = { onAction("evaluate this job: ") },
                label = { Text("Evaluate job", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(Icons.Default.Star, contentDescription = null, modifier = Modifier.size(16.dp))
                },
                modifier = Modifier.weight(1f)
            )
            AssistChip(
                onClick = { onAction("show my applications tracker") },
                label = { Text("Show tracker", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(Icons.Default.List, contentDescription = null, modifier = Modifier.size(16.dp))
                },
                modifier = Modifier.weight(1f)
            )
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
