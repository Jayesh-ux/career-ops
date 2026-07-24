package com.careerops.app.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
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

    // Auto-scroll when new messages arrive or streaming text updates
    LaunchedEffect(messages.size, streamingText.length, progressText.length) {
        if (messages.isNotEmpty() || streamingText.isNotEmpty() || progressText.isNotEmpty()) {
            listState.animateScrollToItem(
                if (streamingText.isNotEmpty() || progressText.isNotEmpty()) messages.size else messages.size - 1
            )
        }
    }

    LaunchedEffect(debugLog.size) {
        if (debugLog.isNotEmpty()) {
            debugListState.animateScrollToItem(debugLog.size - 1)
        }
    }

    Scaffold(
        contentWindowInsets = WindowInsets.systemBars,
        topBar = {
            TopAppBar(
                title = { Text("career-ops", fontWeight = FontWeight.Bold) },
                windowInsets = TopAppBarDefaults.windowInsets,
                actions = {
                    IconButton(onClick = onNavigateToDashboard) {
                        Icon(Icons.Default.Home, contentDescription = "Dashboard")
                    }
                    IconButton(onClick = onNavigateToApplications) {
                        Icon(Icons.Default.List, contentDescription = "Applications")
                    }
                    IconButton(onClick = { viewModel.toggleDebug() }) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = "Debug",
                            tint = if (showDebug) MaterialTheme.colorScheme.error
                                   else MaterialTheme.colorScheme.onSurface
                        )
                    }
                    IconButton(onClick = { viewModel.resetSession() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Reset")
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
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
                        placeholder = { Text("Ask me anything...") },
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
                // Chat messages (always fills full area)
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
                        }
                    }
                    // Live-updating streaming bubble
                    if (streamingText.isNotEmpty()) {
                        item(key = "streaming") {
                            StreamingBubble(streamingText)
                        }
                    }
                    // Progress indicator
                    if (progressText.isNotEmpty() && streamingText.isEmpty()) {
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
                        color = Color(0xFF1A1A2E),
                        shadowElevation = 8.dp
                    ) {
                        Column(modifier = Modifier.padding(8.dp)) {
                            Text(
                                "DEBUG",
                                color = Color(0xFF00FF41),
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
                                    color = Color(0xFF44AAFF),
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
                                            "error" -> Color(0xFFFF4444)
                                            "warn" -> Color(0xFFFFAA00)
                                            "response" -> Color(0xFF44AAFF)
                                            "action" -> Color(0xFFAA44FF)
                                            else -> Color(0xFF00FF41)
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
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.fillMaxWidth(0.9f)
        ) {
            Text(
                text = message.text,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                fontSize = 14.sp,
                lineHeight = 20.sp
            )
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
            modifier = Modifier.width(120.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(message.label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                modifier = Modifier.fillMaxWidth(0.92f)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    // Streaming indicator
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            "Streaming...",
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    // Live text content
                    Text(
                        text = text,
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
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
            shape = RoundedCornerShape(16.dp, 16.dp, 16.dp, 4.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
            modifier = Modifier.fillMaxWidth(0.5f)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 1.5.dp)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = text,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
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
                Button(onClick = { message.onSend?.invoke() }, modifier = Modifier.weight(1f)) {
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
