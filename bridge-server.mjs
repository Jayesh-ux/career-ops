#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, readdirSync, statSync, symlinkSync, copyFileSync } from 'fs';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import yaml from 'js-yaml';
import multer from 'multer';

// Ensure the opencode binary in this directory is discoverable by @opencode-ai/sdk
const __selfDir = dirname(fileURLToPath(import.meta.url));
if (!process.env.PATH.split(':').includes(__selfDir)) {
  process.env.PATH = __selfDir + ':' + process.env.PATH;
}
import { createRequire } from 'module';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';

const require = createRequire(import.meta.url);

// ── Environment check ──────────────────────────────────────────────
// Detect proot-distro: bridge server MUST run in Termux directly,
// NOT inside `proot-distro login`, because proot isolates the
// network namespace and ports won't be reachable from the Android host.
function detectProot() {
  // proot-distro sets PROOT_DISTRO env var
  if (process.env.PROOT_DISTRO) return true;
  // In proot, /proc/1/root differs from /
  try {
    const proc1 = readFileSync('/proc/1/root', 'utf-8').trim();
    if (proc1 && proc1 !== '/' && proc1 !== '') return true;
  } catch { /* /proc not available — assume not proot */ }
  // Termux sets PREFIX to /data/data/com.termux/files/usr
  const prefix = process.env.PREFIX || '';
  if (prefix && !prefix.includes('com.termux')) return true;
  return false;
}

if (detectProot()) {
  console.error('');
  console.error('╔══════════════════════════════════════════════════════════╗');
  console.error('║  ERROR: This server MUST run in Termux directly!       ║');
  console.error('║                                                      ║');
  console.error('║  Do NOT run it inside proot-distro.                   ║');
  console.error('║  proot-distro isolates the network namespace,         ║');
  console.error('║  so the Android app cannot reach this server.         ║');
  console.error('║                                                      ║');
  console.error('║  Run this instead:                                    ║');
  console.error('║    cd ~/career-ops                                   ║');
  console.error('║    node bridge-server.mjs                             ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
  console.error('');
  process.exit(1);
}
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
let mammoth = null;
try { mammoth = require('mammoth'); } catch { /* optional */ }
let pdfParse = null;
try { pdfParse = require('pdf-parse'); } catch { /* optional */ }

let pdftotextAvailable = true;
try { const r = spawnSync('which', ['pdftotext'], { encoding: 'utf-8' }); if (r.status !== 0) pdftotextAvailable = false; } catch { pdftotextAvailable = false; }

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8787', 10);

// ── Multi-user data layer ──────────────────────────────────────────
// When X-User-Id header is present, all data paths resolve under
// /data/users/{userId}/ instead of the project root.
const USERS_ROOT = join(__dirname, 'data', 'users');

function resolveUserDataDir(userId) {
  // userId is the user's email (URL-encoded as path segment)
  const safeId = String(userId || '').toLowerCase().replace(/[^a-z0-9@.+-]/g, '_');
  if (!safeId) return null;
  const dir = join(USERS_ROOT, safeId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'reports'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    mkdirSync(join(dir, 'modes'), { recursive: true });
    mkdirSync(join(dir, 'batch'), { recursive: true });
    mkdirSync(join(dir, 'batch/tracker-additions'), { recursive: true });

    // Symlink .opencode/ so opencode CLI finds SKILL.md when cwd = userDir
    const opencodeLink = join(dir, '.opencode');
    if (!existsSync(opencodeLink)) {
      try { symlinkSync(join(__dirname, '.opencode'), opencodeLink); } catch { /* non-fatal */ }
    }

    // Symlink cv.md and config/ so opencode reads user's data from cwd root
    const cvLink = join(dir, 'cv.md');
    const userCv = join(dir, 'data', 'cv.md');
    if (!existsSync(cvLink) && existsSync(userCv)) {
      try { symlinkSync(userCv, cvLink); } catch { /* non-fatal */ }
    }
    const configLink = join(dir, 'config');
    if (!existsSync(join(dir, 'config', 'profile.yml')) && existsSync(join(__dirname, 'config', 'profile.yml'))) {
      try { copyFileSync(join(__dirname, 'config', 'profile.yml'), join(dir, 'config', 'profile.yml')); } catch { /* non-fatal */ }
    }

    // Symlink modes/ so _profile.md and _shared.md are available
    const modesLink = join(dir, 'modes');
    if (!existsSync(modesLink)) {
      try { symlinkSync(join(__dirname, 'modes'), modesLink); } catch { /* non-fatal */ }
    }

    console.log(`[multi-user] Created user directory: ${dir}`);
  }
  return dir;
}

function resolvePerUserPath(userId, relativePath) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) return join(__dirname, relativePath);
  return join(userDir, relativePath);
}

// Per-user OAuth2 credential store
function getUserOAuth(userId) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) return null;
  const oauthPath = join(userDir, '.oauth2.json');
  if (!existsSync(oauthPath)) return null;
  try {
    return JSON.parse(readFileSync(oauthPath, 'utf-8'));
  } catch { return null; }
}

function setUserOAuth(userId, creds) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) throw new Error('Invalid userId');
  const oauthPath = join(userDir, '.oauth2.json');
  writeFileSync(oauthPath, JSON.stringify(creds, null, 2), 'utf-8');
}

function ensureUserDirs() {
  if (!existsSync(USERS_ROOT)) mkdirSync(USERS_ROOT, { recursive: true });
}
ensureUserDirs();

// Load .bridge.env if present (sets GMAIL_USER, GMAIL_APP_PASSWORD, etc.)
try {
  const envFile = join(__dirname, '.bridge.env');
  if (existsSync(envFile)) {
    const lines = readFileSync(envFile, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (e) { /* ignore */ }

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Multi-user middleware ───────────────────────────────────────────
// Reads X-User-Id header and sets req.userCtx with per-user paths.
// Backwards-compatible: requests without X-User-Id use the root (legacy single-user).
app.use((req, res, next) => {
  const userId = req.headers['x-user-id'] || '';
  if (userId) {
    const userDir = resolveUserDataDir(userId);
    req.userCtx = {
      userId,
      userDir,
      dataDir: join(userDir, 'data'),
      reportsDir: join(userDir, 'reports'),
      configDir: join(userDir, 'config'),
      modesDir: join(userDir, 'modes'),
      cvPath: join(userDir, 'data', 'cv.md'),
      trackerPath: join(userDir, 'data', 'applications.md'),
      profilePath: join(userDir, 'config', 'profile.yml'),
      scanHistory: join(userDir, 'data', 'scan-history.tsv'),
      additionsDir: join(userDir, 'batch', 'tracker-additions'),
      blacklistPath: join(userDir, 'data', 'blacklist.md'),
      pipelinePath: join(userDir, 'data', 'pipeline.md'),
      oauthPath: join(userDir, '.oauth2.json'),
    };
  } else {
    // Legacy single-user mode: point at project root
    req.userCtx = {
      userId: '',
      userDir: __dirname,
      dataDir: join(__dirname, 'data'),
      reportsDir: join(__dirname, 'reports'),
      configDir: join(__dirname, 'config'),
      modesDir: join(__dirname, 'modes'),
      cvPath: join(__dirname, 'data', 'cv.md'),
      trackerPath: TRACKER_PATH,
      profilePath: PROFILE_PATH,
      scanHistory: SCAN_HISTORY,
      additionsDir: ADDITIONS_DIR,
      blacklistPath: join(__dirname, 'data', 'blacklist.md'),
      pipelinePath: join(__dirname, 'data', 'pipeline.md'),
      oauthPath: null,
    };
  }
  next();
});

// ── helpers ────────────────────────────────────────────────────────

/** Strip markdown formatting from text (bold, italic, code, headings, etc.) */
function stripMarkdown(s) {
  return (s || '')
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/__(.+?)__/g, '$1')        // __bold__
    .replace(/_(.+?)_/g, '$1')          // _italic_
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/^#{1,6}\s*/gm, '')        // # headings
    .replace(/^[-*+]\s+/gm, '')         // list markers
    .trim();
}

// ── Gmail OAuth2 helper ───────────────────────────────────────────
// Exchanges refresh token for short-lived access token
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
let cachedGmailToken = null;
let gmailTokenExpiry = 0;

async function getGmailAccessToken() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail OAuth2 not configured — set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in .bridge.env');
  }

  // Return cached token if still valid (with 5min buffer)
  if (cachedGmailToken && Date.now() < gmailTokenExpiry - 300000) {
    return cachedGmailToken;
  }

  const resp = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gmail token refresh failed: ${resp.status} ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error('Gmail token refresh returned no access_token');

  cachedGmailToken = data.access_token;
  gmailTokenExpiry = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedGmailToken;
}

/** Build XOAUTH2 string for IMAP authentication */
function buildXoauth2String(email, accessToken) {
  return `user=${email}\x01auth=Bearer ${accessToken}\x01\x01`;
}

const PROFILE_PATH = join(__dirname, 'config/profile.yml');
const TRACKER_PATH = existsSync(join(__dirname, 'data/applications.md'))
  ? join(__dirname, 'data/applications.md')
  : join(__dirname, 'applications.md');
const STATES_PATH = join(__dirname, 'templates/states.yml');
const ADDITIONS_DIR = join(__dirname, 'batch/tracker-additions');
const SCAN_HISTORY = join(__dirname, 'data/scan-history.tsv');
const UPLOAD_DIR = join(__dirname, 'data/uploads');

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

function readProfile() {
  if (!existsSync(PROFILE_PATH)) return {};
  return yaml.load(readFileSync(PROFILE_PATH, 'utf-8')) || {};
}

function writeProfile(data) {
  writeFileSync(PROFILE_PATH, yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
}

function readUserCv(req) {
  const p = req.userCtx?.cvPath || join(__dirname, 'data/cv.md');
  return existsSync(p) ? readFileSync(p, 'utf-8').slice(0, 4000) : '';
}

function readUserProfileRaw(req) {
  const p = req.userCtx?.profilePath || PROFILE_PATH;
  if (!existsSync(p)) return {};
  try { return yaml.load(readFileSync(p, 'utf-8')) || {}; } catch { return {}; }
}

function userReportDir(req) {
  return req.userCtx?.reportsDir || join(__dirname, 'reports');
}

function userAdditionsDir(req) {
  return req.userCtx?.additionsDir || ADDITIONS_DIR;
}

function userTrackerPath(req) {
  return req.userCtx?.trackerPath || TRACKER_PATH;
}

function userCwd(req) {
  return req.userCtx?.userDir || __dirname;
}

function nextReportNumForDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => parseInt(f.split('-')[0])).filter(n => !isNaN(n));
  return existing.length > 0 ? Math.max(...existing) + 1 : 1;
}

function trackerLines() {
  if (!existsSync(TRACKER_PATH)) return [];
  const text = readFileSync(TRACKER_PATH, 'utf-8');
  return text.split('\n');
}

function findHeaderCols(lines) {
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(s => s.trim().toLowerCase());
    const map = {};
    const aliases = {
      '#': 'num', 'no': 'num', 'number': 'num',
      date: 'date', company: 'company', role: 'role',
      score: 'score', status: 'status', pdf: 'pdf',
      report: 'report', notes: 'notes', location: 'location',
      via: 'via', contacto: 'contactemail', 'contact email': 'contactemail',
      email: 'contactemail',
    };
    cells.forEach((c, i) => {
      const k = aliases[c];
      if (k) map[k] = i;
    });
    if (map.num != null && map.company != null && map.role != null) return map;
    // fallback legacy
    if (cells.length >= 9) {
      return { num: 1, date: 2, company: 3, role: 4, score: 5, status: 6, pdf: 7, report: 8, notes: 9 };
    }
  }
  return null;
}

function parseTrackerRows(lines, colmap) {
  if (!colmap) return [];
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    const num = parseInt(parts[colmap.num], 10);
    if (isNaN(num)) continue;
    const get = (k) => (colmap[k] != null ? (parts[colmap[k]] ?? '') : '');
    rows.push({
      id: num,
      num,
      date: get('date'),
      company: get('company'),
      role: get('role'),
      score: get('score'),
      status: get('status'),
      pdf: get('pdf'),
      report: get('report'),
      notes: get('notes'),
      location: get('location'),
      contactEmail: get('contactemail'),
    });
  }
  return rows;
}

function runCli(script, args = []) {
  const result = spawnSync('node', [script, ...args], {
    cwd: __dirname,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status, error: result.error };
}

async function runOpencode(prompt, timeoutMs = 120000, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('opencode', ['run', prompt], {
      cwd: cwd || __dirname,
      env: { ...process.env, PATH: `/root/.opencode/bin:${process.env.PATH}` },
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`opencode exited ${code}: ${stderr.slice(0, 300)}`));
    });
    proc.on('error', reject);
  });
}

function parseJsonFromOutput(text) {
  const m = text.match(/\{[\s\S]*?\}/);
  return m ? (() => { try { return JSON.parse(m[0]); } catch { return null; } })() : null;
}

function nextReportNum() {
  if (!existsSync(join(__dirname, 'reports'))) mkdirSync(join(__dirname, 'reports'), { recursive: true });
  const existing = readFileSync(TRACKER_PATH, 'utf-8').split('\n');
  let max = 0;
  for (const line of existing) {
    if (!line.startsWith('|')) continue;
    const m = line.match(/^\|\s*(\d+)/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

// ── endpoints ──────────────────────────────────────────────────────

// GET /doctor — runs 'node doctor.mjs --json' and returns the result
app.get('/doctor', (req, res) => {
  try {
    const r = spawnSync('node', ['doctor.mjs', '--json'], {
      cwd: __dirname,
      encoding: 'utf-8',
      timeout: 30000
    });
    if (r.status !== 0) {
      return res.status(500).json({ error: r.stderr || 'doctor.mjs failed' });
    }
    const output = (r.stdout || '').trim();
    try {
      res.json(JSON.parse(output));
    } catch {
      res.status(500).json({ error: 'doctor.mjs produced invalid JSON', raw: output });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /users/:email/oauth/exchange ──────────────────────────────
// Exchange authorization code for OAuth2 tokens and store per-user.
// Body: { code, clientId, clientSecret, redirectUri? }
app.post('/users/:email/oauth/exchange', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { code, clientId, clientSecret, redirectUri } = req.body;
    if (!code || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'code, clientId, and clientSecret are required' });
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri || 'http://localhost:8787/users/oauth/callback',
        grant_type: 'authorization_code',
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(400).json({ error: `Token exchange failed: ${resp.status} ${err.slice(0, 300)}` });
    }

    const data = await resp.json();
    const creds = {
      email,
      clientId,
      clientSecret,
      accessToken: data.access_token || '',
      refreshToken: data.refresh_token || '',
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope || '',
      storedAt: new Date().toISOString(),
    };

    setUserOAuth(email, creds);

    res.json({
      success: true,
      email,
      hasRefreshToken: !!creds.refreshToken,
      expiresIn: data.expires_in || 3600,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /users/:email/oauth/status ─────────────────────────────────
// Check if a user has valid OAuth2 credentials stored.
app.get('/users/:email/oauth/status', (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const creds = getUserOAuth(email);
    if (!creds) {
      return res.json({ configured: false, email });
    }
    const isExpired = creds.expiresAt && Date.now() > creds.expiresAt;
    res.json({
      configured: true,
      email,
      hasRefreshToken: !!creds.refreshToken,
      isExpired,
      expiresAt: creds.expiresAt ? new Date(creds.expiresAt).toISOString() : null,
      storedAt: creds.storedAt,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /users/:email/oauth/callback ───────────────────────────────
// OAuth2 redirect handler — the user lands here after Google consent.
app.get('/users/:email/oauth/callback', (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<html><body><h2>Authorization failed</h2><p>${error}</p></body></html>`);
  }
  res.send(`<html><body><h2>Authorization successful</h2><p>You can close this tab and return to career-ops.</p><script>setTimeout(()=>window.close(),2000)</script></body></html>`);
});

// ── POST /users/:email/setup ───────────────────────────────────────
// Initialize a new user's directory structure with skeleton files.
// Called from Android onboarding after profile form submission.
app.post('/users/:email/setup', (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { name, targetRoles, location, compensation } = req.body;
    const userDir = resolveUserDataDir(email);
    if (!userDir) return res.status(400).json({ error: 'Invalid email' });

    // Create cv.md skeleton
    const cvPath = join(userDir, 'data', 'cv.md');
    if (!existsSync(cvPath)) {
      const cvContent = `# ${name || 'Candidate'}\n\n## Summary\n\n${targetRoles ? `Target roles: ${Array.isArray(targetRoles) ? targetRoles.join(', ') : targetRoles}` : 'Job seeker'}\n\n## Experience\n\n## Education\n\n## Skills\n`;
      writeFileSync(cvPath, cvContent, 'utf-8');
    }

    // Create profile.yml
    const profilePath = join(userDir, 'config', 'profile.yml');
    if (!existsSync(profilePath)) {
      const profile = {
        candidate: { full_name: name || '', email },
        target_roles: { primary: Array.isArray(targetRoles) ? targetRoles : [targetRoles || ''] },
        location: { city: location || '' },
        compensation: { target_range: compensation || '' },
      };
      writeFileSync(profilePath, yaml.dump(profile, { indent: 2, lineWidth: -1, noRefs: true }), 'utf-8');
    }

    // Create tracker skeleton
    const trackerPath = join(userDir, 'data', 'applications.md');
    if (!existsSync(trackerPath)) {
      writeFileSync(trackerPath, '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|------|\n', 'utf-8');
    }

    // Create blacklist skeleton
    const blPath = join(userDir, 'data', 'blacklist.md');
    if (!existsSync(blPath)) {
      writeFileSync(blPath, '# Blacklist\n\nCompanies to avoid applying to.\n', 'utf-8');
    }

    // Create pipeline skeleton
    const pipePath = join(userDir, 'data', 'pipeline.md');
    if (!existsSync(pipePath)) {
      writeFileSync(pipePath, '# Pipeline\n\nPending job URLs to evaluate.\n', 'utf-8');
    }

    res.json({
      success: true,
      email,
      userDir: `/data/users/${email.replace(/[^a-z0-9@.+-]/gi, '_')}`,
      files: ['data/cv.md', 'config/profile.yml', 'data/applications.md', 'data/blacklist.md', 'data/pipeline.md', '.oauth2.json'],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /users/:email/files ────────────────────────────────────────
// List all files in a user's data directory.
app.get('/users/:email/files', (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const userDir = resolveUserDataDir(email);
    if (!userDir) return res.status(400).json({ error: 'Invalid email' });

    function walkDir(dir, prefix = '') {
      const results = [];
      if (!existsSync(dir)) return results;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push(...walkDir(join(dir, entry.name), relPath));
        } else if (entry.name !== '.oauth2.json') {
          const stat = statSync(join(dir, entry.name));
          results.push({ path: relPath, size: stat.size, modified: stat.mtime.toISOString() });
        }
      }
      return results;
    }

    const files = walkDir(userDir);
    res.json({ email, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /users/:email/files/:filepath(*) ───────────────────────────
// Read a specific file from a user's data directory.
app.get('/users/:email/files/{*filepath}', (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const filePath = req.params.filepath || req.params[0] || '';
    const userDir = resolveUserDataDir(email);
    if (!userDir) return res.status(400).json({ error: 'Invalid email' });

    const fullPath = join(userDir, filePath);
    // Security: ensure the resolved path is within the user directory
    if (!fullPath.startsWith(userDir)) {
      return res.status(403).json({ error: 'Path traversal not allowed' });
    }
    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = readFileSync(fullPath, 'utf-8');
    res.json({ path: filePath, content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /profile — returns full profile from config/profile.yml (per-user or root)
app.get('/profile', (req, res) => {
  try {
    const profilePath = req.userCtx.profilePath;
    function readP() {
      if (!existsSync(profilePath)) return {};
      return yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    }
    const p = readP();
    const c = p.candidate || {};
    const t = p.target_roles || {};
    const n = p.narrative || {};
    const comp = p.compensation || {};
    const loc = p.location || {};
    res.json({
      name: c.full_name || '',
      email: c.email || '',
      phone: c.phone || '',
      portfolio: c.portfolio_url || c.portfolio || '',
      linkedin: c.linkedin || '',
      github: c.github || '',
      resumeFileName: '',
      location: loc.city || '',
      country: loc.country || '',
      timezone: loc.timezone || '',
      targetRoles: t.primary || [],
      archetypes: (t.archetypes || []).map(a => a.name || a),
      headline: n.headline || '',
      exitStory: n.exit_story || '',
      superpowers: n.superpowers || [],
      proofPoints: (n.proof_points || []).map(pp => pp.name || pp),
      compensation: comp.target_range || '',
      minimum: comp.minimum || '',
      currency: comp.currency || 'INR'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /profile — update profile fields in config/profile.yml (per-user or root)
app.put('/profile', (req, res) => {
  try {
    const { name, email, phone, portfolio, linkedin, targetRoles, location, headline, compensation } = req.body;
    const profilePath = req.userCtx.profilePath;
    function readP() {
      if (!existsSync(profilePath)) return {};
      return yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    }
    function writeP(data) {
      const dir = dirname(profilePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(profilePath, yaml.dump(data, { indent: 2, lineWidth: -1, noRefs: true }));
    }
    const p = readP();
    if (!p.candidate) p.candidate = {};
    if (name != null) p.candidate.full_name = name;
    if (email != null) p.candidate.email = email;
    if (phone != null) p.candidate.phone = phone;
    if (portfolio != null) p.candidate.portfolio_url = portfolio;
    if (linkedin != null) p.candidate.linkedin = linkedin;
    if (targetRoles != null) {
      if (!p.target_roles) p.target_roles = {};
      p.target_roles.primary = targetRoles;
    }
    if (location != null) {
      if (!p.location) p.location = {};
      p.location.city = location;
    }
    if (headline != null) {
      if (!p.narrative) p.narrative = {};
      p.narrative.headline = headline;
    }
    if (compensation != null) {
      if (!p.compensation) p.compensation = {};
      p.compensation.target_range = compensation;
    }
    writeP(p);

    // Also sync search keywords to portals.yml title_filter.positive
    // Guard: only overwrite if non-empty — empty arrays from profile saves must not clobber existing filters
    const { searchKeywords, searchLocations } = req.body;
    const safeKeywords = Array.isArray(searchKeywords) ? searchKeywords.filter(k => k && typeof k === 'string' && k.trim()) : [];
    const safeLocations = Array.isArray(searchLocations) ? searchLocations.filter(l => l && typeof l === 'string' && l.trim()) : [];
    if (safeKeywords.length > 0 || safeLocations.length > 0) {
      const portalsPath = join(req.userCtx.userDir, 'portals.yml');
      let portals = {};
      if (existsSync(portalsPath)) {
        try { portals = yaml.load(readFileSync(portalsPath, 'utf-8')) || {}; } catch { /* keep empty */ }
      }
      if (safeKeywords.length > 0) {
        if (!portals.title_filter) portals.title_filter = {};
        portals.title_filter.positive = safeKeywords;
      }
      if (safeLocations.length > 0) {
        if (!portals.title_filter) portals.title_filter = {};
        portals.title_filter.location = safeLocations;
      }
      writeFileSync(portalsPath, yaml.dump(portals, { lineWidth: -1 }), 'utf-8');
    }

    const c = p.candidate;
    res.json({
      name: c.full_name || '',
      email: c.email || '',
      phone: c.phone || '',
      portfolio: c.portfolio_url || '',
      linkedin: c.linkedin || '',
      resumeFileName: '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /tracker
app.get('/tracker', (req, res) => {
  try {
    function trackerL() {
      if (!existsSync(req.userCtx.trackerPath)) return [];
      return readFileSync(req.userCtx.trackerPath, 'utf-8').split('\n');
    }
    const lines = trackerL();
    const colmap = findHeaderCols(lines);
    const rows = parseTrackerRows(lines, colmap);
    res.json({ applications: rows.map(r => ({
      id: r.num,
      date: r.date,
      company: r.company,
      role: r.role,
      location: r.location || '',
      status: r.status,
      score: r.score,
      contactEmail: r.contactEmail || '',
      notes: r.notes,
    })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /tracker/:id/status
app.put('/tracker/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });

    // For per-user mode, we need to set CWD or pass tracker path to set-status.mjs
    // The set-status.mjs reads data/applications.md by default; for multi-user we set the
    // working directory to the user's data dir so it finds the right tracker file.
    const userDir = req.userCtx.userDir;
    const envOverride = { ...process.env, FORCE_COLOR: '0' };

    const r = spawnSync('node', [join(__dirname, 'set-status.mjs'), id, status, '--json'], {
      cwd: req.userCtx.userId ? userDir : __dirname,
      encoding: 'utf-8',
      timeout: 120_000,
      env: envOverride,
    });
    if (r.status !== 0) {
      const errMsg = r.stderr || r.stdout || `set-status exited with code ${r.status}`;
      return res.status(400).json({ error: errMsg });
    }

    // Return updated tracker
    function trackerL() {
      if (!existsSync(req.userCtx.trackerPath)) return [];
      return readFileSync(req.userCtx.trackerPath, 'utf-8').split('\n');
    }
    const lines = trackerL();
    const colmap = findHeaderCols(lines);
    const rows = parseTrackerRows(lines, colmap);
    res.json({ applications: rows.map(r => ({
      id: r.num, date: r.date, company: r.company, role: r.role,
      location: r.location || '', status: r.status, score: r.score,
      contactEmail: r.contactEmail || '', notes: r.notes,
    })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /tracker/add
app.post('/tracker/add', (req, res) => {
  try {
    const { company, role, location, contactEmail, notes } = req.body;
    if (!company || !role) return res.status(400).json({ error: 'company and role are required' });

    const addDir = req.userCtx.additionsDir || ADDITIONS_DIR;
    if (!existsSync(addDir)) mkdirSync(addDir, { recursive: true });

    // Find next report number from per-user or root tracker
    const trackerPath = req.userCtx.trackerPath || TRACKER_PATH;
    let max = 0;
    if (existsSync(trackerPath)) {
      const existing = readFileSync(trackerPath, 'utf-8').split('\n');
      for (const line of existing) {
        if (!line.startsWith('|')) continue;
        const m = line.match(/^\|\s*(\d+)/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
    const num = max + 1;
    const date = new Date().toISOString().split('T')[0];
    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const tsvPath = join(addDir, `${num}-${slug}.tsv`);

    // Format: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
    const tsvContent = `${num}\t${date}\t${company}\t${role}\tApplied\tN/A\t❌\t[num](reports/xxx)\t${notes || ''}\n`;
    writeFileSync(tsvPath, tsvContent);

    // Run merge-tracker (for per-user mode, set cwd to userDir so it finds the right tracker)
    const userDir = req.userCtx.userDir;
    const r = spawnSync('node', [join(__dirname, 'merge-tracker.mjs')], {
      cwd: req.userCtx.userId ? userDir : __dirname,
      encoding: 'utf-8',
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    if (r.status !== 0 && r.status !== null) {
      return res.status(500).json({ error: r.stderr || 'merge-tracker failed', id: num, success: false });
    }

    res.json({ id: num, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message, success: false });
  }
});

// POST /email/send — supports both app password and OAuth2 (per-user and legacy)
app.post('/email/send', async (req, res) => {
  try {
    const { email, appPassword, company, role, body, to, pdfPath } = req.body;
    if (!email || !body) {
      return res.status(400).json({ error: 'email and body are required' });
    }

    // Determine auth method: per-user OAuth2 > legacy OAuth2 > app password
    const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
    const hasUserOAuth2 = userOAuth && userOAuth.refreshToken;
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    let authConfig;
    let authMethod = 'unknown';

    if (hasUserOAuth2) {
      // Per-user OAuth2: use their stored tokens
      let accessToken = userOAuth.accessToken;
      if (!accessToken || (userOAuth.expiresAt && Date.now() > userOAuth.expiresAt - 300000)) {
        // Refresh the token
        const tokenResp = await fetch(GMAIL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: userOAuth.clientId,
            client_secret: userOAuth.clientSecret,
            refresh_token: userOAuth.refreshToken,
            grant_type: 'refresh_token',
          }),
        });
        if (!tokenResp.ok) throw new Error(`Per-user token refresh failed: ${tokenResp.status}`);
        const tokenData = await tokenResp.json();
        accessToken = tokenData.access_token;
        // Update stored credentials with new access token
        userOAuth.accessToken = accessToken;
        userOAuth.expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0;
        setUserOAuth(req.userCtx.userId, userOAuth);
      }
      authConfig = {
        type: 'OAuth2',
        user: email,
        clientId: userOAuth.clientId,
        clientSecret: userOAuth.clientSecret,
        accessToken,
      };
      authMethod = 'per_user_oauth2';
    } else if (hasLegacyOAuth2) {
      const accessToken = await getGmailAccessToken();
      authConfig = {
        type: 'OAuth2',
        user: email,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        accessToken,
      };
      authMethod = 'legacy_oauth2';
    } else if (appPassword) {
      authConfig = { user: email, pass: appPassword };
      authMethod = 'app_password';
    } else {
      return res.status(400).json({ error: 'Either appPassword or OAuth2 credentials (per-user or legacy) required' });
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: authConfig,
    });

    const mailOpts = {
      from: email,
      to: to || email,
      subject: `Application for ${role || 'Unknown Role'} at ${company || 'Unknown Company'}`,
      text: body,
    };
    if (pdfPath && existsSync(pdfPath)) mailOpts.attachments = [{ path: pdfPath }];

    const info = await transporter.sendMail(mailOpts);
    res.json({ success: true, applicationId: 0, method: authMethod });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Shared IMAP fetch — single implementation used by /email/inbox and /email/triage
// Supports both app password and OAuth2 (XOAUTH2), per-user and legacy
async function fetchEmails(email, password, { daysBack = 30, maxEmails = 50, timeout = 30000, userOAuth = null } = {}) {
  // Determine auth method: per-user OAuth2 > legacy OAuth2 > app password
  const hasUserOAuth2 = userOAuth && userOAuth.refreshToken;
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  let imapConfig;

  if (hasUserOAuth2) {
    let accessToken = userOAuth.accessToken;
    if (!accessToken || (userOAuth.expiresAt && Date.now() > userOAuth.expiresAt - 300000)) {
      const tokenResp = await fetch(GMAIL_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: userOAuth.clientId,
          client_secret: userOAuth.clientSecret,
          refresh_token: userOAuth.refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (tokenResp.ok) {
        const tokenData = await tokenResp.json();
        accessToken = tokenData.access_token;
        userOAuth.accessToken = accessToken;
        userOAuth.expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0;
      }
    }
    imapConfig = {
      user: email,
      xoauth2: buildXoauth2String(email, accessToken),
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
    };
  } else if (hasLegacyOAuth2) {
    const accessToken = await getGmailAccessToken();
    imapConfig = {
      user: email,
      xoauth2: buildXoauth2String(email, accessToken),
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
    };
  } else {
    imapConfig = {
      user: email, password,
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
    };
  }

  return new Promise((resolve) => {
    const emails = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      emails.sort((a, b) => new Date(b.date) - new Date(a.date));
      // Assign sequential IDs after sorting
      emails.forEach((e, i) => { e.id = i + 1; });
      resolve(emails);
    };

    const imap = new Imap(imapConfig);

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err) => {
        if (err) { imap.end(); finish(); return; }
        const since = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
        imap.search(['ALL', ['SINCE', since]], (err, results) => {
          if (err || !results || results.length === 0) { imap.end(); finish(); return; }
          const latest = results.slice(-maxEmails);
          let pending = latest.length;
          let timedOut = false;

          if (pending === 0) { imap.end(); finish(); return; }

          const f = imap.fetch(latest, { bodies: '' });
          f.on('message', (msg) => {
            let buf = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buf += chunk.toString('utf-8'); });
              stream.on('end', () => {
                simpleParser(buf, (parseErr, parsed) => {
                  if (!parseErr && parsed) {
                    emails.push({
                      from: parsed.from?.text || '',
                      fromEmail: (parsed.from?.value?.[0]?.address) || '',
                      subject: parsed.subject || '',
                      date: parsed.date ? new Date(parsed.date).toISOString() : new Date(0).toISOString(),
                      preview: (parsed.text || '').substring(0, 200),
                      body: (parsed.text || '').substring(0, 5000),
                    });
                  }
                  pending--;
                  if (pending <= 0 && !timedOut) { timedOut = true; imap.end(); finish(); }
                });
              });
            });
            msg.on('end', () => {
              setTimeout(() => { if (pending <= 0 && !timedOut) { timedOut = true; imap.end(); finish(); } }, 2000);
            });
          });
          f.once('error', () => { if (!timedOut) { timedOut = true; imap.end(); finish(); } });
          f.once('end', () => {
            setTimeout(() => { if (!timedOut) { timedOut = true; imap.end(); finish(); } }, 5000);
          });
        });
      });
    });
    imap.once('error', () => { finish(); });
    imap.connect();
    setTimeout(() => { finish(); }, timeout);
  });
}

// ── Spam filter for inbox emails ──────────────────────────────────
// Flags obvious spam/non-recruiter mail without auto-deleting
function classifyEmailSpam(email) {
  const from = (email.fromEmail || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();
  const body = (email.body || '').toLowerCase();
  const preview = (email.preview || '').toLowerCase();

  // Spam signals
  const spamSignals = [];
  let spamScore = 0;

  // No-reply senders
  if (from.includes('no-reply') || from.includes('noreply') || from.includes('donotreply')) {
    spamSignals.push('no-reply sender');
    spamScore += 3;
  }

  // Marketing/promotional senders
  if (from.includes('marketing') || from.includes('newsletter') || from.includes('promo') || from.includes('offers')) {
    spamSignals.push('marketing sender');
    spamScore += 3;
  }

  // Unsubscribe indicators
  if (body.includes('unsubscribe') || body.includes('click here to stop') || body.includes('opt out')) {
    spamSignals.push('contains unsubscribe link');
    spamScore += 2;
  }

  // Job board alerts (not direct recruiter replies)
  if (from.includes('indeed') || from.includes('linkedin') || from.includes('naukri') || from.includes('glassdoor')) {
    spamSignals.push('job board alert');
    spamScore += 2;
  }

  // Sales/spam patterns
  if (subject.includes('limited time') || subject.includes('act now') || subject.includes('congratulations you won')) {
    spamSignals.push('sales/spam language');
    spamScore += 3;
  }

  // Very short body with links (typical spam)
  if (body.length < 100 && (body.includes('http') || body.includes('click'))) {
    spamSignals.push('short body with links');
    spamScore += 2;
  }

  // Legitimate recruiter signals (reduce spam score)
  if (body.includes('interview') || body.includes('position') || body.includes('role') || body.includes('resume')) {
    spamScore -= 2;
  }
  if (body.includes('hiring') || body.includes('apply') || body.includes('candidate')) {
    spamScore -= 1;
  }

  return {
    isSpam: spamScore >= 3,
    spamScore,
    signals: spamSignals,
  };
}

// GET /email/inbox — supports both app password and OAuth2, with spam filtering
app.get('/email/inbox', async (req, res) => {
  const email = req.query.email || process.env.GMAIL_USER;
  const appPassword = req.query.appPassword || process.env.GMAIL_APP_PASSWORD;
  const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
  const hasUserOAuth2 = userOAuth && userOAuth.refreshToken;
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  const includeSpam = req.query.includeSpam === 'true'; // opt-in to see spam

  if (!email) {
    return res.status(400).json({ error: 'email required — set GMAIL_USER env var or pass as query param' });
  }
  if (!appPassword && !hasUserOAuth2 && !hasLegacyOAuth2) {
    return res.status(400).json({ error: 'Either appPassword or OAuth2 credentials required — set GMAIL_APP_PASSWORD or provide OAuth2 via /users/:email/oauth/exchange' });
  }

  try {
    const allEmails = await fetchEmails(email, appPassword, { userOAuth });

    // Classify spam for each email
    const classified = allEmails.map(e => ({
      ...e,
      spam: classifyEmailSpam(e),
    }));

    // Split into legitimate and spam
    const legitimate = classified.filter(e => !e.spam.isSpam);
    const spam = classified.filter(e => e.spam.isSpam);

    res.json({
      emails: includeSpam ? classified : legitimate,
      total: allEmails.length,
      legitimateCount: legitimate.length,
      spamCount: spam.length,
      method: hasUserOAuth2 ? 'per_user_oauth2' : (hasLegacyOAuth2 ? 'legacy_oauth2' : 'app_password'),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /scan — uses real career-ops provider system (57 portals) + web search fallback
// Now includes: blacklist checking, scan history tracking, trust validation
app.post('/scan', async (req, res) => {
  try {
    const { keywords, locations } = req.body;
    const kw = (keywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
    const locs = (locations || []).map(l => l.toLowerCase().trim()).filter(Boolean);

    const portalsPath = join(__dirname, 'portals.yml');
    if (!existsSync(portalsPath)) return res.json({ results: [], summary: { portalsScanned: 0, totalFound: 0, filteredByKeywords: 0, duplicatesSkipped: 0, netNew: 0, tooBroad: false, narrowingHints: [] } });
    const py = yaml.load(readFileSync(portalsPath, 'utf-8'));
    const companies = py?.tracked_companies || [];
    const boards = py?.search_queries || [];

    // Load blacklist — same format as career-ops CLI (per-user or root)
    const blacklistPath = req.userCtx.blacklistPath || join(__dirname, 'data/blacklist.md');
    const blacklist = new Set();
    if (existsSync(blacklistPath)) {
      const blLines = readFileSync(blacklistPath, 'utf-8').split('\n');
      for (const line of blLines) {
        const m = line.match(/^\s*[-*]\s*(.+)/);
        if (m) blacklist.add(m[1].trim().toLowerCase());
      }
    }

    // Load scan history for dedup — same TSV as career-ops CLI (per-user or root)
    const scanHistPath = req.userCtx.scanHistory || SCAN_HISTORY;
    const scanHistory = new Map();
    if (existsSync(scanHistPath)) {
      const histLines = readFileSync(scanHistPath, 'utf-8').split('\n');
      for (const line of histLines) {
        const parts = line.split('\t');
        if (parts.length >= 2) scanHistory.set(parts[1], parts[0]);
      }
    }

    const providers = await loadProviders(join(__dirname, 'providers'));
    const results = [];
    const keywordMatched = []; // jobs that pass keyword filter (used for location fallback)
    const errored = [];
    let totalBeforeFilter = 0;

    // Phase 1: Provider-based scanning
    const providerTargets = [];
    const webSearchTargets = [];
    for (const entry of companies) {
      if (entry.enabled === false) continue;
      if (blacklist.has((entry.name || '').toLowerCase())) continue;
      const resolved = resolveProvider(entry, providers);
      if (resolved && !resolved.error) {
        providerTargets.push({ entry, provider: resolved.provider });
      } else if (entry.scan_query || entry.careers_url) {
        if (!blacklist.has((entry.name || '').toLowerCase())) webSearchTargets.push(entry);
      }
    }
    for (const entry of boards) {
      if (entry.enabled === false) continue;
      const resolved = resolveProvider(entry, providers);
      if (resolved && !resolved.error) providerTargets.push({ entry, provider: resolved.provider, isBoard: true });
    }

    // Provider results — two-tier: keyword match first, then location filter
    await Promise.all(providerTargets.map(async (t) => {
      try {
        const ctx = makeHttpCtx();
        const jobs = await t.provider.fetch(t.entry, ctx);
        totalBeforeFilter += jobs.length;
        for (const job of jobs) {
          const title = (job.title || '').toLowerCase();
          const loc = (job.location || '').toLowerCase();
          const matchesKw = kw.length === 0 || kw.some(k => title.includes(k));
          if (matchesKw) {
            const entry = { company: job.company || t.entry.name || '', role: job.title || '', location: job.location || '', url: job.url || '', matched: true, source: t.provider.id };
            keywordMatched.push(entry);
            const matchesLoc = locs.length === 0 || locs.some(l => loc.includes(l));
            if (matchesLoc) results.push(entry);
          }
        }
      } catch (e) {
        errored.push({ company: t.entry.name, error: e.message });
      }
    }));

    // Phase 2: Web search fallback for companies with no provider match
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    await Promise.all(webSearchTargets.slice(0, 15).map(async (entry) => {
      try {
        if (!entry.careers_url) return;
        const resp = await fetch(entry.careers_url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
        });
        if (!resp.ok) return;
        const html = await resp.text();
        // Match job title patterns in links and headings
        const titlePattern = /<a[^>]*href="([^"]*)"[^>]*>([^<]*(?:developer|engineer|full.?stack|frontend|backend|react|node|python|java|intern)[^<]*)<\/a>/gi;
        let m;
        while ((m = titlePattern.exec(html)) !== null) {
          const title = m[2].trim();
          const lower = title.toLowerCase();
          totalBeforeFilter++;
          if (kw.length === 0 || kw.some(k => lower.includes(k))) {
            const href = m[1].startsWith('http') ? m[1] : new URL(m[1], entry.careers_url).href;
            if (!keywordMatched.some(r => r.url === href)) {
              const entry2 = { company: entry.name || '', role: title, location: '', url: href, matched: true, source: 'websearch' };
              keywordMatched.push(entry2);
              results.push(entry2);
            }
          }
        }
      } catch {
        // timeout or fetch error — skip
      }
    }));
    clearTimeout(timeout);

    // Location fallback: if locations were set but zero results passed both filters,
    // fall back to keyword-only matches so the user gets something instead of nothing
    let locationTier = 'exact';
    if (locs.length > 0 && results.length === 0 && keywordMatched.length > 0) {
      results.push(...keywordMatched);
      locationTier = 'fallback';
    }

    // Dedup by url
    const seen = new Set();
    const beforeDedup = results.length;
    const deduped = results.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    const duplicatesSkipped = beforeDedup - deduped.length;
    const netNew = deduped.length;
    const filteredByKeywords = totalBeforeFilter - keywordMatched.length;
    const filteredByLocation = keywordMatched.length - (locationTier === 'fallback' ? keywordMatched.length : results.length);
    const portalsScanned = providerTargets.length + Math.min(webSearchTargets.length, 15);

    // Track scan history — append new URLs to data/scan-history.tsv (same as scan.mjs)
    const today = new Date().toISOString().slice(0, 10);
    for (const r of deduped) {
      if (r.url && !scanHistory.has(r.url)) {
        try { appendFileSync(SCAN_HISTORY, `${today}\t${r.url}\t${r.source || 'bridge'}\n`); } catch { /* non-fatal */ }
      }
    }

    // Determine if results are too broad and generate narrowing hints
    const narrowingHints = [];
    if (kw.length === 0) narrowingHints.push('No keyword filter — all roles matched');
    if (locs.length === 0) narrowingHints.push('No location filter — results include all locations');
    if (locationTier === 'fallback') narrowingHints.push(`No exact location matches — showing keyword-matched results instead`);
    if (netNew > 100) narrowingHints.push(`${netNew} results is a lot — consider narrowing keywords or adding a location`);

    res.json({
      total: totalBeforeFilter,
      newFound: netNew,
      results: deduped.slice(0, 100),
      errors: errored,
      webFallback: webSearchTargets.length,
      summary: {
        portalsScanned,
        totalFound: totalBeforeFilter,
        filteredByKeywords,
        filteredByLocation,
        duplicatesSkipped,
        netNew,
        locationTier,
        tooBroad: netNew > 100,
        narrowingHints,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message, results: [] });
  }
});

// GET /scan/stream — SSE progress stream for portal scanning
app.get('/scan/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); if (res.flush) res.flush(); };

  try {
    const kw = (req.query.keywords || '').split(',').map(k => k.toLowerCase().trim()).filter(Boolean);
    const locs = (req.query.locations || '').split(',').map(l => l.toLowerCase().trim()).filter(Boolean);

    const portalsPath = join(__dirname, 'portals.yml');
    if (!existsSync(portalsPath)) { send('done', { results: [], summary: { portalsScanned: 0, totalFound: 0, filteredByKeywords: 0, duplicatesSkipped: 0, netNew: 0 } }); return res.end(); }
    const py = yaml.load(readFileSync(portalsPath, 'utf-8'));
    const companies = py?.tracked_companies || [];
    const boards = py?.search_queries || [];

    const blacklistPath = join(__dirname, 'data/blacklist.md');
    const blacklist = new Set();
    if (existsSync(blacklistPath)) {
      for (const line of readFileSync(blacklistPath, 'utf-8').split('\n')) {
        const m = line.match(/^\s*[-*]\s*(.+)/);
        if (m) blacklist.add(m[1].trim().toLowerCase());
      }
    }

    const scanHistory = new Map();
    if (existsSync(SCAN_HISTORY)) {
      for (const line of readFileSync(SCAN_HISTORY, 'utf-8').split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 2) scanHistory.set(parts[1], parts[0]);
      }
    }

    let providers;
    try {
      providers = await loadProviders(join(__dirname, 'providers'));
    } catch (e) {
      console.error('[scan/stream] loadProviders failed:', e.message);
      providers = new Map();
    }
    let results = [];
    let keywordMatched = []; // all keyword-matched jobs (before location filter)
    let totalBeforeFilter = 0;
    const providerTargets = [];
    const webSearchTargets = [];

    for (const entry of companies) {
      if (entry.enabled === false) continue;
      if (blacklist.has((entry.name || '').toLowerCase())) continue;
      const resolved = resolveProvider(entry, providers);
      if (resolved && !resolved.error) providerTargets.push({ entry, provider: resolved.provider });
      else if (entry.scan_query || entry.careers_url) webSearchTargets.push(entry);
    }
    for (const entry of boards) {
      if (entry.enabled === false) continue;
      const resolved = resolveProvider(entry, providers);
      if (resolved && !resolved.error) providerTargets.push({ entry, provider: resolved.provider, isBoard: true });
    }

    const totalPortals = providerTargets.length + Math.min(webSearchTargets.length, 15);
    let completed = 0;

    send('start', { totalPortals, phase: 'providers' });

    // Phase 1: provider scanning (sequential for progress)
    for (const t of providerTargets) {
      try {
        const ctx = makeHttpCtx();
        const jobs = await t.provider.fetch(t.entry, ctx);
        totalBeforeFilter += jobs.length;
        for (const job of jobs) {
          const title = (job.title || '').toLowerCase();
          const loc = (job.location || '').toLowerCase();
          const matchesKw = kw.length === 0 || kw.some(k => title.includes(k));
          if (matchesKw) {
            const entry = { company: job.company || t.entry.name || '', role: job.title || '', location: job.location || '', url: job.url || '', matched: true, source: t.provider.id };
            keywordMatched.push(entry);
            const matchesLoc = locs.length === 0 || locs.some(l => loc.includes(l));
            if (matchesLoc) results.push(entry);
          }
        }
      } catch { /* skip */ }
      completed++;
      send('progress', { completed, total: totalPortals, current: t.entry.name || 'unknown', found: results.length });
    }

    // Phase 2: web search fallback
    if (webSearchTargets.length > 0) send('start', { totalPortals: webSearchTargets.length, phase: 'websearch' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    for (const entry of webSearchTargets.slice(0, 15)) {
      try {
        if (!entry.careers_url) continue;
        const resp = await fetch(entry.careers_url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!resp.ok) continue;
        const html = await resp.text();
        const titlePattern = /<a[^>]*href="([^"]*)"[^>]*>([^<]*(?:developer|engineer|full.?stack|frontend|backend|react|node|python|java|intern)[^<]*)<\/a>/gi;
        let m;
        while ((m = titlePattern.exec(html)) !== null) {
          const title = m[2].trim();
          const lower = title.toLowerCase();
          totalBeforeFilter++;
          if (kw.length === 0 || kw.some(k => lower.includes(k))) {
            const href = m[1].startsWith('http') ? m[1] : new URL(m[1], entry.careers_url).href;
            if (!keywordMatched.some(r => r.url === href)) {
              const entry2 = { company: entry.name || '', role: title, location: '', url: href, matched: true, source: 'websearch' };
              keywordMatched.push(entry2);
              if (!results.some(r => r.url === href)) {
                results.push(entry2);
              }
            }
          }
        }
      } catch { /* skip */ }
      completed++;
      send('progress', { completed, total: totalPortals, current: entry.name || 'web', found: results.length });
    }
    clearTimeout(timeout);

    // Location fallback: if locations were specified but nothing matched both keyword AND location,
    // fall back to keyword-only results so the user sees something
    let locationFallback = false;
    if (results.length === 0 && keywordMatched.length > 0 && locs.length > 0) {
      results = keywordMatched;
      locationFallback = true;
    }

    // Dedup
    const seen = new Set();
    const deduped = results.filter(r => { if (seen.has(r.url)) return false; seen.add(r.url); return true; });
    const today = new Date().toISOString().slice(0, 10);
    for (const r of deduped) {
      if (r.url && !scanHistory.has(r.url)) {
        try { appendFileSync(SCAN_HISTORY, `${today}\t${r.url}\t${r.source || 'bridge'}\n`); } catch { /* non-fatal */ }
      }
    }

    send('done', {
      total: totalBeforeFilter,
      newFound: deduped.length,
      results: deduped.slice(0, 100),
      summary: {
        portalsScanned: totalPortals,
        totalFound: totalBeforeFilter,
        filteredByKeywords: totalBeforeFilter - keywordMatched.length,
        filteredByLocation: keywordMatched.length - results.length + (locationFallback ? keywordMatched.length - deduped.length : 0),
        duplicatesSkipped: results.length - deduped.length,
        netNew: deduped.length,
        locationFallback,
        tooBroad: deduped.length > 100,
        narrowingHints: deduped.length > 100 ? ['Too many results — narrow keywords'] : [],
      },
    });
    res.end();
  } catch (e) {
    send('error', { error: e.message });
    res.end();
  }
});

// POST /resume/upload — accepts PDF/DOCX, extracts text, returns structured profile + suggestions
app.post('/resume/upload', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;
    const ext = req.file.originalname?.toLowerCase() || '';
    let text = '';

    if (ext.endsWith('.pdf')) {
      if (pdftotextAvailable) {
        const r = spawnSync('pdftotext', [filePath, '-'], { encoding: 'utf-8', timeout: 30000 });
        text = (r.stdout || '').trim();
      }
      if (!text && pdfParse) {
        const buf = readFileSync(filePath);
        const r = await pdfParse(buf);
        text = (r.text || '').trim();
      }
    } else if (ext.endsWith('.docx') && mammoth) {
      const buf = readFileSync(filePath);
      const r = await mammoth.extractRawText({ buffer: buf });
      text = (r.value || '').trim();
    } else {
      try { text = readFileSync(filePath, 'utf-8').trim(); } catch { /* fall through */ }
    }

    try { unlinkSync(filePath); } catch { /* cleanup */ }

    if (!text) return res.status(400).json({ error: 'Could not extract text from file' });

    // Write raw text to data/cv.md — the canonical CV file for career-ops (per-user or root)
    const cvDir = req.userCtx.dataDir || join(__dirname, 'data');
    if (!existsSync(cvDir)) mkdirSync(cvDir, { recursive: true });
    const cvWritePath = req.userCtx.cvPath || join(cvDir, 'cv.md');
    writeFileSync(cvWritePath, text, 'utf-8');

    // Parse profile from text
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const name = lines[0] || '';
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const email = emailMatch ? emailMatch[0] : '';
    const phoneMatch = text.match(/\+91\s*\d{5}\s*\d{5}|(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
    const phone = phoneMatch ? phoneMatch[0] : '';
    const linkMatches = text.matchAll(/https?:\/\/[^\s]+/g);
    const links = [...new Set([...linkMatches].map(m => m[0]))];

    // ── Skill extraction — stream-agnostic, no predefined bank ──
    const textLower = text.toLowerCase();
    const ROLE_SUFFIXES = /(?:developer|engineer|architect|designer|manager|analyst|scientist|consultant|specialist|lead|administrator|accountant|officer|executive|coordinator|supervisor|therapist|nurse|doctor|agent|broker|instructor|teacher|professor|technician|mechanic|inspector|auditor|controller|planner|surveyor|pharmacist|dietitian|counselor|social worker)/i;
    let skills = [];
    const skillsSectionMatch = text.match(/(?:skills|tools|technologies|competencies|proficiencies|technical skills)[:\s]*\n([\s\S]*?)(?:\n\s*\n|\n(?=[A-Z]))/i);
    if (skillsSectionMatch) {
      // Extract comma, pipe, or dash separated items from the skills section
      skills = skillsSectionMatch[1]
        .split(/[,|•·–—]/)
        .map(s => stripMarkdown(s.replace(/^[\s\d.)\-*]+/, '').trim()))
        .filter(s => s.length > 1 && s.length < 60)
        .slice(0, 20);
    }
    // Fallback: if no skills section found, extract capitalized multi-word professional terms (line-by-line)
    // Exclude the candidate's own name (e.g. "Rahul Sharma") from appearing as a "skill"
    const nameWords = name.replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s*/i, '').split(/\s+/).filter(Boolean);
    if (skills.length === 0) {
      skills = [...new Set(
        lines.flatMap(l => (l.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || []))
          .filter(t => t.length > 3 && !/^(Dear|Subject|Resume|Curriculum|Contact|Phone|Email|Address|Date|References)/.test(t))
          .filter(t => !nameWords.every(w => t.includes(w)))
      )].slice(0, 15);
    }

    // ── Role/title extraction — from the resume, not a list ──
    // Strategy 1: look for explicit title patterns (Senior X, Lead X, X Manager, etc.)
    const TITLE_PATTERNS = /\b(?:junior|senior|lead|principal|staff|chief|head|vp|director|associate|assistant|certified|chartered|licensed|registered)?\s*(?:[A-Za-z.#+-]+\s+){0,2}(?:developer|engineer|architect|designer|manager|analyst|scientist|consultant|specialist|lead|administrator|accountant|officer|executive|coordinator|supervisor|therapist|nurse|doctor|agent|broker|assistant|officer|instructor|teacher|professor|technician|mechanic|inspector|auditor|controller|planner|surveyor|pharmacist|dietitian|therapist|counselor|social worker)\b/gi;
    const rolePhrases = [...new Set(
      lines.flatMap(l => (l.match(TITLE_PATTERNS) || []).map(r => r.trim()))
    )].slice(0, 8);
    // Strategy 2: first significant line is often the current title (skip name, contact info)
    const titleLine = lines.find(l =>
      l.length > 3 && l.length < 80 &&
      !/^[A-Z0-9._%+-]+@/.test(l) &&
      !/^\+?\d/.test(l) &&
      !/^(http|www\.|linkedin|github)/i.test(l) &&
      !/^(curriculum|resume|cv|contact|phone|email|address)/i.test(l) &&
      ROLE_SUFFIXES.test(l)
    );
    const suggestedKeywords = [...new Set([
      ...rolePhrases,
      ...(titleLine ? [titleLine.trim()] : []),
      ...skills.slice(0, 5),
    ])].slice(0, 10).map(stripMarkdown);

    // ── Location extraction — worldwide, not India-only ──
    // Extract any city-like proper nouns that appear near address/contact sections
    // or are mentioned in the first 20 lines (header area)
    const headerText = lines.slice(0, 20).join(' ').toLowerCase();
    const bodyText = textLower;
    // Match common city patterns: standalone capitalized words in address-like context
    const CITY_PATTERN = /\b(?:mumbai|kalyan|thane|navi mumbai|pune|bangalore|bengaluru|delhi|gurgaon|noida|hyderabad|chennai|kolkata|ahmedabad|goa|jaipur|lucknow|coimbatore|indore|nagpur|surat|vadodara|visakhapatnam|remote|india|usa|uk|canada|australia|singapore|dubai|uae|abu dhabi|sharjah|london|manchester|birmingham|new york|san francisco|seattle|toronto|vancouver|berlin|munich|paris|amsterdam|tokyo|seoul|hong kong|shanghai|bangkok|jakarta|manila|nairobi|lagos|johannesburg|cape town|sao paulo|mexico city|buenos aires|berlin|madrid|barcelona|rome|milan|zurich|vienna|prague|warsaw|budapest|lisbon|dublin)\b/gi;
    const suggestedLocations = [...new Set(
      (bodyText.match(CITY_PATTERN) || []).map(l => l.charAt(0).toUpperCase() + l.slice(1).toLowerCase())
    )].slice(0, 5);

    const existing = (() => {
      const pPath = req.userCtx.profilePath || PROFILE_PATH;
      if (!existsSync(pPath)) return {};
      return yaml.load(readFileSync(pPath, 'utf-8')) || {};
    })();
    if (!existing.candidate) existing.candidate = {};
    if (name && !existing.candidate?.full_name) { existing.candidate.full_name = name; }
    if (email) existing.candidate.email = email;
    if (phone) existing.candidate.phone = phone;
    // Write back to per-user or root profile
    const profileWritePath = req.userCtx.profilePath || PROFILE_PATH;
    const profileDir = dirname(profileWritePath);
    if (!existsSync(profileDir)) mkdirSync(profileDir, { recursive: true });
    writeFileSync(profileWritePath, yaml.dump(existing, { indent: 2, lineWidth: -1, noRefs: true }));

    const portfolioUrl = links.find(l => l.includes('github') || l.includes('portfolio')) || '';
    const linkedinUrl = links.find(l => l.includes('linkedin')) || '';

    // Compensation guess — stream-agnostic, derived from seniority signals and location.
    // This is a rough heuristic. The onboarding confirmation step lets the user correct it.
    // Reasoning is included so the UI can explain *why* a number was guessed.
    const hasSeniorSignals = /senior|lead|principal|staff|head|director|vp|architect|chief|10\+|8\+|12\+|15\+/i.test(text);
    const hasInternSignals = /\bintern(?:ship)?\b|\bfresher\b|\bentry.?level\b|\bjunior\b/i.test(text);
    const hasExperienceYears = (text.match(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b/i) || [])[1];
    const expYears = hasExperienceYears ? parseInt(hasExperienceYears) : 0;
    const locationLower = text.toLowerCase();
    const isMetroCity = /mumbai|bangalore|pune|delhi|gurgaon|noida|hyderabad|chennai|london|new york|san francisco|singapore|dubai|toronto|berlin|tokyo/i.test(locationLower);
    let compensationGuess = '';
    let compensationReason = '';
    if (hasInternSignals) {
      compensationGuess = '1.5-3 LPA';
      compensationReason = 'Resume mentions intern/fresher level — typical entry-level range';
    } else if (hasSeniorSignals || expYears >= 8) {
      compensationGuess = isMetroCity ? '15-30 LPA' : '10-20 LPA';
      compensationReason = `Senior-level signals detected${isMetroCity ? ' in a metro city' : ''} — senior range`;
    } else if (expYears >= 3) {
      compensationGuess = isMetroCity ? '6-12 LPA' : '4-8 LPA';
      compensationReason = `${expYears} years experience${isMetroCity ? ' in a metro city' : ''} — mid-level range`;
    } else if (isMetroCity) {
      compensationGuess = '3-6 LPA';
      compensationReason = 'Metro city location detected — typical range for early-career roles';
    } else {
      compensationGuess = '2.5-5 LPA';
      compensationReason = 'No strong seniority signals — entry-to-mid range estimate';
    }

    res.json({
      success: true,
      name, email, phone,
      skills: suggestedKeywords,
      portfolio: portfolioUrl,
      linkedin: linkedinUrl,
      suggestedKeywords,
      suggestedLocations,
      compensationGuess,
      compensationReason,
      fileName: req.file.originalname || ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /email/triage — classify inbox emails server-side into recruiter replies / spam / other
app.post('/email/triage', async (req, res) => {
  const { email, appPassword } = req.body;
  const user = email || process.env.GMAIL_USER;
  const pass = appPassword || process.env.GMAIL_APP_PASSWORD;
  const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
  const hasUserOAuth2 = userOAuth && userOAuth.refreshToken;
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  if (!user) return res.status(400).json({ error: 'email required' });
  if (!pass && !hasUserOAuth2 && !hasLegacyOAuth2) return res.status(400).json({ error: 'appPassword or OAuth2 credentials required' });

  const allEmails = await fetchEmails(user, pass, { userOAuth });
  const triaged = allEmails.map(e => {
    const subj = (e.subject || '').toLowerCase();
    const body = (e.body || '').toLowerCase();
    const isInterview = /interview|schedule|meeting|phone screen|zoom|teams|on-site/i.test(subj) ||
      /schedule|availability|next step/i.test(body);
    const isRejection = /reject|unfortunately|not moving forward|decided to pursue other/i.test(subj) ||
      /unfortunately|not selected|other candidates/i.test(body);
    const isOffer = /offer|congratulations|pleased to inform|compensation|package/i.test(subj) ||
      /offer letter|join|start date/i.test(body);
    const isRecruiter = /recruiter|talent.?acquisition|hiring manager|your application/i.test(subj) ||
      /resume|application|profile|opportunity/i.test(body);
    const isSpam = /unsubscribe|promotion|newsletter|discount|you won|click here|limited time/i.test(subj) ||
      /marketing|sale|offer|subscribe/i.test(body);
    let classification = 'noise';
    if (isInterview) classification = 'interview';
    else if (isOffer) classification = 'offer';
    else if (isRejection) classification = 'rejection';
    else if (isRecruiter) classification = 'recruiter_reply';
    else if (isSpam) classification = 'spam';
    return { ...e, classification };
  });
  res.json({ emails: triaged });
});

// GET /portals — list available tracked companies and boards
app.get('/portals', (req, res) => {
  try {
    const portalsPath = join(__dirname, 'portals.yml');
    if (!existsSync(portalsPath)) return res.json({ companies: [], boards: [] });
    const py = yaml.load(readFileSync(portalsPath, 'utf-8'));
    res.json({
      companies: (py?.tracked_companies || []).filter(c => c.enabled !== false).map(c => ({ name: c.name, url: c.careers_url || '' })),
      boards: (py?.search_queries || []).filter(b => b.enabled !== false).map(b => ({ name: b.name, query: b.query || '' })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message, companies: [], boards: [] });
  }
});

// POST /email/reply — draft a contextual reply using profile data
app.post('/email/reply', async (req, res) => {
  try {
    const { email, appPassword, to, subject, originalBody, replyType } = req.body;
    if (!email || !appPassword || !to) return res.status(400).json({ error: 'email, appPassword, and to are required' });

    const profile = readProfile();
    const c = profile.candidate || {};
    const name = c.full_name || 'Candidate';
    const phone = c.phone || '';
    const loc = profile.location?.city || '';

    let replyBody = '';
    const type = (replyType || 'interview').toLowerCase();

    if (type === 'interview') {
      replyBody = `Dear Hiring Team,\n\nThank you for your invitation. I would be delighted to attend an interview at your earliest convenience. I am available on weekdays, preferably in the afternoon (2 PM - 5 PM IST).\n\nPlease let me know if you need any additional information or documents from my side.\n\nLooking forward to speaking with you.\n\nBest regards,\n${name}\n${phone || ''}`.trim();
    } else if (type === 'follow_up') {
      replyBody = `Dear Hiring Team,\n\nI hope this message finds you well. I am writing to follow up on my application for the role. I remain very interested in the opportunity and would appreciate any update on the status of my application.\n\nThank you for your time and consideration.\n\nBest regards,\n${name}\n${phone || ''}`.trim();
    } else if (type === 'accept_offer') {
      replyBody = `Dear Hiring Team,\n\nThank you for the offer. I am thrilled to accept and look forward to joining the team. Please let me know the next steps regarding onboarding and any documents you need from my side.\n\nBest regards,\n${name}\n${phone || ''}`.trim();
    } else if (type === 'negotiate') {
      const comp = profile.compensation?.target_range || '5-6 LPA';
      replyBody = `Dear Hiring Team,\n\nThank you for the offer. I am very excited about the role and the opportunity to contribute to your team. Before I accept, I was hoping we could discuss the compensation package. Based on my experience and the market rate for this role in ${loc || 'Mumbai'}, I was expecting something in the range of ${comp}. I am confident I can deliver strong value and would love to make this work.\n\nI look forward to hearing your thoughts.\n\nBest regards,\n${name}\n${phone || ''}`.trim();
    } else {
      replyBody = `Dear Team,\n\nThank you for your message.\n\nBest regards,\n${name}`.trim();
    }

    res.json({ replyBody, subject: `Re: ${subject || ''}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /auto-pipeline — evaluate a JD via opencode (career-ops agent), save report + tracker row
app.post('/auto-pipeline', async (req, res) => {
  let evaluation = { score: 'N/A', fit: '', strengths: [], gaps: [] };
  let jdText = '';

  try {
    const { url, company, role } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    // Fetch JD content for opencode context
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const html = await resp.text();
        jdText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
      }
    } catch { /* fetch failed — opencode will handle it */ }

    // Delegate to opencode — the career-ops AI agent
    const prompt = jdText
      ? `Evaluate this job posting using career-ops auto-pipeline mode. Return ONLY a JSON object (no markdown, no code fences) with these fields: {"score": "X.X", "fit": "1-2 sentence fit assessment", "strengths": ["s1","s2"], "gaps": ["g1"]}. Score is 1.0-5.0. Be honest and conservative. Job URL: ${url} Company: ${company || 'Unknown'} Role: ${role || 'Unknown'} JD text: ${jdText.slice(0, 6000)}`
      : `Evaluate this job posting using career-ops auto-pipeline mode. Return ONLY a JSON object (no markdown, no code fences) with these fields: {"score": "X.X", "fit": "1-2 sentence fit assessment", "strengths": ["s1","s2"], "gaps": ["g1"]}. Score is 1.0-5.0. Be honest and conservative. Job URL: ${url} Company: ${company || 'Unknown'} Role: ${role || 'Unknown'}`;

    const result = await runOpencode(prompt, 120000, userCwd(req));

    // Parse JSON from opencode response (handle markdown fences, prefixes)
    try {
      const jsonMatch = result.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0]);
      } else {
        evaluation = { score: 'N/A', fit: result.slice(0, 200) };
      }
    } catch {
      evaluation = { score: 'N/A', fit: result.slice(0, 200) };
    }
  } catch (e) {
    evaluation = { score: 'N/A', fit: `Error: ${e.message}` };
  }

  const score = evaluation.score || 'N/A';
  const companySlug = (req.body.company || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const today = new Date().toISOString().slice(0, 10);

  // Find next report number (per-user)
  const reportDir = userReportDir(req);
  const nextNum = nextReportNumForDir(reportDir);
  const numStr = String(nextNum).padStart(3, '0');

  // Save report to user's directory
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${numStr}-${companySlug}-${today}.md`);
  const reportContent = `# Evaluation Report #${numStr}

**Company:** ${req.body.company || 'Unknown'}
**Role:** ${req.body.role || 'Unknown'}
**URL:** ${req.body.url || ''}
**Date:** ${today}
**Score:** ${score}/5
**PDF:** ❌

## Fit Assessment
${evaluation.fit || 'N/A'}

## Strengths
${(evaluation.strengths || []).map(s => `- ${s}`).join('\n') || '- N/A'}

## Gaps
${(evaluation.gaps || []).map(g => `- ${g}`).join('\n') || '- None identified'}
`;
  writeFileSync(reportPath, reportContent, 'utf-8');

  // Update tracker — append TSV to user's batch/tracker-additions
  const additionsDir = userAdditionsDir(req);
  if (!existsSync(additionsDir)) mkdirSync(additionsDir, { recursive: true });
  const tsvPath = join(additionsDir, `${numStr}-${companySlug}.tsv`);
  const tsvLine = `${numStr}\t${today}\t${req.body.company || 'Unknown'}\t${req.body.role || 'Unknown'}\tEvaluated\t${score}/5\t❌\t[${numStr}](reports/${numStr}-${companySlug}-${today}.md)\tAuto-pipeline (opencode)`;
  writeFileSync(tsvPath, tsvLine + '\n', 'utf-8');

  // Run merge-tracker from user dir or root
  try {
    spawnSync('node', ['merge-tracker.mjs'], { cwd: userCwd(req), encoding: 'utf-8', timeout: 10000 });
  } catch { /* non-fatal */ }

  res.json({
    score,
    reportNum: nextNum,
    reportPath: `${numStr}-${companySlug}-${today}.md`,
    fit: evaluation.fit,
    strengths: evaluation.strengths || [],
    gaps: evaluation.gaps || [],
  });
});

// POST /email/credentials — save Gmail credentials
// With X-User-Id header: saves to per-user .oauth2.json
// Without header: saves to .bridge.env (legacy single-user)
app.post('/email/credentials', (req, res) => {
  try {
    const { gmailUser, appPassword, clientId, clientSecret, refreshToken } = req.body;
    if (!gmailUser) {
      return res.status(400).json({ success: false, error: 'gmailUser is required' });
    }

    // Per-user mode: store in user's directory
    if (req.userCtx.userId && clientId && refreshToken) {
      const creds = {
        email: gmailUser,
        clientId,
        clientSecret,
        accessToken: '',
        refreshToken,
        expiresAt: 0,
        tokenType: 'Bearer',
        scope: 'openid https://mail.google.com/',
        storedAt: new Date().toISOString(),
      };
      setUserOAuth(req.userCtx.userId, creds);

      // Also update runtime env for legacy fallback paths
      process.env.GMAIL_USER = gmailUser;
      process.env.GMAIL_CLIENT_ID = clientId;
      process.env.GMAIL_CLIENT_SECRET = clientSecret;
      process.env.GMAIL_REFRESH_TOKEN = refreshToken;

      return res.json({ success: true, method: 'per_user_oauth2', storage: 'user_dir' });
    }

    // Legacy single-user mode: update runtime env and .bridge.env
    process.env.GMAIL_USER = gmailUser;
    if (appPassword) process.env.GMAIL_APP_PASSWORD = appPassword;
    if (clientId) process.env.GMAIL_CLIENT_ID = clientId;
    if (clientSecret) process.env.GMAIL_CLIENT_SECRET = clientSecret;
    if (refreshToken) process.env.GMAIL_REFRESH_TOKEN = refreshToken;

    // Persist to .bridge.env
    const envPath = join(__dirname, '.bridge.env');
    const lines = [];
    const keysToSet = ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];
    if (existsSync(envPath)) {
      const existing = readFileSync(envPath, 'utf-8').split('\n');
      for (const line of existing) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) { lines.push(line); continue; }
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          if (keysToSet.includes(key)) continue; // replace
        }
        lines.push(line);
      }
    }
    lines.push(`GMAIL_USER=${gmailUser}`);
    if (appPassword) lines.push(`GMAIL_APP_PASSWORD=${appPassword}`);
    if (clientId) lines.push(`GMAIL_CLIENT_ID=${clientId}`);
    if (clientSecret) lines.push(`GMAIL_CLIENT_SECRET=${clientSecret}`);
    if (refreshToken) lines.push(`GMAIL_REFRESH_TOKEN=${refreshToken}`);
    writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');

    // Clear cached token so next request uses new credentials
    cachedGmailToken = null;
    gmailTokenExpiry = 0;

    res.json({ success: true, method: clientId ? 'legacy_oauth2' : 'app_password', storage: 'bridge.env' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /liveness — check job posting URLs for liveness via check-liveness.mjs
app.post('/liveness', (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'urls array is required' });
    }
    const script = join(__dirname, 'check-liveness.mjs');
    if (!existsSync(script)) {
      return res.status(500).json({ error: 'check-liveness.mjs not found' });
    }
    // Write URLs to a temp file, run the checker
    const tmpFile = join(__dirname, 'data', `_liveness_check_${Date.now()}.txt`);
    writeFileSync(tmpFile, urls.join('\n'), 'utf-8');
    try {
      const r = spawnSync('node', [script, '--file', tmpFile], {
        cwd: __dirname,
        encoding: 'utf-8',
        timeout: 60000
      });
      try { unlinkSync(tmpFile); } catch {}
      if (r.status !== 0) {
        return res.status(500).json({ error: r.stderr || 'liveness check failed' });
      }
      try {
        res.json(JSON.parse((r.stdout || '{}').trim()));
      } catch {
        // Parse line-by-line results
        const lines = (r.stdout || '').split('\n').filter(Boolean);
        const results = lines.map(line => {
          try { return JSON.parse(line); } catch { return { url: line, status: 'unknown' }; }
        });
        res.json({ results });
      }
    } catch (e) {
      try { unlinkSync(tmpFile); } catch {}
      res.status(500).json({ error: e.message });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /gmail/test — verify Gmail SMTP credentials work
app.post('/gmail/test', async (req, res) => {
  try {
    const nodemailer = require('nodemailer');
    const email = req.body.email || process.env.GMAIL_USER;
    const password = req.body.appPassword || process.env.GMAIL_APP_PASSWORD;
    const oauthCreds = req.userCtx?.oauthPath ? getUserOAuth(req.userCtx.userId) : null;

    if (!email) {
      return res.status(400).json({ success: false, error: 'No Gmail address configured. Set GMAIL_USER in .bridge.env or provide email in request body.' });
    }

    // Try OAuth2 first if available
    if (oauthCreds?.refreshToken && oauthCreds?.clientId) {
      try {
        const accessToken = await getGmailAccessToken();
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: { type: 'OAuth2', user: email, clientId: oauthCreds.clientId, clientSecret: oauthCreds.clientSecret, refreshToken: oauthCreds.refreshToken, accessToken },
        });
        await transporter.verify();
        return res.json({ success: true, method: 'oauth2', email, message: 'Gmail OAuth2 connection verified successfully.' });
      } catch (e) {
        // Fall through to app password
      }
    }

    // Try app password
    if (password) {
      try {
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com', port: 465, secure: true,
          auth: { user: email, pass: password },
        });
        await transporter.verify();
        return res.json({ success: true, method: 'app_password', email, message: 'Gmail app password verified successfully.' });
      } catch (e) {
        return res.json({ success: false, method: 'app_password', error: `App password verification failed: ${e.message}. Generate a new one at https://myaccount.google.com/apppasswords` });
      }
    }

    res.json({ success: false, error: `No credentials available for ${email}. Either set GMAIL_APP_PASSWORD in .bridge.env or configure OAuth2 via /users/${email}/oauth/exchange.` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /followups — get follow-up cadence from followup-cadence.mjs
app.get('/followups', (req, res) => {
  try {
    const script = join(__dirname, 'followup-cadence.mjs');
    if (!existsSync(script)) {
      return res.status(500).json({ error: 'followup-cadence.mjs not found' });
    }
    const r = spawnSync('node', [script, '--json'], {
      cwd: __dirname,
      encoding: 'utf-8',
      timeout: 30000
    });
    if (r.status !== 0) {
      return res.status(500).json({ error: r.stderr || 'followup-cadence failed' });
    }
    try {
      res.json(JSON.parse((r.stdout || '[]').trim()));
    } catch {
      // Fallback: return raw output wrapped in array
      const lines = (r.stdout || '').split('\n').filter(Boolean);
      res.json({ entries: lines });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /email/classify — classify an email via opencode (replaces direct Anthropic calls)
app.post('/email/classify', async (req, res) => {
  try {
    const { from, fromEmail, subject, preview } = req.body;
    if (!subject) return res.status(400).json({ error: 'subject required' });

    const prompt = `You are a job-search email classifier. Classify this email as one of: job_reply, job_alert, spam.
Return ONLY a JSON object (no markdown, no code fences): {"classification": "job_reply|job_alert|spam", "confidence": 0.0-1.0, "reason": "brief explanation"}

Email:
From: ${from || 'Unknown'} <${fromEmail || 'unknown'}>
Subject: ${subject}
Preview: ${(preview || '').slice(0, 500)}`;

    const result = await runOpencode(prompt, 60000, userCwd(req));

    // Parse JSON from response
    let classification = { classification: 'spam', confidence: 0.5, reason: 'parse_error' };
    try {
      const jsonMatch = result.match(/\{[\s\S]*?\}/);
      if (jsonMatch) classification = JSON.parse(jsonMatch[0]);
    } catch { /* fallback to default */ }

    res.json(classification);
  } catch (e) {
    res.json({ classification: 'spam', confidence: 0.0, reason: `Error: ${e.message}` });
  }
});

// POST /email/cover-letter — generate a cover letter via opencode (replaces direct Anthropic calls)
app.post('/email/cover-letter', async (req, res) => {
  try {
    const { company, role, resume, jd } = req.body;
    if (!company || !role) return res.status(400).json({ error: 'company and role required' });

    const userCv = resume || readUserCv(req);

    const prompt = `Write a concise, tailored job application email body (3-4 paragraphs).
Structure: introduction, relevant highlights from the resume, why this role, closing.
Never invent claims. Reorder and emphasize existing experience from the resume.

RESUME:
${userCv.slice(0, 4000)}

JOB: ${role} at ${company}
${jd ? `JD: ${jd.slice(0, 3000)}` : ''}

Return ONLY the email body text (no markdown, no JSON, no code fences).`;

    const result = await runOpencode(prompt, 120000, userCwd(req));

    // Strip markdown fences if present
    let coverLetter = result.trim();
    coverLetter = coverLetter.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '').trim();

    res.json({ coverLetter });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── new workflow endpoints ──────────────────────────────────────────

// POST /email/draft — formal application email (hr_application, referral, cold, process_stuck)
app.post('/email/draft', async (req, res) => {
  try {
    const { type, company, role, jd, contactName, reportNum } = req.body;
    const cv = readUserCv(req);
    const profile = readUserProfileRaw(req);
    const prompt = `You are a job application email drafter. Generate a formal application email.
Type: ${type || 'hr_application'}
Company: ${company || 'Unknown'}
Role: ${role || 'Unknown'}
Contact: ${contactName || 'Hiring Team'}
${jd ? `JD: ${jd.slice(0, 3000)}` : ''}
${reportNum ? `Report: #${reportNum}` : ''}

CV excerpt: ${cv}
Candidate name: ${profile?.candidate?.full_name || 'Candidate'}
Candidate email: ${profile?.candidate?.email || ''}
Candidate phone: ${profile?.candidate?.phone || ''}

Return JSON: {"subject": "...", "body": "...", "contactBlock": "..."}`;

    const result = await runOpencode(prompt, 120000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { subject: '', body: result.trim().slice(0, 2000), contactBlock: '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /outreach — LinkedIn recruiter/hiring manager outreach (contacto)
app.post('/outreach', async (req, res) => {
  try {
    const { company, role, contactType, jd, contactName } = req.body;
    const cv = readUserCv(req);
    const prompt = `You are a job outreach message generator. Create a ≤300 character LinkedIn connection request.
Company: ${company || 'Unknown'}
Role: ${role || 'Unknown'}
Contact type: ${contactType || 'recruiter'}
Contact name: ${contactName || ''}
${jd ? `JD: ${jd.slice(0, 2000)}` : ''}
CV excerpt: ${cv}

Rules: max 300 chars. No corporate speak. No "passionate about". Lead with value.
Return JSON: {"message": "...", "charCount": N, "contactType": "..."}`;

    const result = await runOpencode(prompt, 120000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { message: result.trim().slice(0, 300), charCount: result.trim().length, contactType: contactType || 'recruiter' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /deep — company research (6-axis)
app.post('/deep', async (req, res) => {
  try {
    const { company, role } = req.body;
    const prompt = `Research this company for a job application. Return JSON with 6 axes:
Company: ${company}
${role ? `Role: ${role}` : ''}

Return JSON: {"ai_strategy": "...", "recent_moves": "...", "engineering_culture": "...", "challenges": "...", "competitors": "...", "candidate_angle": "..."}`;

    const result = await runOpencode(prompt, 180000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { summary: result.trim().slice(0, 3000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /interview-prep — company-specific interview preparation
app.post('/interview-prep', async (req, res) => {
  try {
    const { company, role, reportNum } = req.body;
    const cv = readUserCv(req);
    const reportDir = userReportDir(req);
    const report = reportNum ? (() => {
      try { const f = readdirSync(reportDir).filter(f => f.startsWith(String(reportNum).padStart(3, '0'))); return f.length ? readFileSync(join(reportDir, f[0]), 'utf-8').slice(0, 4000) : ''; } catch { return ''; }
    })() : '';
    const prompt = `Generate interview prep for this company.
Company: ${company}
Role: ${role || ''}
CV: ${cv}
${report ? `Report: ${report}` : ''}

Return JSON: {"likely_questions": ["q1","q2","q3","q4","q5"], "star_stories": [{"situation":"...","task":"...","action":"...","result":"..."}], "company_red_flags": ["..."], "questions_to_ask": ["..."], "key_talking_points": ["..."]}`;

    const result = await runOpencode(prompt, 180000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { summary: result.trim().slice(0, 3000) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /batch — batch evaluate multiple URLs
app.post('/batch', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) return res.status(400).json({ error: 'urls array required' });
    const results = [];
    for (const item of urls.slice(0, 10)) {
      const url = typeof item === 'string' ? item : item.url;
      const company = typeof item === 'string' ? '' : item.company || '';
      const role = typeof item === 'string' ? '' : item.role || '';
      try {
        const prompt = `Evaluate this job. Return JSON: {"score":"X.X","fit":"...","strengths":["..."],"gaps":["..."]} Job: ${role} at ${company} URL: ${url}`;
        const r = await runOpencode(prompt, 60000, userCwd(req));
        const parsed = parseJsonFromOutput(r);
        results.push({ url, company, role, ...(parsed || { score: 'N/A', fit: r.trim().slice(0, 200) }) });
      } catch (e) {
        results.push({ url, company, role, score: 'N/A', fit: `Error: ${e.message}` });
      }
    }
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /pdf — generate CV PDF
app.post('/pdf', async (req, res) => {
  try {
    const script = join(__dirname, 'generate-pdf.mjs');
    if (!existsSync(script)) return res.status(500).json({ error: 'generate-pdf.mjs not found' });
    const r = spawnSync('node', [script], { cwd: __dirname, encoding: 'utf-8', timeout: 60000 });
    if (r.status !== 0) return res.status(500).json({ error: r.stderr || 'PDF generation failed' });
    const pdfFiles = readdirSync(join(__dirname, 'output')).filter(f => f.endsWith('.pdf'));
    const latest = pdfFiles.sort().pop();
    res.json({ success: true, pdfPath: latest || '', outputDir: 'output/' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /salary-gap — salary gap analysis
app.get('/salary-gap', (req, res) => {
  try {
    const script = join(__dirname, 'salary-gap.mjs');
    if (!existsSync(script)) return res.json({ observations: [], gaps: [] });
    const r = spawnSync('node', [script, '--json'], { cwd: __dirname, encoding: 'utf-8', timeout: 30000 });
    if (r.status !== 0) return res.json({ observations: [], gaps: [] });
    try { res.json(JSON.parse(r.stdout.trim() || '{}')); } catch { res.json({ raw: r.stdout }); }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /cv — edit cv.md (per-user or root)
app.put('/cv', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });
    const cvDir = req.userCtx.dataDir || join(__dirname, 'data');
    if (!existsSync(cvDir)) mkdirSync(cvDir, { recursive: true });
    const cvPath = req.userCtx.cvPath || join(cvDir, 'cv.md');
    writeFileSync(cvPath, content, 'utf-8');
    res.json({ success: true, length: content.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /cv — read cv.md (per-user or root)
app.get('/cv', (req, res) => {
  try {
    const cvPath = req.userCtx.cvPath || join(__dirname, 'data/cv.md');
    if (!existsSync(cvPath)) return res.json({ content: '' });
    res.json({ content: readFileSync(cvPath, 'utf-8') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET/POST /blacklist — manage do-not-apply list (per-user or root)
app.get('/blacklist', (req, res) => {
  try {
    const blPath = req.userCtx.blacklistPath || join(__dirname, 'data/blacklist.md');
    if (!existsSync(blPath)) return res.json({ companies: [] });
    const lines = readFileSync(blPath, 'utf-8').split('\n');
    const companies = lines.map(l => { const m = l.match(/^\s*[-*]\s*(.+)/); return m ? m[1].trim() : ''; }).filter(Boolean);
    res.json({ companies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/blacklist', (req, res) => {
  try {
    const { company, action } = req.body;
    if (!company) return res.status(400).json({ error: 'company required' });
    const blPath = req.userCtx.blacklistPath || join(__dirname, 'data/blacklist.md');
    const blDir = dirname(blPath);
    if (!existsSync(blDir)) mkdirSync(blDir, { recursive: true });
    let lines = existsSync(blPath) ? readFileSync(blPath, 'utf-8').split('\n') : ['# Blacklist', ''];
    if (action === 'remove') {
      lines = lines.filter(l => !l.toLowerCase().includes(company.toLowerCase()));
    } else {
      if (!lines.some(l => l.toLowerCase().includes(company.toLowerCase()))) {
        lines.push(`- ${company}`);
      }
    }
    writeFileSync(blPath, lines.join('\n'), 'utf-8');
    const companies = lines.map(l => { const m = l.match(/^\s*[-*]\s*(.+)/); return m ? m[1].trim() : ''; }).filter(Boolean);
    res.json({ companies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /scan-history — view scan dedup history
app.get('/scan-history', (req, res) => {
  try {
    const histPath = join(__dirname, 'data/scan-history.tsv');
    if (!existsSync(histPath)) return res.json({ entries: [] });
    const lines = readFileSync(histPath, 'utf-8').split('\n').filter(Boolean);
    const entries = lines.slice(1).map(l => {
      const p = l.split('\t');
      return { url: p[0] || '', firstSeen: p[1] || '', portal: p[2] || '', title: p[3] || '', company: p[4] || '', status: p[5] || '', location: p[6] || '' };
    });
    res.json({ entries: entries.slice(-200) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /followup/draft — generate follow-up email draft
app.post('/followup/draft', async (req, res) => {
  try {
    const { company, role, followupCount, contactEmail, appliedDate } = req.body;
    const cv = readUserCv(req);
    const prompt = `Generate a follow-up email for a job application.
Company: ${company}
Role: ${role}
Follow-up #${(followupCount || 0) + 1}
Applied: ${appliedDate || 'recently'}
Contact: ${contactEmail || 'Hiring Team'}
CV excerpt: ${cv}

Rules: Never use "just checking in" or "circling back". Lead with value. Under 150 words.
Return JSON: {"subject": "...", "body": "..."}`;

    const result = await runOpencode(prompt, 120000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { subject: '', body: result.trim().slice(0, 1500) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /paste-reply — classify a pasted reply email
app.post('/paste-reply', async (req, res) => {
  try {
    const { from, fromEmail, subject, body } = req.body;
    const prompt = `Classify this email reply from a recruiter/employer.
From: ${from || ''} <${fromEmail || ''}>
Subject: ${subject || ''}
Body: ${(body || '').slice(0, 2000)}

Return JSON: {"classification": "interview|offer|rejection|recruiter_reply|noise", "confidence": 0.0-1.0, "summary": "1-line summary", "suggestedAction": "what to do next"}`;

    const result = await runOpencode(prompt, 60000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { classification: 'noise', confidence: 0.5, summary: result.trim().slice(0, 200), suggestedAction: 'Review manually' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /dedup — tracker dedup + normalize
app.post('/dedup', (req, res) => {
  try {
    const dedupScript = join(__dirname, 'dedup-tracker.mjs');
    const normScript = join(__dirname, 'normalize-statuses.mjs');
    let dedupResult = '', normResult = '';
    if (existsSync(dedupScript)) {
      const r = spawnSync('node', [dedupScript], { cwd: __dirname, encoding: 'utf-8', timeout: 30000 });
      dedupResult = r.stdout || '';
    }
    if (existsSync(normScript)) {
      const r = spawnSync('node', [normScript], { cwd: __dirname, encoding: 'utf-8', timeout: 30000 });
      normResult = r.stdout || '';
    }
    res.json({ dedup: dedupResult.trim(), normalize: normResult.trim() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /tracker/stats — tracker statistics
app.get('/tracker/stats', (req, res) => {
  try {
    const lines = trackerLines();
    const colmap = findHeaderCols(lines);
    const apps = parseTrackerRows(lines, colmap);
    const total = apps.length;
    const byStatus = {};
    let totalScore = 0, scoreCount = 0, pdfCount = 0, reportCount = 0;
    for (const a of apps) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      const s = parseFloat(a.score);
      if (!isNaN(s)) { totalScore += s; scoreCount++; }
      if (a.pdf === '✅') pdfCount++;
      if (a.report) reportCount++;
    }
    res.json({
      total,
      byStatus,
      avgScore: scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : 'N/A',
      pdfPercent: total > 0 ? Math.round(pdfCount / total * 100) : 0,
      reportPercent: total > 0 ? Math.round(reportCount / total * 100) : 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /reports/:id — fetch evaluation report content
app.get('/reports/:id', (req, res) => {
  try {
    const { id } = req.params;
    const reportsDir = join(__dirname, 'reports');
    if (!existsSync(reportsDir)) return res.status(404).json({ error: 'No reports directory' });
    const files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
    // Match by report number prefix (zero-padded or not)
    const match = files.find(f => {
      const num = f.split('-')[0];
      return num === id || num === String(parseInt(id)).padStart(3, '0');
    });
    if (!match) return res.status(404).json({ error: `Report #${id} not found` });
    const content = readFileSync(join(reportsDir, match), 'utf-8');
    res.json({ id, filename: match, content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /reports — list all reports with metadata
app.get('/reports', (req, res) => {
  try {
    const reportsDir = join(__dirname, 'reports');
    if (!existsSync(reportsDir)) return res.json({ reports: [] });
    const files = readdirSync(reportsDir).filter(f => f.endsWith('.md')).sort().reverse();
    const reports = files.map(f => {
      const content = readFileSync(join(reportsDir, f), 'utf-8');
      const num = f.split('-')[0];
      const company = f.split('-').slice(1, -2).join('-').replace(/-/g, ' ');
      const date = f.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
      const score = content.match(/\*\*Score:\*\*\s*(\S+)/)?.[1] || 'N/A';
      return { id: num, filename: f, company, date, score, preview: content.slice(0, 200) };
    });
    res.json({ reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /pipeline — list pending URLs from data/pipeline.md
app.get('/pipeline', (req, res) => {
  try {
    const pipelinePath = join(__dirname, 'data/pipeline.md');
    if (!existsSync(pipelinePath)) return res.json({ entries: [] });
    const text = readFileSync(pipelinePath, 'utf-8');
    const lines = text.split('\n');
    const entries = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Parse lines like: "- https://company.com/jobs/123" or "- [Company] https://..."
      const urlMatch = trimmed.match(/https?:\/\/\S+/);
      if (urlMatch) {
        const url = urlMatch[0].replace(/[)\]]$/, '');
        const label = trimmed.replace(/^[-*]\s*/, '').replace(url, '').trim();
        // Check if this URL already has a tracker entry (already evaluated)
        const trackerText = existsSync(TRACKER_PATH) ? readFileSync(TRACKER_PATH, 'utf-8') : '';
        const alreadyEvaluated = trackerText.includes(url);
        entries.push({ url, label, evaluated: alreadyEvaluated });
      }
    }
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /pipeline/evaluate — evaluate a pipeline entry and remove from pipeline
app.post('/pipeline/evaluate', async (req, res) => {
  try {
    const { url, company, role } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const prompt = `Evaluate this job posting using career-ops auto-pipeline mode. Return ONLY a JSON object with: {"score":"X.X","fit":"...","strengths":["..."],"gaps":["..."]}. Job: ${role || 'Unknown'} at ${company || 'Unknown'} URL: ${url}`;
    const stdout = await runOpencode(prompt, 120000, userCwd(req));
    let evaluation = { score: 'N/A', fit: '', strengths: [], gaps: [] };
    try { evaluation = JSON.parse(stdout.match(/\{[\s\S]*?\}/)?.[0] || '{}'); } catch { /* keep defaults */ }
    // Save report + tracker (per-user)
    const score = evaluation.score || 'N/A';
    const slug = (company || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const today = new Date().toISOString().slice(0, 10);
    const reportDir = userReportDir(req);
    const nextNum = nextReportNumForDir(reportDir);
    const numStr = String(nextNum).padStart(3, '0');
    if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, `${numStr}-${slug}-${today}.md`), `# Report #${numStr}\n\n**Company:** ${company || 'Unknown'}\n**Role:** ${role || 'Unknown'}\n**URL:** ${url}\n**Score:** ${score}/5\n\n## Fit\n${evaluation.fit || 'N/A'}\n\n## Strengths\n${(evaluation.strengths || []).map(s => `- ${s}`).join('\n') || '- N/A'}\n\n## Gaps\n${(evaluation.gaps || []).map(g => `- ${g}`).join('\n') || '- None'}\n`, 'utf-8');
    const additionsDir = userAdditionsDir(req);
    if (!existsSync(additionsDir)) mkdirSync(additionsDir, { recursive: true });
    writeFileSync(join(additionsDir, `${numStr}-${slug}.tsv`), `${numStr}\t${today}\t${company || 'Unknown'}\t${role || 'Unknown'}\tEvaluated\t${score}/5\t❌\t[${numStr}](reports/${numStr}-${slug}-${today}.md)\tPipeline evaluate\n`, 'utf-8');
    try { spawnSync('node', ['merge-tracker.mjs'], { cwd: userCwd(req), encoding: 'utf-8', timeout: 10000 }); } catch { /* non-fatal */ }
    // Remove evaluated URL from user's pipeline.md
    try {
      const pipelinePath = req.userCtx?.pipelinePath || join(__dirname, 'data/pipeline.md');
      if (existsSync(pipelinePath)) {
        const lines = readFileSync(pipelinePath, 'utf-8').split('\n');
        const filtered = lines.filter(l => !l.includes(url));
        writeFileSync(pipelinePath, filtered.join('\n'), 'utf-8');
      }
    } catch { /* non-fatal */ }
    res.json({ score, reportNum: nextNum, fit: evaluation.fit, strengths: evaluation.strengths, gaps: evaluation.gaps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /export/:file — data export for backup/sharing ─────────────
const EXPORT_WHITELIST = {
  'daily-job-log':  join(__dirname, 'data/daily-job-log.md'),
  'applications':   join(__dirname, 'data/applications.md'),
  'cv':             join(__dirname, 'data/cv.md'),
  'portals':        join(__dirname, 'portals.yml'),
  'scan-history':   join(__dirname, 'data/scan-history.tsv'),
  'blacklist':      join(__dirname, 'data/blacklist.md'),
  'pipeline':       join(__dirname, 'data/pipeline.md'),
  'profile':        join(__dirname, 'config/profile.yml'),
};

app.get('/export/:file', (req, res) => {
  const key = req.params.file;
  const filePath = EXPORT_WHITELIST[key];
  if (!filePath || !existsSync(filePath)) {
    return res.status(404).json({ error: `File not found: ${key}` });
  }
  try {
    const stat = statSync(filePath);
    const content = readFileSync(filePath, 'utf-8');
    res.json({
      name: key,
      filename: basename(filePath),
      content,
      size: stat.size,
      modified: stat.mtime.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── auto-setup portals.yml from template if missing ─────────────────
const PORTALS_EXAMPLE = join(__dirname, 'templates/portals.example.yml');
const PORTALS_YAML = join(__dirname, 'portals.yml');
if (!existsSync(PORTALS_YAML) && existsSync(PORTALS_EXAMPLE)) {
  try {
    copyFileSync(PORTALS_EXAMPLE, PORTALS_YAML);
    console.log('[setup] Copied templates/portals.example.yml → portals.yml');
  } catch (e) {
    console.error('[setup] Failed to copy portals.yml:', e.message);
  }
}

// ── GET /download/apk — serve latest APK for install ────────────────
app.get('/download/apk', (req, res) => {
  const candidates = [
    join(__dirname, 'career-ops-app', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    join(__dirname, 'career-ops.apk'),
    '/sdcard/Download/career-ops.apk',
  ];
  const apkPath = candidates.find(p => existsSync(p));
  if (!apkPath) {
    return res.status(404).json({ error: 'APK not found', searched: candidates });
  }
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="career-ops.apk"');
  res.sendFile(apkPath);
});

// ── crash protection ───────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

// ── start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`career-ops bridge server v2 running on http://0.0.0.0:${PORT}`);
  console.log(`Tracker: ${TRACKER_PATH}`);
  console.log(`Profile: ${PROFILE_PATH}`);
});

// ── OpenCode SDK integration ───────────────────────────────────────
const opencodeSessions = new Map();
const OPENCODE_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4096';
const OPENCODE_PORT = 4096;

function isTermux() {
  return existsSync('/data/data/com.termux') || !!process.env.TERMUX_VERSION;
}

async function waitForOpencodeServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url + '/health', { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function initOpencode(userId, userDir) {
  const key = userId || '__root__';
  if (opencodeSessions.has(key)) return opencodeSessions.get(key);

  let client;

  // Strategy 1: Connect to an already-running opencode server
  try {
    const probe = await fetch(OPENCODE_URL + '/health', { signal: AbortSignal.timeout(2000) });
    if (probe.ok) {
      console.log(`[chat] Connecting to existing opencode server at ${OPENCODE_URL}`);
      client = createOpencodeClient({
        baseUrl: OPENCODE_URL,
        directory: userDir || __dirname,
      });
    }
  } catch {}

  // Strategy 2: Spawn opencode serve
  if (!client) {
    if (isTermux()) {
      // On Android/Termux: spawn via proot-distro (opencode binary needs glibc)
      console.log(`[chat] Termux detected — launching opencode via proot-distro...`);
      const prootBin = '/data/data/com.termux/files/usr/bin/proot-distro';
      const prootProc = spawn(prootBin, [
        'login', 'debian', '--',
        'bash', '-c',
        `cd /root/career-ops && echo "[proot] cwd: $(pwd)" && echo "[proot] opencode: $(ls -la ./opencode 2>&1)" && ./opencode serve --hostname=127.0.0.1 --port=${OPENCODE_PORT} 2>&1`
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, HOME: '/root' },
        detached: true,
      });
      prootProc.unref();
      prootProc.on('error', (e) => console.error(`[chat] proot spawn error: ${e.message}`));
      prootProc.stdout?.on('data', (d) => {
        const s = d.toString().trim();
        if (s) console.log(`[proot:out] ${s}`);
      });
      prootProc.stderr?.on('data', (d) => {
        const s = d.toString().trim();
        if (s) console.log(`[proot:err] ${s}`);
      });
      prootProc.on('exit', (code) => console.log(`[proot] exited with code ${code}`));

      console.log(`[chat] Waiting for opencode server on ${OPENCODE_URL}...`);
      const ready = await waitForOpencodeServer(OPENCODE_URL, 30000);
      if (!ready) {
        throw new Error(
          'opencode server did not start in 30s. Check proot output above for errors.'
        );
      }
      console.log(`[chat] opencode server ready`);
      client = createOpencodeClient({
        baseUrl: OPENCODE_URL,
        directory: userDir || __dirname,
      });
      // Warmup: wait for model provider to initialize after fresh server start
      console.log('[chat] Warming up model provider (2s)...');
      await new Promise(r => setTimeout(r, 2000));
    } else {
      // Desktop Linux/macOS: spawn directly
      try {
        console.log(`[chat] Spawning opencode serve locally...`);
        const server = await createOpencode({
          dir: userDir || __dirname,
          permission: { bash: "allow", write: "allow", edit: "allow" },
          timeout: 15000,
        });
        client = createOpencodeClient({
          baseUrl: server.url,
          directory: userDir || __dirname,
        });
      } catch (e) {
        throw new Error(`Failed to start opencode: ${e.message}`);
      }
    }
  }

  const sessionResult = await client.session.create({
    body: { title: userId || 'default' }
  });
  const sessionId = sessionResult.data?.id;
  if (!sessionId) {
    throw new Error('Failed to create opencode session: ' + JSON.stringify(sessionResult.error || sessionResult));
  }

  opencodeSessions.set(key, { client, sessionId });
  return { client, sessionId };
}

async function doctorCheck(userDir) {
  const result = spawnSync('node', ['doctor.mjs', '--json'], {
    cwd: userDir,
    encoding: 'utf-8',
    timeout: 30000
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { onboardingNeeded: true, missing: ['applications.md'] };
  }
}

// ── POST /chat — send message to opencode brain ─────────────────────
app.post('/chat', async (req, res) => {
  try {
    const userId = req.userCtx?.userId;
    const userDir = req.userCtx?.userDir;
    const { message } = req.body;
    
    if (!message) return res.status(400).json({ error: 'message required' });
    
    const trackerPath = join(userDir, 'data', 'applications.md');
    if (!existsSync(trackerPath)) {
      await doctorCheck(userDir);
    }
    
    const { client, sessionId } = await initOpencode(userId, userDir);
    console.log(`[chat] Session ${sessionId}, sending: "${message.slice(0, 80)}..."`);

    await client.session.promptAsync({
      path: { id: sessionId },
      body: { 
        parts: [{ type: "text", text: message }],
        model: { providerID: "opencode", modelID: "big-pickle" }
      }
    });

    const POLL_MS = 1000;
    const MAX_WAIT = 300000;
    const deadline = Date.now() + MAX_WAIT;
    let pollCount = 0;
    let sawBusy = false;
    let idleCount = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_MS));
      pollCount++;

      const statusResult = await client.session.status({}).catch(() => ({ data: {} }));
      const st = statusResult.data?.[sessionId]?.type;

      if (st === 'busy' || st === 'retry') {
        sawBusy = true;
        idleCount = 0;
        if (pollCount % 15 === 0) {
          console.log(`[chat] Working... ${Math.round(pollCount)}s (${st})`);
        }
        continue;
      }

      if (sawBusy) {
        idleCount++;
        if (idleCount >= 2) {
          console.log(`[chat] Idle confirmed after ${pollCount}s`);
          break;
        }
      }
    }

    // Fetch messages — scan ALL assistant messages for one with text
    const msgsResult = await client.session.messages({
      path: { id: sessionId },
      query: { limit: 30 }
    });
    
    const msgs = Array.isArray(msgsResult.data) ? msgsResult.data : [];
    const assistants = msgs.filter(m => m.info?.role === 'assistant');
    
    let content = '';
    let toolOutputs = [];
    
    // Scan from newest to oldest for text content
    for (let i = assistants.length - 1; i >= 0; i--) {
      const parts = assistants[i].parts || [];
      
      const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
      if (text && text.trim().length > 0) {
        content = text;
        toolOutputs = parts.filter(p => p.type === 'tool').map(tp => ({
          tool: tp.tool, status: tp.state?.status,
          output: tp.state?.output || '', input: tp.state?.input || ''
        }));
        console.log(`[chat] Found text in msg ${i} (${text.length} chars)`);
        break;
      }
      
      // If this message has tool parts, collect them as fallback
      const tools = parts.filter(p => p.type === 'tool').map(tp => ({
        tool: tp.tool, status: tp.state?.status,
        output: tp.state?.output || '', input: tp.state?.input || ''
      }));
      if (tools.length > 0 && toolOutputs.length === 0) {
        toolOutputs = tools;
      }
    }
    
    // Fallback: use tool outputs if no text
    if (!content && toolOutputs.length > 0) {
      const completed = toolOutputs.filter(t => t.status === 'completed');
      if (completed.length > 0) {
        content = formatToolSummary(completed);
      }
    }
    
    if (!content) {
      content = 'Processing complete. Check the tracker for updates.';
    }
    
    const parsed = parseActionBlocks(content);
    const toolActions = parseToolOutputs(toolOutputs);
    parsed.actions.push(...toolActions);
    
    res.json({
      ...parsed,
      success: true,
      sessionId,
      content: content || parsed.content || '',
    });
  } catch (e) {
    console.error('[chat] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Parse tool outputs into structured action blocks ────────────────
function parseToolOutputs(toolOutputs) {
  const actions = [];
  
  for (const tool of toolOutputs) {
    if (tool.status !== 'completed' || !tool.output) continue;
    
    const output = tool.output;
    
    // Parse scan.mjs JSON output → job_card actions
    if (tool.tool === 'bash' && (tool.input?.includes('scan.mjs') || tool.input?.includes('scan'))) {
      try {
        const scanData = JSON.parse(output);
        if (scanData.results && Array.isArray(scanData.results)) {
          for (const job of scanData.results.slice(0, 10)) {
            actions.push({
              type: 'job_card',
              data: {
                company: job.company || 'Unknown',
                role: job.role || '',
                url: job.url || '',
                location: job.location || '',
                source: job.source || '',
                score: ''
              }
            });
          }
        }
      } catch {
        // Not JSON, try to extract job info from text
        const lines = output.split('\n').filter(l => l.includes('http'));
        for (const line of lines.slice(0, 5)) {
          const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            actions.push({
              type: 'job_card',
              data: {
                company: line.split(/[|\-]/)[0]?.trim() || 'Unknown',
                role: line.split(/[|\-]/)[1]?.trim() || '',
                url: urlMatch[1],
                location: '',
                source: '',
                score: ''
              }
            });
          }
        }
      }
    }
    
    // Parse evaluation report output → score action
    if (tool.tool === 'bash' && (tool.input?.includes('evaluate') || tool.input?.includes('oferta'))) {
      const scoreMatch = output.match(/Score:\s*(\d+\.?\d*)\s*\/\s*5/i);
      if (scoreMatch) {
        actions.push({
          type: 'evaluation',
          data: {
            score: scoreMatch[1],
            summary: output.slice(0, 500)
          }
        });
      }
    }
    
    // Parse email draft output → email_draft action
    if (tool.tool === 'bash' && (tool.input?.includes('email') || tool.input?.includes('draft'))) {
      try {
        const emailData = JSON.parse(output);
        if (emailData.to || emailData.subject) {
          actions.push({
            type: 'email_draft',
            data: {
              to: emailData.to || '',
              subject: emailData.subject || '',
              body: emailData.body || '',
              company: emailData.company || '',
              role: emailData.role || ''
            }
          });
        }
      } catch {}
    }
  }
  
  return actions;
}

// ── Format tool summary when no text response available ─────────────
function formatToolSummary(completedTools) {
  const summaries = [];
  
  for (const tool of completedTools) {
    if (tool.input?.includes('scan.mjs')) {
      try {
        const data = JSON.parse(tool.output);
        const count = data.results?.length || data.total || 0;
        summaries.push(`Found ${count} job listings`);
      } catch {
        const urlCount = (tool.output.match(/https?:\/\//g) || []).length;
        if (urlCount > 0) {
          summaries.push(`Found ${urlCount} job listings`);
        } else {
          summaries.push('Scan completed');
        }
      }
    } else if (tool.input?.includes('evaluate') || tool.input?.includes('oferta')) {
      const scoreMatch = tool.output.match(/Score:\s*(\d+\.?\d*)/i);
      if (scoreMatch) {
        summaries.push(`Evaluation complete — Score: ${scoreMatch[1]}/5`);
      } else {
        summaries.push('Evaluation complete');
      }
    } else {
      summaries.push('Operation completed');
    }
  }
  
  return summaries.join('\n') || 'Processing complete.';
}

// ── POST /chat/stream — SSE streaming for chat ──────────────────────
app.post('/chat/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const send = (event, data) => {
    if (!res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  let heartbeat = null;
  let pollTimer = null;
  let settled = false;

  function cleanup() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function finish() {
    if (settled) return;
    settled = true;
    cleanup();
    try { res.end(); } catch {}
  }

  res.on('close', () => { cleanup(); settled = true; });

  try {
    const userId = req.userCtx?.userId;
    const userDir = req.userCtx?.userDir;
    const { message } = req.body;

    if (!message) { send('error', { error: 'message required' }); return finish(); }

    const trackerPath = join(userDir, 'data', 'applications.md');
    if (!existsSync(trackerPath)) {
      await doctorCheck(userDir);
    }

    const { client, sessionId } = await initOpencode(userId, userDir);

    // Immediate connected event so client knows the SSE pipe is alive
    send('connected', { sessionId });
    console.log(`[chat/stream] Session ${sessionId}, sending: "${message.slice(0, 80)}..."`);

    // Heartbeat every 15s to keep connection alive
    heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(':keepalive\n\n');
    }, 15000);

    // Fire promptAsync (non-blocking)
    const asyncResult = await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: message }],
        model: { providerID: "opencode", modelID: "big-pickle" }
      }
    });
    if (asyncResult.error) {
      send('error', { error: asyncResult.error });
      return finish();
    }

    // Poll opencode until idle, then fetch the response
    const POLL_MS = 1500;
    const MAX_WAIT = 180000; // 3 min
    const deadline = Date.now() + MAX_WAIT;
    let pollCount = 0;
    let sawBusy = false;
    let idleCount = 0;

    while (Date.now() < deadline && !settled) {
      await new Promise(r => setTimeout(r, POLL_MS));
      pollCount++;

      const statusResult = await client.session.status({}).catch(() => ({ data: {} }));
      const st = statusResult.data?.[sessionId]?.type;

      if (st === 'busy' || st === 'retry') {
        sawBusy = true;
        idleCount = 0;
        if (pollCount % 4 === 0) {
          console.log(`[chat/stream] Working... ${Math.round(pollCount * POLL_MS / 1000)}s (${st})`);
          send('text_delta', { text: `\n...working (${Math.round(pollCount * POLL_MS / 1000)}s)...\n` });
        }
        continue;
      }

      if (sawBusy) {
        idleCount++;
        if (idleCount >= 2) {
          console.log(`[chat/stream] Idle after ${pollCount} polls`);
          break;
        }
      }

      // Not busy, never saw busy — opencode might have finished before we started polling
      if (!sawBusy && pollCount >= 3) {
        console.log(`[chat/stream] No busy seen in ${pollCount} polls, proceeding`);
        break;
      }
    }

    // Fetch the response
    const msgsResult = await client.session.messages({
      path: { id: sessionId },
      query: { limit: 20 }
    });
    const msgs = Array.isArray(msgsResult.data) ? msgsResult.data : [];
    const assistants = msgs.filter(m => m.info?.role === 'assistant');

    let content = '';

    for (let i = assistants.length - 1; i >= 0; i--) {
      const parts = assistants[i].parts || [];
      const text = parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
      if (text && text.trim().length > 0) {
        content = text;
        break;
      }
    }

    if (!content) content = 'Done. Check tracker for updates.';

    // Send the response as a single text_delta
    send('text_delta', { text: content });
    send('done', { sessionId });
    finish();
  } catch (e) {
    send('error', { error: e.message });
    finish();
  }
});

// ── POST /chat/reset — reset user's opencode session ────────────────
app.post('/chat/reset', (req, res) => {
  const userId = req.userCtx?.userId;
  const key = userId || '__root__';
  if (opencodeSessions.has(key)) {
    opencodeSessions.delete(key);
    res.json({ success: true, message: 'Session reset' });
  } else {
    res.json({ success: true, message: 'No active session' });
  }
});

// ── GET /debug — opencode server diagnostics ─────────────────────────
app.get('/debug', async (req, res) => {
  const info = {
    opencodeUrl: OPENCODE_URL,
    hasRunningSessions: opencodeSessions.size,
    sessions: [...opencodeSessions.entries()].map(([k, v]) => ({ key: k, sessionId: v.sessionId })),
    uptime: Math.floor(process.uptime()) + 's',
  };
  
  // Probe opencode server
  try {
    const probe = await fetch(OPENCODE_URL + '/health', { signal: AbortSignal.timeout(3000) });
    info.opencodeHealth = probe.ok ? 'ok' : 'error ' + probe.status;
  } catch (e) {
    info.opencodeHealth = 'unreachable: ' + e.message;
  }
  
  // Check for user's opencode files
  const userDir = req.userCtx?.userDir || __dirname;
  const fs = await import('fs');
  info.files = {
    opencodeJson: fs.existsSync(join(userDir, 'opencode.json')),
    cvMd: fs.existsSync(join(userDir, 'cv.md')),
    profileYml: fs.existsSync(join(userDir, 'config', 'profile.yml')),
    applicationsMd: fs.existsSync(join(userDir, 'data', 'applications.md')),
    portalsYml: fs.existsSync(join(userDir, 'portals.yml')),
  };
  
  res.json(info);
});

// ── Action block parser for TUI-to-GUI rendering ────────────────────
function parseActionBlocks(text) {
  const actions = [];
  const actionRegex = /\[ACTION:(\w+)\]([\s\S]*?)\[\/ACTION\]/g;
  let match;
  
  while ((match = actionRegex.exec(text)) !== null) {
    const type = match[1];
    const content = match[2].trim();
    const lines = content.split('\n');
    const data = {};
    
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        data[key] = value;
      }
    }
    
    actions.push({ type, data });
  }
  
  const cleanText = text.replace(actionRegex, '').trim();
  return { text: cleanText, actions };
}
