#!/usr/bin/env node
/**
 * scheduler.mjs — Daily job search pipeline for career-ops multi-user.
 *
 * Zero new dependencies. Uses setInterval + checkpoint persistence.
 * Designed to be started from bridge-server.mjs or standalone.
 *
 * Run-once-per-IST-day pipeline (Termux-friendly — no cron needed):
 *   When the bridge starts (and every 5 min poll), each task runs the first
 *   time it's seen a new IST date, regardless of what local hour the app was
 *   opened. So opening Termux any time runs today's full pipeline once.
 *   Order (per user, checkpointed so restarts don't redo completed steps):
 *   scan -> triage -> evaluate -> followup -> adapt.
 *
 *   - scan:      job portals, location-filtered
 *   - triage:    inbox classify recruiter replies / interviews / spam
 *   - evaluate:  top new scan results (score >= 4.0)
 *   - followup:  cron/daily-hunt.mjs --followups-only (auto-sends overdue
 *                warm-thread follow-ups unless SCHEDULER_FOLLOWUP_AUTOSEND=0)
 *   - adapt:     daily-adapt.mjs metrics
 *
 * Run standalone:  node scheduler.mjs
 * Run from bridge: imported and started by bridge-server.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import YAML from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_ROOT = join(__dirname, 'data', 'users');
const ADAPT_LOG_PATH = join(__dirname, 'data', 'adapt-log.md');

function readBridgeEnvKey() {
  for (const p of [join(__dirname, '.bridge.env'), join(__dirname, '.env')]) {
    try {
      if (existsSync(p)) {
        const m = readFileSync(p, 'utf-8').match(/^CREDENTIALS_KEY=(.+)$/m);
        if (m && m[1]) return m[1].trim();
      }
    } catch { /* ignore */ }
  }
  return null;
}

function checkpointPathForUser(userDir) {
  const d = join(userDir, 'data');
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return join(d, '.scheduler-checkpoint.json');
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DAILY_APP_TARGET = 8;             // max applications per day

let running = false;

// ── Checkpoint ──────────────────────────────────────────────────────

function loadCheckpoint(userDir) {
  const path = checkpointPathForUser(userDir);
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch { /* ignore corrupt checkpoint */ }
  return {};
}

function saveCheckpoint(userDir, cp) {
  const path = checkpointPathForUser(userDir);
  try {
    writeFileSync(path, JSON.stringify(cp, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

function resetDailyFlags(cp, today) {
  cp._date = today;
  cp.scanDone = false;
  cp.triageDone = false;
  cp.evaluateDone = false;
  cp.followupDone = false;
  cp.adaptDone = false;
  cp.dailyApps = cp.dailyApps || {};
  cp.dailyApps[today] = 0;
  cp.repliesDrafted = 0;
}

function istDateKey() {
  // IST date string YYYY-MM-DD regardless of server/device timezone.
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return parts; // en-CA yields YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10); // fallback
  }
}

// Must run once per IST day. Compare against the IST date so a bridge that was
// off overnight flips to a fresh day in the user's local (Termux = IST) time.
function todayKey() {
  return istDateKey();
}

// IST weekday: 0 = Sunday ... 6 = Saturday. Used to avoid Sunday auto-sends.
function istWeekday() {
  try {
    const dow = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata', weekday: 'short',
    }).format(new Date()); // e.g. "Sun"
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dow);
  } catch {
    return -1; // unknown — never block on this
  }
}

// ── User discovery ──────────────────────────────────────────────────

function listUserDirs() {
  if (!existsSync(USERS_ROOT)) return [];
  try {
    return readdirSync(USERS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      // A real user dir is an email (X-User-Id). Reject stray project-tree
      // copies like data/users/career-ops (batch/config/modes/reports) that
      // happen to contain a profile.yml but are NOT a mailbox user.
      .filter(d => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.name))
      .map(d => join(USERS_ROOT, d.name))
      .filter(dir => existsSync(join(dir, 'config', 'profile.yml')));
  } catch { return []; }
}

// ── Task runners ────────────────────────────────────────────────────

function runScript(script, args, userDir, opts = {}) {
  try {
    const fullArgs = [join(__dirname, script), ...args, '--user-dir', userDir];
    const r = spawnSync('node', fullArgs, {
      cwd: opts.cwd || userDir,
      encoding: 'utf-8',
      timeout: 180_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    if (r.status !== 0) {
      console.error(`[scheduler] ${script} failed for ${userDir}: ${(r.stderr || '').slice(0, 200)}`);
    }
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e) {
    console.error(`[scheduler] ${script} error: ${e.message}`);
    return { ok: false, stdout: '', stderr: e.message };
  }
}

async function runScriptAsync(script, args, userDir, opts = {}) {
  // Non-blocking version — fires and forgets for long-running tasks
  try {
    const { spawn } = await import('child_process');
    const fullArgs = [join(__dirname, script), ...args, '--user-dir', userDir];
    const proc = spawn('node', fullArgs, {
      cwd: opts.cwd || userDir,
      encoding: 'utf-8',
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', d => { stdout += d; });
    proc.stderr?.on('data', d => { stderr += d; });
    return new Promise(resolve => {
      proc.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }));
      proc.on('error', (e) => resolve({ ok: false, stdout, stderr: e.message }));
      setTimeout(() => { proc.kill(); resolve({ ok: false, stdout, stderr: 'timeout' }); }, 300_000);
    });
  } catch (e) {
    return Promise.resolve({ ok: false, stdout: '', stderr: e.message });
  }
}

// ── Task 1: Daily scan ─────────────────────────────────────────────

async function runScan(userDir) {
  console.log(`[scheduler] Scanning portals for ${userDir}...`);
  // scan.mjs resolves portals.yml from its working directory — run it from the
  // repo root, not the user dir, or every scheduled scan fails "portals.yml not found".
  const result = await runScriptAsync('scan.mjs', ['--json'], userDir, { cwd: __dirname });
  if (result.ok) {
    try {
      const data = JSON.parse(result.stdout.trim());
      console.log(`[scheduler] Scan found ${data.newFound || 0} new jobs (${data.total || 0} total)`);
      return data;
    } catch { /* parse failed — scan still ran */ }
  }
  return null;
}

// ── Task 2: Inbox scan + triage ────────────────────────────────────

async function runTriage(userDir) {
  console.log(`[scheduler] Scanning inbox for ${userDir}...`);
  const profilePath = join(userDir, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return null;

  // Read profile to get email
  let profile;
  try {
    profile = YAML.load(readFileSync(profilePath, 'utf-8'));
  } catch {
    try {
      profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    } catch { return null; }
  }

  const email = profile?.candidate?.email || process.env.GMAIL_USER;
  if (!email) return null;

  // Read OAuth credentials — same on-disk formats the bridge supports:
  // legacy JSON {encrypted,iv,authTag}, plaintext {refreshToken, ...}, or the
  // current AES-256-GCM base64 blob (iv||authTag||ciphertext) in .oauth2.json.
  const oauthPath = join(userDir, '.oauth2.json');
  let userOAuth = null;
  if (existsSync(oauthPath)) {
    try {
      const raw = readFileSync(oauthPath, 'utf-8').trim();
      const credsKey = process.env.CREDENTIALS_KEY || readBridgeEnvKey();
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed.encrypted && credsKey) {
          const crypto = await import('crypto');
          const key = Buffer.from(credsKey, 'hex');
          const iv = Buffer.from(parsed.iv, 'hex');
          const authTag = Buffer.from(parsed.authTag, 'hex');
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(parsed.encrypted, 'base64', 'utf-8');
          decrypted += decipher.final('utf-8');
          userOAuth = JSON.parse(decrypted);
        } else if (parsed.refreshToken) {
          userOAuth = parsed;
        }
      } else if (credsKey && /^[A-Za-z0-9+/=]{60,}$/.test(raw)) {
        // Current format: base64(iv(12) + authTag(16) + ciphertext)
        const crypto = await import('crypto');
        const key = Buffer.from(credsKey, 'hex');
        const buf = Buffer.from(raw, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
        decipher.setAuthTag(buf.subarray(12, 28));
        const decrypted = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
        userOAuth = JSON.parse(decrypted.toString('utf-8'));
      }
    } catch { /* no valid OAuth */ }
  }

  // If no per-user OAuth, try legacy env vars
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  const appPassword = process.env.GMAIL_APP_PASSWORD;

  if (!userOAuth && !hasLegacyOAuth2 && (!appPassword || appPassword === 'REVOKED_REPLACE_WITH_OAUTH')) {
    console.log(`[scheduler] No email auth for ${userDir} — skipping triage`);
    return null;
  }

  // Call the bridge server's triage endpoint if available, otherwise use inline classification
  const result = await runScriptAsync('auto-reply-draft.mjs', [], userDir);
  if (result.ok) {
    try {
      return JSON.parse(result.stdout.trim());
    } catch { /* parse failed */ }
  }
  return null;
}

// ── Task 3: Auto-evaluate new scan results ─────────────────────────

async function runAutoEvaluate(userDir) {
  console.log(`[scheduler] Auto-evaluating new jobs for ${userDir}...`);

  // Read pipeline to find unevaluated URLs
  const pipelinePath = join(userDir, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) return null;

  const pipelineLines = readFileSync(pipelinePath, 'utf-8').split('\n');
  // Only evaluate jobs posted within the last 30 days — the pipeline is
  // append-only and holds months of stale entries that would otherwise block
  // the daily pipeline evaluating ancient listings.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const urls = [];
  for (const line of pipelineLines) {
    const m = line.match(/https?:\/\/[^\s\)]+/);
    if (!m) continue;
    const posted = line.match(/posted:\s*(\d{4}-\d{2}-\d{2})/);
    if (posted) {
      const d = new Date(posted[1]);
      if (isNaN(d) || d < cutoff) continue;
    }
    urls.push(m[0]);
  }

  if (urls.length === 0) {
    console.log(`[scheduler] No recent (<30d) pipeline URLs to evaluate — skipping`);
    return null;
  }

  // Check how many apps sent today
  const cp = loadCheckpoint(userDir);
  const today = todayKey();
  const appsSentToday = (cp.dailyApps && cp.dailyApps[today]) || 0;
  if (appsSentToday >= DAILY_APP_TARGET) {
    console.log(`[scheduler] Daily app target reached (${appsSentToday}/${DAILY_APP_TARGET}) — skipping evaluation`);
    return null;
  }

  // Evaluate top 3 URLs (score gate >= 4.0)
  const toEvaluate = urls.slice(0, 3);
  const results = [];
  for (const url of toEvaluate) {
    console.log(`[scheduler] Evaluating ${url}...`);
    const evalResult = await runScriptAsync('evaluate-url.mjs', [url], userDir);
    if (evalResult.ok) {
      try {
        const data = JSON.parse(evalResult.stdout.trim());
        if (data.score && parseFloat(data.score) >= 4.0) {
          results.push(data);
          console.log(`[scheduler] Score ${data.score}/5 — qualifying`);
        } else {
          console.log(`[scheduler] Score ${data.score || 'N/A'}/5 — below threshold`);
        }
      } catch { /* parse failed */ }
    }
  }
  return results;
}

// ── Task 4: Follow-up cadence ──────────────────────────────────────

// Runs cron/daily-hunt.mjs in follow-up-only mode. That script computes the
// overdue/urgent set from followup-cadence, drafts each follow-up, sends it
// (respecting FOLLOWUP_MAX_PER_RUN + AUTO_SEND_FOLLOWUPS), and advances
// data/follow-ups.md so cadence stays honest. Falls back to the plain cadence
// dry-run analysis if daily-hunt.mjs is missing.
async function runFollowupCadence(userDir) {
  console.log(`[scheduler] Running followup cadence for ${userDir}...`);
  const hunter = join(__dirname, 'cron', 'daily-hunt.mjs');
  if (existsSync(hunter)) {
    // Termux model: there IS no wall-clock cron to depend on. The scheduler is
    // the single run-once-per-day follower and it auto-sends overdue warm
    // threads (capped in the engine). Set SCHEDULER_FOLLOWUP_AUTOSEND=0 for a
    // dry-run (drafts + digest only, nothing sent). Respect the engine's own
    // AUTO_SEND_FOLLOWUPS env (default 1) unless explicitly overridden here.
    const prev = process.env.AUTO_SEND_FOLLOWUPS;
    if (process.env.SCHEDULER_FOLLOWUP_AUTOSEND === '0') process.env.AUTO_SEND_FOLLOWUPS = '0';
    // Never auto-send on a Sunday (recruiters aren't checking; looking
    // desperate, not diligent). Digest still refreshes, nothing goes out.
    if (istWeekday() === 0) process.env.AUTO_SEND_FOLLOWUPS = '0';
    const followupBatch = await runScriptAsync('cron/daily-hunt.mjs', ['--followups-only'], userDir);
    if (prev !== undefined) process.env.AUTO_SEND_FOLLOWUPS = prev;
    const summary = (followupBatch.stdout || '').split('\n').filter(l =>
      /followups|follow-up|sent|would send|digest|on next/i.test(l)).slice(-10).join('\n');
    console.log(`[scheduler] followup summary:\n${summary}`);
    return followupBatch;
  }
  console.log(`[scheduler] cron/daily-hunt.mjs missing — falling back to dry cadence analysis`);
  return runScript('followup-cadence.mjs', ['--json'], userDir);
}

// ── Task 5: Daily adaptation ───────────────────────────────────────

async function runDailyAdapt(userDir) {
  console.log(`[scheduler] Running daily adaptation for ${userDir}...`);
  const result = await runScriptAsync('daily-adapt.mjs', [], userDir);
  if (result.ok) {
    // Log the adaptation
    try {
      const data = JSON.parse(result.stdout.trim());
      if (data.changes && data.changes.length > 0) {
        const logDir = join(userDir, 'data');
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
        const logPath = join(logDir, 'adapt-log.md');
        const entry = `\n## ${new Date().toISOString()}\n${data.changes.map(c => `- ${c}`).join('\n')}\n`;
        writeFileSync(logPath, entry, { flag: 'a' });
      }
    } catch { /* parse failed */ }
  }
  return result;
}

// ── Main loop ───────────────────────────────────────────────────────

async function tick() {
  if (running) return;
  running = true;

  try {
    const today = todayKey();

    const userDirs = listUserDirs();
    if (userDirs.length === 0) {
      running = false;
      return;
    }

    // Run-once-per-IST-day: a task runs when its checkpoint flag for today is
    // not yet set. No wall-clock gating — opening Termux any hour runs today's
    // pipeline. Tasks run in dependency order (evaluate needs scan).
    for (const dir of userDirs) {
      let cp = loadCheckpoint(dir);
      if (cp._date !== today) resetDailyFlags(cp, today);

      if (!cp.scanDone) {
        await runScan(dir);
        cp = loadCheckpoint(dir);
        cp._date = today;
        cp.scanDone = true;
        cp.lastScan = new Date().toISOString();
        saveCheckpoint(dir, cp);
      }

      if (!cp.triageDone) {
        await runTriage(dir);
        cp = loadCheckpoint(dir);
        cp._date = today;
        cp.triageDone = true;
        cp.lastTriage = new Date().toISOString();
        saveCheckpoint(dir, cp);
      }

      if (!cp.evaluateDone && cp.scanDone) {
        await runAutoEvaluate(dir);
        cp = loadCheckpoint(dir);
        cp._date = today;
        cp.evaluateDone = true;
        cp.lastEvaluate = new Date().toISOString();
        saveCheckpoint(dir, cp);
      }

      if (!cp.followupDone) {
        await runFollowupCadence(dir);
        cp = loadCheckpoint(dir);
        cp._date = today;
        cp.followupDone = true;
        cp.lastFollowup = new Date().toISOString();
        saveCheckpoint(dir, cp);
      }

      if (!cp.adaptDone) {
        await runDailyAdapt(dir);
        cp = loadCheckpoint(dir);
        cp._date = today;
        cp.adaptDone = true;
        cp.lastAdapt = new Date().toISOString();
        saveCheckpoint(dir, cp);
      }
    }
  } catch (e) {
    console.error(`[scheduler] Tick error: ${e.message}`);
  } finally {
    running = false;
  }
}

// ── Start ───────────────────────────────────────────────────────────

export function startScheduler() {
  console.log(`[scheduler] Starting — poll every ${POLL_INTERVAL_MS / 1000}s (run-once-per-IST-day)`);
  console.log(`[scheduler] Daily pipeline: scan -> triage -> evaluate -> followup (auto-send) -> adapt`);
  setInterval(() => { tick().catch(e => console.error(`[scheduler] Tick async error: ${e.message}`)); }, POLL_INTERVAL_MS);
  // Run first tick immediately (after 10s to let bridge-server finish booting)
  setTimeout(() => { tick().catch(e => console.error(`[scheduler] Tick async error: ${e.message}`)); }, 10_000);
}

// Run standalone if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
}
