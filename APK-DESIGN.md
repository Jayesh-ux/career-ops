# Career-Ops Android APK — Build Prompt for Claude

> Copy this entire document and paste to Claude to build the APK.

---

## Build a Complete Android Job Search App

**Package:** `io.careerops.client`
**Min SDK:** 26 | **Target SDK:** 34
**Language:** Kotlin | **UI:** Jetpack Compose + Material 3
**Architecture:** MVVM + Clean Architecture

---

### 1. Core Architecture

The app wraps an existing Node.js job-search automation engine (career-ops) into a mobile UI. Two runtime modes:

**Mode A — Embedded (Recommended for first build):**
- App bundles a Node.js runtime via [Termux](https://github.com/termux/termux-app) JNI bridge
- All `.mjs` scripts run locally on-device
- SMTP/IMAP connections go direct from the phone

**Mode B — Server Mode (Fallback):**
- Career-ops runs on a laptop/desktop, exposes a local REST API
- Android app connects via WiFi/USB

**For Claude: Implement Mode B first (simpler), then Mode A.**

---

### 2. Data Models

```kotlin
// Application.kt
data class AppPreferences(
  val targetRoles: List<String> = listOf("Full Stack Developer", "Software Engineer"),
  val locations: List<String> = listOf("Mumbai", "Navi Mumbai", "Thane", "Remote"),
  val excludedLocations: List<String> = listOf("Pune", "Bangalore"),
  val salaryMin: Int = 300000,
  val salaryMax: Int = 800000,
  val titleKeywords: List<String> = listOf("React", "Node.js", "Full Stack", "Web Developer"),
  val spendTier: String = "standard", // economy | standard | premium
  val outputLanguage: String = "en",
  val modesDir: String = "modes/"
)

// Application.kt
data class JobApplication(
  val id: Int,
  val date: String, // YYYY-MM-DD
  val company: String,
  val role: String,
  val location: String,
  val status: ApplicationStatus,
  val score: String, // "N/A" or "X.X/5"
  val contactEmail: String,
  val notes: String,
  val timeline: List<TimelineEvent> = emptyList()
)

enum class ApplicationStatus {
  EVALUATED, APPLIED, RESPONDED, INTERVIEW, OFFER, REJECTED, DISCARDED, SKIP
}

data class TimelineEvent(
  val timestamp: Long,
  val event: String,
  val detail: String
)

// EmailMessage.kt
data class EmailMessage(
  val id: Int,
  val from: String,
  val fromEmail: String,
  val subject: String,
  val date: String,
  val preview: String,
  val isJobRelated: Boolean = false
)

// ScanResult.kt
data class ScanResult(
  val company: String,
  val role: String,
  val location: String,
  val url: String,
  val matched: Boolean,
  val reason: String = ""
)
```

---

### 3. Screens Implementation

#### Screen 1: Onboarding / Profile Setup

```kotlin
@Composable
fun OnboardingScreen(
  viewModel: OnboardingViewModel,
  onComplete: () -> Unit
) {
  var step by remember { mutableIntStateOf(0) }
  val steps = listOf("Resume", "Profile", "Locations", "Keywords", "Email")

  Scaffold(topBar = { LinearProgressIndicator(progress = step / 5f) }) { padding ->
    Column(Modifier.padding(padding).padding(24.dp)) {
      when (step) {
        0 -> ResumeUploadStep(viewModel.resumeFile, viewModel::setResumeFile)
        1 -> ProfileStep(viewModel.name, viewModel::setName,
                         viewModel.email, viewModel::setEmail,
                         viewModel.phone, viewModel::setPhone,
                         viewModel.portfolio, viewModel::setPortfolio,
                         viewModel.linkedin, viewModel::setLinkedin)
        2 -> LocationStep(viewModel.selectedLocations, viewModel::toggleLocation,
                          viewModel.excludedLocations, viewModel::toggleExcluded)
        3 -> KeywordStep(viewModel.keywords, viewModel::addKeyword, viewModel::removeKeyword)
        4 -> EmailSetupStep(viewModel.gmailUser, viewModel::setGmailUser,
                            viewModel.appPassword, viewModel::setAppPassword,
                            viewModel.claudeKey, viewModel::setClaudeKey)
      }
      Spacer(Modifier.weight(1f))
      Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
      ) {
        if (step > 0) Button(onClick = { step-- }) { Text("Back") }
        Spacer(Modifier.weight(1f))
        Button(onClick = {
          if (step < 4) step++
          else { viewModel.saveProfile(); onComplete() }
        }) { Text(if (step < 4) "Next" else "Start Job Search") }
      }
    }
  }
}
```

#### Screen 2: Dashboard (Home)

```
┌──────────────────────────────────┐
│  12:30  Wed 15 Jul               │
│                                  │
│  ┌─ Welcome back, Jayesh ──────┐│
│  │  📄 Resume: cv-jayesh.pdf   ││
│  │  📍 Mumbai · Thane · Remote ││
│  │  🎯 Full Stack Developer    ││
│  └──────────────────────────────┘│
│                                  │
│  ┌─── Stats ───────────────────┐│
│  │  ┌─────┐ ┌─────┐ ┌───────┐ ││
│  │  │  78 │ │  3  │ │   5   │ ││
│  │  │Apps │ │Active│ │Replies│ ││
│  │  └─────┘ └─────┘ └───────┘ ││
│  └──────────────────────────────┘│
│                                  │
│  Action Buttons:                 │
│  ┌──────────┐ ┌──────────┐      │
│  │ 🎯 Apply │ │ 📋 Scan  │      │
│  │  Now     │ │ Portals  │      │
│  └──────────┘ └──────────┘      │
│  ┌──────────┐ ┌──────────┐      │
│  │ 📬 Inbox │ │ 📊 Stats │      │
│  └──────────┘ └──────────┘      │
│                                  │
│  ── Recent Activity ───────────  │
│  ✅ 10:15 Sent to Cybotrix       │
│  ✅ 10:14 Sent to AutomateBuddy  │
│  💬 #70 DP Info → Discarded      │
│  💬 #47 1Accord → Reply sent     │
│                                  │
│  Bottom Nav: [Home] [Apps] [Inbox]│
│              [Scan] [Profile]     │
└──────────────────────────────────┘
```

#### Screen 3: Quick Apply

```kotlin
@Composable
fun QuickApplyScreen(
  viewModel: QuickApplyViewModel,
  onBack: () -> Unit,
  onSent: (Int) -> Unit
) {
  var company by remember { mutableStateOf("") }
  var role by remember { mutableStateOf("") }
  var email by remember { mutableStateOf("") }
  var location by remember { mutableStateOf("") }
  var salary by remember { mutableStateOf("") }
  var bodyTemplate by remember { mutableStateOf("standard") }

  Column(Modifier.padding(24.dp)) {
    Text("Quick Apply", style = MaterialTheme.typography.headlineMedium)
    Spacer(16.dp)

    OutlinedTextField(company, { company = it }, label = "Company Name")
    OutlinedTextField(role, { role = it }, label = "Role")
    OutlinedTextField(email, { email = it }, label = "Contact Email")
    OutlinedTextField(location, { location = it }, label = "Location")
    OutlinedTextField(salary, { salary = it }, label = "Salary / Notes")

    Spacer(8.dp)
    Text("Cover Letter Template:", style = MaterialTheme.typography.labelMedium)
    Row {
      listOf("Standard", "React", "Node").forEach { t ->
        FilterChip(selected = bodyTemplate == t.lowercase(),
                   onClick = { bodyTemplate = t.lowercase() },
                   label = { Text(t) })
        Spacer(4.dp)
      }
    }

    Spacer(24.dp)
    Button(onClick = {
      viewModel.sendApplication(company, role, email, bodyTemplate) { id ->
        onSent(id)
      }
    }, Modifier.fillMaxWidth(), enabled = company.isNotBlank() && email.isNotBlank()) {
      Text("Preview & Send")
    }
  }
}
```

#### Screen 4: Inbox

```kotlin
@Composable
fun InboxScreen(viewModel: InboxViewModel) {
  Column {
    Row(Modifier.padding(16.dp), verticalAlignment = CenterVertically) {
      Text("Inbox", style = MaterialTheme.typography.headlineMedium)
      Spacer(Modifier.weight(1f))
      IconButton(onClick = { viewModel.refresh() }) {
        Icon(Icons.Default.Refresh, "Refresh")
      }
      FilterChip(selected = viewModel.jobOnly, onClick = { viewModel.toggleFilter() },
                 label = { Text("Jobs Only") })
    }

    LazyColumn {
      items(viewModel.emails.filter { if (viewModel.jobOnly) it.isJobRelated else true }) { email ->
        SwipeToDismiss(
          background = { Box(Modifier.fillMaxSize().background(Color.Red).padding(16.dp)) { Text("Archive") } },
          dismissContent = {
            Card(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
              Row(Modifier.padding(16.dp)) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(
                  if (email.isJobRelated) Color(0xFFFF4444) else Color.Gray
                ))
                Spacer(8.dp)
                Column(Modifier.weight(1f)) {
                  Text(email.from, fontWeight = FontWeight.Bold)
                  Text(email.subject, maxLines = 1, overflow = Overflow.Ellipsis)
                  Text(email.preview, maxLines = 2, overflow = Overflow.Ellipsis,
                       style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                  Text(email.date, style = MaterialTheme.typography.labelSmall)
                }
                IconButton(onClick = { viewModel.classify(email.id) }) {
                  Icon(Icons.Default.MailOutline, "Classify")
                }
              }
            }
          }
        )
      }
    }
  }
}
```

#### Screen 5: Applications List + Detail

```kotlin
// Applications List
@Composable
fun AppListScreen(
  viewModel: AppListViewModel,
  onAppClick: (Int) -> Unit
) {
  Column {
    Row(Modifier.padding(16.dp)) {
      Text("Applications (${viewModel.applications.size})", style = MaterialTheme.typography.headlineMedium)
      Spacer(Modifier.weight(1f))
      // Filter dropdown
      var expanded by remember { mutableStateOf(false) }
      Box {
        OutlinedButton(onClick = { expanded = true }) {
          Text("Status ▼")
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
          listOf("All", "Applied", "Interview", "Rejected").forEach { s ->
            DropdownMenuItem(text = { Text(s) }, onClick = { viewModel.filterBy(s); expanded = false })
          }
        }
      }
    }
    LazyColumn {
      items(viewModel.filteredApps) { app ->
        ApplicationCard(app, onClick = { onAppClick(app.id) })
      }
    }
  }
}

@Composable
fun ApplicationCard(app: JobApplication, onClick: () -> Unit) {
  Card(Modifier.padding(8.dp).clickable(onClick = onClick)) {
    Row(Modifier.padding(16.dp)) {
      CircleColorIndicator(app.status) // 🟢 🔵 🔴 ⚪
      Spacer(8.dp)
      Column(Modifier.weight(1f)) {
        Text("${app.company}", fontWeight = FontWeight.Bold)
        Text(app.role, style = MaterialTheme.typography.bodyMedium)
        Text(app.location, style = MaterialTheme.typography.bodySmall, color = Gray)
        Row {
          Text("#${app.id}", style = MaterialTheme.typography.labelSmall)
          Spacer(8.dp)
          Text(app.date, style = MaterialTheme.typography.labelSmall)
        }
      }
      Column(horizontalAlignment = End) {
        StatusChip(app.status)
        Spacer(4.dp)
        Text(app.score, style = MaterialTheme.typography.labelSmall)
      }
    }
  }
}

// Application Detail
@Composable
fun AppDetailScreen(appId: Int, viewModel: AppDetailViewModel, onBack: () -> Unit) {
  val app = viewModel.application
  if (app == null) { Box(Modifier.fillMaxSize()) { CircularProgressIndicator() }; return }

  Scaffold(
    topBar = {
      TopAppBar(
        title = { Text(app.company) },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Default.ArrowBack, "Back") } }
      )
    }
  ) { padding ->
    Column(Modifier.padding(padding).padding(16.dp)) {
      // Status section
      Row(verticalAlignment = CenterVertically) {
        StatusChip(app.status, large = true)
        Spacer(Modifier.weight(1f))
        DropdownMenuButton("Update Status ▼", listOf("Applied", "Interview", "Rejected", "Offer")) { newStatus ->
          viewModel.updateStatus(newStatus)
        }
      }
      Divider(Modifier.padding(vertical = 8.dp))

      // Info section
      InfoRow("Role", app.role)
      InfoRow("Location", app.location)
      InfoRow("Contact", app.contactEmail)
      InfoRow("Salary", app.notes)

      Divider(Modifier.padding(vertical = 8.dp))

      // Timeline
      Text("Timeline", style = MaterialTheme.typography.titleSmall)
      LazyColumn {
        items(app.timeline.sortedByDescending { it.timestamp }) { event ->
          TimelineItem(event)
        }
      }

      Spacer(Modifier.weight(1f))

      // Action buttons
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
        Button(onClick = { viewModel.sendFollowUp() }) { Text("Follow Up") }
        OutlinedButton(onClick = { viewModel.deleteApp() }) {
          Text("Delete", color = Red)
        }
      }
    }
  }
}
```

#### Screen 6: Portal Scanner

```
┌──────────────────────────────────┐
│  ← Portal Scanner                │
│                                  │
│  ┌── Filters ──────────────────┐│
│  │ Title Keywords:              ││
│  │ [React] [Node.js] [Full Stack]││
│  │ [+] Add keyword              ││
│  │                              ││
│  │ Locations:                   ││
│  │ [Mumbai] [Thane] [Remote]    ││
│  │                              ││
│  │ Portals:                     ││
│  │ [✅ Greenhouse] [✅ Ashby]   ││
│  │ [✅ Lever] [✅ Web Search]  ││
│  └──────────────────────────────┘│
│                                  │
│  [  Start Scan  ]  [Auto-Apply] │
│                                  │
│  ── Results ───────────────────  │
│  Scanning... ████████░░ 67%      │
│                                  │
│  Found 5 new matches:           │
│  ☐ Acme Corp - Full Stack Dev   │
│     Mumbai · React+Node         │
│  ☐ TechCo - Jr. SDE             │
│     Remote · JavaScript         │
│  ☐ StartupX - Web Dev           │
│     Thane · PHP/Laravel         │
│  ☐ ...                          │
│                                  │
│  [Apply to Selected (3)]        │
└──────────────────────────────────┘
```

#### Screen 7: Statistics / Pipeline

```
┌──────────────────────────────────┐
│  📊 Pipeline Statistics          │
│                                  │
│  ── Funnel ──                   │
│  Evaluated        ██████░  78   │
│  Applied          █████░░  68   │
│  Responded        ██░░░░░  22   │
│  Interview        █░░░░░░  4    │
│  Offer            ░░░░░░░  0    │
│  Rejected         █░░░░░░  3    │
│                                  │
│  ── Today's Activity ──         │
│  2 sent, 0 replies              │
│                                  │
│  ── Top Companies ──            │
│  Follow-up due:                 │
│  • #20 Pluckk (3 days ago)       │
│  • #48 Infytrix (2 days ago)    │
│  • #21 The Fast Way (3 days ago)│
│                                  │
│  [  Generate Report  ]          │
└──────────────────────────────────┘
```

---

### 4. Networking & API Layer

```kotlin
// CareerOpsApi.kt — Retrofit interface to the Node.js engine
interface CareerOpsApi {

  // Email operations
  @POST("email/send")
  suspend fun sendEmail(@Body req: SendEmailRequest): SendEmailResponse

  @GET("email/inbox")
  suspend fun fetchInbox(): InboxResponse

  // Tracker operations
  @GET("tracker")
  suspend fun getTracker(): TrackerResponse

  @PUT("tracker/{id}/status")
  suspend fun updateStatus(@Path("id") id: Int, @Body req: StatusRequest): TrackerResponse

  @POST("tracker/add")
  suspend fun addApplication(@Body req: AddApplicationRequest): AddResponse

  // Scan operations
  @POST("scan")
  suspend fun scanPortals(@Body req: ScanRequest): ScanResponse

  // Profile
  @GET("profile")
  suspend fun getProfile(): ProfileResponse

  @PUT("profile")
  suspend fun updateProfile(@Body req: ProfileRequest): ProfileResponse
}

// Local fallback — same interface, runs scripts via Termux
class CareerOpsLocalApi(
  private val appContext: Context
) : CareerOpsApi {
  override suspend fun sendEmail(req: SendEmailRequest): SendEmailResponse {
    // Run: node send-batch.mjs user pass
    val process = Runtime.getRuntime().exec(arrayOf(
      "node", "${appContext.filesDir}/career-ops/send-batch.mjs",
      req.email, req.appPassword
    ))
    process.waitFor()
    return SendEmailResponse(success = process.exitValue() == 0)
  }

  override suspend fun fetchInbox(): InboxResponse {
    val process = Runtime.getRuntime().exec(arrayOf(
      "node", "${appContext.filesDir}/career-ops/check-inbox.mjs",
      // ... credentials from encrypted storage
    ))
    val output = process.inputStream.bufferedReader().readText()
    return parseInboxFromOutput(output)
  }

  override suspend fun scanPortals(req: ScanRequest): ScanResponse {
    val process = Runtime.getRuntime().exec(arrayOf(
      "node", "${appContext.filesDir}/career-ops/scan.mjs",
      req.keywords.joinToString(","),
      "--location", req.locations.joinToString(",")
    ))
    return parseScanOutput(process.inputStream.bufferedReader().readText())
  }

  // ... other endpoints
}

// Repository combining both
class ApplicationRepository(
  private val api: CareerOpsApi, // remote or local
  private val db: AppDatabase
) {
  val applications: Flow<List<JobApplication>> = db.applicationDao().getAll()

  suspend fun sendNewApplication(
    company: String, role: String, email: String,
    body: String, password: String
  ): Result<Int> {
    return try {
      val response = api.sendEmail(SendEmailRequest(email, password, company, role, body))
      if (response.success) {
        val id = db.applicationDao().insert(response.toEntity())
        Result.success(id.toInt())
      } else Result.failure(Exception(response.error))
    } catch (e: Exception) { Result.failure(e) }
  }
}
```

---

### 5. Background Workers

```kotlin
// InboxSyncWorker.kt
class InboxSyncWorker(
  ctx: Context, params: WorkerParameters
) : CoroutineWorker(ctx, params) {

  override suspend fun doWork(): Result {
    val api = CareerOpsLocalApi(applicationContext)
    return try {
      val inbox = api.fetchInbox()
      val db = AppDatabase.getInstance(applicationContext)

      // Use Claude API to classify emails
      val classified = classifyWithClaude(inbox, apiKey)

      db.emailDao().insertAll(classified.map { it.toEntity() })

      // Auto-update tracker for replies
      classified.filter { it.isJobRelated }.forEach { msg ->
        val matchedApp = db.applicationDao().findByEmail(msg.fromEmail)
        if (matchedApp != null) {
          when {
            msg.subject.contains("interview", true) ||
            msg.subject.contains("meeting", true) ||
            msg.body.contains("schedule", true) ->
              db.applicationDao().updateStatus(matchedApp.id, "Interview")
            msg.subject.contains("reject", true) ||
            msg.body.contains("unfortunately", true) ->
              db.applicationDao().updateStatus(matchedApp.id, "Rejected")
          }
        }
      }
      Result.success()
    } catch (e: Exception) { Result.retry() }
  }

  private suspend fun classifyWithClaude(
    emails: List<RawEmail>, apiKey: String
  ): List<ClassifiedEmail> {
    // Call Claude API to classify each email
    val prompt = """Classify each email as JOB_REPLY, JOB_ALERT, or SPAM.
                   |A job reply is a person responding to a job application.
                   |Return JSON array: [{"id":N, "classification":"...", "confidence":0.0}]
                   |Emails: ${emails.joinToString("\n") { "${it.id}: ${it.subject}" }}""".trimMargin()

    val response = httpClient.post("https://api.anthropic.com/v1/messages") {
      header("x-api-key", apiKey)
      header("anthropic-version", "2023-06-01")
      jsonBody = buildJsonObject {
        put("model", "claude-sonnet-4-20250514")
        put("max_tokens", 1024)
        put("messages", buildJsonArray {
          addJsonObject {
            put("role", "user")
            put("content", prompt)
          }
        })
      }
    }
    return parseClassification(response.body.toString())
  }
}
```

---

### 6. Claude API Integration

```kotlin
// ClaudeService.kt
class ClaudeService(private val apiKey: String) {

  private val client = HttpClient(OkHttp) {
    install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
  }

  suspend fun classifyEmail(email: EmailMessage): ClassificationResult {
    val response = client.post("https://api.anthropic.com/v1/messages") {
      header("x-api-key", apiKey)
      header("anthropic-version", "2023-06-01")
      contentType(ContentType.Application.Json)
      setBody(ClaudeRequest(
        model = "claude-sonnet-4-20250514",
        maxTokens = 256,
        system = "You are a job-search email classifier. Classify each email as: " +
                 "job_reply (someone responding to an application), " +
                 "job_alert (automated job recommendation), " +
                 "spam (promotions, banking, social media). " +
                 "Return JSON: {classification: string, confidence: float, reason: string}",
        messages = listOf(Message("user", """Classify this email:
          |From: ${email.from} <${email.fromEmail}>
          |Subject: ${email.subject}
          |Preview: ${email.preview}""".trimMargin()))
      ))
    }
    return response.body<ClaudeResponse>().toClassification()
  }

  suspend fun generateCoverLetter(
    company: String, role: String,
    resume: String, jd: String
  ): String {
    val response = client.post("https://api.anthropic.com/v1/messages") {
      header("x-api-key", apiKey)
      setBody(ClaudeRequest(
        model = "claude-sonnet-4-20250514",
        maxTokens = 1024,
        system = "Write concise, tailored job application emails. " +
                 "The candidate is Jayesh Singh, a Full Stack Developer. " +
                 "Never invent claims. Reorder and emphasize existing experience.",
        messages = listOf(Message("user",
          """
          |RESUME:
          |$resume
          |
          |JOB: $role at $company
          |
          |Write a professional application email body (3-4 paragraphs)
          |with: introduction, relevant highlights, why this role, closing.
        """.trimMargin()))
      ))
    }
    return response.body<ClaudeResponse>().content.first().text
  }

  suspend fun extractJobDetails(rawText: String): ExtractedJob {
    val response = client.post("https://api.anthropic.com/v1/messages") {
      header("x-api-key", apiKey)
      setBody(ClaudeRequest(
        model = "claude-sonnet-4-20250514",
        maxTokens = 512,
        messages = listOf(Message("user",
          """
          |Extract structured data from this job description.
          |Return JSON: {company, role, location, salary, skills:[], contactEmail, isRemote}
          |
          |JD:
          |$rawText
        """.trimMargin()))
      ))
    }
    return Json.decodeFromString(response.body<ClaudeResponse>().content.first().text)
  }
}

// Models
@Serializable
data class ClaudeRequest(
  val model: String,
  @SerialName("max_tokens") val maxTokens: Int,
  val system: String? = null,
  val messages: List<Message>
)

@Serializable
data class Message(val role: String, val content: String)

@Serializable
data class ClaudeResponse(
  val id: String,
  val content: List<ContentBlock>,
  val model: String,
  val usage: Usage
)

@Serializable
data class ContentBlock(val type: String, val text: String)
@Serializable
data class Usage(@SerialName("input_tokens") val input: Int, @SerialName("output_tokens") val output: Int)
```

---

### 7. Email Sending (Direct SMTP from Android)

```kotlin
// EmailSender.kt — Port of career-ops TLS SMTP sender to Kotlin
class EmailSender(private val userEmail: String, private val appPassword: String) {

  suspend fun send(to: String, subject: String, body: String, pdfPath: String?): Boolean {
    return withContext(Dispatchers.IO) {
      try {
        val socket = SSLSocketFactory.getDefault().createSocket("smtp.gmail.com", 465) as SSLSocket
        socket.soTimeout = 15000

        val writer = BufferedWriter(OutputStreamWriter(socket.outputStream))
        val reader = BufferedReader(InputStreamReader(socket.inputStream))

        fun read(code: String): Boolean {
          val line = reader.readLine() ?: return false
          return line.startsWith(code)
        }
        fun send(cmd: String) { writer.write("$cmd\r\n"); writer.flush() }

        read("220")                    // SMTP greeting
        send("EHLO career-ops-app")
        read("250")                    // EHLO response
        send("AUTH LOGIN")
        read("334")                    // Username prompt
        send(Base64.encodeToString(userEmail.toByteArray(), Base64.NO_WRAP))
        read("334")                    // Password prompt
        send(Base64.encodeToString(appPassword.toByteArray(), Base64.NO_WRAP))
        read("235")                    // Auth success
        send("MAIL FROM:<$userEmail>")
        read("250")
        send("RCPT TO:<$to>")
        read("250")
        send("DATA")
        read("354")                    // Start input

        val boundary = "==boundary_${System.currentTimeMillis()}=="
        writer.write("From: Jayesh Singh <$userEmail>\r\n")
        writer.write("To: $to\r\n")
        writer.write("Subject: =?UTF-8?Q?${encodeSubject(subject)}?=\r\n")
        writer.write("MIME-Version: 1.0\r\n")
        writer.write("Content-Type: multipart/mixed; boundary=\"$boundary\"\r\n")
        writer.write("\r\n")
        writer.write("--$boundary\r\n")
        writer.write("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
        writer.write(body)
        writer.write("\r\n\r\n")

        if (pdfPath != null) {
          val pdfBytes = File(pdfPath).readBytes()
          writer.write("--$boundary\r\n")
          writer.write("Content-Type: application/pdf\r\n")
          writer.write("Content-Disposition: attachment; filename=\"Jayesh_Singh_CV.pdf\"\r\n")
          writer.write("Content-Transfer-Encoding: base64\r\n\r\n")
          val b64 = Base64.encodeToString(pdfBytes, Base64.NO_WRAP)
          b64.chunked(76).forEach { writer.write("$it\r\n") }
          writer.write("\r\n")
        }

        writer.write("--$boundary--\r\n")
        writer.write("\r\n.\r\n")
        writer.flush()
        read("250")                    // Email accepted
        send("QUIT")
        socket.close()
        true
      } catch (e: Exception) {
        Log.e("EmailSender", "Failed: ${e.message}")
        false
      }
    }
  }

  private fun encodeSubject(s: String): String {
    return s.map { c ->
      if (c.code > 127 || c == '=' || c == '?' || c == '_')
        "=${c.code.toString(16).uppercase().padStart(2, '0')}"
      else c.toString()
    }.joinToString("")
  }
}
```

---

### 8. Complete Screen Flow & Navigation

```kotlin
// NavGraph.kt
@Composable
fun CareerOpsNavGraph(navController: NavHostController) {
  NavHost(navController, startDestination = if (isOnboarded) "dashboard" else "onboarding") {

    composable("onboarding") {
      OnboardingScreen(
        viewModel = koinViewModel(),
        onComplete = { navController.navigate("dashboard") { popUpTo("onboarding") { inclusive = true } } }
      )
    }

    composable("dashboard") { DashboardScreen(viewModel = koinViewModel()) }
    composable("applications") { AppListScreen(viewModel = koinViewModel()) { id ->
      navController.navigate("application/$id")
    }}
    composable("application/{id}", arguments = listOf(navArgument("id") { type = NavType.IntType })) {
      AppDetailScreen(appId = it.arguments?.getInt("id") ?: 0, viewModel = koinViewModel())
    }
    composable("inbox") { InboxScreen(viewModel = koinViewModel()) }
    composable("scan") { ScanScreen(viewModel = koinViewModel()) }
    composable("quick-apply") { QuickApplyScreen(viewModel = koinViewModel()) { id ->
      navController.navigate("application/$id")
    }}
    composable("stats") { StatsScreen(viewModel = koinViewModel()) }
    composable("profile") { ProfileScreen(viewModel = koinViewModel()) }
  }
}

// Main scaffold with bottom nav
@Composable
fun MainScreen() {
  val navController = rememberNavController()
  val items = listOf(
    BottomNavItem("Home", Icons.Default.Home, "dashboard"),
    BottomNavItem("Apps", Icons.Default.List, "applications"),
    BottomNavItem("Inbox", Icons.Default.Email, "inbox"),
    BottomNavItem("Scan", Icons.Default.Search, "scan"),
    BottomNavItem("Profile", Icons.Default.Person, "profile"),
  )

  Scaffold(
    bottomBar = {
      NavigationBar {
        val currentRoute = currentRoute(navController)
        items.forEach { item ->
          NavigationBarItem(
            icon = { Icon(item.icon, item.label) },
            label = { Text(item.label) },
            selected = currentRoute == item.route,
            onClick = {
              if (currentRoute != item.route)
                navController.navigate(item.route) {
                  popUpTo(navController.graph.startDestinationId) { saveState = true }
                  launchSingleTop = true
                  restoreState = true
                }
            }
          )
        }
      }
    }
  ) { padding ->
    Box(Modifier.padding(padding)) {
      CareerOpsNavGraph(navController)
    }
  }
}
```

---

### 9. Firebase Cloud Messaging (Optional)

```kotlin
// For notifying user when inbox has new replies
class CareerOpsMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    // Show notification: "New reply from {company}"
    message.notification?.let {
      val channel = NotificationChannel("jobs", "Job Replies", IMPORTANCE_HIGH)
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)

      val notification = NotificationCompat.Builder(this, "jobs")
        .setContentTitle(it.title)
        .setContentText(it.body)
        .setSmallIcon(R.drawable.ic_notification)
        .setAutoCancel(true)
        .build()

      NotificationManagerCompat.from(this).notify(System.currentTimeMillis().toInt(), notification)
    }
  }
}
```

---

### 10. AndroidManifest.xml Permissions & Services

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
  <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />

  <application ...>
    <service android:name=".service.InboxSyncService"
             android:foregroundServiceType="dataSync" />
    <receiver android:name=".receiver.BootReceiver"
              android:enabled="true">
      <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
      </intent-filter>
    </receiver>
  </application>
</manifest>
```

---

### 11. Build Configuration

```kotlin
// build.gradle.kts (app)
plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("com.google.devtools.ksp")
  id("com.google.dagger.hilt.android")
}

android {
  namespace = "io.careerops.client"
  compileSdk = 34

  defaultConfig {
    applicationId = "io.careerops.client"
    minSdk = 26
    targetSdk = 34
    versionCode = 1
    versionName = "1.0"
  }

  buildFeatures { compose = true }
  composeOptions { kotlinCompilerExtensionVersion = "1.5.8" }
}

dependencies {
  // Compose BOM
  val composeBom = platform("androidx.compose:compose-bom:2024.02.00")
  implementation(composeBom)
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.activity:activity-compose:1.8.2")
  implementation("androidx.navigation:navigation-compose:2.7.7")

  // Lifecycle
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.7.0")
  implementation("androidx.lifecycle:lifecycle-runtime-compose:2.7.0")

  // Room
  implementation("androidx.room:room-runtime:2.6.1")
  implementation("androidx.room:room-ktx:2.6.1")
  ksp("androidx.room:room-compiler:2.6.1")

  // Networking
  implementation("com.squareup.retrofit2:retrofit:2.9.0")
  implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.9.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")

  // DI
  implementation("com.google.dagger:hilt-android:2.50")
  ksp("com.google.dagger:hilt-compiler:2.50")

  // WorkManager
  implementation("androidx.work:work-runtime-ktx:2.9.0")

  // Firebase
  implementation(platform("com.google.firebase:firebase-bom:32.7.0"))
  implementation("com.google.firebase:firebase-messaging-ktx")

  // Serialization
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")
}
```

---

### 12. How to Build & Package

```bash
# Prerequisites: Android Studio Hedgehog+, JDK 17

# Clone this prompt's implementation
# Android Studio → New Project → Import from version control
# Paste this design, Claude generates the code

# Build APK
./gradlew assembleDebug
# APK at: app/build/outputs/apk/debug/app-debug.apk

# Build Release
./gradlew assembleRelease
# Sign with keystore
jarsigner -keystore my-release-key.jks \
  app/build/outputs/apk/release/app-release-unsigned.apk alias_name
zipalign -v 4 app-release-unsigned.apk career-ops.apk
```

---

### 13. Key UX Principles Applied

1. **Minimal taps to take action** — Dashboard has all primary actions (Apply, Scan, Inbox) one tap away
2. **Status at a glance** — Color-coded status indicators (🟢 Interview, 🔵 Applied, 🔴 Rejected)
3. **Progressive onboarding** — Step-by-step setup, never more than 5 fields per screen
4. **Background intelligence** — Workers scan inbox periodically; Claude classifies replies automatically
5. **Offline-first** — Room DB caches tracker; syncs when online
6. **Security** — App password stored in EncryptedSharedPreferences, never logged
7. **TUI wrapper** — Bottom navigation mirrors a terminal workflow: Find → Apply → Track → Follow Up

---

### 14. Project Structure

```
career-ops-app/
├── app/
│   ├── src/main/
│   │   ├── java/io/careerops/client/
│   │   │   ├── CareerOpsApp.kt
│   │   │   ├── MainActivity.kt
│   │   │   ├── navigation/
│   │   │   ├── ui/
│   │   │   │   ├── onboarding/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── applications/
│   │   │   │   ├── inbox/
│   │   │   │   ├── scan/
│   │   │   │   ├── stats/
│   │   │   │   └── profile/
│   │   │   ├── data/
│   │   │   │   ├── local/
│   │   │   │   ├── remote/
│   │   │   │   └── repository/
│   │   │   ├── domain/
│   │   │   │   ├── model/
│   │   │   │   └── usecase/
│   │   │   ├── service/
│   │   │   ├── worker/
│   │   │   └── di/
│   │   ├── res/
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── build.gradle.kts
├── settings.gradle.kts
└── gradle.properties
```

---

> **END OF PROMPT** — Copy everything above and paste to Claude to build the APK.
> The Claude API key goes in `ClaudeService.kt` — add a settings screen for it.
> For the first version, use Server Mode (Mode B) — run career-ops on a laptop and point the app at it.

---

### Quick Start for Building

```
1. Open Android Studio
2. Create new project → "Empty Compose Activity"
3. Replace all files with Claude's generated code from this prompt
4. Add CLAUDE_API_KEY in local.properties (optional, for auto-classify)
5. Build: ./gradlew assembleDebug
6. Share APK from app/build/outputs/apk/debug/
```
