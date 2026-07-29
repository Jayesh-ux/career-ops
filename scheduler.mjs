#!/usr/bin/env node
/**
 * scheduler.mjs — Daily job search pipeline for career-ops multi-user.
 *
 * Zero new dependencies. Uses setInterval + checkpoint persistence.
 * Designed to be started from bridge-server.mjs or standalone.
 *
 * Daily pipeline:
 *   06:00 — Scan job portals for new jobs
 *   06:01 — Scan inbox for new emails
 *   06:02 — Triage: classify recruiter replies, interviews, spam
 *   06:03 — Draft replies for recruiter emails (queue, never auto-send)
 *   06:05 — Evaluate top new scan results (score >= 4.0)
 *   06:10 — Draft applications for qualifying jobs
 *   08:00 — Follow-up cadence (overdue follow-ups)
 *   20:00 — Daily adaptation: compute metrics, suggest changes
 *
 * Run standalone:  node scheduler.mjs
 * Run from bridge: imported and started by bridge-server.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_ROOT = join(__dirname, 'data', 'users');
const CHECKPOINT_PATH = join(__dirname, '.scheduler-checkpoint.json');
const ADAPT_LOG_PATH = join(__dirname, 'data', 'adapt-log.md');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STAGGER_DELAY_MS = 30 * 1000;     // 30s between users
const SCAN_HOUR = 6;
const TRIAGE_HOUR = 6;
const EVALUATE_HOUR = 6;
const FOLLOWUP_HOUR = 8;
const ADAPT_HOUR = 20;
const DAILY_APP_TARGET = 8;             // max applications per day

let running = false;

// ── Checkpoint ──────────────────────────────────────────────────────

function loadCheckpoint() {
  try {
    if (existsSync(CHECKPOINT_PATH)) {
      return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'));
    }
  } catch { /* ignore corrupt checkpoint */ }
  return {};
}

function saveCheckpoint(cp) {
  try {
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hourNow() {
  return new Date().getHours();
}

// ── User discovery ──────────────────────────────────────────────────

function listUserDirs() {
  if (!existsSync(USERS_ROOT)) return [];
  try {
    return readdirSync(USERS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(USERS_ROOT, d.name))
      .filter(dir => existsSync(join(dir, 'config', 'profile.yml')));
  } catch { return []; }
}

// ── Task runners ────────────────────────────────────────────────────

function runScript(script, args, userDir) {
  try {
    const fullArgs = [join(__dirname, script), ...args, '--user-dir', userDir];
    const r = spawnSync('node', fullArgs, {
      cwd: userDir,
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

async function runScriptAsync(script, args, userDir) {
  // Non-blocking version — fires and forgets for long-running tasks
  try {
    const { spawn } = await import('child_process');
    const fullArgs = [join(__dirname, script), ...args, '--user-dir', userDir];
    const proc = spawn('node', fullArgs, {
      cwd: userDir,
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

function runScan(userDir) {
  console.log(`[scheduler] Scanning portals for ${userDir}...`);
  const result = runScript('scan.mjs', ['--json'], userDir);
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
    const yaml = await import('yaml');
    profile = yaml.parse(readFileSync(profilePath, 'utf-8'));
  } catch {
    try {
      profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
    } catch { return null; }
  }

  const email = profile?.candidate?.email || process.env.GMAIL_USER;
  if (!email) return null;

  // Read OAuth credentials
  const oauthPath = join(userDir, '.oauth2.json');
  let userOAuth = null;
  if (existsSync(oauthPath)) {
    try {
      const raw = JSON.parse(readFileSync(oauthPath, 'utf-8'));
      // Handle encrypted credentials
      if (raw.encrypted && process.env.CREDENTIALS_KEY) {
        const crypto = await import('crypto');
        const key = Buffer.from(process.env.CREDENTIALS_KEY, 'hex');
        const iv = Buffer.from(raw.iv, 'hex');
        const authTag = Buffer.from(raw.authTag, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(raw.encrypted, 'base64', 'utf-8');
        decrypted += decipher.final('utf-8');
        userOAuth = JSON.parse(decrypted);
      } else if (raw.refreshToken) {
        userOAuth = raw;
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
  const result = runScript('auto-reply-draft.mjs', [], userDir);
  if (result.ok) {
    try {
      return JSON.parse(result.stdout.trim());
    } catch { /* parse failed */ }
  }
  return null;
}

// ── Task 3: Auto-evaluate new scan results ─────────────────────────

function runAutoEvaluate(userDir) {
  console.log(`[scheduler] Auto-evaluating new jobs for ${userDir}...`);

  // Read pipeline to find unevaluated URLs
  const pipelinePath = join(userDir, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) return null;

  const pipeline = readFileSync(pipelinePath, 'utf-8');
  const urls = [];
  const lines = pipeline.split('\n');
  for (const line of lines) {
    const m = line.match(/https?:\/\/[^\s\)]+/);
    if (m) urls.push(m[0]);
  }

  if (urls.length === 0) return null;

  // Check how many apps sent today
  const cp = loadCheckpoint();
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
    const evalResult = runScript('evaluate-url.mjs', [url], userDir);
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

function runFollowupCadence(userDir) {
  console.log(`[scheduler] Running followup-cadence for ${userDir}...`);
  return runScript('followup-cadence.mjs', ['--json'], userDir);
}

// ── Task 5: Daily adaptation ───────────────────────────────────────

function runDailyAdapt(userDir) {
  console.log(`[scheduler] Running daily adaptation for ${userDir}...`);
  const result = runScript('daily-adapt.mjs', [], userDir);
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

function tick() {
  if (running) return;
  running = true;

  try {
    const cp = loadCheckpoint();
    const today = todayKey();
    const hour = hourNow();

    // Reset daily flags at midnight
    if (cp._date !== today) {
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

    const userDirs = listUserDirs();
    if (userDirs.length === 0) {
      running = false;
      return;
    }

    // Task 1: Daily scan at 6 AM
    if (hour === SCAN_HOUR && !cp.scanDone) {
      console.log(`[scheduler] Running daily scan for ${userDirs.length} users...`);
      for (let i = 0; i < userDirs.length; i++) {
        if (i > 0) {
          const wait = STAGGER_DELAY_MS;
          console.log(`[scheduler] Waiting ${wait / 1000}s before next user...`);
          const start = Date.now();
          while (Date.now() - start < wait) { /* busy wait */ }
        }
        runScan(userDirs[i]);
      }
      cp.scanDone = true;
      cp.lastScan = new Date().toISOString();
      saveCheckpoint(cp);
    }

    // Task 2: Inbox triage at 6 AM
    if (hour === TRIAGE_HOUR && !cp.triageDone) {
      console.log(`[scheduler] Running inbox triage for ${userDirs.length} users...`);
      for (const dir of userDirs) {
        runTriage(dir);
      }
      cp.triageDone = true;
      cp.lastTriage = new Date().toISOString();
      saveCheckpoint(cp);
    }

    // Task 3: Auto-evaluate at 6 AM (after scan)
    if (hour === EVALUATE_HOUR && !cp.evaluateDone && cp.scanDone) {
      console.log(`[scheduler] Running auto-evaluate for ${userDirs.length} users...`);
      for (const dir of userDirs) {
        runAutoEvaluate(dir);
      }
      cp.evaluateDone = true;
      cp.lastEvaluate = new Date().toISOString();
      saveCheckpoint(cp);
    }

    // Task 4: Follow-up cadence at 8 AM
    if (hour === FOLLOWUP_HOUR && !cp.followupDone) {
      console.log(`[scheduler] Running followup-cadence for ${userDirs.length} users...`);
      for (const dir of userDirs) {
        runFollowupCadence(dir);
      }
      cp.followupDone = true;
      cp.lastFollowup = new Date().toISOString();
      saveCheckpoint(cp);
    }

    // Task 5: Daily adaptation at 8 PM
    if (hour === ADAPT_HOUR && !cp.adaptDone) {
      console.log(`[scheduler] Running daily adaptation for ${userDirs.length} users...`);
      for (const dir of userDirs) {
        runDailyAdapt(dir);
      }
      cp.adaptDone = true;
      cp.lastAdapt = new Date().toISOString();
      saveCheckpoint(cp);
    }

    saveCheckpoint(cp);
  } catch (e) {
    console.error(`[scheduler] Tick error: ${e.message}`);
  } finally {
    running = false;
  }
}

// ── Start ───────────────────────────────────────────────────────────

export function startScheduler() {
  console.log(`[scheduler] Starting — poll every ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`[scheduler] Daily pipeline: scan(${SCAN_HOUR}h) triage(${TRIAGE_HOUR}h) evaluate(${EVALUATE_HOUR}h) followup(${FOLLOWUP_HOUR}h) adapt(${ADAPT_HOUR}h)`);
  setInterval(tick, POLL_INTERVAL_MS);
  // Run first tick immediately (after 10s to let bridge-server finish booting)
  setTimeout(tick, 10_000);
}

// Run standalone if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
}
