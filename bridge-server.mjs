#!/usr/bin/env node

import express from 'express';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, readdirSync, statSync, symlinkSync, copyFileSync } from 'fs';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';
import yaml from 'js-yaml';
import multer from 'multer';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

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

// Per-user directory cache — after first successful resolution, skip 8+ existsSync calls
const _userDirCache = new Map();

function resolveUserDataDir(userId) {
  const safeId = String(userId || '').toLowerCase().replace(/[^a-z0-9@.+-]/g, '_');
  if (!safeId) return null;

  const cached = _userDirCache.get(safeId);
  if (cached) return cached;

  const dir = join(USERS_ROOT, safeId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'reports'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    mkdirSync(join(dir, 'modes'), { recursive: true });
    mkdirSync(join(dir, 'batch'), { recursive: true });
    mkdirSync(join(dir, 'batch/tracker-additions'), { recursive: true });

    const opencodeLink = join(dir, '.opencode');
    if (!existsSync(opencodeLink)) {
      try { symlinkSync(join(__dirname, '.opencode'), opencodeLink); } catch { /* non-fatal */ }
    }

    const cvLink = join(dir, 'cv.md');
    const userCv = join(dir, 'data', 'cv.md');
    if (!existsSync(cvLink) && existsSync(userCv)) {
      try { symlinkSync(userCv, cvLink); } catch { /* non-fatal */ }
    }
    if (!existsSync(join(dir, 'config', 'profile.yml')) && existsSync(join(__dirname, 'config', 'profile.yml'))) {
      try { copyFileSync(join(__dirname, 'config', 'profile.yml'), join(dir, 'config', 'profile.yml')); } catch { /* non-fatal */ }
    }

    const modesLink = join(dir, 'modes');
    if (!existsSync(modesLink)) {
      try { symlinkSync(join(__dirname, 'modes'), modesLink); } catch { /* non-fatal */ }
    }

    console.log(`[multi-user] Created user directory: ${dir}`);
  }

  _userDirCache.set(safeId, dir);
  return dir;
}

function resolvePerUserPath(userId, relativePath) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) return join(__dirname, relativePath);
  return join(userDir, relativePath);
}

// Read spend_tier from user's config/profile.yml and map to opencode model
// Tiers: economy (cheapest), standard (balanced, default), premium (most capable)
function resolveModelForUser(userId) {
  const defaultModel = { providerID: 'opencode', modelID: 'big-pickle' };
  try {
    const profilePath = join(resolveUserDataDir(userId) || __dirname, 'config', 'profile.yml');
    if (!existsSync(profilePath)) return defaultModel;
    const raw = readFileSync(profilePath, 'utf-8');
    const cfg = yaml.load(raw);
    const tier = cfg?.spend_tier || 'standard';
    // For opencode, all tiers currently map to big-pickle (free tier only).
    // When paid models become available, map: economy → cheapest, standard → balanced, premium → best.
    if (tier === 'economy') return { providerID: 'opencode', modelID: 'big-pickle' };
    if (tier === 'premium') return { providerID: 'opencode', modelID: 'big-pickle' };
    return defaultModel; // standard or unknown
  } catch {
    return defaultModel;
  }
}

// ── Credential encryption (AES-256-GCM) ─────────────────────────────
// Encrypts .oauth2.json at rest. Key auto-generated on first run and
// persisted to .bridge.env so it survives restarts.

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const AUTH_TAG_LEN = 16;
const BRIDGE_ENV_PATH = join(__dirname, '.bridge.env');

function getOrCreateEncryptionKey() {
  if (process.env.CREDENTIALS_KEY) {
    return Buffer.from(process.env.CREDENTIALS_KEY, 'hex');
  }
  // Auto-generate key and persist to .bridge.env
  const key = randomBytes(KEY_LEN);
  const hex = key.toString('hex');
  try {
    let envContent = '';
    if (existsSync(BRIDGE_ENV_PATH)) {
      envContent = readFileSync(BRIDGE_ENV_PATH, 'utf-8');
      // Replace existing CREDENTIALS_KEY if present
      if (envContent.includes('CREDENTIALS_KEY=')) {
        envContent = envContent.replace(/^CREDENTIALS_KEY=.*$/m, `CREDENTIALS_KEY=${hex}`);
      } else {
        envContent = envContent.trimEnd() + `\nCREDENTIALS_KEY=${hex}\n`;
      }
    } else {
      envContent = `CREDENTIALS_KEY=${hex}\n`;
    }
    writeFileSync(BRIDGE_ENV_PATH, envContent, 'utf-8');
    process.env.CREDENTIALS_KEY = hex;
    console.log('[crypto] Auto-generated encryption key, saved to .bridge.env');
  } catch (e) {
    console.error('[crypto] Warning: could not persist key to .bridge.env:', e.message);
  }
  return key;
}

function encryptJson(data) {
  const key = getOrCreateEncryptionKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptJson(encoded) {
  const key = getOrCreateEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

function isEncryptedData(str) {
  // Encrypted data is base64 and starts with IV (12 bytes) + auth tag (16 bytes)
  // Plaintext JSON always starts with '{' or '['
  if (!str || str.length < 20) return false;
  if (str.trimStart().startsWith('{') || str.trimStart().startsWith('[')) return false;
  // Check if it's valid base64 with minimum length for IV+tag+ciphertext
  return /^[A-Za-z0-9+/=]{60,}$/.test(str.trim());
}

// Per-user OAuth2 credential store
function getUserOAuth(userId) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) return null;
  const oauthPath = join(userDir, '.oauth2.json');
  if (!existsSync(oauthPath)) return null;
  try {
    const raw = readFileSync(oauthPath, 'utf-8').trim();
    if (isEncryptedData(raw)) {
      return decryptJson(raw);
    }
    // Plaintext migration: encrypt and re-save
    const data = JSON.parse(raw);
    try {
      setUserOAuth(userId, data);
    } catch { /* non-fatal — will retry next time */ }
    return data;
  } catch { return null; }
}

function setUserOAuth(userId, creds) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) throw new Error('Invalid userId');
  const oauthPath = join(userDir, '.oauth2.json');
  const encrypted = encryptJson(creds);
  writeFileSync(oauthPath, encrypted, 'utf-8');
}

// ── Portal login requirements + per-user credential vault ───────────
// Indian job portals gate the application form behind an account; company
// ATS pages (Greenhouse, Lever, Ashby, ...) are public. The vault stores
// the user's portal credentials encrypted at rest (same AES-256-GCM key as
// .oauth2.json) so auto-fill can log in and apply seamlessly.

const PORTAL_LOGIN_REQUIREMENTS = [
  // googleOAuth: portal offers "Continue with Google" — the preferred login
  // path (uses the user's Gmail OAuth session in their persistent profile).
  // Fallback: stored portal email/password from /portal-creds.
  { portal: 'Internshala', hostPattern: 'internshala.com', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Naukri', hostPattern: 'naukri.com', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Shine', hostPattern: 'shine.com', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'TimesJobs', hostPattern: 'timesjobs.com', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Hirist', hostPattern: 'hirist', loginRequired: true, needsProfile: true, googleOAuth: false },
  { portal: 'iimjobs', hostPattern: 'iimjobs.com', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Foundit', hostPattern: 'foundit', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Instahyre', hostPattern: 'instahyre.com', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Cutshort', hostPattern: 'cutshort.io', loginRequired: true, needsProfile: true, googleOAuth: true },
  { portal: 'Freshersworld', hostPattern: 'freshersworld.com', loginRequired: true, needsProfile: true, googleOAuth: false },
  { portal: 'LinkedIn', hostPattern: 'linkedin.com', loginRequired: true, needsProfile: false, googleOAuth: false },
  { portal: 'Glassdoor', hostPattern: 'glassdoor', loginRequired: 'partial', needsProfile: false, googleOAuth: true },
  { portal: 'Indeed', hostPattern: 'indeed.com', loginRequired: 'partial', needsProfile: false, googleOAuth: true },
  { portal: 'Monster', hostPattern: 'monsterindia.com', loginRequired: true, needsProfile: true, googleOAuth: true },
];

function detectPortalFromUrl(urlStr) {
  const host = ((urlStr || '').toLowerCase().match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
  for (const p of PORTAL_LOGIN_REQUIREMENTS) {
    if (host.endsWith(p.hostPattern) || host.includes(p.hostPattern)) return p;
  }
  return null;
}

function getPortalCredsPath(userId) {
  const userDir = resolveUserDataDir(userId);
  if (!userDir) return null;
  return join(userDir, '.portal-creds.json');
}

function getPortalCreds(userId) {
  const p = getPortalCredsPath(userId);
  if (!p || !existsSync(p)) return {};
  try {
    const raw = readFileSync(p, 'utf-8').trim();
    if (isEncryptedData(raw)) return decryptJson(raw) || {};
    const data = JSON.parse(raw);
    setPortalCreds(userId, data); // migrate to encrypted
    return data;
  } catch { return {}; }
}

function setPortalCreds(userId, creds) {
  const p = getPortalCredsPath(userId);
  if (!p) throw new Error('Invalid userId');
  writeFileSync(p, encryptJson(creds || {}), 'utf-8');
}

function deletePortalCreds(userId, portal) {
  const creds = getPortalCreds(userId);
  const norm = (portal || '').toLowerCase();
  let removed = false;
  for (const key of Object.keys(creds)) {
    if (key.toLowerCase() === norm) { delete creds[key]; removed = true; }
  }
  if (removed) setPortalCreds(userId, creds);
  return removed;
}

async function refreshOAuthToken(creds) {
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) return null;
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);
  const data = await resp.json();
  return {
    accessToken: data.access_token || creds.accessToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : creds.expiresAt,
  };
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

// ── Bridge auth ─────────────────────────────────────────────────────
// Shared-secret token check. DISABLED for local-only use (127.0.0.1).
// The bridge server only runs on-device — no external exposure.
// To re-enable, set BRIDGE_TOKEN in .bridge.env and uncomment below.
//
// const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
// if (BRIDGE_TOKEN) {
//   app.use((req, res, next) => {
//     const incoming = req.headers['x-bridge-token'] || '';
//     if (incoming === BRIDGE_TOKEN) return next();
//     res.status(401).json({ error: 'unauthorized' });
//   });
//   console.log('[auth] Bridge token auth enabled');
// }

// ── Health check ─────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── APK download ────────────────────────────────────────────────────
// Serves the latest APK so Android file manager can install it.
app.get('/download-apk', (req, res) => {
  const apkPaths = [
    join(__selfDir, 'app-release.apk'),
    join(__selfDir, 'career-ops.apk'),
    '/data/data/com.termux/files/home/downloads/career-ops.apk',
  ];
  let apkPath = null;
  for (const p of apkPaths) {
    if (existsSync(p)) { apkPath = p; break; }
  }
  if (!apkPath) return res.status(404).json({ error: 'APK not found' });
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.download(apkPath, 'career-ops.apk');
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

// Build user context prefix for opencode chat messages.
// Reads the user's profile + CV and prepends them so the model has full context.
// Capped at ~3000 chars to avoid overwhelming the model with huge CVs.
function buildUserContext(req) {
  const parts = [];
  try {
    const profilePath = req.userCtx?.profilePath;
    if (profilePath && existsSync(profilePath)) {
      const profile = readFileSync(profilePath, 'utf-8');
      if (profile.trim()) parts.push(`[USER PROFILE]\n${profile.trim()}\n[/USER PROFILE]`);
    }
  } catch { /* skip */ }
  try {
    const cvPath = req.userCtx?.cvPath;
    if (cvPath && existsSync(cvPath)) {
      let cv = readFileSync(cvPath, 'utf-8').trim();
      if (cv.length > 3000) cv = cv.slice(0, 3000) + '\n... [truncated]';
      if (cv) parts.push(`[USER CV]\n${cv}\n[/USER CV]`);
    }
  } catch { /* skip */ }
  return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
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

/** Check if a user has usable OAuth credentials (refresh token or valid access token) */
function hasUsableOAuth(userOAuth) {
  if (!userOAuth) return false;
  if (userOAuth.refreshToken) return true;
  if (userOAuth.accessToken && (!userOAuth.expiresAt || Date.now() < userOAuth.expiresAt)) return true;
  return false;
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

function resolveUserExportPath(key, rootPath, req) {
  const userDir = req.userCtx?.userDir;
  if (!userDir) return rootPath;
  const exportMap = {
    'daily-job-log': join(userDir, 'data/daily-job-log.md'),
    'applications':  join(userDir, 'data/applications.md'),
    'cv':            join(userDir, 'cv.md'),
    'scan-history':  join(userDir, 'data/scan-history.tsv'),
    'blacklist':     join(userDir, 'data/blacklist.md'),
    'pipeline':      join(userDir, 'data/pipeline.md'),
    'profile':       join(userDir, 'config/profile.yml'),
  };
  return exportMap[key] || rootPath;
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
  // Use SDK client (HTTP to opencode server) instead of spawning binary directly.
  // Spawning fails on Termux because the binary requires proot's dynamic linker.
  const userId = cwd ? basename(cwd) : undefined;
  // Stateless agent-helper calls (eval/draft/reply/classify/...) must NOT reuse
  // the shared /chat session — shared history made evals echo the previous job's
  // (hallucinated) details when a JD fetch failed. Always use a fresh session.
  const { client, sessionId } = await initOpencode(userId, cwd, true);

  // "Train the spawned opencode": prepend the persistent agent-training context
  // so every stateless call applies the same portal strategy, multi-user
  // isolation, Kotlin-backend contracts and HITL guard. Loaded from the user's
  // tree when present (per-user override), else the shared root copy.
  const trainingContext = readAgentTraining(cwd);
  const effectivePrompt = trainingContext ? `${trainingContext}\n\n${prompt}` : prompt;

  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      parts: [{ type: "text", text: effectivePrompt }],
      model: resolveModelForUser(userId)
    }
  });

  const deadline = Date.now() + timeoutMs;
  let lastBusyPoll = 0;
  let msgsResult = { data: [] };
  let msgs = [];

  // Poll until we see assistant text OR the deadline/10s-idle grace expires.
  // Previous loop broke on idleCount>=2 which raced the model's final text step
  // (tool call finishes → status idle → loop breaks → final text not yet emitted).
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const statusResult = await client.session.status({}).catch(() => ({ data: {} }));
    const st = statusResult.data?.[sessionId]?.type;
    const isBusy = (st === 'busy' || st === 'retry');
    if (isBusy) { lastBusyPoll = Date.now(); continue; }

    // Status idle — check messages for actual assistant text (not just tool calls).
    msgsResult = await client.session.messages({
      path: { id: sessionId },
      query: { limit: 50 }
    }).catch(() => ({ data: [] }));
    msgs = Array.isArray(msgsResult.data) ? msgsResult.data : [];

    const hasAssistantText = msgs.some(m =>
      m.info?.role === 'assistant' && (m.parts || []).some(p =>
        p.type === 'text' && (p.text || p.content || '').trim().length > 10
      )
    );
    if (hasAssistantText) break;

    // If never-busy case: break after 5s with no text (prompt likely rejected/error).
    // If was-busy: break after 10s idle with no text (agent stuck on tool calls without
    // producing a final answer — common when websearch returns but model doesn't emit text).
    const idleMs = lastBusyPoll ? (Date.now() - lastBusyPoll) : (Date.now() - (deadline - timeoutMs));
    if (idleMs > (lastBusyPoll ? 10000 : 5000)) break;
  }

  // One final query if we don't have text yet (text may have arrived after last poll).
  if (!msgs.some(m =>
    m.info?.role === 'assistant' && (m.parts || []).some(p =>
      p.type === 'text' && (p.text || p.content || '').trim().length > 10
    )
  )) {
    await new Promise(r => setTimeout(r, 2000));
    msgsResult = await client.session.messages({
      path: { id: sessionId },
      query: { limit: 50 }
    }).catch(() => ({ data: [] }));
    msgs = Array.isArray(msgsResult.data) ? msgsResult.data : [];
  }
  const assistants = msgs.filter(m => m.info?.role === 'assistant');

  const textParts = [];
  for (const m of assistants) {
    for (const p of (m.parts || [])) {
      if (p.type === 'text') {
        const t = (p.text || p.content || '').trim();
        // Keep JSON blocks too — draft/classify/reply/eval prompts return JSON,
        // and filtering them out made those endpoints return empty. Only strip
        // the skill-wrapper artifacts injected by the agent runtime.
        if (t && !t.startsWith('<skill_content')) {
          textParts.push(t);
        }
      }
    }
  }

  const output = textParts.join('\n\n');
  if (!output) throw new Error('opencode produced no text output');
  return output;
}

function parseJsonFromOutput(text) {
  const m = text.match(/\{[\s\S]*?\}/);
  return m ? (() => { try { return JSON.parse(m[0]); } catch { return null; } })() : null;
}

// Robust JSON extraction for NESTED payloads (e.g. the CV render JSON), which
// the non-greedy first-{..} regex in parseJsonFromOutput truncates at the first
// closing brace. Prefers an exact parse, then a balanced-brace scan.
function parseJsonPayload(text) {
  if (!text) return null;
  const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(trimmed); } catch { /* fall through to brace scan */ }
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// ── Shared JD contact extraction (recruiter/application emails + phones) ──
// Used by /auto-pipeline (report + response) and /email/draft (contact hints)
// so recruiter emails are captured reliably for IMAP outreach and follow-ups.
const NOISE_EMAIL = /example\.com|\.(png|jpe?g|gif|svg|webp)$|sentry|wixpress|\b(no-?reply|donotreply|do-not-reply|noreply|notifications|updates|bounce|mailer-daemon|postmaster)@|\d+@/i;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const APP_HINT_RE = /\b(apply|careers?|recruit(er|ing|ment)?|hr|hiring|jobs?|talents?|resume|cv|talent-?acq(uisition)?|join)\b/i;
const PHONE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;

function extractJdContact(html, pageText) {
  const raw = `${html || ''}\n${pageText || ''}`;
  const seen = new Set();
  const emails = [];
  for (const m of raw.match(EMAIL_RE) || []) {
    const e = m.replace(/^mailto:/i, '').toLowerCase().trim();
    if (seen.has(e)) continue;
    if (NOISE_EMAIL.test(e)) continue;
    if (e.length > 60) continue;
    seen.add(e);
    emails.push(e);
  }
  const app = e => APP_HINT_RE.test(e);
  emails.sort((a, b) => (app(b) ? 1 : 0) - (app(a) ? 1 : 0));
  const phones = [...new Set((raw.match(PHONE_RE) || []).map(p => p.replace(/\s+/g, ' ').trim()))].slice(0, 3);
  return { emails: emails.slice(0, 8), phones, applicationEmails: emails.filter(app).slice(0, 3) };
}

// Fetch a JD URL and return page text (for the LLM) + extracted contact info.
// Email-first fallback: many Indian job boards (Internshala/Naukri/Shine/
// Foundit/TimesJobs) render the contact/application email only in JS, so the
// plain-HTTP fetch below sees nothing. When no application email is found, the
// page is rendered with headless Chromium (contact-render.mjs — same stealth
// engine as apply-job.mjs) and the visible text + DOM emails are re-extracted.
// This is what keeps the app on the proven CLI email-apply path.
async function fetchJdAndContact(url, { textLimit = 6000 } = {}) {
  let html = '';
  let pageText = '';
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (resp.ok) {
      html = await resp.text();
      pageText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  } catch { /* fall through to renderer */ }

  let contact = html ? extractJdContact(html, pageText) : { emails: [], phones: [], applicationEmails: [] };

  // Playwright render fallback — only when the plain fetch found no usable
  // email (the exact case where the app used to give up and fall to auto-fill).
  const renderer = join(__dirname, 'contact-render.mjs');
  if (existsSync(renderer) && (!html || (!contact.emails.length && !contact.applicationEmails.length))) {
    try {
      const r = spawnSync('node', [renderer, url, String(textLimit)], {
        encoding: 'utf-8',
        timeout: 45000,
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      if (r.status === 0) {
        const parsed = parseJsonFromOutput(r.stdout || '');
        if (parsed && !parsed.error && parsed.pageText && parsed.pageText.length > 50) {
          const renderedText = (parsed.pageText || '').replace(/\s+/g, ' ').trim();
          if (renderedText.length > pageText.length) pageText = renderedText;
          const renderedContact = extractJdContact('', `${parsed.emails || []}\n${parsed.applicationEmails || []}\n${parsed.pageText || ''}`);
          if (renderedContact.applicationEmails.length || renderedContact.emails.length) {
            // Prefer application-looking emails, then any real email, then keep
            // whatever the plain fetch found as a last resort.
            contact = {
              emails: renderedContact.emails.length ? renderedContact.emails : contact.emails,
              phones: (parsed.phones || []).length ? parsed.phones : contact.phones,
              applicationEmails: renderedContact.applicationEmails.length ? renderedContact.applicationEmails : contact.applicationEmails,
            };
          }
        }
      }
    } catch { /* renderer failed — proceed with plain-fetch results */ }
  }

  return {
    html,
    pageText: pageText.slice(0, textLimit),
    contact,
  };
}

// Load the persistent agent-training context for spawned opencode calls.
// Prefers <cwd>/agent-training.md (per-user override), falls back to root.
function readAgentTraining(cwd) {
  for (const candidate of [cwd, __dirname]) {
    if (!candidate) continue;
    const p = join(candidate, 'agent-training.md');
    if (existsSync(p)) {
      try { return readFileSync(p, 'utf-8').trim(); } catch { /* fall through */ }
    }
  }
  return '';
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
    const script = join(__dirname, 'doctor.mjs');
    const args = [script, '--json'];
    const cwd = userCwd(req);
    const nodeBin = process.execPath || 'node';
    const r = spawnSync(nodeBin, args, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000
    });
    if (r.error) {
      return res.status(500).json({ error: `Failed to run doctor: ${r.error.message}` });
    }
    if (r.status !== 0) {
      return res.status(500).json({ error: r.stderr?.slice(0, 500) || 'doctor.mjs failed' });
    }
    const output = (r.stdout || '').trim();
    try {
      res.json(JSON.parse(output));
    } catch {
      res.status(500).json({ error: 'doctor.mjs produced invalid JSON', raw: output.slice(0, 500) });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /users/:email/oauth/exchange ──────────────────────────────
// Exchange authorization code for OAuth2 tokens and store per-user.
// Body: { code, clientId, clientSecret, redirectUri? }
app.post('/users/:email/oauth/exchange', async (req, res) => {
  console.log(`[OAuth] Exchange request received for email=${req.params.email}`);
  try {
    const email = decodeURIComponent(req.params.email);
    const { code, clientId: clientIdBody, clientSecret: clientSecretBody, redirectUri, cookies } = req.body;
    const clientId = clientIdBody || process.env.GMAIL_CLIENT_ID;
    const clientSecret = clientSecretBody || process.env.GMAIL_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'code required; clientId/clientSecret from body or .bridge.env' });
    }

    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        access_type: 'offline',
        prompt: 'consent',
        redirect_uri: redirectUri || 'https://career-ops.app',
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[OAuth] Token exchange failed: ${resp.status}`, err.slice(0, 500));
      return res.status(400).json({ error: `Token exchange failed: ${resp.status}`, details: err.slice(0, 300) });
    }

    const data = await resp.json();

    // Decode email from ID token if available (Chrome Custom Tabs flow doesn't provide email client-side)
    let resolvedEmail = email;
    if (data.id_token) {
      try {
        const payload = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64').toString());
        if (payload.email) resolvedEmail = payload.email;
      } catch (_) {}
    }

    const creds = {
      email: resolvedEmail,
      clientId,
      clientSecret,
      accessToken: data.access_token || '',
      refreshToken: data.refresh_token || '',
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
      tokenType: data.token_type || 'Bearer',
      scope: data.scope || '',
      storedAt: new Date().toISOString(),
    };

    setUserOAuth(resolvedEmail, creds);

    // The app's WebView login mints Google session cookies alongside the OAuth
    // code. Persist them server-side here (the same proven request path) so the
    // Playwright profile can be seeded — a separate client seed POST has proven
    // flaky on the app side, so the exchange carries the cookies too.
    if (typeof cookies === 'string' && cookies.trim()) {
      const parsed = parseGoogleCookieString(cookies);
      if (parsed.length) {
        const target = join(resolveUserDataDir(resolvedEmail), 'google-cookies.json');
        writeFileSync(target, JSON.stringify({ cookies: parsed, updatedAt: new Date().toISOString() }, null, 2));
        console.log(`[seed] via-exchange userId=${resolvedEmail} count=${parsed.length} → ${target}`);
      }
    }

    res.json({
      success: true,
      email: resolvedEmail,
      hasRefreshToken: !!creds.refreshToken,
      expiresIn: data.expires_in || 3600,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /auth/google-id-token ────────────────────────────────────
// Verify a Google ID token from Credential Manager. Returns whether
// the user already has Gmail OAuth configured or needs the full flow.
app.post('/auth/google-id-token', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });

    // Decode the JWT payload (no signature verification — this came from Google's SDK)
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    const email = payload.email;
    if (!email) return res.status(400).json({ error: 'No email in ID token' });

    // Check if user already has OAuth credentials stored
    const creds = getUserOAuth(email);
    const hasGmailAuth = !!(creds && creds.refreshToken);

    res.json({
      success: true,
      email,
      hasGmailAuth,
      name: payload.name || '',
      picture: payload.picture || '',
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

// ── GET /users/:email/oauth/tokens ─────────────────────────────────
// Return OAuth tokens for a user. Protected by bridge token.
app.get('/users/:email/oauth/tokens', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    // Verify bridge token
    const bridgeToken = req.headers['x-bridge-token'] || '';
    if (bridgeToken !== process.env.BRIDGE_TOKEN) {
      return res.status(403).json({ error: 'Invalid bridge token' });
    }
    const creds = getUserOAuth(email);
    if (!creds) {
      return res.status(404).json({ error: 'No OAuth credentials' });
    }
    // If expired but has refresh token, attempt refresh
    if (creds.expiresAt && Date.now() > creds.expiresAt && creds.refreshToken) {
      try {
        const refreshed = await refreshOAuthToken(creds);
        if (refreshed) {
          Object.assign(creds, refreshed);
          setUserOAuth(email, creds);
        }
      } catch (e) {
        console.error('[OAuth] Token refresh failed:', e.message);
      }
    }
    res.json({
      email: creds.email,
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      expiresAt: creds.expiresAt,
      tokenType: creds.tokenType,
      scope: creds.scope,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /users/:email/oauth/callback ───────────────────────────────
// OAuth2 redirect handler — the user lands here after Google consent.
// Auto-exchanges the code for tokens.
app.get('/users/:email/oauth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).send(`<html><body><h2>Authorization failed</h2><p>${error}</p></body></html>`);
  }
  if (!code) {
    return res.status(400).send('<html><body><h2>No authorization code received</h2></body></html>');
  }
  try {
    const email = decodeURIComponent(req.params.email);
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      access_type: 'offline',
      prompt: 'consent',
      redirect_uri: `http://127.0.0.1:8787/users/${encodeURIComponent(email)}/oauth/callback`,
    });
    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!resp.ok) {
      const err = await resp.text();
      return res.status(400).send(`<html><body><h2>Token exchange failed</h2><pre>${err.slice(0, 500)}</pre></body></html>`);
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
    const hasRefresh = !!creds.refreshToken;
    res.send(`<html><body style="font-family:system-ui;max-width:500px;margin:50px auto;text-align:center;">
      <h1>✅ ${hasRefresh ? 'Authorization Complete!' : 'Partial Auth'}</h1>
      <p>Email: ${email}</p>
      <p>Refresh Token: ${hasRefresh ? '✅ Obtained' : '❌ Not obtained (will expire in 1hr)'}</p>
      <p>You can close this tab and return to career-ops.</p>
      <script>setTimeout(()=>window.close(),2000)</script>
    </body></html>`);
  } catch (e) {
    res.status(500).send(`<html><body><h2>Error</h2><pre>${e.message}</pre></body></html>`);
  }
});

// POST /email/connect — Save app password for a user (user-friendly fallback)
app.post('/email/connect', (req, res) => {
  try {
    const { email, appPassword: rawPw } = req.body;
    if (!email || !rawPw) return res.status(400).json({ error: 'email and appPassword required' });
    const appPassword = rawPw.replace(/\s+/g, '');

    // Store as per-user credentials (app password mode)
    const userId = req.userCtx?.userId || email;
    const creds = {
      email,
      clientId: '',
      clientSecret: '',
      accessToken: '',
      refreshToken: '',
      appPassword,
      expiresAt: 0,
      tokenType: 'app_password',
      scope: 'imap_smtp',
      storedAt: new Date().toISOString(),
    };
    setUserOAuth(userId, creds);
    res.json({ success: true, email, method: 'app_password' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

    // Create modes/_profile.md — archetypes, narrative, negotiation from user's data
    const modesDir = join(userDir, 'modes');
    if (!existsSync(modesDir)) mkdirSync(modesDir, { recursive: true });

    const profileMdPath = join(modesDir, '_profile.md');
    if (!existsSync(profileMdPath)) {
      const roles = Array.isArray(targetRoles) ? targetRoles : [targetRoles || 'Software Developer'];
      const roleName = roles[0] || 'Software Developer';
      const roleList = roles.map(r => `| **${r}** | Skills from your CV | cv.md |`).join('\n');
      const compRange = compensation || '3-6 LPA';
      const loc = location || 'India';

      const profileMd = `# User Profile Context -- career-ops

<!-- This file was auto-generated during onboarding. Customize via chat or edit directly. -->

## Your Target Roles

| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
${roleList}

## Your Adaptive Framing

| If the role is... | Emphasize about you... | Proof point sources |
|-------------------|------------------------|---------------------|
${roles.map(r => `| ${r} | Your strongest projects and skills for this role | cv.md |`).join('\n')}

## Your Exit Narrative

${name || 'Candidate'} is a ${roleName} with experience from their CV. They combine technical skills with practical project experience, making them effective at delivering complete features.

## Your Cross-cutting Advantage

Built multiple projects demonstrating end-to-end development capability. Combines technical skills with practical problem-solving.

## Your Comp Targets

Targeting ${compRange} for roles in ${loc}.
- Check local market rates via Glassdoor, AmbitionBox, LinkedIn Salary
- Use this range as baseline in evaluations

## Your Negotiation Scripts

**Salary expectations:**
> "Based on my experience and market data for this role, I'm targeting ${compRange}. I'm open to discussing based on the overall opportunity and growth."

**When offered below target:**
> "I'm excited about this role. Based on my experience, I'm looking at ${compRange}. Is there flexibility in the budget?"

## Your Location Policy

Roles in ${loc} preferred. Willing to commute within reason. Score remote/hybrid roles higher unless location is explicitly local.
`;
      writeFileSync(profileMdPath, profileMd, 'utf-8');
    }

    // Create modes/_custom.md — house rules
    const customMdPath = join(modesDir, '_custom.md');
    if (!existsSync(customMdPath)) {
      const compRange = compensation || '3-6 LPA';
      const loc = location || 'India';
      const customMd = `# Custom Instructions -- career-ops

<!-- Auto-generated during onboarding. Add rules via chat. -->

## House Rules

- Always check and flag compensation in every evaluation. Minimum bar: the lower end of ${compRange}. Flag roles below that as a dealbreaker.
- Prioritize roles in ${loc}. Remote/hybrid is preferred if available.
- Never auto-submit applications without user confirmation first.
- After each evaluation, if user says "too high" or "you missed X", update this file.

## Custom Workflows

(none yet -- add yours via chat)

## Output Preferences

- Reports: lead with the score and one-line verdict
- Keep responses concise — show action cards, not walls of text

## Off-Limits

- Never auto-send emails or applications without user tapping [Send] or [Apply]
- Never fabricate claims not in cv.md
`;
      writeFileSync(customMdPath, customMd, 'utf-8');
    }

    res.json({
      success: true,
      email,
      userDir: `/data/users/${email.replace(/[^a-z0-9@.+-]/gi, '_')}`,
      files: ['data/cv.md', 'config/profile.yml', 'modes/_profile.md', 'modes/_custom.md', 'data/applications.md', 'data/blacklist.md', 'data/pipeline.md', '.oauth2.json'],
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
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          const sub = join(dir, entry.name);
          if (existsSync(sub)) results.push(...walkDir(sub, relPath));
        } else if (entry.isFile() && entry.name !== '.oauth2.json') {
          try {
            const stat = statSync(join(dir, entry.name));
            results.push({ path: relPath, size: stat.size, modified: stat.mtime.toISOString() });
          } catch { /* skip unreadable files */ }
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

    const r = spawnSync('node', [join(__dirname, 'set-status.mjs'), id, status, '--json', '--user-dir', userDir], {
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
    const r = spawnSync('node', [join(__dirname, 'merge-tracker.mjs'), '--user-dir', userDir], {
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
// Build a raw RFC2822 message (optionally with a PDF attachment) for Gmail REST send.
function buildRfc2822Message({ from, to, subject, body, pdfPath }) {
  const hasAttachment = pdfPath && existsSync(pdfPath);
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject || ''}`,
    'MIME-Version: 1.0',
  ];
  if (hasAttachment) {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(body);
    lines.push('');
    lines.push(`--${boundary}`);
    const pdfBuf = readFileSync(pdfPath);
    const fileName = basename(pdfPath) || 'resume.pdf';
    lines.push(`Content-Type: application/pdf; name="${fileName}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${fileName}"`);
    lines.push('');
    lines.push(pdfBuf.toString('base64'));
    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(body);
  }
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

app.post('/email/send', async (req, res) => {
  try {
    const { email: emailParam, appPassword, company, role, body, to, pdfPath } = req.body;
    // Sender is optional when X-User-Id is present (the app never sends it):
    // fall back to the userId header, then the legacy GMAIL_USER env.
    const email = (emailParam || '').trim() || req.userCtx?.userId || process.env.GMAIL_USER || '';
    if (!email || !body) {
      return res.status(400).json({ error: 'email (sender) and body are required' });
    }
    if (!to || !String(to).trim()) {
      return res.status(400).json({ error: 'to (recipient) is required — refusing to send without a recipient' });
    }

    // Idempotency: refuse an identical send (user, recipient, company, role)
    // within the dedup window — the app's Send button already guards client-side,
    // this is the server-side net so a retry/double-tap never emails twice.
    const dedupKey = recentEmailSendKey(req.userCtx?.userId, to, company, role);
    const now = Date.now();
    const prevSend = _recentEmailSends.get(dedupKey);
    if (prevSend && now - prevSend.ts < EMAIL_SEND_DEDUP_MS) {
      console.log(`[email/send] duplicate blocked (${dedupKey})`);
      return res.json({ success: true, duplicate: true, method: 'dedup', messageId: prevSend.messageId || null });
    }
    _recentEmailSends.set(dedupKey, { ts: now, messageId: null });
    const recordSent = (messageId) => {
      _recentEmailSends.set(dedupKey, { ts: Date.now(), messageId: messageId || null });
    };
    const clearSend = () => _recentEmailSends.delete(dedupKey);
    // Application emails must carry the CV. When the caller didn't pass a
    // pdfPath, default to the user's generated CV PDF (per-user, then legacy).
    // A relative pdfPath is resolved against the user's tree (multi-user).
    const defaultCv = req.userCtx?.userDir
      ? join(req.userCtx.userDir, 'output', 'generic-cv.pdf')
      : join(__dirname, 'output', 'generic-cv.pdf');
    let resolvedPdf;
    if (pdfPath) {
      if (existsSync(pdfPath)) {
        resolvedPdf = pdfPath;
      } else if (req.userCtx?.userDir && existsSync(join(req.userCtx.userDir, pdfPath))) {
        resolvedPdf = join(req.userCtx.userDir, pdfPath);
      }
    }
    if (!resolvedPdf && existsSync(defaultCv)) resolvedPdf = defaultCv;

    // Determine auth method: per-user OAuth2 > legacy OAuth2 > app password
    const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
    const hasUserOAuth2 = hasUsableOAuth(userOAuth);
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    const envAppPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    const subject = `Application for ${role || 'Unknown Role'} at ${company || 'Unknown Company'}`;

    // ── OAuth2: Gmail REST send (token carries gmail.send, not the mail.google.com SMTP scope) ──
    if (hasUserOAuth2 || hasLegacyOAuth2) {
      let accessToken = null;
      try {
        accessToken = await resolveGmailAccessToken(req.userCtx?.userId, email);
      } catch (tokenErr) {
        console.warn(`[email/send] token resolution failed: ${tokenErr.message}`);
      }
      if (accessToken) {
        try {
          const raw = buildRfc2822Message({ from: email, to, subject, body, pdfPath: resolvedPdf });
          const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ raw }),
          });
          if (sendResp.ok) {
            const sent = await sendResp.json();
            console.log(`[email/send] gmail_rest success (id=${sent.id})`);
            recordSent(sent.id);
            return res.json({ success: true, applicationId: 0, method: hasUserOAuth2 ? 'per_user_oauth2_rest' : 'legacy_oauth2_rest', messageId: sent.id });
          }
          const errText = await sendResp.text();
          console.warn(`[email/send] gmail_rest failed: ${sendResp.status} ${errText.slice(0, 200)}`);
        } catch (e) {
          console.warn(`[email/send] gmail_rest error: ${e.message}`);
        }
      }
    }

    // ── SMTP fallback (app password only) — SMTP XOAUTH2 needs the mail.google.com scope ──
    const attempts = [];
    if (appPassword) {
      attempts.push({ label: 'app_password', auth: { user: email, pass: appPassword } });
    }
    if (!hasUserOAuth2 && !hasLegacyOAuth2 && !appPassword && envAppPassword) {
      attempts.push({ label: 'env_app_password', auth: { user: email, pass: envAppPassword } });
    }

    if (attempts.length === 0) {
      clearSend();
      return res.status(400).json({ error: 'Gmail REST send unavailable and no appPassword configured for SMTP fallback' });
    }

    const mailOpts = {
      from: email,
      to,
      subject,
      text: body,
    };
    if (resolvedPdf) mailOpts.attachments = [{ path: resolvedPdf }];

    let lastErr = null;
    for (const attempt of attempts) {
      try {
        const transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com', port: 587, secure: false,
          auth: attempt.auth,
        });
        await transporter.sendMail(mailOpts);
        console.log(`[email/send] ${attempt.label} success`);
        recordSent(null);
        return res.json({ success: true, applicationId: 0, method: attempt.label });
      } catch (e) {
        console.warn(`[email/send] ${attempt.label} failed: ${e.message}`);
        lastErr = e;
      }
    }
    clearSend();
    return res.status(500).json({ success: false, error: lastErr ? lastErr.message : 'Email send failed' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Shared IMAP fetch — single implementation used by /email/inbox and /email/triage
// Supports both app password and OAuth2 (XOAUTH2), per-user and legacy

// Rate-limit IMAP connection error logging — the scheduler polls every few
// minutes, so an auth/config failure would otherwise spam the logs. Log once
// per email per hour (or immediately when the error text changes).
const _imapErrorLog = new Map();
// Idempotency guard for /email/send: blocks duplicate sends of the same
// application (same user, recipient, company, role) within a short window,
// so a double-tap / retry in the app can never email a recruiter twice.
const _recentEmailSends = new Map();
const EMAIL_SEND_DEDUP_MS = 60000;
function recentEmailSendKey(userId, to, company, role) {
  return `${String(userId || '').toLowerCase()}|${String(to || '').trim().toLowerCase()}|${String(company || '').trim().toLowerCase()}|${String(role || '').trim().toLowerCase()}`;
}
function logImapError(email, err) {
  const msg = err?.message || String(err);
  const key = String(email || '').toLowerCase();
  const now = Date.now();
  const prev = _imapErrorLog.get(key);
  if (prev && msg === prev.msg && now - prev.ts < 3600000) return; // same error within 1h — silent
  _imapErrorLog.set(key, { msg, ts: now });
  console.error(`[IMAP] Connection error for ${email}: ${msg}`);
}

// Same treatment for REST failures (e.g. Gmail API disabled) so the
// scheduler doesn't spam an identical 403 every poll.
const _restErrorLog = new Map();
function logRestError(tag, email, err) {
  const msg = (err?.message || String(err)).slice(0, 160);
  const key = `${tag}|${String(email || '').toLowerCase()}`;
  const now = Date.now();
  const prev = _restErrorLog.get(key);
  if (prev && msg === prev.msg && now - prev.ts < 3600000) return;
  _restErrorLog.set(key, { msg, ts: now });
  console.error(`[${tag}] ${err?.message || err}`);
}

async function fetchEmails(email, password, { daysBack = 30, maxEmails = 50, timeout = 30000, userOAuth = null } = {}) {
  // Determine auth method: per-user OAuth2 > legacy OAuth2 > app password
  const hasUserOAuth2 = hasUsableOAuth(userOAuth);
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  let imapConfig;

  if (hasUserOAuth2) {
    let accessToken = userOAuth.accessToken;
    if (!accessToken || (userOAuth.expiresAt && Date.now() > userOAuth.expiresAt - 300000)) {
      // Refresh token if we have one, otherwise use existing access token as-is
      if (userOAuth.refreshToken) {
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
        } else {
          const errText = await tokenResp.text().catch(() => '');
          console.error(`[IMAP] Token refresh failed for ${email}: ${tokenResp.status} ${errText.slice(0, 200)}`);
          if (!accessToken) {
            console.error(`[IMAP] No access token available for ${email} — cannot authenticate`);
            return [];
          }
        }
      }
    }
    imapConfig = {
      user: email,
      xoauth2: buildXoauth2String(email, accessToken),
      host: 'imap.gmail.com', port: 993, tls: true,
      connTimeout: 30000, authTimeout: 30000,
      tlsOptions: { rejectUnauthorized: false },
    };
  } else if (hasLegacyOAuth2) {
    const accessToken = await getGmailAccessToken();
    imapConfig = {
      user: email,
      xoauth2: buildXoauth2String(email, accessToken),
      host: 'imap.gmail.com', port: 993, tls: true,
      connTimeout: 30000, authTimeout: 30000,
      tlsOptions: { rejectUnauthorized: false },
    };
  } else {
    imapConfig = {
      user: email, password,
      host: 'imap.gmail.com', port: 993, tls: true,
      connTimeout: 30000, authTimeout: 30000,
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

        function processResults(latest) {
          let pending = latest.length;
          let timedOut = false;

          if (pending === 0) { imap.end(); finish(); return; }

          const f = imap.fetch(latest, { bodies: '', uids: true });
          f.on('message', (msg) => {
            let buf = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buf += chunk.toString('utf-8'); });
              stream.on('end', () => {
                simpleParser(buf, (parseErr, parsed) => {
                  if (!parseErr && parsed) {
                    emails.push({
                      uid: msg.uid,
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
        }

        // Defensive search: V8 throws "Too many arguments" with large result sets on imap.search()
        try {
          imap.search(['ALL', ['SINCE', since]], (err, results) => {
            if (err || !results || results.length === 0) { imap.end(); finish(); return; }
            processResults(results.slice(-maxEmails));
          });
        } catch (searchErr) {
          console.warn(`[IMAP] search() threw (${searchErr.message}), falling back to seq.search with capped results`);
          try {
            imap.seq.search(['ALL', ['SINCE', since]], (err2, results2) => {
              if (err2 || !results2 || results2.length === 0) { imap.end(); finish(); return; }
              processResults(results2.slice(-Math.min(maxEmails, 50)));
            });
          } catch (seqErr) {
            console.error(`[IMAP] seq.search also failed: ${seqErr.message}`);
            imap.end();
            finish();
          }
        }
      });
    });
    imap.once('error', (err) => {
      logImapError(email, err);
      finish();
    });
    imap.connect();
    setTimeout(() => { finish(); }, timeout);
  });
}

// ── Gmail REST inbox (reliable alternative to IMAP) ────────────────
// The `imap` npm package throws "Too many arguments" against Gmail on
// large/older accounts. OAuth users get the Gmail REST API instead —
// same tokens, no flaky parser. App-password users keep the IMAP path.

async function resolveGmailAccessToken(userId, email) {
  const userOAuth = userId ? getUserOAuth(userId) : null;
  if (userOAuth && hasUsableOAuth(userOAuth)) {
    if (!userOAuth.accessToken || (userOAuth.expiresAt && Date.now() > userOAuth.expiresAt - 300000)) {
      if (userOAuth.refreshToken) {
        const refreshed = await refreshOAuthToken(userOAuth);
        if (refreshed) {
          Object.assign(userOAuth, refreshed);
          try { setUserOAuth(userId, userOAuth); } catch {}
        }
      }
    }
    if (userOAuth.accessToken) return userOAuth.accessToken;
  }
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN) {
    return getGmailAccessToken();
  }
  throw new Error('No Gmail auth available for REST inbox');
}

function parseFromEmail(fromStr) {
  const m = String(fromStr || '').match(/<([^>]+)>/);
  return m ? m[1] : String(fromStr || '').trim().split(/\s+/)[0];
}

function extractGmailBody(msg) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.body && node.body.data) {
      try {
        const b64 = node.body.data.replace(/-/g, '+').replace(/_/g, '/');
        parts.push(Buffer.from(b64, 'base64').toString('utf-8'));
      } catch { /* skip undecodable part */ }
    }
    if (Array.isArray(node.parts)) for (const p of node.parts) walk(p);
  };
  walk(msg.payload);
  return parts.join('\n\n');
}

async function fetchGmailInboxREST(email, userId, { daysBack = 30, maxEmails = 50, query } = {}) {
  const accessToken = await resolveGmailAccessToken(userId, email);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const q = query || `in:inbox newer_than:${Math.max(daysBack, 1)}d`;
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${Math.min(Math.max(maxEmails, 1), 50)}&q=${encodeURIComponent(q)}`;
  const listResp = await fetch(listUrl, { headers });
  if (!listResp.ok) {
    const errText = await listResp.text().catch(() => '');
    throw new Error(`Gmail API list failed: ${listResp.status} ${errText.slice(0, 200)}`);
  }
  const listData = await listResp.json();
  const ids = (listData.messages || []).slice(0, maxEmails).map(m => m.id);

  const emails = [];
  await Promise.all(ids.map(async (id) => {
    try {
      const msgResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers });
      if (!msgResp.ok) return;
      const msg = await msgResp.json();
      const headersMap = {};
      for (const h of (msg.payload?.headers || [])) headersMap[h.name.toLowerCase()] = h.value;
      const bodyText = extractGmailBody(msg);
      const parsedDate = new Date(headersMap.date || parseInt(msg.internalDate || 0, 10));
      emails.push({
        gmailId: msg.id,
        from: headersMap.from || '',
        fromEmail: parseFromEmail(headersMap.from || ''),
        subject: headersMap.subject || '',
        date: isNaN(parsedDate.getTime()) ? new Date(0).toISOString() : parsedDate.toISOString(),
        preview: (msg.snippet || '').substring(0, 200),
        body: bodyText.substring(0, 5000),
      });
    } catch { /* skip individual message failures */ }
  }));

  emails.sort((a, b) => new Date(b.date) - new Date(a.date));
  emails.forEach((e, i) => { e.id = i + 1; });
  return emails;
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
  const rawAppPassword = (req.query.appPassword || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  // Treat placeholder/revoked app passwords as no password
  const appPassword = rawAppPassword && !rawAppPassword.includes('REVOKED') && !rawAppPassword.includes('REPLACE') ? rawAppPassword : null;
  const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
  const hasUserOAuth2 = hasUsableOAuth(userOAuth);
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  const includeSpam = req.query.includeSpam === 'true'; // opt-in to see spam

  if (!email) {
    return res.status(400).json({ error: 'email required — set GMAIL_USER env var or pass as query param' });
  }
  if (!appPassword && !hasUserOAuth2 && !hasLegacyOAuth2) {
    return res.status(400).json({ error: 'No email auth configured. Connect Gmail in Settings (OAuth or app password).' });
  }

  try {
    const daysBack = parseInt(req.query.daysBack, 10) || 30;
    const maxEmails = parseInt(req.query.maxEmails, 10) || 50;

    // OAuth users get Gmail REST (reliable; IMAP crashes on large mailboxes).
    // App-password users keep IMAP. On REST failure, fall back to IMAP.
    let allEmails;
    let method;
    if (hasUserOAuth2 || hasLegacyOAuth2) {
      try {
        allEmails = await fetchGmailInboxREST(email, req.userCtx.userId, { daysBack, maxEmails });
        method = hasUserOAuth2 ? 'per_user_oauth2_rest' : 'legacy_oauth2_rest';
      } catch (restErr) {
        logRestError('email/inbox', email, restErr);
        allEmails = await fetchEmails(email, appPassword, { userOAuth, daysBack, maxEmails });
        method = hasUserOAuth2 ? 'per_user_oauth2_imap' : 'legacy_oauth2_imap';
      }
    } else {
      allEmails = await fetchEmails(email, appPassword, { userOAuth, daysBack, maxEmails });
      method = 'app_password';
    }

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
      method,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /email/sent — list emails sent from the account (audit trail).
// Read-only; used to show the user exactly what the system sent.
app.get('/email/sent', async (req, res) => {
  const email = req.query.email || process.env.GMAIL_USER;
  const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
  const hasUserOAuth2 = hasUsableOAuth(userOAuth);
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;

  if (!email) return res.status(400).json({ error: 'email required' });
  if (!hasUserOAuth2 && !hasLegacyOAuth2) {
    return res.status(400).json({ error: 'Sent-folder audit requires OAuth2 (app-password IMAP not supported for sent)' });
  }

  try {
    const daysBack = parseInt(req.query.daysBack, 10) || 3;
    const maxEmails = parseInt(req.query.maxEmails, 10) || 50;
    const sent = await fetchGmailInboxREST(email, req.userCtx.userId, {
      daysBack,
      maxEmails,
      query: `in:sent newer_than:${Math.max(daysBack, 1)}d`,
    });
    res.json({ emails: sent, total: sent.length, method: 'gmail_rest_sent' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /scan — uses real career-ops provider system + web search fallback
// Now includes: blacklist checking, scan history tracking, trust validation
app.post('/scan', async (req, res) => {
  try {
    let { keywords, locations } = req.body;

    // Auto-load from user profile if not provided in request
    if (!keywords || keywords.length === 0 || !locations || locations.length === 0) {
      const pPath = req.userCtx.profilePath;
      if (pPath && existsSync(pPath)) {
        try {
          const profile = yaml.load(readFileSync(pPath, 'utf-8')) || {};
          if ((!keywords || keywords.length === 0) && profile.target_roles?.primary?.length) {
            keywords = profile.target_roles.primary;
          }
          if ((!locations || locations.length === 0) && profile.location?.city) {
            locations = [profile.location.city];
          }
        } catch { /* profile read is non-fatal */ }
      }
    }

    // Read user's location from profile for dynamic proximity
    const userProfile = readUserProfileRaw(req);
    const userCity = ((userProfile.location?.city) || '').toLowerCase().trim();
    const userCountry = ((userProfile.location?.country) || '').toLowerCase().trim();
    const userLocFull = ((userProfile.candidate?.location) || '').toLowerCase().trim();
    const userLocFlex = ((userProfile.candidate?.location_flexibility) || '').toLowerCase().trim();

    // Dynamically extract nearby location terms from flexibility + full location
    const nearbyTerms = buildNearbyTerms(userProfile);

    const rawKw = (keywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
    const STOP_WORDS = new Set(['full', 'stack']);
    const expandedKw = new Set(rawKw);
    for (const k of rawKw) {
      for (const w of k.split(/\s+/)) {
        if (w.length >= 4 && !STOP_WORDS.has(w)) expandedKw.add(w);
      }
    }
    const kw = [...expandedKw];

    // Build domain relevance terms from user's experience narrative
    const domainTerms = new Set();
    const storyStopWords = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'three', 'core', 'production', 'now', 'seeking', 'full', 'time', 'role', 'build', 'scale', 'applications', 'built', 'end', 'across']);
    const exitStory = (userProfile.narrative?.exit_story || '').toLowerCase();
    for (const w of exitStory.split(/\W+/).filter(w => w.length >= 4 && !storyStopWords.has(w))) domainTerms.add(w);
    for (const pp of (userProfile.narrative?.proof_points || [])) {
      for (const w of (pp.hero_metric || '').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !storyStopWords.has(w))) domainTerms.add(w);
    }

    // Build location expansion dynamically from user's profile terms
    const LOCATION_EXPANSIONS = {};
    for (const term of nearbyTerms) {
      if (!LOCATION_EXPANSIONS[term]) LOCATION_EXPANSIONS[term] = [...nearbyTerms];
    }
    // Locations can arrive as a single comma/newline-separated blob (the
    // profile city block) — split into individual terms so each city matches.
    const rawLocs = (locations || []).flatMap(l => String(l).toLowerCase().split(/[,\n;&]+/).map(s => s.trim())).filter(Boolean);
    // For each raw location term, derive variants: prefix "navi ", "greater " and suffix " area", " region"
    for (const loc of [...nearbyTerms, ...rawLocs]) {
      const variants = [loc, loc.replace(/\s+area$/,''), loc.replace(/\s+region$/, '')];
      if (!loc.startsWith('navi ') && !loc.startsWith('new ') && !loc.startsWith('greater ')) {
        variants.push('navi ' + loc);
        variants.push('greater ' + loc);
      }
      if (!LOCATION_EXPANSIONS[loc]) LOCATION_EXPANSIONS[loc] = variants;
      else for (const v of variants) if (!LOCATION_EXPANSIONS[loc].includes(v)) LOCATION_EXPANSIONS[loc].push(v);
    }
    const locs = Array.from(new Set(rawLocs.flatMap(l => LOCATION_EXPANSIONS[l] || [l])));

    const portalsPath = join(__dirname, 'portals.yml');
    if (!existsSync(portalsPath)) return res.json({ results: [], summary: { portalsScanned: 0, totalFound: 0, filteredByKeywords: 0, duplicatesSkipped: 0, netNew: 0, tooBroad: false, narrowingHints: [] } });
    const py = yaml.load(readFileSync(portalsPath, 'utf-8'));
    let companies = py?.tracked_companies || [];
    const boards = py?.search_queries || [];
    const jobBoards = py?.job_boards || [];

    // Also load companies from tracker — every company user applied to becomes a scan target
    const trackerPath = req.userCtx.trackerPath || TRACKER_PATH;
    if (existsSync(trackerPath)) {
      const trackerLines = readFileSync(trackerPath, 'utf-8').split('\n');
      const existingNames = new Set(companies.map(c => (c.name || '').toLowerCase()));
      for (const line of trackerLines) {
        const m = line.match(/^\|\s*\d+\s*\|[^|]*\|([^|]+)/);
        if (m) {
          const companyName = m[1].trim();
          const lower = companyName.toLowerCase();
          if (lower && !existingNames.has(lower)) {
            existingNames.add(lower);
            const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^(the|a|an)/, '');
            companies.push({
              name: companyName,
              careers_url: `https://${slug}.com/careers`,
              notes: 'auto-discovered from tracker',
            });
          }
        }
      }
    }

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
    const portalResults = []; // per-portal breakdown
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
      else if (entry.scan_query || entry.careers_url) webSearchTargets.push(entry);
    }
    for (const entry of jobBoards) {
      if (entry.enabled === false) continue;
      if (blacklist.has((entry.name || '').toLowerCase())) continue;
      const resolved = resolveProvider(entry, providers);
      if (resolved && !resolved.error) {
        providerTargets.push({ entry, provider: resolved.provider, isBoard: true });
      } else if (entry.careers_url) {
        webSearchTargets.push(entry);
      }
    }

    // Provider results — two-tier: keyword match first, then location filter
    await Promise.all(providerTargets.map(async (t) => {
      try {
        const ctx = makeHttpCtx();
        const jobs = await t.provider.fetch(t.entry, ctx);
        totalBeforeFilter += jobs.length;
        let kwCount = 0;
        let exactCount = 0;
        for (const job of jobs) {
          const title = (job.title || '').toLowerCase();
          const loc = (job.location || '').toLowerCase();
          const matchesKw = kw.length === 0 || kw.some(k => title.includes(k));
          if (matchesKw) {
            kwCount++;
            const SENIOR_TITLE_RE = /\b(senior|staff|principal|head of|vice president|vp[\s.]|director|sr\.?\s)/i;
            if (SENIOR_TITLE_RE.test(title)) continue;
            const entry = { company: job.company || t.entry.name || '', role: job.title || '', location: job.location || '', url: job.url || '', matched: true, source: t.provider.id, notes: t.entry.notes || '' };
            keywordMatched.push(entry);
            const matchesLoc = locs.length === 0 || locs.some(l => loc.includes(l));
            if (matchesLoc) {
              exactCount++;
              results.push(entry);
            }
          }
        }
        portalResults.push({ company: t.entry.name || 'unknown', status: 'scanned', keywordMatches: kwCount, exactMatches: exactCount });
      } catch (e) {
        portalResults.push({ company: t.entry.name || 'unknown', status: 'errored', keywordMatches: 0, exactMatches: 0, error: e.message?.slice(0, 200) || 'unknown error' });
        errored.push({ company: t.entry.name, error: e.message });
      }
    }));

    // Phase 2: Web search fallback for companies with no provider match
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    await Promise.all(webSearchTargets.slice(0, 15).map(async (entry) => {
      try {
        if (!entry.careers_url) { portalResults.push({ company: entry.name || 'unknown', status: 'skipped', keywordMatches: 0, exactMatches: 0 }); return; }
        const resp = await fetch(entry.careers_url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
        });
        if (!resp.ok) { portalResults.push({ company: entry.name || 'unknown', status: 'unreachable', keywordMatches: 0, exactMatches: 0 }); return; }
        const html = await resp.text().catch(() => '');
        if (html.length < 100) { portalResults.push({ company: entry.name || 'unknown', status: 'empty', keywordMatches: 0, exactMatches: 0 }); return; }
        // Build job title detection terms dynamically from profile + portals config
        const titleDetectTerms = new Set();
        for (const k of rawKw) for (const w of k.split(/\s+/)) if (w.length >= 3) titleDetectTerms.add(w.replace(/[^a-z0-9]/g, ''));
        for (const role of (userProfile.target_roles?.primary || [])) for (const w of role.toLowerCase().split(/\s+/)) if (w.length >= 3) titleDetectTerms.add(w.replace(/[^a-z0-9]/g, ''));
        for (const role of (userProfile.target_roles?.archetypes || [])) for (const w of (role.name || '').toLowerCase().split(/\s+/)) if (w.length >= 3) titleDetectTerms.add(w.replace(/[^a-z0-9]/g, ''));
        // Also add common tech job words that may not appear in user's target roles
        for (const common of ['developer', 'engineer', 'intern', 'software', 'web', 'mobile', 'app', 'data', 'devops', 'cloud', 'platform', 'product', 'designer', 'analyst', 'consultant', 'architect', 'tech', 'support', 'qa', 'test', 'security', 'systems', 'frontend', 'backend', 'fullstack', 'sde', 'swe', 'junior', 'associate']) titleDetectTerms.add(common);
        const jobTitleRx = new RegExp([...titleDetectTerms].sort((a,b) => b.length - a.length).join('|'), 'i');

        // Extract job listings from link text, headings, and spans
        const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>([^<]{4,120})<\/a>/gi;
        const headingPattern = /<(?:h[23]|div|span|strong)[^>]*>([^<]{4,120})<\/(?:h[23]|div|span|strong)>/gi;

        const seenUrls = new Set();
        const matches = [];
        let kwCount = 0;
        let exactCount = 0;

        let m;
        while ((m = linkPattern.exec(html)) !== null) {
          const title = m[2].replace(/<[^>]+>/g, '').trim();
          if (title.length >= 4 && jobTitleRx.test(title.toLowerCase())) matches.push({ title, href: m[1] });
        }
        if (matches.length === 0) {
          while ((m = headingPattern.exec(html)) !== null) {
            const title = m[1].replace(/<[^>]+>/g, '').trim();
            if (title.length >= 4 && jobTitleRx.test(title.toLowerCase())) matches.push({ title, href: '' });
          }
        }

        for (const match of matches) {
          const href = match.href && (match.href.startsWith('http') ? match.href : new URL(match.href, entry.careers_url).href);
          if (href && !isJobDetailUrl(href)) continue;
          if (href && seenUrls.has(href)) continue;
          if (href) seenUrls.add(href);
          const lower = match.title.toLowerCase();
          totalBeforeFilter++;
          if (kw.length === 0 || kw.some(k => lower.includes(k))) {
            kwCount++;
            const companyLoc = (entry.location || '').toLowerCase();
            const matchesLoc = locs.length === 0 || locs.some(l => companyLoc.includes(l));
            const entry2 = { company: entry.name || '', role: match.title, location: entry.location || '', url: href || '', matched: true, source: 'websearch', notes: entry.notes || '' };
            keywordMatched.push(entry2);
            if (matchesLoc) {
              exactCount++;
              results.push(entry2);
            }
          }
        }
        portalResults.push({ company: entry.name || 'unknown', status: 'scanned', keywordMatches: kwCount, exactMatches: exactCount });
      } catch (e) {
        portalResults.push({ company: entry.name || 'unknown', status: 'errored', keywordMatches: 0, exactMatches: 0, error: e.message?.slice(0, 200) || 'unknown error' });
      }
    }));
    clearTimeout(timeout);

    // Dedup exact location matches
    const seen = new Set();
    const beforeDedup = results.length;
    const deduped = results.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    // Sort: nearby areas first, domain relevance second, country match third
    const localScore = (r) => {
      const loc = (r.location || '').toLowerCase();
      for (const t of nearbyTerms) {
        if (t !== userCountry && loc.includes(t)) return 3;
      }
      if (userCountry && loc.includes(userCountry)) return 2;
      if (domainTerms.size > 0) {
        const notesAndCompany = ((r.notes || '') + ' ' + (r.company || '')).toLowerCase();
        for (const dt of domainTerms) {
          if (notesAndCompany.includes(dt)) return 1;
        }
      }
      return 0;
    };
    deduped.sort((a, b) => localScore(b) - localScore(a));

    // Location-aware response: if no exact matches but keyword matches exist,
    // include them as a separate `otherLocations` list so the frontend can
    // show both sets with a clear "outside your area" label
    const locationExactMatch = deduped.length > 0;
    const locationTier = locs.length === 0 ? 'none' : locationExactMatch ? 'exact' : 'nearby';
    keywordMatched.sort((a, b) => localScore(b) - localScore(a));
    let otherLocations = [];
    if (!locationExactMatch && keywordMatched.length > 0) {
      const otherSeen = new Set();
      otherLocations = keywordMatched.filter(r => {
        if (otherSeen.has(r.url)) return false;
        otherSeen.add(r.url);
        return true;
      });
    }

    const duplicatesSkipped = beforeDedup - deduped.length;
    const netNew = deduped.length + otherLocations.length;
    const filteredByKeywords = totalBeforeFilter - keywordMatched.length;
    const filteredByLocation = keywordMatched.length - deduped.length;
    const portalsScanned = providerTargets.length + Math.min(webSearchTargets.length, 15);

    // Track scan history — append new URLs to data/scan-history.tsv (same as scan.mjs)
    const today = new Date().toISOString().slice(0, 10);
    for (const r of [...deduped, ...otherLocations]) {
      if (r.url && !scanHistory.has(r.url)) {
        try { appendFileSync(scanHistPath, `${today}\t${r.url}\t${r.source || 'bridge'}\n`); } catch { /* non-fatal */ }
      }
    }

    // Generate widening steps: honest explanation of what was done
    const wideningSteps = [];
    if (netNew > 0 && locationExactMatch) {
      wideningSteps.push(`Found ${deduped.length} matches in your target area.`);
    } else if (netNew > 0 && !locationExactMatch) {
      wideningSteps.push(`No exact location matches in "${userCity || locs.join(', ')}".`);
      wideningSteps.push(`Found ${otherLocations.length} keyword-matched roles in other areas — included as nearby matches.`);
      if (userCountry) wideningSteps.push(`Try expanding location filter to "${userCountry}" for more results.`);
    } else if (netNew === 0) {
      wideningSteps.push(`Scanned ${portalsScanned} portals for "${rawKw.join(', ')}" positions.`);
      wideningSteps.push('Zero matching jobs found anywhere with current filters.');
      if (userCity) wideningSteps.push(`No openings for your profile in "${userCity}" or wider India at this time.`);
      wideningSteps.push('This is an honest count — will re-check on next scheduled scan.');
    }

    // Generate narrowing hints — progressive: suggest expanding location if no/few results
    const narrowingHints = [];
    if (kw.length === 0) narrowingHints.push('No keyword filter — all roles matched');
    if (locs.length === 0) narrowingHints.push('No location filter — results include all locations');
    if (netNew === 0) {
      narrowingHints.push(`No jobs found with current keywords and location. Try broader keywords or search without location filter.`);
      if (userCountry && userCity) narrowingHints.push(`Try expanding location from "${userCity}" to "${userCountry}" or remove location filter entirely.`);
    } else if (!locationExactMatch && otherLocations.length > 0) {
      narrowingHints.push(`No exact location matches — ${otherLocations.length} keyword-matched jobs found in other locations. Try expanding your location to "${userCountry}" or nearby cities.`);
    }
    if (netNew > 100) narrowingHints.push(`${netNew} results is a lot — consider narrowing keywords or adding a location`);

    // If no exact location matches but keyword matches exist in other locations,
    // include them in results so the app shows something useful
    const exactResults = deduped.slice(0, 100);
    const otherResults = otherLocations.slice(0, 100);
    const mergedResults = exactResults.length > 0 ? exactResults : otherResults;

    res.json({
      total: totalBeforeFilter,
      newFound: netNew,
      results: mergedResults,
      otherLocations: otherResults,
      locationExactMatch,
      portalResults,
      wideningSteps,
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

// ── Timeout helper ─────────────────────────────────────────────────
// Race any promise against a wall-clock deadline. Used around browser
// operations (launch, per-portal scrape, close) so one stuck portal or a
// hung Chromium launch on a phone can never stall the whole scan.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label || 'operation'} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ── Shared location-term builder ─────────────────────────────────────
// Profiles store cities in several shapes — a single city, or a comma /
// newline-separated list ("Mumbai, Thane, Navi Mumbai…"), plus a commuting
// preference that may live under compensation or candidate. Tokenizing all
// of them means a Mumbai-area role matches whether the profile listed it as
// one city or many, for every user.
const LOC_STOP_WORDS = new Set(['onsite','site','on','in','at','area','near','around','hybrid','remote','work','or','and','the','from','office','for','within']);
function buildNearbyTerms(profile) {
  const p = profile || {};
  const city = String(p.location?.city || '').toLowerCase();
  const country = String(p.location?.country || '').toLowerCase();
  const fullLoc = String(p.candidate?.location || '').toLowerCase();
  const flex = String((p.candidate?.location_flexibility) || (p.compensation?.location_flexibility) || '').toLowerCase();
  const terms = new Set();
  const add = (t) => {
    const c = t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim();
    if (c.length >= 2 && !/^\d+$/.test(c)) terms.add(c);
  };
  for (const tok of city.split(/[,\n;&/]+/)) add(tok);
  if (country) terms.add(country);
  for (const tok of flex.split(/[\s,;&/]+/)) {
    const c = tok.toLowerCase().replace(/[^a-z]/g, '');
    if (c.length >= 3 && !LOC_STOP_WORDS.has(c)) terms.add(c);
  }
  if (fullLoc && country) {
    const parts = fullLoc.split(',').map(s => s.trim());
    const statePart = parts.length >= 2 ? parts[parts.length - 2] : '';
    if (statePart && !statePart.includes(country)) add(statePart);
  }
  return terms;
}

// ── Career-ops heuristic scoring for scan results ───────────────────
// Zero-token fit score for every scanned opportunity so the user can see
// a rating on every card. Mirrors the full evaluation rubric (role match,
// seniority, location, domain, compensation). Not a substitute for the
// deep opencode evaluation — it decides which roles deserve one.
function scoreScanResult(result, userProfile, kwList) {
  const title = (result.role || '').toLowerCase();
  const loc = (result.location || '').toLowerCase();
  const company = (result.company || '');
  const notesAndCompany = ((result.notes || '') + ' ' + company + ' ' + title).toLowerCase();
  const profile = userProfile || {};
  let score = 0;
  const details = [];

  // 1. Role match (0-3)
  const targetRoles = (profile.target_roles?.primary || []).map(r => String(r).toLowerCase());
  const archetypes = (profile.target_roles?.archetypes || []).map(a => String(a.name || '').toLowerCase()).filter(Boolean);
  const allRoles = [...new Set([...targetRoles, ...archetypes, ...(kwList || []).map(k => String(k).toLowerCase())])];
  const fullMatch = allRoles.find(r => r && (title === r || title.includes(r)));
  const tokenMatch = allRoles.filter(r => r && r.split(/\s+/).some(t => t.length >= 4 && title.includes(t)));
  if (fullMatch) { score += 3; details.push(`exact role match "${fullMatch}"`); }
  else if (tokenMatch.length > 0) { score += 2; details.push(`keyword overlap: ${[...new Set(tokenMatch)].slice(0, 3).join(', ')}`); }
  else { score += 0.5; details.push('generic engineering role'); }

  // 2. Seniority alignment (0-1)
  const senior = /\b(senior|staff|principal|head of|vp[\s.]|director|lead|architect)\b/i.test(title);
  const junior = /\b(junior|fresher|entry)\b/i.test(title);
  if (junior) { score += 1; details.push('junior/fresher level'); }
  else if (!senior) { score += 0.5; details.push('mid level'); }
  else { details.push('senior role (no bonus)'); }

  // 3. Location proximity (0-2)
  const userCity = ((profile.location?.city) || '').toLowerCase().trim();
  const userCountry = ((profile.location?.country) || '').toLowerCase().trim();
  // location_flexibility lives under compensation in profile.yml (it is a
  // commuting/preference field, not candidate identity). Read both locations
  // for back-compat with profiles that placed it under candidate.
  const flex = ((profile.candidate?.location_flexibility) || (profile.compensation?.location_flexibility) || '').toLowerCase();
  const FLEX_STOP = new Set(['onsite', 'site', 'on', 'in', 'at', 'area', 'near', 'around', 'hybrid', 'remote', 'work', 'or', 'and', 'the']);
  const flexCities = flex.split(/[\s/,;]+/).map(s => s.replace(/^[^a-z]+|[^a-z]+$/g, '')).filter(s => s.length >= 3 && !FLEX_STOP.has(s));
  // The city field may be a multi-line/comma-separated list of preferred
  // cities — tokenize it so every listed city scores like an exact hit.
  const cityTokens = userCity.split(/[,\n;&/]+/).map(s => s.replace(/^[^a-z]+|[^a-z]+$/g, '')).filter(s => s.length >= 2 && !FLEX_STOP.has(s));
  const preferredHits = [...new Set([...cityTokens, ...flexCities].filter(c => loc.includes(c)))];
  if (preferredHits.length > 0) { score += 2; details.push(`in preferred area (${preferredHits.slice(0, 3).join(', ')})`); }
  else if (userCountry && loc.includes(userCountry)) { score += 1.5; details.push('in-country'); }
  else if (/\bremote\b/.test(loc) && (/\bremote\b/.test(flex) || /\bremote\b/.test(userCity))) { score += 2; details.push('remote (preferred)'); }
  else if (loc) { score += 0.5; details.push('outside target area'); }
  else { score += 0.5; details.push('location unknown'); }

  // 4. Domain relevance (0-1)
  const stopWords = new Set(['and','the','for','with','from','that','this','three','core','production','now','seeking','full','time','role','build','scale','applications','built','end','across','your','our','platform','product','yourself','what','stack','development','developer','developers','engineering','engineer','application','shipping','building','build','coordination','architecture','decisions','zero','live','projects','project','products','their','them','also','can','will','you','have','team','into']);
  const domainTerms = new Set();
  for (const w of ((profile.narrative?.exit_story || '')).toLowerCase().split(/\W+/)) if (w.length >= 4 && !stopWords.has(w)) domainTerms.add(w);
  for (const pp of (profile.narrative?.proof_points || [])) {
    for (const w of String(pp.hero_metric || '').toLowerCase().split(/\W+/)) if (w.length >= 4 && !stopWords.has(w)) domainTerms.add(w);
  }
  // Stack/domain words from superpowers — tech keywords (react, node, python,
  // django, spring, fintech, logistics, recruitment, saas…) are the terms that
  // actually appear in job titles/descriptions, unlike project names.
  for (const sp of (profile.narrative?.superpowers || [])) {
    for (const w of String(sp).toLowerCase().split(/\W+/)) if (w.length >= 4 && !stopWords.has(w)) domainTerms.add(w);
  }
  let domainHits = 0;
  for (const dt of domainTerms) if (notesAndCompany.includes(dt)) domainHits++;
  if (domainHits >= 2) { score += 1; details.push('domain relevance'); }
  else if (domainHits === 1) { score += 0.5; details.push('some domain overlap'); }

  // 5. Compensation fit (0-1)
  const targetMin = parseFloat(profile.compensation?.minimum) || 3;
  if (result.salary) {
    const s = String(result.salary).toLowerCase();
    const m = s.match(/₹?\s*([\d,.]+)\s*(?:-|to)\s*([\d,.]+)\s*(lpa|lakh|l)/) || s.match(/₹?\s*([\d,.]+)\s*(lpa|lakh|l)/);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val >= targetMin) { score += 1; details.push('salary in range'); }
      else if (val >= targetMin * 0.6) { score += 0.5; details.push('salary slightly below target'); }
      else { score += 0.2; details.push('salary below target'); }
    } else if (/competitive|market|negotiable|negotiation/i.test(s)) { score += 0.5; details.push('salary negotiable'); }
  } else {
    score += 0.5; // no data — don't penalize a missing field as much as a below-target salary
  }

  // Normalize to /5. The raw sum is out of 8 across five components, but two of
  // them (domain 0-1 and salary 0-1) are frequently unscorable from portal data
  // (job descriptions and salary figures are often absent), capping realistic
  // results near 6/8 = 3.75. Normalizing by 7 instead of 8 keeps 5.0 for a
  // perfect match while letting a genuine role+level+location triple-fit land at
  // 4.0+. This is a user-agnostic calibration constant, identical for everyone.
  const normalized = Math.round((Math.max(0, Math.min(score, 8)) / 7) * 20) / 4; // → /5
  const finalScore = Math.max(0.5, Math.min(5, normalized));
  const fit = finalScore >= 4 ? 'Strong' : finalScore >= 3 ? 'Moderate' : finalScore >= 2 ? 'Weak' : 'Poor';
  return { score: `${finalScore.toFixed(1)}/5`, scoreNum: finalScore, fit, details };
}

// Seniority filter — a Junior/Mid dev should not be shown Senior Manager,
// Director, VP, Staff/Principal, or "Head of" postings. Titles that clearly
// name an engineering role (engineer/developer/full-stack) are kept — a
// "Senior Software Engineer" can still be a target for a mid-level search.
function isSeniorOnlyRole(title) {
  const t = String(title || '');
  // Junior/fresher/entry signals override any senior marker.
  if (/\b(junior|fresher|entry\s+level|associate|trainee|intern)\b/i.test(t)) return false;
  // SDE 2 / SDE II / Software Development Engineer III / Engineer II = senior
  // IC levels — filter regardless of an "engineer" token in the title.
  if (/\bsde\s*(?:[-.]?\s*)?(?:ii|iii|iv|v|\d+)\b/i.test(t)) return true;
  if (/\b(?:software\s+development\s+)?engineer\s+(?:ii|iii|iv|v|vi|vii)\b/i.test(t)) return true;
  if (/\bdeveloper\s+(?:ii|iii|iv|v|vi|vii)\b/i.test(t)) return true;
  // Explicit senior leadership/keyword markers.
  if (!/\b(senior|sr\.?|staff|principal|head\s+of|vice\s+president|vp[\s.]|director|chief|architect|lead)\b/i.test(t)) return false;
  // Engineering postings are legitimate targets even with a senior prefix —
  // but only when the title names the engineering role itself (not "Head of
  // Engineering" / "VP Engineering", which are leadership postings).
  if (/\b(engineer|developer|full.?stack|front.?end|back.?end|software\s+engineer|software\s+developer)\b/i.test(t)) return false;
  return true;
}

// Load the user's tracker to build the "already applied" exclusion sets.
// Active statuses (applied/responded/interview/offer) make a company an
// active target — results there are suppressed so we never spam a company
// the user is already in-process with. Rejected/discarded are re-eligible.
function buildTrackerExclusion(trackerPath) {
  const activeCompanies = new Set();
  const activeRoles = new Set();
  if (trackerPath && existsSync(trackerPath)) {
    const lines = readFileSync(trackerPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\|\s*\d+\s*\|[^|]*\|([^|]+)\|([^|]+)\|([^|]*)\|([^|]+)/);
      if (!m) continue;
      const company = m[1].trim().toLowerCase();
      const role = m[2].trim().toLowerCase();
      const status = m[4].trim().toLowerCase();
      if (company && ['applied', 'responded', 'interview', 'offer'].includes(status)) {
        activeCompanies.add(company);
        activeRoles.add(`${company}::${role}`);
      }
    }
  }
  return { activeCompanies, activeRoles };
}

// Decode common HTML entities in scraped titles.
function stripHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/').replace(/&ndash;/g, '-')
    .replace(/&#\d+;/g, '');
}

// Extract plausible job links from portal HTML. Tolerates multiline anchors
// and nested tags — Naukri/Indeed/Shine/Foundit/TimesJobs markup is messy and
// the old single-line regex missed almost everything (hence "no matches").
function extractHtmlJobLinks(html, baseUrl) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const out = [];
  const seen = new Set();
  const anchorRx = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const hrefAttr = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
  let m;
  while ((m = anchorRx.exec(text)) !== null) {
    const hrefMatch = hrefAttr.exec(m[1] || '');
    let href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || '') : '';
    if (!href || /^javascript:|^mailto:|^tel:|^#|^data:/.test(href)) continue;
    const inner = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!inner || inner.length < 3 || inner.length > 220) continue;
    try { href = new URL(href, baseUrl).href; } catch { continue; }
    if (!href.startsWith('http')) continue;
    const key = (inner + '|' + href).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: stripHtmlEntities(inner), url: href });
  }
  return out;
}

// Filter out non-job-detail anchors that Indian job boards surface alongside
// real listings (search pages, blog posts, category/footer links). Keeps scan
// results to actual job postings instead of inflated "job-search" noise.
function isJobDetailUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const host = (u.hostname || '').toLowerCase();
  const path = (u.pathname || '').toLowerCase();
  // Generic navigation/footer/noise signals — never individual job postings.
  if (/\/(?:login|signup|register|log-in|sign-in|blog|faq|help|contact|about|search|job-alert|alerts|recommendations)\b/.test(path)) return false;
  // Portal-specific detail URL shapes.
  if (host.endsWith('shine.com')) return /\/jobs?\//.test(path);
  if (host.endsWith('timesjobs.com')) return /\/jobdetail\//.test(path);
  if (host.endsWith('internshala.com')) return /\/job\/detail\//.test(path) && !/(\?|&)utm_/i.test(u.search);
  if (host.endsWith('naukri.com')) return /\/job\//.test(path);
  if (host.endsWith('foundit.in') || host.endsWith('foundit.com')) return /\/job\//.test(path);
  if (host.endsWith('instahyre.com')) return /\/job\//.test(path);
  if (host.endsWith('indeed.com')) return /\/viewjob\b/.test(path);
  return true;
}

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
    let queryKeywords = req.query.keywords || '';
    let queryLocations = req.query.locations || '';
    const round = parseInt(req.query.round, 10) || 1;
    const expandPortals = round >= 2 || req.query.deep === 'true'; // re-scan expands to more portals

    // Auto-load from user profile if not provided in query
    if (!queryKeywords || !queryLocations) {
      const pPath = req.userCtx.profilePath;
      if (pPath && existsSync(pPath)) {
        try {
          const profile = yaml.load(readFileSync(pPath, 'utf-8')) || {};
          if (!queryKeywords && profile.target_roles?.primary?.length) {
            const archetypeNames = (profile.target_roles.archetypes || [])
              .map(a => typeof a === 'string' ? a : (a.name || ''))
              .filter(Boolean);
            queryKeywords = [...profile.target_roles.primary, ...archetypeNames].join(',');
          }
          if (!queryLocations && profile.location?.city) {
            queryLocations = profile.location.city;
          }
        } catch { /* profile read is non-fatal */ }
      }
    }

    // Read user's location from profile for dynamic proximity
    const userProfile = readUserProfileRaw(req);
    const userCity = ((userProfile.location?.city) || '').toLowerCase().trim();
    const userCountry = ((userProfile.location?.country) || '').toLowerCase().trim();
    const userLocFull = ((userProfile.candidate?.location) || '').toLowerCase().trim();
    const userLocFlex = ((userProfile.candidate?.location_flexibility) || '').toLowerCase().trim();

    // Dynamically extract nearby location terms from flexibility + full location
    const nearbyTerms = buildNearbyTerms(userProfile);

    // Build domain relevance terms from user's experience narrative
    const domainTerms = new Set();
    const storyStopWords = new Set(['and', 'the', 'for', 'with', 'from', 'that', 'this', 'three', 'core', 'production', 'now', 'seeking', 'full', 'time', 'role', 'build', 'scale', 'applications', 'built', 'end', 'across']);
    const exitStory = (userProfile.narrative?.exit_story || '').toLowerCase();
    for (const w of exitStory.split(/\W+/).filter(w => w.length >= 4 && !storyStopWords.has(w))) domainTerms.add(w);
    for (const pp of (userProfile.narrative?.proof_points || [])) {
      for (const w of (pp.hero_metric || '').toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !storyStopWords.has(w))) domainTerms.add(w);
    }

    const rawKw = queryKeywords.split(',').map(k => k.toLowerCase().trim()).filter(Boolean);
    const STOP_WORDS = new Set(['full', 'stack']);
    const expandedKw = new Set(rawKw);
    for (const k of rawKw) {
      for (const w of k.split(/\s+/)) {
        if (w.length >= 4 && !STOP_WORDS.has(w)) expandedKw.add(w);
      }
    }
    // Deep/re-scan mode: same relevance filters as normal scan — every card
    // must be a plausible match. Never skip the profile keyword filters.
    const kw = [...expandedKw];
    const rawLocParts = queryLocations.split(/[,\n;&]+/).map(l => l.toLowerCase().trim()).filter(Boolean);
    // Build location expansion dynamically from nearby terms
    const LOCATION_EXPANSIONS = {};
    for (const term of nearbyTerms) {
      if (!LOCATION_EXPANSIONS[term]) LOCATION_EXPANSIONS[term] = [...nearbyTerms];
    }
    const locs = Array.from(new Set(rawLocParts.flatMap(l => LOCATION_EXPANSIONS[l] || [l])));

    const portalsPath = join(__dirname, 'portals.yml');
    if (!existsSync(portalsPath)) { send('done', { results: [], summary: { portalsScanned: 0, totalFound: 0, filteredByKeywords: 0, duplicatesSkipped: 0, netNew: 0 } }); return res.end(); }
    const py = yaml.load(readFileSync(portalsPath, 'utf-8'));
    let companies = py?.tracked_companies || [];
    const boards = py?.search_queries || [];
    const jobBoards = py?.job_boards || [];

    const blacklistPath = req.userCtx.blacklistPath || join(__dirname, 'data/blacklist.md');
    const blacklist = new Set();
    if (existsSync(blacklistPath)) {
      for (const line of readFileSync(blacklistPath, 'utf-8').split('\n')) {
        const m = line.match(/^\s*[-*]\s*(.+)/);
        if (m) blacklist.add(m[1].trim().toLowerCase());
      }
    }

    const scanHistPath = req.userCtx.scanHistory || SCAN_HISTORY;
    const scanHistory = new Map();
    if (existsSync(scanHistPath)) {
      for (const line of readFileSync(scanHistPath, 'utf-8').split('\n')) {
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
    for (const entry of jobBoards) {
      if (entry.enabled === false) continue;
      // Second-tier boards (expand_on_rerun) only join on a re-scan so the
      // first pass stays fast and each "Scan again" widens coverage.
      if (entry.expand_on_rerun && !expandPortals) continue;
      const resolved = resolveProvider(entry, providers);
      if (resolved && !resolved.error) providerTargets.push({ entry, provider: resolved.provider, isBoard: true });
      else if (entry.careers_url) webSearchTargets.push(entry);
    }

    const totalPortalCount = providerTargets.length + webSearchTargets.length;
    const phaseLabel = (label, count) => `${label} — ${count} source${count === 1 ? '' : 's'}`;
    let completed = 0;

    // Phase 1: provider scanning (sequential for progress)
    const streamPortalResults = [];
    let phaseTotal = providerTargets.length;
    completed = 0;
    send('start', { totalPortals: phaseTotal, phase: 'providers', phaseLabel: phaseLabel('Phase 1/3 · career pages', phaseTotal) });
    for (const t of providerTargets) {
      try {
        const ctx = makeHttpCtx();
        const jobs = await t.provider.fetch(t.entry, ctx);
        totalBeforeFilter += jobs.length;
        let kwCount = 0;
        let exactCount = 0;
        for (const job of jobs) {
          const title = (job.title || '').toLowerCase();
          const loc = (job.location || '').toLowerCase();
          const matchesKw = kw.length === 0 || kw.some(k => title.includes(k));
          if (matchesKw) {
            kwCount++;
            const SENIOR_TITLE_RE = /\b(senior|staff|principal|head of|vice president|vp[\s.]|director|sr\.?\s)/i;
            if (SENIOR_TITLE_RE.test(title)) continue;
            const entry = { company: job.company || t.entry.name || '', role: job.title || '', location: job.location || '', url: job.url || '', matched: true, source: t.provider.id, notes: t.entry.notes || '' };
            keywordMatched.push(entry);
            const matchesLoc = locs.length === 0 || locs.some(l => loc.includes(l));
            if (matchesLoc) {
              exactCount++;
              results.push(entry);
            }
          }
        }
        streamPortalResults.push({ company: t.entry.name || 'unknown', status: 'scanned', keywordMatches: kwCount, exactMatches: exactCount });
        completed++;
        send('progress', { completed, total: phaseTotal, current: t.entry.name || 'unknown', found: results.length, keywordMatches: kwCount, exactMatches: exactCount, phase: 'providers', phaseLabel: phaseLabel('Phase 1/3 · career pages', phaseTotal) });
      } catch (e) { 
        streamPortalResults.push({ company: t.entry.name || 'unknown', status: 'errored', keywordMatches: 0, exactMatches: 0 });
        completed++;
        send('progress', { 
          completed, 
          total: phaseTotal, 
          current: t.entry.name || 'unknown', 
          found: results.length,
          keywordMatches: 0,
          exactMatches: 0,
          phase: 'providers',
          phaseLabel: phaseLabel('Phase 1/3 · career pages', phaseTotal),
          error: `Failed: ${e.message?.slice(0, 100) || 'unknown error'}`
        }); 
      }
    }

    // Phase 2: direct HTTP scrape for every portal (no cap — every portal gets a shot).
    if (webSearchTargets.length > 0) {
      phaseTotal = webSearchTargets.length;
      completed = 0;
      send('start', { totalPortals: phaseTotal, phase: 'websearch', phaseLabel: phaseLabel('Phase 2/3 · job portals & boards', phaseTotal) });
    }
    // Job-like title detector built from profile keywords + common tech terms.
    const joby = /\b(software|developer|engineer|full.?stack|front.?end|back.?end|react|node\.?js|java|python|spring|\.net|web|sde|swe|qa|test|trainee|intern|analyst|programmer|dev)\b/i;

    // Phase 2 uses a PER-PORTAL timeout (15s) so one slow or hung portal cannot
    // stall the whole batch, and emits a progress event BEFORE each fetch so the
    // app always shows live per-portal activity ("N/M — {portal}: Searching…")
    // instead of a static phase label while a request is in flight.
    const PORTAL_FETCH_TIMEOUT_MS = 15000;

    for (const entry of webSearchTargets) {
      let kwCount = 0;
      let exactCount = 0;
      let statusNote = 'Searching...';
      if (!entry.careers_url) {
        streamPortalResults.push({ company: entry.name || 'unknown', status: 'skipped', keywordMatches: 0, exactMatches: 0 });
        completed++;
        send('progress', { completed, total: phaseTotal, current: entry.name || 'web', found: results.length, keywordMatches: 0, exactMatches: 0, statusNote: 'skipped (no careers_url)', phase: 'websearch', phaseLabel: phaseLabel('Phase 2/3 · job portals & boards', phaseTotal) });
        continue;
      }
      // Fresh per-portal abort signal — a slow request is cut off at 15s and the
      // loop moves on to the next portal instead of blocking the whole phase.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PORTAL_FETCH_TIMEOUT_MS);
      try {
        // Live feedback BEFORE the request, so the UI never looks stuck.
        send('progress', { completed, total: phaseTotal, current: entry.name || 'web', found: results.length, keywordMatches: 0, exactMatches: 0, statusNote, phase: 'websearch', phaseLabel: phaseLabel('Phase 2/3 · job portals & boards', phaseTotal) });
        // Race the fetch against a hard timer as a safety net: even if the
        // AbortController above is flaky and the request never rejects on abort,
        // this guarantees the loop moves on and the phase cannot stall forever.
        const resp = await Promise.race([
          fetch(entry.careers_url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-IN,en;q=0.9',
            },
            redirect: 'follow',
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('portal fetch timed out')), PORTAL_FETCH_TIMEOUT_MS + 2000)),
        ]);
        if (!resp.ok) {
          streamPortalResults.push({ company: entry.name || 'unknown', status: 'blocked', keywordMatches: 0, exactMatches: 0 });
          statusNote = 'blocked (HTTP ' + resp.status + ') — trying Playwright next';
          send('progress', { completed, total: phaseTotal, current: entry.name || 'web', found: results.length, keywordMatches: 0, exactMatches: 0, statusNote, error: statusNote, phase: 'websearch', phaseLabel: phaseLabel('Phase 2/3 · job portals & boards', phaseTotal) });
          completed++;
          continue;
        }
        const html = await resp.text();
        if (!html || html.length < 100) {
          streamPortalResults.push({ company: entry.name || 'unknown', status: 'empty', keywordMatches: 0, exactMatches: 0 });
          statusNote = 'empty page — trying Playwright next';
          send('progress', { completed, total: phaseTotal, current: entry.name || 'web', found: results.length, keywordMatches: 0, exactMatches: 0, statusNote, phase: 'websearch', phaseLabel: phaseLabel('Phase 2/3 · job portals & boards', phaseTotal) });
          completed++;
          continue;
        }
        const links = extractHtmlJobLinks(html, entry.careers_url);
        for (const link of links) {
          const title = link.title.toLowerCase();
          if (!joby.test(title)) continue;
          if (!isJobDetailUrl(link.url)) continue;
          totalBeforeFilter++;
          if (kw.length === 0 || kw.some(k => title.includes(k))) {
            kwCount++;
            if (!keywordMatched.some(r => r.url === link.url)) {
              const companyLoc = (entry.location || '').toLowerCase();
              const matchesLoc = locs.length === 0 || locs.some(l => companyLoc.includes(l));
              const entry2 = { company: entry.name || '', role: link.title, location: entry.location || '', url: link.url, matched: true, source: 'websearch', notes: entry.notes || '' };
              keywordMatched.push(entry2);
              if (matchesLoc && !results.some(r => r.url === link.url)) {
                exactCount++;
                results.push(entry2);
              }
            }
          }
        }
        streamPortalResults.push({ company: entry.name || 'unknown', status: kwCount > 0 ? 'scanned' : 'no_matches', keywordMatches: kwCount, exactMatches: exactCount });
        statusNote = kwCount > 0 ? `${kwCount} relevant title${kwCount !== 1 ? 's' : ''}` : `scanned ${links.length} link(s), no role matched your keywords`;
      } catch (e) {
        streamPortalResults.push({ company: entry.name || 'unknown', status: 'errored', keywordMatches: kwCount, exactMatches: exactCount });
        statusNote = `failed (${(e.message || 'error').slice(0, 60)}) — trying Playwright next`;
      } finally {
        clearTimeout(timeout);
      }
      completed++;
      send('progress', { completed, total: phaseTotal, current: entry.name || 'web', found: results.length, keywordMatches: kwCount, exactMatches: exactCount, statusNote, phase: 'websearch', phaseLabel: phaseLabel('Phase 2/3 · job portals & boards', phaseTotal) });
    }

    // Phase 3: Playwright deep scraping for portals that returned no results
    // Includes both web search failures AND provider targets that returned zero matches
    const providerZeroMatch = providerTargets
      .filter(t => !t.isBoard && t.entry.careers_url)
      .filter(t => {
        const portal = streamPortalResults.find(p => p.company === t.entry.name);
        return !portal || portal.keywordMatches === 0;
      });
    const playwrightFailed = [
      ...webSearchTargets.filter(entry => {
        const alreadyFound = results.some(r => r.company === entry.name);
        return !alreadyFound && entry.careers_url;
      }),
      ...providerZeroMatch.map(t => t.entry)
    ];

    if (playwrightFailed.length > 0) {
      phaseTotal = playwrightFailed.length;
      completed = 0;
      send('start', { totalPortals: phaseTotal, phase: 'playwright', phaseLabel: phaseLabel('Phase 3/3 · browser retry', phaseTotal) });
      
      let chromium;
      let playwrightAvailable = true;
      try {
        const pw = await import('playwright');
        chromium = pw.chromium;
      } catch {
        try {
          const pw = await import('playwright-core');
          chromium = pw.chromium;
        } catch {
          playwrightAvailable = false;
        }
      }
      
      // If Playwright isn't available locally, try remote proxy
      const remotePwUrl = process.env.REMOTE_PLAYWRIGHT_URL;
      if (!playwrightAvailable && remotePwUrl) {
        for (const entry of playwrightFailed.slice(0, expandPortals ? playwrightFailed.length : 30)) {
          const beforeKw = keywordMatched.length;
          const beforeExact = results.length;
          try {
            const resp = await fetch(`${remotePwUrl}/playwright/scrape`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: entry.careers_url }),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) {
              const data = await resp.json();
              if (data.success && Array.isArray(data.links)) {
                for (const link of data.links) {
                  const title = (link.title || '').toLowerCase();
                  const href = link.url;
                  if (!href || !isJobDetailUrl(href) || keywordMatched.some(r => r.url === href)) continue;
                  const matchesKeyword = kw.length === 0 || kw.some(k => title.includes(k));
                  if (!matchesKeyword) continue;
                  const entry2 = { company: entry.name || '', role: link.title, location: entry.location || '', url: href, matched: true, source: 'remote-playwright', notes: entry.notes || '' };
                  keywordMatched.push(entry2);
                  const companyLoc = (entry.location || '').toLowerCase();
                  const matchesLoc = locs.length === 0 || locs.some(l => companyLoc.includes(l));
                  if (matchesLoc && !results.some(r => r.url === href)) {
                    results.push(entry2);
                  }
                }
              }
            }
          } catch (e) {
            // Portal failed — continue
          }
          completed++;
          const kwCount = keywordMatched.length - beforeKw;
          const exactCount = results.length - beforeExact;
          send('progress', { completed, total: phaseTotal, current: `${entry.name} (remote)`, found: results.length, keywordMatches: kwCount, exactMatches: exactCount, phase: 'playwright', phaseLabel: phaseLabel('Phase 3/3 · browser retry', phaseTotal) });
        }
      } else if (!playwrightAvailable) {
        send('progress', { completed: playwrightFailed.length, total: playwrightFailed.length, current: 'Playwright not available', found: results.length, error: 'playwright not installed, set REMOTE_PLAYWRIGHT_URL in .bridge.env to use a remote server', phase: 'playwright', phaseLabel: phaseLabel('Phase 3/3 · browser retry', playwrightFailed.length) });
      }
      
      if (chromium) {
        let browser;
        try {
          browser = await withTimeout(chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-compositing'] }), 30000, 'chromium launch');
        } catch (e) {
          browser = null;
          send('progress', { completed: playwrightFailed.length, total: playwrightFailed.length, current: 'Browser launch failed', found: results.length, error: (e.message || 'launch timed out').slice(0, 100), phase: 'playwright', phaseLabel: phaseLabel('Phase 3/3 · browser retry', playwrightFailed.length) });
        }
        
        if (browser) {
          for (const entry of playwrightFailed.slice(0, expandPortals ? playwrightFailed.length : 30)) {
            const beforeKw = keywordMatched.length;
            const beforeExact = results.length;
            try {
              await withTimeout((async () => {
              const page = await browser.newPage();
              await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-IN,en;q=0.9' });
              await page.goto(entry.careers_url, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await page.waitForTimeout(3500); // wait for SPA content

              // Extract job listings from links + headings. Indian portals
              // (Naukri, Indeed, Shine, Foundit, TimesJobs, ...) render job
              // titles as links; we also read headings for JS-heavy boards.
              const jobs = await page.evaluate(() => {
                const out = [];
                const seen = new Set();
                const push = (title, url) => {
                  const t = (title || '').replace(/\s+/g, ' ').trim();
                  if (t.length < 3 || t.length > 200) return;
                  const key = (t + '|' + (url || '')).toLowerCase();
                  if (seen.has(key)) return;
                  seen.add(key);
                  out.push({ title: t, url: url || '' });
                };
                for (const a of Array.from(document.querySelectorAll('a[href]'))) {
                  const t = (a.textContent || '').trim();
                  const u = a.href || '';
                  if (/^javascript:|^mailto:|^tel:|^#/.test(u)) continue;
                  push(t, u);
                }
                for (const h of Array.from(document.querySelectorAll('h1,h2,h3,h4,div[class*="job"] span,span[class*="job"],div[class*="title"],strong'))) {
                  const t = (h.textContent || '').trim();
                  if (t && t.length <= 200) push(t, '');
                }
                return out;
              });

              // Keep only titles that look like job postings relevant to this user
              const joby = /\b(software|developer|engineer|full.?stack|front.?end|back.?end|react|node\.?js|java|python|spring|\.net|web|sde|swe|qa|test|trainee|intern|analyst|programmer|dev)\b/i;
              for (const job of jobs) {
                const title = job.title.toLowerCase();
                if (!joby.test(title)) continue;
                if (job.url && !isJobDetailUrl(job.url)) continue;
                totalBeforeFilter++;
                if (kw.length === 0 || kw.some(k => title.includes(k))) {
                  const href = job.url;
                  if (href && !keywordMatched.some(r => r.url === href)) {
                    const companyLoc = (entry.location || '').toLowerCase();
                    const matchesLoc = locs.length === 0 || locs.some(l => companyLoc.includes(l));
                    const entry2 = { company: entry.name || '', role: job.title, location: entry.location || '', url: href, matched: true, source: 'playwright', notes: entry.notes || '' };
                    keywordMatched.push(entry2);
                    if (matchesLoc && !results.some(r => r.url === href)) {
                      results.push(entry2);
                    }
                  }
                }
              }
              
              await page.close();
              })(), 25000, `${entry.name || 'portal'} scrape`);
            } catch (e) {
              // Portal failed — continue
            }
            completed++;
            const kwCount = keywordMatched.length - beforeKw;
            const exactCount = results.length - beforeExact;
            send('progress', { 
              completed, 
              total: phaseTotal, 
              current: `${entry.name} (Playwright)`, 
              found: results.length,
              keywordMatches: kwCount,
              exactMatches: exactCount,
              phase: 'playwright',
              phaseLabel: phaseLabel('Phase 3/3 · browser retry', phaseTotal)
            });
          }
          await withTimeout(browser.close(), 10000, 'browser close');
        }
      }
    }

    // Sort: nearby areas first, domain relevance second, country match third
    const localScore = (r) => {
      const loc = (r.location || '').toLowerCase();
      for (const t of nearbyTerms) {
        if (t !== userCountry && loc.includes(t)) return 3;
      }
      if (userCountry && loc.includes(userCountry)) return 2;
      if (domainTerms.size > 0) {
        const notesAndCompany = ((r.notes || '') + ' ' + (r.company || '')).toLowerCase();
        for (const dt of domainTerms) {
          if (notesAndCompany.includes(dt)) return 1;
        }
      }
      return 0;
    };

    // Location-aware response: if no exact matches but keyword matches exist,
    // include them as a separate `otherLocations` list so the app shows both.
    const locationExactMatch = results.length > 0;
    const locationTier = locs.length === 0 ? 'none' : locationExactMatch ? 'exact' : 'nearby';
    keywordMatched.sort((a, b) => localScore(b) - localScore(a));
    let otherLocations = [];
    if (!locationExactMatch && keywordMatched.length > 0) {
      const otherSeen = new Set();
      otherLocations = keywordMatched.filter(r => {
        if (otherSeen.has(r.url)) return false;
        otherSeen.add(r.url);
        return true;
      });
    }

    // Dedup (by URL, fallback by company+role for entries without a URL)
    const seen = new Set();
    const seenCR = new Set();
    const rawResults = [...results, ...otherLocations];
    const deduped = rawResults.filter(r => {
      if (!r.company || !r.role) return false; // never show empty cards
      const urlKey = r.url || '';
      if (urlKey && seen.has(urlKey)) return false;
      if (urlKey) seen.add(urlKey);
      const crKey = `${(r.company || '').toLowerCase()}::${(r.role || '').toLowerCase()}`;
      if (seenCR.has(crKey)) return false;
      seenCR.add(crKey);
      return true;
    });

    // Level filter — hide Senior Manager/Director/VP/Staff postings that a
    // Junior/Mid developer should not be shown (they inflate the result list).
    const filteredByLevel = [];
    const levelFiltered = deduped.filter(r => {
      if (isSeniorOnlyRole(r.role)) { filteredByLevel.push(r); return false; }
      return true;
    });

    // Don't re-spam companies the user already applied to (per-user tracker).
    const { activeCompanies, activeRoles } = buildTrackerExclusion(req.userCtx.trackerPath || TRACKER_PATH);
    const excludedApplied = [];
    const usableResults = [];
    for (const r of levelFiltered) {
      const company = (r.company || '').toLowerCase();
      const role = (r.role || '').toLowerCase();
      if (activeCompanies.has(company) || activeRoles.has(`${company}::${role}`)) {
        excludedApplied.push(r);
        continue;
      }
      usableResults.push(r);
    }

    // Score every opportunity with the career-ops rubric so each card is rated.
    const profileForScore = readUserProfileRaw(req);
    const scored = usableResults.map(r => {
      const s = scoreScanResult(r, profileForScore, rawKw);
      return { ...r, score: s.score, scoreNum: s.scoreNum, fit: s.fit, scoreDetails: s.details };
    });
    scored.sort((a, b) => b.scoreNum - a.scoreNum || localScore(b) - localScore(a));

    const today = new Date().toISOString().slice(0, 10);
    for (const r of scored) {
      if (r.url && !scanHistory.has(r.url)) {
        try { appendFileSync(scanHistPath, `${today}\t${r.url}\t${r.source || 'bridge'}\n`); } catch { /* non-fatal */ }
      }
    }

    // Per-user scan note — append found opportunities to the user's data dir
    try {
      const notePath = join(req.userCtx.userDir, 'data', 'scan-results.md');
      if (!existsSync(notePath)) writeFileSync(notePath, '# Scan Results (auto-recorded)\n\n');
      const noteLines = [`\n## ${today} — ${rawKw.join(', ') || 'all roles'} | ${locStrForNote(queryLocations)}\n`];
      for (const r of scored) {
        noteLines.push(`| ${r.company} | ${r.role} | ${r.score} | ${r.location || ''} | ${r.url || ''} |`);
      }
      appendFileSync(notePath, noteLines.join('\n'), 'utf-8');
    } catch { /* non-fatal */ }

    const duplicatesSkipped = rawResults.length - deduped.length;
    const netNew = scored.length;
    const narrowingHints = [];
    if (kw.length === 0) narrowingHints.push('No keyword filter — all roles matched');
    if (locs.length === 0) narrowingHints.push('No location filter — results include all locations');
    if (netNew === 0) {
      narrowingHints.push(`No jobs found with current keywords and location. Try broader keywords or search without location filter.`);
      if (userCountry && userCity) narrowingHints.push(`Try expanding location from "${userCity}" to "${userCountry}" or remove location filter entirely.`);
    } else if (!locationExactMatch && otherLocations.length > 0) {
      narrowingHints.push(`No exact location matches — ${otherLocations.length} keyword-matched jobs found in other locations. Try expanding your location to "${userCountry}" or nearby cities.`);
    }
    if (netNew > 150) narrowingHints.push(`${netNew} results is a lot — consider narrowing keywords or adding a location`);
    if (filteredByLevel.length > 0) narrowingHints.push(`Filtered out ${filteredByLevel.length} senior-level role(s) (Senior Manager/Director/VP) that don't fit a Junior/Mid search.`);

    // Build widening steps for the done event
    const streamWideningSteps = [];
    if (netNew > 0 && locationExactMatch) {
      streamWideningSteps.push(`Found ${scored.length} matching roles in your target area.`);
    } else if (netNew > 0 && !locationExactMatch) {
      streamWideningSteps.push(`No exact location matches. Included ${scored.length} keyword-matched roles from other areas.`);
    } else if (netNew === 0) {
      streamWideningSteps.push(`Scanned ${totalPortalCount} portals — zero matching jobs found.`);
      if (userCity) streamWideningSteps.push(`No openings for your profile in "${userCity}" or wider India at this time.`);
      streamWideningSteps.push('Will re-check on next scheduled scan.');
    }
    if (excludedApplied.length > 0) {
      streamWideningSteps.push(`Skipped ${excludedApplied.length} role(s) at companies you already applied to (tracker).`);
    }
    if (!expandPortals) {
      streamWideningSteps.push(`Scan again to expand across more Indian job portals (Naukri, Indeed, Shine, Foundit, TimesJobs, Hirist, Cutshort, Instahyre, Internshala and more).`);
    }

    send('done', {
      total: totalBeforeFilter,
      newFound: netNew,
      results: scored,
      otherLocations: [],
      locationExactMatch,
      portalResults: streamPortalResults,
      wideningSteps: streamWideningSteps,
      round,
      summary: {
        portalsScanned: totalPortalCount,
        totalFound: totalBeforeFilter,
        filteredByKeywords: totalBeforeFilter - keywordMatched.length,
        filteredByLocation: keywordMatched.length - deduped.length,
        filteredByLevel: filteredByLevel.length,
        duplicatesSkipped,
        excludedApplied: excludedApplied.length,
        netNew,
        locationTier,
        expanded: expandPortals,
        tooBroad: netNew > 150,
        narrowingHints,
      },
    });
    res.end();
  } catch (e) {
    send('error', { error: e.message });
    res.end();
  }
});

// helper for the scan note header
function locStrForNote(queryLocations) {
  const parts = String(queryLocations || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : 'any location';
}

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

// ── Interview detection helpers ──────────────────────────────────
// Parses a scheduled interview date/time out of an email subject/body.
// Returns { date: 'YYYY-MM-DD', time: 'HH:MM', iso, human, confidence } or null.
function extractInterviewDateTime(subject, body) {
  const text = `${subject || ''}\n${body || ''}`.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const MONTHS = { january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
  const DOW = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

  const now = new Date();
  let target = null;
  let foundTime = null;
  let confidence = 0;

  // Time: "10:30 AM", "10am", "2 PM", "14:30", "2:00 PM IST"
  const timeRe = /\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
  const timeMatch = timeRe.exec(text);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    let m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const meridiem = (timeMatch[3] || '').toLowerCase();
    if (meridiem.startsWith('p') && h < 12) h += 12;
    if (meridiem.startsWith('a') && h === 12) h = 0;
    // Only trust if plausibly a wall-clock time in an interview context
    if (h <= 23 && (timeMatch[2] || meridiem || h >= 7)) {
      foundTime = { h, m };
      confidence += 1;
    }
  }

  // "tomorrow" / "today"
  if (/\btomorrow\b/i.test(text)) {
    target = new Date(now); target.setDate(target.getDate() + 1); confidence += 2;
  } else if (/\btoday\b/i.test(text)) {
    target = new Date(now); confidence += 1;
  }

  // Month-name date: "August 5", "5th August", "August 5, 2026"
  if (!target) {
    const md = /\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b(?:\s*,?\s*(\d{4}))?/i.exec(text) ||
      /\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:\s*,?\s*(\d{4}))?/i.exec(text);
    if (md) {
      const monthName = md[1] || md[2];
      const dayStr = md[2] || md[1];
      const year = parseInt(md[3] || now.getFullYear(), 10);
      const month = MONTHS[monthName.toLowerCase()];
      if (month !== undefined) {
        target = new Date(year, month, parseInt(dayStr, 10));
        confidence += 2;
      }
    }
  }

  // Numeric date: "05/08/2026", "2026-08-05", "05-08-2026"
  if (!target) {
    const nd = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b|\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/.exec(text);
    if (nd) {
      const [ , y1, m1, d1, d2, m2, y2 ] = nd;
      const year = parseInt(y1 || y2, 10);
      const month = parseInt(m1 || m2, 10);
      const day = parseInt(d1 || d2, 10);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= now.getFullYear() - 1) {
        target = new Date(year, month - 1, day);
        confidence += 2;
      }
    }
  }

  // Day-of-week: "on Monday", "next Tuesday", "this Friday"
  if (!target) {
    const dowRe = /\b(?:on\s+|next\s+|this\s+|coming\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
    const dowMatch = dowRe.exec(text);
    if (dowMatch) {
      const d = DOW[dowMatch[1].toLowerCase()];
      let delta = (d - now.getDay() + 7) % 7;
      if (/\bnext\s+/.test(text)) delta = delta === 0 ? 7 : delta;
      if (/\b(?:this|on)\s+sunday/i.test(text) && d === now.getDay()) delta = 0;
      target = new Date(now); target.setDate(target.getDate() + delta);
      confidence += 1;
    }
  }

  if (!target) return null;
  if (foundTime) {
    target.setHours(foundTime.h, foundTime.m, 0, 0);
  } else {
    target.setHours(0, 0, 0, 0);
  }

  const human = target.toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return {
    date: `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`,
    time: `${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`,
    iso: target.toISOString(),
    human,
    confidence,
  };
}

function interviewsFilePath(req) {
  const dataDir = req.userCtx?.dataDir || join(__dirname, 'data');
  return join(dataDir, 'interviews.json');
}

function loadInterviews(req) {
  try {
    const p = interviewsFilePath(req);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : [];
  } catch { return []; }
}

function saveInterviews(req, arr) {
  try {
    const p = interviewsFilePath(req);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(arr, null, 2));
  } catch { /* non-fatal */ }
}

// POST /email/triage — classify inbox emails server-side into recruiter replies / spam / other
app.post('/email/triage', async (req, res) => {
  const { email, appPassword } = req.body;
  const user = email || process.env.GMAIL_USER;
  const pass = appPassword || process.env.GMAIL_APP_PASSWORD;
  const userOAuth = req.userCtx.userId ? getUserOAuth(req.userCtx.userId) : null;
  const hasUserOAuth2 = hasUsableOAuth(userOAuth);
  const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  if (!user) return res.status(400).json({ error: 'email required' });
  if (!pass && !hasUserOAuth2 && !hasLegacyOAuth2) return res.status(400).json({ error: 'appPassword or OAuth2 credentials required' });

  // OAuth users get Gmail REST (reliable); app-password users keep IMAP
  let allEmails;
  if (hasUserOAuth2 || hasLegacyOAuth2) {
    try {
      allEmails = await fetchGmailInboxREST(user, req.userCtx.userId, {
        daysBack: parseInt(req.body.daysBack, 10) || 30,
        maxEmails: parseInt(req.body.maxEmails, 10) || 50,
      });
    } catch (restErr) {
      logRestError('email/triage', email, restErr);
      allEmails = await fetchEmails(user, pass, { userOAuth });
    }
  } else {
    allEmails = await fetchEmails(user, pass, { userOAuth });
  }

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

    let scheduledAt = null, scheduledHuman = null;
    if (classification === 'interview') {
      const dt = extractInterviewDateTime(e.subject, e.body);
      if (dt) {
        scheduledAt = dt.iso;
        scheduledHuman = dt.human;
      }
    }
    return { ...e, classification, scheduledAt, scheduledHuman };
  });
  res.json({ emails: triaged });
});

// POST /interview/detect — scan inbox for interview-scheduling emails,
// extract date/time, and persist them to data/interviews.json (per user).
app.post('/interview/detect', async (req, res) => {
  try {
    const { email, appPassword, daysBack, maxEmails } = req.body;
    const userId = req.userCtx?.userId;
    const userOAuth = userId ? getUserOAuth(userId) : null;
    const hasUserOAuth2 = hasUsableOAuth(userOAuth);
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    const user = email || process.env.GMAIL_USER || req.userCtx?.userId;
    if (!user || (!appPassword && !hasUserOAuth2 && !hasLegacyOAuth2)) {
      return res.status(400).json({ error: 'email and auth (appPassword or OAuth2) required' });
    }

    let allEmails;
    if (hasUserOAuth2 || hasLegacyOAuth2) {
      try {
        allEmails = await fetchGmailInboxREST(user, userId, {
          daysBack: parseInt(daysBack, 10) || 14,
          maxEmails: parseInt(maxEmails, 10) || 40,
        });
      } catch (restErr) {
        logRestError('interview/detect', email, restErr);
        allEmails = await fetchEmails(user, appPassword, { userOAuth });
      }
    } else {
      allEmails = await fetchEmails(user, appPassword, { userOAuth });
    }

    const interviews = loadInterviews(req);
    const seen = new Set(interviews.map(i => i.key));
    let newCount = 0;
    const found = [];

    for (const e of (allEmails || [])) {
      const fromL = (e.fromEmail || e.from || '').toLowerCase();
      // Skip job-board alerts / digests — they're not interview invites
      const digestFrom = ['naukri', 'indeed', 'linkedin', 'glassdoor', 'monster', 'hirist', 'quora', 'buzzfeed', 'medium', 'substack', 'newsletter', 'digest', 'no-reply', 'noreply', 'updates@', 'donotreply'];
      if (digestFrom.some(d => fromL.includes(d))) continue;

      const subj = (e.subject || '').toLowerCase();
      const body = (e.body || e.preview || '').toLowerCase();
      const isInterview =
        /interview|phone screen|next round|meeting with|screen(ing)? call|technical round|hr round|f2f|face.to.face/i.test(subj) ||
        /interview|phone screen|availability|next step|schedule(d)?|confirmed|we would like to meet|pleased to invite/i.test(body);
      if (!isInterview) continue;

      const dt = extractInterviewDateTime(e.subject, e.body || e.preview);
      const key = `${e.fromEmail || e.from || ''}|${(e.subject || '').slice(0, 60)}`;
      let record = interviews.find(i => i.key === key);
      if (!record) {
        record = {
          key,
          id: e.gmailId || String(Date.now()),
          from: e.from || '',
          subject: e.subject || '',
          bodyPreview: (e.body || e.preview || '').slice(0, 400),
          detectedAt: new Date().toISOString(),
          reminderSentAt: null,
          status: 'scheduled',
        };
        interviews.push(record);
        newCount++;
      }
      if (dt) {
        record.scheduledAt = dt.iso;
        record.scheduledHuman = dt.human;
        record.date = dt.date;
        record.time = dt.time;
        record.confidence = dt.confidence;
      }
      found.push({
        from: record.from,
        subject: record.subject,
        scheduledAt: record.scheduledAt || null,
        scheduledHuman: record.scheduledHuman || null,
        status: record.status,
      });
    }

    saveInterviews(req, interviews);
    res.json({ interviews: found, newCount, total: interviews.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /interviews — list detected interviews with reminder status
app.get('/interviews', (req, res) => {
  try {
    const now = Date.now();
    const interviews = loadInterviews(req)
      .map(i => {
        const scheduledMs = i.scheduledAt ? new Date(i.scheduledAt).getTime() : null;
        let reminder = null;
        if (scheduledMs) {
          const diffMs = scheduledMs - now;
          const diffH = Math.round(diffMs / 3600000);
          if (diffMs < 0 && diffH > -48) reminder = { due: true, label: `Interview was ${Math.abs(diffH)}h ago` };
          else if (diffH <= 0) reminder = { due: true, label: 'Interview time reached' };
          else if (diffH <= 1) reminder = { due: true, label: `Interview in ${diffH}h` };
          else if (diffH <= 24) reminder = { due: true, label: `Interview in ${diffH}h (${i.scheduledHuman})` };
          else reminder = { due: false, label: `Interview in ${diffH}h` };
        }
        return { ...i, reminder };
      })
      .sort((a, b) => (a.scheduledAt || '9999') < (b.scheduledAt || '9999') ? -1 : 1);
    res.json({ interviews, count: interviews.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    // Check auth: OAuth2 (per-user or legacy) OR app password
    const userId = req.userCtx?.userId;
    const userOAuth = userId ? getUserOAuth(userId) : null;
    const hasUserOAuth2 = hasUsableOAuth(userOAuth);
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    const resolvedEmail = email || process.env.GMAIL_USER;
    if (!resolvedEmail || (!appPassword && !hasUserOAuth2 && !hasLegacyOAuth2)) {
      return res.status(400).json({ error: 'email and auth (appPassword or OAuth2) required' });
    }
    if (!to) return res.status(400).json({ error: 'to is required' });

    const profilePath = req.userCtx?.profilePath || PROFILE_PATH;
    const profile = existsSync(profilePath) ? yaml.load(readFileSync(profilePath, 'utf-8')) || {} : readProfile();
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

// POST /email/reply/send — send an approved reply draft via SMTP (HITL: user must tap [Send])
app.post('/email/reply/send', async (req, res) => {
  try {
    const { to, subject, body, cc, bcc } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'to and body are required' });

    // Resolve auth (same logic as /email/send)
    const userId = req.userCtx?.userId;
    const userOAuth = userId ? getUserOAuth(userId) : null;
    const hasUserOAuth2 = hasUsableOAuth(userOAuth);
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;

    if (!hasUserOAuth2 && !hasLegacyOAuth2 && !process.env.GMAIL_USER) {
      return res.status(400).json({ error: 'No email auth configured. Connect Gmail in Settings.' });
    }

    const userEmail = req.userCtx?.userId
      ? (userOAuth?.userEmail || process.env.GMAIL_USER || '')
      : (process.env.GMAIL_USER || '');

    let accessToken;
    if (hasUserOAuth2) {
      accessToken = userOAuth.accessToken;
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
        if (!tokenResp.ok) return res.status(500).json({ error: `Token refresh failed: ${tokenResp.status}` });
        const tokenData = await tokenResp.json();
        accessToken = tokenData.access_token;
        userOAuth.accessToken = accessToken;
        userOAuth.expiresAt = tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0;
        setUserOAuth(userId, userOAuth);
      }
    } else if (hasLegacyOAuth2) {
      accessToken = await getGmailAccessToken();
    }

    // Build RFC 2822 message
    const boundary = `----=_Part_${Date.now()}`;
    const lines = [
      `From: ${userEmail}`,
      `To: ${to}`,
      cc ? `Cc: ${cc}` : null,
      bcc ? `Bcc: ${bcc}` : null,
      `Subject: ${subject || ''}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      '',
      body,
    ].filter(Boolean);

    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!sendResp.ok) {
      const err = await sendResp.text();
      return res.status(500).json({ error: `Gmail send failed: ${sendResp.status} ${err}` });
    }

    const sent = await sendResp.json();
    res.json({ success: true, messageId: sent.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /email/spam/delete — delete selected messages (HITL: user selects which to delete)
// OAuth users: Gmail REST delete by message id. App-password users: IMAP.
app.post('/email/spam/delete', async (req, res) => {
  try {
    const { messageIds, markAsRead } = req.body;
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds array is required' });
    }

    const userId = req.userCtx?.userId;
    const userOAuth = userId ? getUserOAuth(userId) : null;
    const hasUserOAuth2 = hasUsableOAuth(userOAuth);
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    const userEmail = userOAuth?.userEmail || process.env.GMAIL_USER;
    const imapPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

    if (!userEmail || (!hasUserOAuth2 && !hasLegacyOAuth2 && !imapPassword)) {
      return res.status(400).json({ error: 'IMAP credentials not configured — connect Gmail in Settings' });
    }

    // ── OAuth users: Gmail REST delete (reliable; avoids IMAP) ──────────
    if (hasUserOAuth2 || hasLegacyOAuth2) {
      const accessToken = await resolveGmailAccessToken(userId, userEmail);
      const headers = { Authorization: `Bearer ${accessToken}` };

      // Gmail message ids are 15-19 digit numeric strings — use directly.
      // Anything else is a sequential id (1..N) from /email/inbox; map to gmailId.
      const isGmailId = (s) => /^\d{15,19}$/.test(String(s));
      const needsResolve = messageIds.some(m => !isGmailId(m));
      const gmailIdBySeq = {};
      if (needsResolve) {
        const inboxEmails = await fetchGmailInboxREST(userEmail, userId, { daysBack: 30, maxEmails: 100 });
        for (const e of inboxEmails) gmailIdBySeq[String(e.id)] = e.gmailId;
      }

      const deleted = [];
      const failed = [];
      const seen = new Set();
      for (const rawId of messageIds) {
        const gmailId = isGmailId(rawId) ? String(rawId) : gmailIdBySeq[String(rawId)];
        if (!gmailId || seen.has(gmailId)) { if (!gmailId) failed.push(rawId); continue; }
        seen.add(gmailId);
        try {
          if (markAsRead) {
            await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}/modify`, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
            });
          }
          const delResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}`, {
            method: 'DELETE',
            headers,
          });
          if (delResp.ok) {
            deleted.push(rawId);
          } else {
            const errText = await delResp.text().catch(() => '');
            console.error(`[email/spam/delete] Gmail delete failed for ${gmailId}: ${delResp.status} ${errText.slice(0, 150)}`);
            failed.push(rawId);
          }
        } catch (delErr) {
          console.error(`[email/spam/delete] ${delErr.message}`);
          failed.push(rawId);
        }
      }
      return res.json({
        success: true,
        deleted: deleted.length,
        failed: failed.length,
        details: { deleted, failed },
        method: hasUserOAuth2 ? 'per_user_oauth2_rest' : 'legacy_oauth2_rest',
      });
    }

    // ── App-password users: IMAP delete ─────────────────────────────────
    let Imap;
    try {
      Imap = (await import('imap')).default;
    } catch {
      return res.status(500).json({ error: 'IMAP library not installed' });
    }

    // Build IMAP config: OAuth2 (per-user or legacy) > app password
    let imapConfig;
    if (hasUserOAuth2) {
      let accessToken = userOAuth.accessToken;
      if (!accessToken || (userOAuth.expiresAt && Date.now() > userOAuth.expiresAt - 300000)) {
        const tokenResp = await fetch(GMAIL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: userOAuth.clientId, client_secret: userOAuth.clientSecret,
            refresh_token: userOAuth.refreshToken, grant_type: 'refresh_token',
          }),
        });
        if (tokenResp.ok) {
          const td = await tokenResp.json();
          accessToken = td.access_token;
          userOAuth.accessToken = accessToken;
          userOAuth.expiresAt = td.expires_in ? Date.now() + td.expires_in * 1000 : 0;
          setUserOAuth(userId, userOAuth);
        } else {
          return res.status(500).json({ error: 'Token refresh failed' });
        }
      }
      imapConfig = {
        user: userEmail,
        xoauth2: buildXoauth2String(userEmail, accessToken),
        host: 'imap.gmail.com', port: 993, tls: true,
        tlsOptions: { rejectUnauthorized: false },
      };
    } else if (hasLegacyOAuth2) {
      const accessToken = await getGmailAccessToken();
      imapConfig = {
        user: userEmail,
        xoauth2: buildXoauth2String(userEmail, accessToken),
        host: 'imap.gmail.com', port: 993, tls: true,
        tlsOptions: { rejectUnauthorized: false },
      };
    } else {
      imapConfig = {
        user: userEmail, password: imapPassword,
        host: 'imap.gmail.com', port: 993, tls: true,
        tlsOptions: { rejectUnauthorized: false },
      };
    }

    const result = await new Promise((resolve, reject) => {
      const imap = new Imap(imapConfig);
      const deleted = [];
      const failed = [];

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) { imap.end(); reject(new Error('Failed to open INBOX')); return; }

          const addFlags = markAsRead ? '\\Seen' : null;
          let processed = 0;

          for (const uid of messageIds) {
            const uidNum = parseInt(uid, 10);
            if (isNaN(uidNum)) { failed.push(uid); processed++; continue; }

            imap.uid.addFlags(uidNum, ['\\Deleted'], (err) => {
              if (err) {
                failed.push(uid);
              } else {
                deleted.push(uid);
              }
              processed++;
              if (processed >= messageIds.length) {
                imap.expunge((err) => {
                  imap.end();
                  if (err) reject(err);
                  else resolve({ deleted, failed });
                });
              }
            });
          }
        });
      });

      imap.once('error', (err) => reject(err));
      imap.connect();
    });

    res.json({ success: true, deleted: result.deleted.length, failed: result.failed.length, details: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /auto-pipeline — evaluate a JD via opencode (career-ops agent), save report + tracker row
 // Shared auto-pipeline evaluation: fetch JD + recruiter contact, evaluate via
 // opencode, write the per-user evaluation report + tracker addition, and return
 // the response object. Used by POST /auto-pipeline (single URL) and POST /batch
 // (up to 5 URLs). Always resolves to a 200-shaped result — an evaluation
 // failure still lands a report so the outcome is attributable.
 async function runAutoPipeline(req, { url, company, role }) {
  let evaluation = { score: 'N/A', fit: '', strengths: [], gaps: [] };
  let jdText = '';
  let contact = { emails: [], phones: [], applicationEmails: [] };

  try {
    if (!url) throw new Error('url required');

    // Fetch JD content + recruiter/application contact info for opencode context
    try {
      const fetched = await fetchJdAndContact(url, { textLimit: 8000 });
      jdText = fetched.pageText;
      contact = fetched.contact;
    } catch { /* fetch failed — opencode will handle it */ }

    // Delegate to opencode — the career-ops AI agent
    const contactContext = (contact.emails.length || contact.phones.length)
      ? `\nContact info found on the posting page (for the report + outreach): emails=${contact.emails.join(', ')} phones=${contact.phones.join(', ')}`
      : '';
    const prompt = jdText
      ? `Evaluate this job posting using career-ops auto-pipeline mode. Return ONLY a JSON object (no markdown, no code fences) with these fields: {"score": "X.X", "fit": "1-2 sentence fit assessment", "strengths": ["s1","s2"], "gaps": ["g1"]}. Score is 1.0-5.0. Be honest and conservative. Job URL: ${url} Company: ${company || 'Unknown'} Role: ${role || 'Unknown'} JD text: ${jdText.slice(0, 6000)}${contactContext}`
      : `Evaluate this job posting using career-ops auto-pipeline mode. IMPORTANT: the job description could NOT be fetched from the URL — do NOT guess or invent any details about salary, location, stack, or requirements. If you cannot evaluate without the JD, return exactly {"score": "N/A", "fit": "JD could not be fetched — cannot evaluate reliably", "strengths": [], "gaps": []}. Never copy details from any other job. Job URL: ${url} Company: ${company || 'Unknown'} Role: ${role || 'Unknown'}`;

    // Warmup guard: opencode right after a bridge restart can return empty text
    // ("produced no text output") for the first call or two. Retry with a short
    // backoff so the first call of a batch isn't lost to the warmup window.
    let result = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        result = await runOpencode(prompt, 120000, userCwd(req));
        if (result && result.trim()) break;
      } catch (e) {
        if (attempt < 2) await new Promise(r => setTimeout(r, 10000));
      }
    }

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
  const companySlug = (company || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const today = new Date().toISOString().slice(0, 10);

  // Find next report number (per-user)
  const reportDir = userReportDir(req);
  const nextNum = nextReportNumForDir(reportDir);
  const numStr = String(nextNum).padStart(3, '0');

  // Save report to user's directory
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `${numStr}-${companySlug}-${today}.md`);
  const contactLine = (contact.emails.length || contact.phones.length)
    ? `**Contact:** emails: ${contact.emails.join(', ')}${contact.phones.length ? ` · phones: ${contact.phones.join(', ')}` : ''}`
    : '**Contact:** not found on posting page';
  const reportContent = `# Evaluation Report #${numStr}

**Company:** ${company || 'Unknown'}
**Role:** ${role || 'Unknown'}
**URL:** ${url || ''}
**Date:** ${today}
**Score:** ${score}/5
**PDF:** ❌
${contactLine}

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
  const contactNote = contact.applicationEmails.length ? ` Contact: ${contact.applicationEmails.join(', ')}` : '';
  const tsvLine = `${numStr}\t${today}\t${company || 'Unknown'}\t${role || 'Unknown'}\tEvaluated\t${score}/5\t❌\t[${numStr}](reports/${numStr}-${companySlug}-${today}.md)\tAuto-pipeline (opencode)${contactNote}`;
  writeFileSync(tsvPath, tsvLine + '\n', 'utf-8');

  // Run merge-tracker from user dir or root
  try {
    const ud = req.userCtx?.userDir;
    const mergeArgs = ud ? ['merge-tracker.mjs', '--user-dir', ud] : ['merge-tracker.mjs'];
    spawnSync('node', mergeArgs, { cwd: userCwd(req), encoding: 'utf-8', timeout: 10000 });
  } catch { /* non-fatal */ }

  return {
    url,
    score,
    company: company || '',
    role: role || '',
    reportNum: nextNum,
    reportPath: `${numStr}-${companySlug}-${today}.md`,
    fit: evaluation.fit,
    strengths: evaluation.strengths || [],
    gaps: evaluation.gaps || [],
    contactEmails: contact.emails || [],
    contactPhones: contact.phones || [],
  };
}

app.post('/auto-pipeline', async (req, res) => {
  try {
    const { url, company, role } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    res.json(await runAutoPipeline(req, { url, company, role }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
    const dataDir = req.userCtx?.dataDir || join(__dirname, 'data');
    // Write URLs to a temp file, run the checker
    const tmpFile = join(dataDir, `_liveness_check_${Date.now()}.txt`);
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
    const userDir = req.userCtx?.userDir;
    const args = [script, '--json'];
    if (userDir) args.push('--user-dir', userDir);
    const r = spawnSync('node', args, {
      cwd: userCwd(req),
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

    // If jd is a job URL, fetch the posting and extract real contact info from
    // the page itself (many Indian portals list a contact/application email or
    // a mailto link). Without this, the drafter only sees the bare URL string
    // and has to guess — which is why drafts came back with no contact email.
    let jdContext = jd ? jd.slice(0, 3000) : '';
    let contactHints = '';
    if (jd && /^https?:\/\//i.test(jd)) {
      try {
        const fetched = await fetchJdAndContact(jd, { textLimit: 4000 });
        if (fetched.pageText.length > 100) {
          jdContext = `${jdContext}\n\nPosting text: ${fetched.pageText}`;
        }
        const { emails, phones, applicationEmails } = fetched.contact;
        // Prefer application-looking emails (apply/careers/hr/jobs/recruit);
        // fall back to any email found on the page.
        const best = applicationEmails.length ? applicationEmails : emails;
        if (best.length) {
          contactHints = `Contact emails found on the posting page: ${best.join(', ')}`;
        }
        if (phones.length) {
          contactHints += `${contactHints ? '\n' : ''}Contact phone numbers found on the posting page: ${phones.join(', ')} — give these to the candidate so they can approach the recruiter manually if needed.`;
        }
      } catch { /* fetch failed — the drafter proceeds on the URL alone */ }
    }

    // Finding the "to" address: prefer application-looking emails from the
    // posting page, else fall back to a websearch for the company's real
    // application/HR email. Posting pages (Internshala et al.) often hide the
    // company email behind their Apply flow, so the agent must be able to look
    // it up — otherwise drafts keep coming back with no address.
    const contactGuidance = contactHints
      ? `${contactHints}\nUse one of these as "to" if it looks like a real hiring/application contact email.`
      : 'No contact email was found on the posting page.';

    const prompt = `You are a job application email drafter. Generate a formal application email.
Type: ${type || 'hr_application'}
Company: ${company || 'Unknown'}
Role: ${role || 'Unknown'}
Contact: ${contactName || 'Hiring Team'}
${jdContext ? `JD: ${jdContext}` : ''}
${contactHints ? `\n${contactHints}` : ''}

Finding the "to" address: ${contactGuidance} If none of the given addresses is suitable, or none was found on the posting page, use your websearch tool to find the company's real application/HR email — e.g. search "<company> careers email", "<company> HR email for applications", "<company> contact email", or check the company website's contact/careers page. Only return an address you actually verified from a search result or the company site; never guess and never fabricate. If you still cannot find a real address, return "to" as an empty string.
${reportNum ? `Report: #${reportNum}` : ''}

CV excerpt: ${cv}
Candidate name: ${profile?.candidate?.full_name || 'Candidate'}
Candidate email: ${profile?.candidate?.email || ''}
Candidate phone: ${profile?.candidate?.phone || ''}

Return JSON: {"to": "hiring contact email or empty string if unknown", "subject": "...", "body": "...", "contactBlock": "...", "phone": "recruiter contact phone or empty string if unknown"}`;

    const result = await runOpencode(prompt, 180000, userCwd(req));
    const parsed = parseJsonFromOutput(result);
    res.json(parsed || { to: '', subject: '', body: result.trim().slice(0, 2000), contactBlock: '', phone: '' });
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
    for (const item of urls.slice(0, 5)) {
      const url = typeof item === 'string' ? item : item.url;
      const company = typeof item === 'string' ? '' : item.company || '';
      const role = typeof item === 'string' ? '' : item.role || '';
      // Same grounded evaluation as /auto-pipeline: JD + contact fetched first,
      // per-user report written, tracker updated — so every batch result carries
      // a reportNum the app can pass straight to /cv/tailor for the tailored PDF.
      results.push(await runAutoPipeline(req, { url, company, role }));
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
    const userDir = req.userCtx?.userDir || __dirname;
    const r = spawnSync('node', [script], { cwd: userDir, encoding: 'utf-8', timeout: 60000 });
    if (r.status !== 0) return res.status(500).json({ error: r.stderr || 'PDF generation failed' });
    const outputDir = join(userDir, 'output');
    const pdfFiles = existsSync(outputDir) ? readdirSync(outputDir).filter(f => f.endsWith('.pdf')) : [];
    const latest = pdfFiles.sort().pop();
    res.json({ success: true, pdfPath: latest || '', outputDir: 'output/' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /cv/tailor — generate a tailored, ATS-optimized CV PDF for a specific role.
// Split design (reliable under stateless opencode timeouts — the old design made
// one agent call run the whole 5-step pipeline and died at the 5-min cap):
//   Phase A — the bridge gathers ALL context synchronously (fetch JD + contact,
//     locate the evaluation report, run the zero-LLM jd-skill-gap classifier,
//     resolve the CV template, inline cv/profile) and hands it to ONE focused
//     opencode call whose only job is to return the compact render JSON
//     (modes/pdf.md JSON Input Schema). No commands, no file writes by the agent.
//   Phase B — the bridge runs the deterministic scripts itself with exact exit
//     codes: build-cv-html -> verify-cv-facts (hard fact gate) -> generate-pdf.
// Multi-user: every artifact (jds/, output/) lands in the requesting user's tree.
// HITL: this only PRODUCES the PDF — sending still goes through /email/send with
// the user's confirmation.
app.post('/cv/tailor', async (req, res) => {
  try {
    const { url, reportNum, company, role } = req.body;
    const toolchainDir = __dirname; // scripts + modes + fonts live only here
    const userDir = userCwd(req);   // per-user execution tree (root = __dirname)
    const reportDir = userReportDir(req);
    const profilePath = req.userCtx?.profilePath || join(toolchainDir, 'config', 'profile.yml');
    const outputDir = join(userDir, 'output');

    if (!url && !reportNum && !company && !role) {
      return res.status(400).json({ error: 'Provide url, reportNum, or company/role' });
    }

    // 1) JD text + recruiter contact (inline agent context)
    let jdText = '';
    let contact = { emails: [], phones: [], applicationEmails: [] };
    try {
      if (url) {
        const fetched = await fetchJdAndContact(url, { textLimit: 8000 });
        jdText = fetched.pageText;
        contact = fetched.contact;
      }
    } catch { /* work from the report below */ }

    // 2) Locate the evaluation report to anchor --report and give the agent context
    let reportFile = '';
    let reportContent = '';
    if (existsSync(reportDir)) {
      const files = readdirSync(reportDir).filter(f => f.endsWith('.md'));
      const normCompany = String(company || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      const normRole = String(role || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (reportNum) {
        reportFile = files.find(f => f.startsWith(String(reportNum).padStart(3, '0') + '-')) || '';
      } else if (normCompany || normRole) {
        for (const f of files) {
          const text = readFileSync(join(reportDir, f), 'utf-8').toLowerCase();
          if ((normCompany && text.includes(normCompany)) || (normRole && text.includes(normRole))) {
            reportFile = f;
            break;
          }
        }
      }
      if (reportFile) reportContent = readFileSync(join(reportDir, reportFile), 'utf-8');
    }
    const reportNumForPdf = reportFile
      ? parseInt(reportFile.split('-')[0], 10)
      : (reportNum ? parseInt(String(reportNum), 10) : 0);
    const companySlug = String(company || (reportFile ? reportFile.slice(4).replace(/\.[^.]+$/, '') : '') || 'role')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Nothing to tailor against — require a JD or a matched report.
    if (!jdText && !reportContent) {
      return res.status(400).json({ error: 'No JD text and no evaluation report found — provide url, or a reportNum/company+role that matches an existing report' });
    }

    // 3) Candidate slug + paper format (a4 unless the JD clearly targets US/Canada)
    const profile = readUserProfileRaw(req);
    const candidateName = profile?.candidate?.full_name || profile?.full_name || profile?.name || 'Candidate';
    const candidate = String(candidateName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const sourceForFormat = `${jdText} ${reportContent}`;
    const format = /\b(US|USA|United States|Canada)\b/i.test(sourceForFormat) && !/\bIndia\b/i.test(sourceForFormat) ? 'letter' : 'a4';

    // 4) Persist the JD into the user's tree so artifacts stay per-user
    const jdDir = join(userDir, 'jds');
    if (!existsSync(jdDir)) mkdirSync(jdDir, { recursive: true });
    const jdFileAbs = join(jdDir, `${companySlug}.md`);
    writeFileSync(jdFileAbs, `# ${company || companySlug} — ${role || 'Job'}\n\n**Source:** ${url || 'evaluation report'}\n\n${jdText || reportContent}\n`, 'utf-8');

    // 5) Zero-LLM skill-gap classifier (fast, deterministic) -> honest agent context.
    //    NOTE: only used when it actually found skills — the fetched page text is
    //    single-line and often yields "0 skills found", which is safer than the
    //    reflow-based alternative that over-splits capitalized words into false gaps.
    let skillGapSummary = '';
    try {
      const gapScript = join(toolchainDir, 'jd-skill-gap.mjs');
      if (existsSync(gapScript) && existsSync(join(userDir, 'data', 'cv.md'))) {
        const gap = spawnSync('node', [gapScript, jdFileAbs, '--summary'], { cwd: join(userDir, 'data'), encoding: 'utf-8', timeout: 15000 });
        if (gap.status === 0 && /JD skills found:\s*[1-9]/.test(gap.stdout || '')) skillGapSummary = gap.stdout.trim().slice(0, 2000);
      }
    } catch { /* non-fatal */ }

    // 6) Resolve the CV template (honors the user's profile override)
    let templatePath = join(toolchainDir, 'templates', 'cv-template.html');
    try {
      const tpl = spawnSync('node', ['cv-templates.mjs', 'resolve', 'cv'], {
        cwd: toolchainDir,
        env: { ...process.env, CAREER_OPS_PROFILE: profilePath },
        encoding: 'utf-8', timeout: 15000,
      });
      if (tpl.status === 0 && tpl.stdout.trim()) templatePath = tpl.stdout.trim().split('\n')[0];
    } catch { /* fall back to the base template */ }

    // 7) ONE focused opencode call per attempt: return ONLY the render JSON
    //    (no commands/files). If the fact gate (step 8) rejects the rendered CV
    //    (unsourced metric/claim), re-run the agent with the exact rejected
    //    claims fed back — the same "stop, fix, re-run until it passes" loop the
    //    pdf mode prescribes, done here so the deterministic scripts own it.
    const cvContent = readUserCv(req);
    const contactCtx = (contact.emails.length || contact.phones.length)
      ? `\nContact on posting page: emails=${contact.emails.join(', ')} phones=${contact.phones.join(', ')}`
      : '';
    const schema = `{
  "lang": "en",
  "page_format": "${format}",
  "candidate": {"name": "...", "phone": "...", "email": "...", "linkedin": {"url":"...","display":"..."}, "portfolio": {"url":"...","display":"..."}, "location": "...", "photo": ""},
  "sections": {"summary":"Professional Summary","competencies":"Core Competencies","experience":"Work Experience","projects":"Projects","education":"Education","certifications":"Certifications","skills":"Skills"},
  "summary": "...",
  "competencies": ["..."],
  "experience": [{"company":"...","role":"...","location":"...","dates":"...","bullets":["..."]}],
  "projects": [{"name":"...","badge":"...","tech":"...","description":"..."}],
  "education": [{"title":"...","org":"...","year":"...","description":"..."}],
  "certifications": [{"title":"...","org":"...","year":"..."}],
  "skills": [{"category":"Languages","items":"..."}]
}`;

    const buildPrompt = (rejectedClaims) => `Tailor a CV for this role and return ONLY the render JSON.

You are the career-ops CV engine. Source of truth — NEVER invent skills, metrics, percentages, or employers:
CV:\n${cvContent}\n
Profile (JSON):\n${JSON.stringify(profile, null, 2)}\n
Role: ${role || 'Unknown'} at ${company || 'Unknown'}
${url ? `Job URL: ${url}\n` : ''}Job description:\n${(jdText || '(not fetched — use the evaluation report only)').slice(0, 6000)}\n
Evaluation report:\n${reportContent.slice(0, 2500) || '(none)'}\n
Skill-gap classifier (jd-skill-gap) — NEVER present gap items as skills the candidate has:\n${skillGapSummary || '(unavailable)'}${contactCtx}\n
Rules:
- candidate.name must equal "${candidateName}". Paper format is ${format}.
- Inject JD keywords into real experience only. Reword honestly — never fabricate numbers, percentages, or employers.
- competencies: 6-8 keyword phrases drawn only from existing / supported-by-resume skills.
- Return ONLY one valid JSON object matching exactly this schema — no markdown, no code fences, no commentary, no extra keys:\n${schema}
${rejectedClaims ? `\nREJECTED BY THE FACT GATE — these claims are NOT in cv.md. Remove every mention of them from the CV (including education/project descriptions). Do not re-insert them:\n${rejectedClaims}` : ''}`;

    // 8) Generate-then-gate loop: agent JSON -> build-cv-html -> verify-cv-facts.
    //    A gate failure regenerates the payload with the rejected claims fed back.
    const dataDir = join(userDir, 'data');
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    const jsonPath = join(outputDir, `cv-${candidate}-${companySlug}.json`);
    const htmlAbs = join(outputDir, `cv-${candidate}-${companySlug}.html`);
    const verifyScript = join(toolchainDir, 'verify-cv-facts.mjs');

    let payload = null;
    let lastAgentOutput = '';
    let lastGateError = '';
    let gateAttempts = 0;
    const MAX_ATTEMPTS = 3;
    while (gateAttempts < MAX_ATTEMPTS) {
      const result = await runOpencode(buildPrompt(lastGateError), 240000, userCwd(req));
      lastAgentOutput = result;
      payload = parseJsonPayload(result);
      if (!payload) { gateAttempts++; continue; } // e.g. opencode warmup — retry

      if (!payload.candidate?.name || !payload.summary || !Array.isArray(payload.experience) || !Array.isArray(payload.skills)) {
        return res.status(422).json({ error: 'render JSON missing required fields', output: JSON.stringify(payload).slice(0, 1500) });
      }

      writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
      const r1 = spawnSync('node', [join(toolchainDir, 'build-cv-html.mjs'), jsonPath, htmlAbs, templatePath], { cwd: userDir, encoding: 'utf-8', timeout: 30000 });
      if (r1.status !== 0) {
        return res.status(500).json({ error: 'build-cv-html failed', stderr: (r1.stderr || r1.stdout || '').slice(0, 1500), htmlPath: `output/cv-${candidate}-${companySlug}.html`, output: result.slice(0, 1000) });
      }

      if (existsSync(dataDir) && existsSync(verifyScript)) {
        const r2 = spawnSync('node', [verifyScript, htmlAbs, '--source', 'cv.md'], { cwd: dataDir, encoding: 'utf-8', timeout: 30000 });
        if (r2.status !== 0) {
          lastGateError = (r2.stderr || r2.stdout || '').slice(0, 1200);
          gateAttempts++;
          if (gateAttempts >= MAX_ATTEMPTS) {
            return res.status(500).json({ error: 'verify-cv-facts failed (fact gate) after retries', stderr: lastGateError, htmlPath: `output/cv-${candidate}-${companySlug}.html` });
          }
          continue; // regenerate the payload with the rejected claims fed back
        }
      }
      break; // fact gate passed
    }
    if (!payload) {
      return res.status(422).json({ error: 'agent returned no valid render JSON after retries', output: lastAgentOutput.slice(0, 2000) });
    }

    const today = new Date().toISOString().slice(0, 10);
    // Report-derived slugs already carry the date (011-mthree-2026-08-03.md) —
    // don't stamp it twice. Bare company slugs still get today's date.
    const pdfBase = `cv-${candidate}-${companySlug}`;
    const pdfName = `${pdfBase}${pdfBase.endsWith(`-${today}`) ? '' : `-${today}`}.pdf`;
    const pdfAbs = join(outputDir, pdfName);
    // --allow-reorder: build-cv-html's template order is a deliberate design
    // (modes/pdf.md "Section order") that legitimately differs from cv.md's
    // order — the guard's job is to catch AGENT scrambling, which cannot happen
    // here because the template owns the order. --user-dir must be the SPACED
    // form: generate-pdf detects it via argv.indexOf('--user-dir').
    const pdfArgs = [join(toolchainDir, 'generate-pdf.mjs'), htmlAbs, pdfAbs, `--format=${format}`, '--allow-reorder'];
    pdfArgs.push('--user-dir', userDir);
    if (reportNumForPdf > 0) pdfArgs.push(`--report=${String(reportNumForPdf).padStart(3, '0')}`);
    const r3 = spawnSync('node', pdfArgs, { cwd: userDir, encoding: 'utf-8', timeout: 90000 });
    if (r3.status !== 0) {
      return res.status(500).json({ error: 'generate-pdf failed', stderr: (r3.stderr || '').slice(0, 1500), htmlPath: `output/cv-${candidate}-${companySlug}.html` });
    }
    if (!existsSync(pdfAbs)) {
      return res.status(500).json({ error: 'generate-pdf produced no file', stdout: (r3.stdout || '').slice(0, 1000), htmlPath: `output/cv-${candidate}-${companySlug}.html` });
    }

    const gapsHint = skillGapSummary ? `\n\nSkill-gap summary:\n${skillGapSummary.slice(0, 800)}` : '';
    res.json({
      success: true,
      pdfPath: `output/${pdfName}`,
      htmlPath: `output/cv-${candidate}-${companySlug}.html`,
      reportNum: reportNumForPdf || null,
      company: company || (reportFile ? reportFile.replace(/^\d+-/, '').replace(/-\d{4}-\d{2}-\d{2}\.md$/, '') : ''),
      role: role || '',
      output: `Tailored CV generated for ${role || company}.\n- Format: ${format}\n- Report: ${reportNumForPdf ? String(reportNumForPdf).padStart(3, '0') : 'none'}${gapsHint}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /salary-gap — salary gap analysis
app.get('/salary-gap', (req, res) => {
  try {
    const script = join(__dirname, 'salary-gap.mjs');
    if (!existsSync(script)) return res.json({ observations: [], gaps: [] });
    const cwd = userCwd(req);
    const r = spawnSync('node', [script, '--json'], { cwd, encoding: 'utf-8', timeout: 30000 });
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
    const histPath = req.userCtx?.scanHistory || join(__dirname, 'data/scan-history.tsv');
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
    const userDir = req.userCtx?.userDir || __dirname;
    let dedupResult = '', normResult = '';
    if (existsSync(dedupScript)) {
      const r = spawnSync('node', [dedupScript], { cwd: userDir, encoding: 'utf-8', timeout: 30000 });
      dedupResult = r.stdout || '';
    }
    if (existsSync(normScript)) {
      const r = spawnSync('node', [normScript], { cwd: userDir, encoding: 'utf-8', timeout: 30000 });
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
    const trackerPath = req.userCtx?.trackerPath || TRACKER_PATH;
    const lines = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf-8').split('\n') : [];
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
    const reportsDir = req.userCtx?.reportsDir || join(__dirname, 'reports');
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
    const reportsDir = req.userCtx?.reportsDir || join(__dirname, 'reports');
    if (!existsSync(reportsDir)) return res.json({ reports: [] });
    const files = readdirSync(reportsDir).filter(f => f.endsWith('.md')).sort().reverse();
    const reports = files.map(f => {
      const num = f.split('-')[0];
      const company = f.split('-').slice(1, -2).join('-').replace(/-/g, ' ');
      const date = f.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
      // Extract score from first 500 chars only (not full file)
      let score = 'N/A';
      let preview = '';
      try {
        const head = readFileSync(join(reportsDir, f), 'utf-8').slice(0, 500);
        score = head.match(/\*\*Score:\*\*\s*(\S+)/)?.[1] || 'N/A';
        preview = head.slice(0, 200);
      } catch { /* file read failed — use defaults */ }
      return { id: num, filename: f, company, date, score, preview };
    });
    res.json({ reports });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /pipeline — list pending URLs from data/pipeline.md
app.get('/pipeline', (req, res) => {
  try {
    const pipelinePath = req.userCtx?.pipelinePath || join(__dirname, 'data/pipeline.md');
    if (!existsSync(pipelinePath)) return res.json({ entries: [] });
    const text = readFileSync(pipelinePath, 'utf-8');
    const lines = text.split('\n');
    const entries = [];
    // Read tracker ONCE before the loop (was O(n) reads per URL)
    const trackerPath = req.userCtx?.trackerPath || TRACKER_PATH;
    const trackerText = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf-8') : '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Parse lines like: "- https://company.com/jobs/123" or "- [Company] https://..."
      const urlMatch = trimmed.match(/https?:\/\/\S+/);
      if (urlMatch) {
        const url = urlMatch[0].replace(/[)\]]$/, '');
        const label = trimmed.replace(/^[-*]\s*/, '').replace(url, '').trim();
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
    try { const _ud = req.userCtx?.userDir; const _ma = _ud ? ['merge-tracker.mjs', '--user-dir', _ud] : ['merge-tracker.mjs']; spawnSync('node', _ma, { cwd: userCwd(req), encoding: 'utf-8', timeout: 10000 }); } catch { /* non-fatal */ }
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
  const rootPath = EXPORT_WHITELIST[key];
  if (!rootPath) return res.status(404).json({ error: `Unknown export: ${key}` });
  const filePath = resolveUserExportPath(key, rootPath, req);
  if (!existsSync(filePath)) {
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

// ── POST /upload-apk — receive APK update from dev environment ─────
app.post('/upload-apk', upload.single('apk'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No APK file uploaded' });
    const src = req.file.path;
    const dest1 = join(__dirname, 'career-ops.apk');
    const dest2 = '/sdcard/Download/career-ops.apk';
    copyFileSync(src, dest1);
    try { copyFileSync(src, dest2); } catch {}
    try { unlinkSync(src); } catch {}
    res.json({ success: true, path: dest1, size: req.file.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  // Start opencode at boot so first chat connects instantly (no 30s cold start)
  bootOpencode().catch(e => console.error('[boot] opencode startup failed:', e.message));

  // Start scheduler for automated daily tasks
  import('./scheduler.mjs').then(m => m.startScheduler()).catch(e => console.error('[scheduler] failed to start:', e.message));

  // Evict stale opencode sessions every 30 minutes (30min TTL)
  setInterval(() => {
    const now = Date.now();
    const TTL_MS = 30 * 60 * 1000;
    for (const [key, sess] of opencodeSessions) {
      if (now - sess.lastAccess > TTL_MS) {
        opencodeSessions.delete(key);
        console.log(`[session] Evicted stale session: ${key}`);
      }
    }
  }, 30 * 60 * 1000).unref();
});

// ── OpenCode SDK integration ───────────────────────────────────────
const opencodeSessions = new Map();
const OPENCODE_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:4096';
const OPENCODE_PORT = 4096;
let _opencodeReady = false; // true once bootOpencode() completes

function isTermux() {
  return !!process.env.TERMUX_VERSION;
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

// Called once at server boot — swaps AGENTS.md, kills stale opencode, spawns fresh proot
async function bootOpencode() {
  if (isTermux()) {
    const prootRootfs = '/data/data/com.termux/files/usr/var/lib/proot-distro/containers/debian/rootfs';
    const androidAgentsSrc = join(__dirname, 'AGENTS_ANDROID.md');
    const prootAgentsFull = join(prootRootfs, 'root/career-ops/AGENTS.md');
    const prootAgentsBackup = join(prootRootfs, 'root/career-ops/AGENTS.md.full');

    // 1) Swap AGENTS.md → lightweight version (backup full once)
    try {
      if (existsSync(androidAgentsSrc)) {
        if (!existsSync(prootAgentsBackup) && existsSync(prootAgentsFull)) {
          copyFileSync(prootAgentsFull, prootAgentsBackup);
          console.log('[boot] Backed up AGENTS.md → AGENTS.md.full in proot');
        }
        copyFileSync(androidAgentsSrc, prootAgentsFull);
        console.log('[boot] Installed lightweight AGENTS_ANDROID.md → AGENTS.md in proot');
      }
    } catch (e) {
      console.log(`[boot] AGENTS swap failed: ${e.message}`);
    }

    // 2) Kill any stale opencode process
    try {
      const killResult = spawnSync('pkill', ['-9', '-f', 'opencode serve'], {
        encoding: 'utf-8', timeout: 5000
      });
      if (killResult.status === 0) {
        console.log('[boot] Killed stale opencode process');
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch { /* no matching process — fine */ }

    // 3) Spawn opencode via proot-distro
    const prootBin = '/data/data/com.termux/files/usr/bin/proot-distro';
    if (!existsSync(prootBin)) {
      console.log('[boot] proot-distro not found — skipping opencode boot');
      return;
    }
    console.log('[boot] Launching opencode via proot-distro...');
    const prootProc = spawn(prootBin, [
      'login', 'debian', '--',
      'bash', '-c',
      `cd /root/career-ops && ./opencode serve --hostname=127.0.0.1 --port=${OPENCODE_PORT} 2>&1`
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/root' },
      detached: true,
    });
    prootProc.unref();
    prootProc.on('error', (e) => console.error(`[boot] proot spawn error: ${e.message}`));
    prootProc.stdout?.on('data', (d) => {
      const s = d.toString().trim();
      if (s) console.log(`[proot:out] ${s}`);
    });
    prootProc.stderr?.on('data', (d) => {
      const s = d.toString().trim();
      if (s) console.log(`[proot:err] ${s}`);
    });
    prootProc.on('exit', (code) => console.log(`[proot] exited with code ${code}`));

    // 4) Wait for server ready
    console.log('[boot] Waiting for opencode server...');
    const ready = await waitForOpencodeServer(OPENCODE_URL, 30000);
    if (!ready) {
      console.error('[boot] opencode server did not start in 30s — will retry on first chat');
      return;
    }
    console.log('[boot] opencode server ready');
    // Warmup: let model provider initialize
    await new Promise(r => setTimeout(r, 2000));
  }
  _opencodeReady = true;
}

// Called per user on first /chat — just connects to already-running opencode + creates session
async function initOpencode(userId, userDir, fresh = false) {
  const key = userId || '__root__';
  const cached = opencodeSessions.get(key);
  if (cached && !fresh) {
    cached.lastAccess = Date.now();
    return cached;
  }

  let client;

  // Try connecting to existing opencode server (should be running from bootOpencode)
  try {
    const probe = await fetch(OPENCODE_URL + '/health', { signal: AbortSignal.timeout(2000) });
    if (probe.ok) {
      client = createOpencodeClient({
        baseUrl: OPENCODE_URL,
        directory: userDir || __dirname,
      });
    }
  } catch {}

  // Fallback: opencode not running (boot failed or non-Termux). Spawn now.
  if (!client) {
    if (isTermux()) {
      // Retry boot — first chat fallback
      console.log('[chat] opencode not running — retrying boot...');
      await bootOpencode();
      try {
        const probe = await fetch(OPENCODE_URL + '/health', { signal: AbortSignal.timeout(2000) });
        if (probe.ok) {
          client = createOpencodeClient({
            baseUrl: OPENCODE_URL,
            directory: userDir || __dirname,
          });
        }
      } catch {}
    } else {
      // Desktop: spawn directly
      try {
        console.log('[chat] Spawning opencode serve locally...');
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

  if (!client) {
    throw new Error('opencode server not available');
  }

  const sessionResult = await client.session.create({
    body: { title: userId || 'default' }
  });
  const sessionId = sessionResult.data?.id;
  if (!sessionId) {
    throw new Error('Failed to create opencode session: ' + JSON.stringify(sessionResult.error || sessionResult));
  }

    if (!fresh) {
    opencodeSessions.set(key, { client, sessionId, lastAccess: Date.now() });
  }
  return { client, sessionId };
}

async function doctorCheck(userDir) {
  const result = spawnSync('node', ['doctor.mjs', '--json', '--user-dir', userDir], {
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

    const userCtx = buildUserContext(req);
    const enrichedMessage = userCtx ? userCtx + message : message;

    await client.session.promptAsync({
      path: { id: sessionId },
      body: { 
        parts: [{ type: "text", text: enrichedMessage }],
        model: resolveModelForUser(userId)
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
          const elapsed = Math.round(pollCount);
          console.log(`[chat] ${elapsed}s busy waiting for response...`);
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
        console.log(`[chat] Found text in msg ${i} (${text.length} chars)`);
      }
      
      // Collect tool outputs from ALL messages (not just the one with text)
      const tools = parts.filter(p => p.type === 'tool').map(tp => ({
        tool: tp.tool, status: tp.state?.status,
        output: tp.state?.output || '', input: tp.state?.input || ''
      }));
      if (tools.length > 0) {
        toolOutputs.push(...tools);
      }
      
      if (content) break;
    }
    
    // Append tool output summaries to content (gives user visibility into what ran)
    if (toolOutputs.length > 0) {
      const completed = toolOutputs.filter(t => t.status === 'completed' && t.output);
      if (completed.length > 0) {
        const toolSummary = formatToolSummary(completed);
        if (content) {
          content = content + '\n\n---\n' + toolSummary;
        } else {
          content = toolSummary;
        }
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
  const parts = [];
  
  for (const tool of completedTools) {
    if (tool.input?.includes('scan.mjs')) {
      try {
        const data = JSON.parse(tool.output);
        const count = data.results?.length || data.total || 0;
        if (data.results && Array.isArray(data.results)) {
          const listings = data.results.slice(0, 10).map(r =>
            `• **${r.company || 'Unknown'}** — ${r.role || ''} | ${r.location || ''} | [Apply](${r.url || ''})`
          ).join('\n');
          parts.push(`Found **${count}** matching jobs:\n\n${listings}`);
        } else {
          parts.push(`Scan found ${count} results. Check tracker for details.`);
        }
      } catch {
        // Raw output — scan.mjs prints "+ Company | Title | Location" lines
        // Extract those lines and pass them through (frontend parseScanResults expects this format)
        const rawLines = (tool.output || '').split('\n');
        const scanLines = rawLines.filter(l => /^\s*\+\s+.+\|/.test(l.trim()));
        if (scanLines.length > 0) {
          const listings = scanLines.slice(0, 30).join('\n');
          const summaryLine = rawLines.find(l => /Total jobs found|New offers added/i.test(l)) || '';
          parts.push(`${summaryLine ? summaryLine.trim() + '\n\n' : ''}${listings}`);
        } else {
          // No structured lines — show summary text only
          const summaryText = rawLines
            .filter(l => /\d+\s+(found|added|scanned|filtered|skipped)/i.test(l) || /Total|Portal|Company/i.test(l))
            .slice(0, 15)
            .join('\n');
          parts.push(summaryText || 'Scan completed. Check pipeline.md for results.');
        }
      }
    } else if (tool.input?.includes('evaluate') || tool.input?.includes('oferta')) {
      parts.push((tool.output || 'Evaluation complete').slice(0, 2000));
    } else {
      // Skip large raw tool outputs — they're internal, not user-facing
      const out = (tool.output || '').trim();
      if (out.length > 0 && out.length < 3000 && !out.startsWith('{') && !out.startsWith('<')) {
        parts.push(out.slice(0, 1500));
      }
    }
  }
  
  return parts.join('\n\n') || 'Processing complete.';
}

// ── POST /chat/stream — SSE streaming for chat ──────────────────────
app.post('/chat/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    if (!res.destroyed) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (res.flush) res.flush();
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

    const lowerMsg = message.toLowerCase();

    const trackerPath = join(userDir, 'data', 'applications.md');
    if (!existsSync(trackerPath)) {
      await doctorCheck(userDir);
    }

    const { client, sessionId } = await initOpencode(userId, userDir);

    // Check if session is already busy from a previous message
    try {
      const preCheck = await client.session.status({}).catch(() => ({ data: {} }));
      const preStatus = preCheck.data?.[sessionId]?.type;
      if (preStatus === 'busy' || preStatus === 'retry') {
        send('error', { error: 'Still processing your previous message. Please wait a moment and try again.' });
        return finish();
      }
    } catch {}

    // Immediate connected event so client knows the SSE pipe is alive
    send('connected', { sessionId });
    console.log(`[chat/stream] Session ${sessionId}, sending: "${message.slice(0, 80)}..."`);

    // Heartbeat every 5s to keep connection alive (mobile NAT timeouts)
    heartbeat = setInterval(() => {
      if (!res.destroyed) {
        res.write(':keepalive\n\n');
        if (res.flush) res.flush();
      }
    }, 5000);

    // Fire promptAsync (non-blocking)
    const userCtx2 = buildUserContext(req);
    const enrichedMessage2 = userCtx2 ? userCtx2 + message : message;
    const asyncResult = await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: enrichedMessage2 }],
        model: resolveModelForUser(userId)
      }
    });
    if (asyncResult.error) {
      send('error', { error: asyncResult.error });
      return finish();
    }

    // Detect workflow phase from message (used for progress + fallback)
    const isApply = lowerMsg.includes('apply') || lowerMsg.includes('follow');
    const isScan = lowerMsg.includes('scan') || lowerMsg.includes('find job') || lowerMsg.includes('search');
    const isEmail = lowerMsg.includes('email') || lowerMsg.includes('inbox');
    const isCv = lowerMsg.includes('cv') || lowerMsg.includes('resume') || lowerMsg.includes('pdf');
    const isInterview = lowerMsg.includes('interview');

    // Poll opencode until idle, then fetch the response
    const POLL_MS = 1000;
    const MAX_WAIT = isScan ? 120000 : 300000; // 2 min for scan, 5 min otherwise
    const deadline = Date.now() + MAX_WAIT;
    let pollCount = 0;
    let sawBusy = false;
    let idleCount = 0;
    let lastStreamedLen = 0; // Track how much text we've already streamed
    let lastToolName = '';
    let completedTools = 0;

    while (Date.now() < deadline && !settled) {
      await new Promise(r => setTimeout(r, POLL_MS));
      pollCount++;

      const withTimeout0 = (p, ms) => Promise.race([p, new Promise((_,rej) => setTimeout(() => rej(new Error('SDK timeout')), ms))]);
      const statusResult = await withTimeout0(client.session.status({}), 5000).catch(() => ({ data: {} }));
      const st = statusResult.data?.[sessionId]?.type;

      if (st === 'busy' || st === 'retry') {
        sawBusy = true;
        idleCount = 0;

        // Stream intermediate text while opencode is working — every poll
        {
          try {
            const withTimeout = (p, ms) => Promise.race([p, new Promise((_,rej) => setTimeout(() => rej(new Error('SDK timeout')), ms))]);
            const intermediateMsgs = await withTimeout(client.session.messages({
              path: { id: sessionId },
              query: { limit: 10 }
            }), 5000);
            const iMsgs = Array.isArray(intermediateMsgs.data) ? intermediateMsgs.data : [];
            const iAssistants = iMsgs.filter(m => m.info?.role === 'assistant');
            let intermediateText = '';
            for (const m of iAssistants) {
              for (const p of (m.parts || [])) {
                if (p.type === 'text') {
                  let t = (p.text || p.content || '').trim();
                  // Strip internal JSON and file content that leaks into text
                  const jsonIdx = t.indexOf('{"onboardingNeeded"');
                  if (jsonIdx > 0) t = t.slice(0, jsonIdx).trim();
                  const jsonIdx2 = t.indexOf('\n{"status"');
                  if (jsonIdx2 > 0) t = t.slice(0, jsonIdx2).trim();
                  const pathIdx = t.indexOf('<path>');
                  if (pathIdx > 0) t = t.slice(0, pathIdx).trim();
                  const sysCtxIdx = t.indexOf('## System Context');
                  if (sysCtxIdx > 0) t = t.slice(0, sysCtxIdx).trim();
                  const srcIdx = t.indexOf('## Sources of Truth');
                  if (srcIdx > 0) t = t.slice(0, srcIdx).trim();
                  // Skip raw tool outputs
                  const looksLikeToolOutput = t.startsWith('{') || t.startsWith('[') || t.startsWith('<') || t.startsWith('# ') || t.startsWith('| ');
                  if (t.length > intermediateText.length && !looksLikeToolOutput) {
                    intermediateText = t;
                  }
                } else if (p.type === 'tool' && p.state?.status === 'running') {
                  lastToolName = p.tool || '';
                }
              }
            }

            // Check scan progress file (written by scan.mjs)
            const scanProgressPath = join(userDir, 'data', 'scan-progress.json');
            if (existsSync(scanProgressPath)) {
              try {
                const sp = JSON.parse(readFileSync(scanProgressPath, 'utf-8'));
                const age = Date.now() - (sp.ts || 0);
                if (age < 30000) { // fresh (< 30s old)
                  if (sp.phase === 'verify') {
                    send('progress', { 
                      text: `Verifying with Playwright...`,
                      portal: sp.portal,
                      current: sp.current,
                      total: sp.total,
                      phase: 'verify'
                    });
                  } else {
                    send('progress', { 
                      text: `Scanning ${sp.portal}...`,
                      portal: sp.portal,
                      current: sp.current + 1,
                      total: sp.total,
                      found: sp.found,
                      phase: 'scan'
                    });
                  }
                }
              } catch {}
            }
            if (intermediateText.length > lastStreamedLen) {
              const delta = intermediateText.slice(lastStreamedLen);
              lastStreamedLen = intermediateText.length;
              // Final check: skip deltas that are pure junk
              const isJunk = delta.startsWith('{') || delta.startsWith('<path>') || delta.includes('onboardingNeeded');
              if (!isJunk && delta.trim().length > 0) {
                send('text_delta', { text: delta });
                console.log(`[chat/stream] Streaming intermediate: ${delta.length} chars (total ${lastStreamedLen})`);
              }
            }

            // Send structured step progress based on what tool is running
            if (pollCount % 2 === 0 || isScan) {
              const elapsed = Math.round(pollCount * POLL_MS / 1000);
              const toolDisplay = lastToolName ? lastToolName.replace(/[^a-zA0-9_-]/g, '').slice(0, 30) : '';

              // Count completed tool calls to infer progress
              completedTools = 0;
              let currentTool = toolDisplay;
              try {
                const withTimeout2 = (p, ms) => Promise.race([p, new Promise((_,rej) => setTimeout(() => rej(new Error('SDK timeout')), ms))]);
                const progressMsgs = await withTimeout2(client.session.messages({
                  path: { id: sessionId },
                  query: { limit: 20 }
                }), 5000);
                const pMsgs = Array.isArray(progressMsgs.data) ? progressMsgs.data : [];
                for (const m of pMsgs) {
                  for (const p of (m.parts || [])) {
                    if (p.type === 'tool' && p.state?.status === 'completed') completedTools++;
                    if (p.type === 'tool' && p.state?.status === 'running') currentTool = (p.tool || '').slice(0, 30);
                  }
                }
              } catch {}

              if (isApply) {
                const steps = [
                  { label: 'Loading profile & CV', done: completedTools >= 1 },
                  { label: 'Fetching job description', done: completedTools >= 2 },
                  { label: 'Evaluating fit (A-G scoring)', done: completedTools >= 4 },
                  { label: 'Drafting application email', done: completedTools >= 5 },
                  { label: 'Preparing tracker entry', done: false }
                ];
                const currentStep = steps.findIndex(s => !s.done);
                const progress = Math.min(completedTools / 5, 1.0);
                // Combine step label with current tool for real-time context
                const toolContext = currentTool ? ` — ${currentTool}` : '';
                const stepLabel = currentStep >= 0 ? steps[currentStep].label : 'Finishing up';
                send('progress', {
                  text: `${stepLabel}${toolContext}`,
                  step: Math.min(completedTools + 1, 5),
                  totalSteps: 5,
                  steps: steps.map(s => ({ label: s.label, done: s.done })),
                  currentTool,
                  elapsed,
                  progress
                });
              } else if (isScan) {
                const steps = [
                  { label: 'Loading portals', done: completedTools >= 1 },
                  { label: 'Scanning providers', done: completedTools >= 2 },
                  { label: 'Web search fallback', done: completedTools >= 3 },
                  { label: 'Filtering results', done: completedTools >= 4 },
                  { label: 'Tracking new jobs', done: false }
                ];
                const currentStep = steps.findIndex(s => !s.done);
                const toolContext = currentTool ? ` — ${currentTool}` : '';
                send('progress', {
                  text: `${currentStep >= 0 ? steps[currentStep].label : 'Finishing scan'}${toolContext}`,
                  step: Math.min(completedTools + 1, 5),
                  totalSteps: 5,
                  steps: steps.map(s => ({ label: s.label, done: s.done })),
                  currentTool,
                  elapsed,
                  progress: Math.min(completedTools / 5, 1.0)
                });
              } else if (isEmail) {
                const steps = [
                  { label: 'Connecting to inbox', done: completedTools >= 1 },
                  { label: 'Fetching recent emails', done: completedTools >= 2 },
                  { label: 'Classifying messages', done: completedTools >= 3 },
                  { label: 'Preparing replies', done: false }
                ];
                const currentStep = steps.findIndex(s => !s.done);
                const toolContext = currentTool ? ` — ${currentTool}` : '';
                send('progress', {
                  text: `${currentStep >= 0 ? steps[currentStep].label : 'Finishing'}${toolContext}`,
                  step: Math.min(completedTools + 1, 4),
                  totalSteps: 4,
                  steps: steps.map(s => ({ label: s.label, done: s.done })),
                  currentTool,
                  elapsed,
                  progress: Math.min(completedTools / 4, 1.0)
                });
              } else {
                // Map tool names to human-readable descriptions
                const toolDescriptions = {
                  'webfetch': 'Reading job posting...',
                  'websearch': 'Searching for company info...',
                  'codesearch': 'Looking up company info...',
                  'read': 'Reading document...',
                  'edit': 'Updating file...',
                  'write': 'Creating file...',
                  'bash': 'Running command...',
                  'glob': 'Searching files...',
                  'grep': 'Searching content...',
                  'task': 'Working on subtask...',
                  'skill': 'Loading career-ops skill...',
                };
                // Infer step from completed tool count
                const stepLabels = ['Starting up...', 'Reading profile & CV...', 'Analyzing job...', 'Researching company...', 'Drafting response...', 'Finalizing...'];
                const stepIdx = Math.min(completedTools, stepLabels.length - 1);
                const baseLabel = stepLabels[stepIdx];
                const toolDesc = currentTool ? (toolDescriptions[currentTool] || `Running ${currentTool}...`) : '';
                const description = toolDesc ? `${baseLabel.replace('...', '')} — ${toolDesc}` : baseLabel;
                send('progress', {
                  text: description,
                  step: completedTools + 1,
                  totalSteps: 5,
                  steps: [],
                  currentTool,
                  elapsed,
                  progress: Math.min(completedTools / 5, 1.0)
                });
              }
            }
          } catch {}
        }

        if (pollCount % 4 === 0) {
          const elapsed = Math.round(pollCount * POLL_MS / 1000);
          console.log(`[chat/stream] ${elapsed}s busy — tool=${lastToolName || 'none'} completed=${completedTools}`);
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

    // Fetch the response (more messages to capture tool outputs when LLM times out)
    const withTimeoutFinal = (p, ms) => Promise.race([p, new Promise((_,rej) => setTimeout(() => rej(new Error('SDK timeout')), ms))]);
    const msgsResult = await withTimeoutFinal(client.session.messages({
      path: { id: sessionId },
      query: { limit: 50 }
    }), 10000);
    const msgs = Array.isArray(msgsResult.data) ? msgsResult.data : [];
    const assistants = msgs.filter(m => m.info?.role === 'assistant');

    // Log summary only (full parts are large)
    for (const m of assistants) {
      const parts = m.parts || [];
      const summary = parts.map(p => `${p.type}:${(p.text||'').length || (p.state?.output||'').length}`).join(',');
      console.log(`[chat/stream] assistant parts: ${parts.length} (${summary})`);
    }

    let content = '';

    // Collect ONLY text parts from assistant messages — tool outputs are internal, not user-facing
    const allTextParts = [];

    for (const m of assistants) {
      for (const p of (m.parts || [])) {
        if (p.type === 'text') {
          const t = (p.text || p.content || '').trim();
          // Skip raw tool outputs that appear as text: JSON blobs, file reads, skill content
          const startsWithJson = t.startsWith('{') || t.startsWith('[');
          const isFileContent = t.startsWith('<path>') || t.startsWith('<content>') || t.includes('## System Context');
          const isSkillContent = t.startsWith('<skill_content');
          const isMarkdownTable = t.startsWith('| ') && t.includes(' | ');
          const hasInternalJson = t.includes('onboardingNeeded') || t.includes('autoCopied') || t.includes('"plugins"');
          const hasFilePath = t.includes('<path>/') || t.includes('## Sources of Truth');
          // If text has valid start BUT contains junk later, strip the junk
          let cleanText = t;
          if (hasInternalJson) {
            // Cut everything from first { that starts a JSON blob
            const jsonIdx = cleanText.indexOf('{"onboardingNeeded"');
            if (jsonIdx > 0) cleanText = cleanText.slice(0, jsonIdx).trim();
            const jsonIdx2 = cleanText.indexOf('\n{"status"');
            if (jsonIdx2 > 0) cleanText = cleanText.slice(0, jsonIdx2).trim();
          }
          if (hasFilePath) {
            // Cut everything from <path> onwards
            const pathIdx = cleanText.indexOf('<path>');
            if (pathIdx > 0) cleanText = cleanText.slice(0, pathIdx).trim();
            const sysCtxIdx = cleanText.indexOf('## System Context');
            if (sysCtxIdx > 0) cleanText = cleanText.slice(0, sysCtxIdx).trim();
            const srcIdx = cleanText.indexOf('## Sources of Truth');
            if (srcIdx > 0) cleanText = cleanText.slice(0, srcIdx).trim();
          }
          if (cleanText.length > 0 && !startsWithJson && !isSkillContent && !isMarkdownTable) {
            allTextParts.push(cleanText);
          }
        }
      }
    }

    content = allTextParts.join('\n\n');

    // Final cleanup pass — strip any remaining internal content that leaked through
    const cleanupPatterns = [
      /\{"status":"up-to-date"[\s\S]*/s,  // Everything from status JSON onwards
      /\{"onboardingNeeded"[\s\S]*/s,
      /\n<path>[\s\S]*/s,
      /\n## System Context[\s\S]*/s,
      /\n## Sources of Truth[\s\S]*/s,
      /\n<skill_content[\s\S]*/s,
      /\n# System Context[\s\S]*/s,
      /\n<content>[\s\S]*/s,
      /<task_result>[\s\S]*/s,
      /\ntask_id:[\s\S]*/s,
      /\n```markdown[\s\S]*/s,
      /\nJob Application for[\s\S]*/s,  // Strip raw Greenhouse form HTML
      /^Hey! I'm your job search assistant[\s\S]*?land your next role\./m,  // Welcome message
      /^Here's what I can do:[\s\S]*?land your next role\./m,
      /## What You Offer[\s\S]*$/,  // AGENTS.md system prompt sections
      /## Intent Routing[\s\S]*$/,
      /## Critical Rules[\s\S]*$/,
      /## Output Formats[\s\S]*$/,
      /## Canonical States[\s\S]*$/,
    ];
    for (const pat of cleanupPatterns) {
      content = content.replace(pat, '');
    }
    content = content.trim();

    // If the remaining content is mostly raw JD HTML (not a real evaluation), truncate hard
    if (content.includes('About Glean:') || content.includes('About the Role:') || content.includes('Submit application')) {
      // This is raw JD content, not an evaluation — find the actual eval text before it
      const evalEnd = content.indexOf('Job Application for');
      if (evalEnd > 50) {
        content = content.slice(0, evalEnd).trim();
      } else {
        content = 'Task completed. Check reports and tracker for details.';
      }
    }

    // Cap final response to prevent UI overwhelm
    const MAX_RESPONSE = 8000;
    if (content.length > MAX_RESPONSE) {
      content = content.slice(0, MAX_RESPONSE) + '\n\n[Response truncated — full results saved to reports]';
    }

    // Fallback: if no text was produced (LLM timed out), extract results from tool outputs
    if (!content || content === 'Task completed. Check reports and tracker for details.') {
      const toolOutputs = [];
      for (const m of assistants) {
        for (const p of (m.parts || [])) {
          if (p.type === 'tool' && p.state?.status === 'completed' && p.state?.output) {
            toolOutputs.push({ tool: p.tool, input: p.state?.input || '', output: p.state?.output });
          }
        }
      }

      if (toolOutputs.length > 0) {
        const toolContent = formatToolSummary(toolOutputs);
        if (toolContent && toolContent !== 'Processing complete.') {
          content = toolContent;
          lastStreamedLen = 0; // Reset — fallback content is entirely new text, not continuation of intermediate stream
        }
      }

      // Fallback: run scan.mjs directly when opencode produces nothing
      if (!content && isScan) {
        console.log('[chat/stream] opencode produced no scan output — running scan.mjs directly');
        try {
          const { spawn } = await import('child_process');
          const userDir2 = userDir || __dirname;
          const scanEnv = { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' };

          // Stream progress while scan.mjs runs
          let scanProgress = '';
          const scanResult = await new Promise((resolve, reject) => {
            const proc = spawn('node', [join(__dirname, 'scan.mjs'), '--user-dir', userDir2], {
              cwd: userDir2,
              env: scanEnv,
              timeout: 240000,
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => {
              const str = chunk.toString();
              stdout += str;
              // Extract + Company | Role | Location lines as they stream
              const lines = str.split('\n');
              for (const line of lines) {
                if (/^\s*\+\s+.+\|/.test(line.trim())) {
                  const clean = line.trim().replace(/^\+\s+/, '+ ');
                  send('text_delta', { text: clean + '\n' });
                  scanProgress += clean + '\n';
                }
                // Stream portal progress from console output
                const portalMatch = line.match(/Scanning\s+(.+?)\.\.\./);
                if (portalMatch) {
                  send('progress', { text: `Scanning ${portalMatch[1]}...`, phase: 'scan' });
                }
                const foundMatch = line.match(/Total jobs found:\s+(\d+)/);
                if (foundMatch) {
                  send('progress', { text: `Found ${foundMatch[1]} jobs total`, phase: 'summary' });
                }
                const addedMatch = line.match(/New offers added:\s+(\d+)/);
                if (addedMatch) {
                  send('progress', { text: `${addedMatch[1]} new offers added to pipeline`, phase: 'done' });
                }
              }
            });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('close', (code) => {
              if (code === 0 || scanProgress.length > 0) resolve({ stdout, stderr, code });
              else reject(new Error(`scan.mjs exit ${code}: ${stderr.slice(0, 500)}`));
            });
            proc.on('error', reject);
          });

          if (scanProgress.length > 0) {
            // scan.mjs already streamed + lines via text_delta above
            lastStreamedLen = 0;
            // Build a summary header
            const addedMatch = scanResult.stdout.match(/New offers added:\s+(\d+)/);
            const totalMatch = scanResult.stdout.match(/Total jobs found:\s+(\d+)/);
            const header = `**Scan complete.** ${addedMatch ? addedMatch[1] + ' new offers' : totalMatch ? totalMatch[1] + ' found' : 'Results below'}\n\n`;
            content = header + scanProgress;
            // Re-send header since the + lines were already streamed
            send('text_delta', { text: header });
          } else {
            // scan.mjs ran but produced no + lines — read pipeline.md for India jobs
            const pipelinePath = join(__dirname, 'data', 'pipeline.md');
            if (existsSync(pipelinePath)) {
              const pipelineContent = readFileSync(pipelinePath, 'utf-8');
              const indiaLocations = /mumbai|kalyan|navi mumbai|thane|bangalore|bengaluru|pune|india|chennai|hyderabad|gurgaon|gurugram|noida|delhi|remote.*india|india.*remote/i;
              const indiaJobs = [];
              for (const line of pipelineContent.split('\n')) {
                if (!line.startsWith('- [ ]')) continue;
                const parts = line.replace('- [ ] ', '').split('|').map(p => p.trim());
                if (parts.length >= 3) {
                  const [, url, company, role, location] = parts;
                  if (indiaLocations.test(location || '')) {
                    indiaJobs.push({ company: company || 'Unknown', role: role || '', location: location || '' });
                  }
                }
              }
              if (indiaJobs.length > 0) {
                const formatted = indiaJobs.map(j => `+ ${j.company} | ${j.role} | ${j.location}`).join('\n');
                content = `**Pipeline:** ${indiaJobs.length} India-based roles:\n\n${formatted}`;
              }
            }
          }
          lastStreamedLen = 0;
        } catch (e) {
          console.error('[chat/stream] Direct scan fallback error:', e.message);
          // Final fallback: read pipeline.md
          try {
            const pipelinePath = join(__dirname, 'data', 'pipeline.md');
            if (existsSync(pipelinePath)) {
              const pipelineContent = readFileSync(pipelinePath, 'utf-8');
              const indiaLocations = /mumbai|kalyan|navi mumbai|thane|bangalore|bengaluru|pune|india|chennai|hyderabad|gurgaon|gurugram|noida|delhi|remote.*india|india.*remote/i;
              const indiaJobs = [];
              for (const line of pipelineContent.split('\n')) {
                if (!line.startsWith('- [ ]')) continue;
                const parts = line.replace('- [ ] ', '').split('|').map(p => p.trim());
                if (parts.length >= 3) {
                  const [, url, company, role, location] = parts;
                  if (indiaLocations.test(location || '')) {
                    indiaJobs.push({ company: company || 'Unknown', role: role || '', location: location || '' });
                  }
                }
              }
              if (indiaJobs.length > 0) {
                const formatted = indiaJobs.map(j => `+ ${j.company} | ${j.role} | ${j.location}`).join('\n');
                content = `**Pipeline:** ${indiaJobs.length} India-based roles:\n\n${formatted}`;
                lastStreamedLen = 0;
              }
            }
          } catch {}
        }
      }

      if (!content) content = 'Task completed. Check reports and tracker for details.';
    }

    // Send remaining text (skip what was already streamed incrementally)
    const remaining = content.slice(lastStreamedLen);
    if (remaining.length > 0) {
      send('text_delta', { text: remaining });
    }
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
    opencodeBootCompleted: _opencodeReady,
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

// Robust JSON extraction for apply-job.mjs stdout. The scripts print one JSON
// object, but a browser/stealth lib can occasionally leak a banner line onto
// stdout — find the first balanced JSON object instead of requiring pure output.
function extractJsonPayload(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function parseApplyOutput(r, url, label) {
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  const parsed = extractJsonPayload(stdout);
  if (parsed) {
    if (stderr) console.log(`[apply:${label}] stderr: ${stderr.slice(0, 400)}`);
    return parsed;
  }
  console.log(`[apply:${label}] non-JSON stdout (${stdout.length}B): ${stdout.slice(0, 500)}`);
  console.log(`[apply:${label}] stderr (${stderr.length}B): ${stderr.slice(0, 500)}`);
  return { error: `Failed to parse ${label} result`, manualUrl: url, raw: stdout.slice(0, 500) };
}

// ── POST /apply/open — Open Chrome, extract form fields ─────────────
app.post('/apply/open', async (req, res) => {
  try {
    const { url, stealth } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const userDir = req.userCtx?.userDir || __dirname;
    const scriptArgs = [join(__dirname, 'apply-job.mjs'), url, '--user-dir', userDir];
    if (stealth) scriptArgs.push('--stealth');
    const r = spawnSync('node', scriptArgs, {
      cwd: userDir,
      encoding: 'utf-8',
      timeout: 120_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    if (r.status !== 0) {
      return res.json({ error: r.stderr || 'Apply script failed', manualUrl: url });
    }

    res.json(parseApplyOutput(r, url, 'open'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /apply/fill — Fill form with user answers + CV ────────────
app.post('/apply/fill', async (req, res) => {
  try {
    const { url, answers, company, stealth, submit } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const userDir = req.userCtx?.userDir || __dirname;

    // Write answers to temp file for the script
    const answersPath = join(userDir, 'data', 'uploads', `answers-${Date.now()}.json`);
    const answersDir = dirname(answersPath);
    if (!existsSync(answersDir)) mkdirSync(answersDir, { recursive: true });
    if (answers) writeFileSync(answersPath, JSON.stringify(answers));

    const scriptArgs = [join(__dirname, 'apply-job.mjs'), url, '--fill', '--headless', '--user-dir', userDir];
    if (stealth) scriptArgs.push('--stealth');
    if (answers) scriptArgs.push('--answers-json', answersPath);
    if (company) scriptArgs.push('--company', company);
    if (submit) scriptArgs.push('--submit');

    const r = spawnSync('node', scriptArgs, {
      cwd: userDir,
      encoding: 'utf-8',
      timeout: 150_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    // Clean up temp file
    try { unlinkSync(answersPath); } catch {}

    if (r.status !== 0) {
      return res.json({ error: r.stderr || 'Apply fill failed', manualUrl: url });
    }

    res.json(parseApplyOutput(r, url, 'fill'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /apply/close — Close apply session (no-op, browser closes per script run) ──
app.post('/apply/close', (req, res) => {
  console.log('[APPLY] Session close requested');
  res.json({ success: true, message: 'Apply session closed.' });
});

// ── POST /apply/guide — Generate manual apply guide (no browser launch) ──
app.post('/apply/guide', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const remotePwUrl = process.env.REMOTE_PLAYWRIGHT_URL;
    const userDir = req.userCtx?.userDir || __dirname;

    if (remotePwUrl) {
      // Try remote Playwright server first
      try {
        const resp = await fetch(`${remotePwUrl}/playwright/guided-apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, userDir }),
          signal: AbortSignal.timeout(15000),
        });
        if (resp.ok) {
          const data = await resp.json();
          return res.json(data);
        }
      } catch { /* remote failed, fall through to local */ }
    }

    // Local generation via apply-job.mjs --manual-guide
    const r = spawnSync('node', [join(__dirname, 'apply-job.mjs'), url, '--manual-guide', '--user-dir', userDir], {
      cwd: userDir,
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    if (r.status !== 0) {
      return res.json({ error: r.stderr || 'Guide generation failed', manualUrl: url });
    }

    res.json(parseApplyOutput(r, url, 'guide'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /form-answers — Persist candidate answers to config/form-answers.yml ──
// Answers to candidate-confirmation form questions (salary, YOE, office commute,
// etc). Asked once in the app, stored here, reused across every subsequent form.
app.post('/form-answers', (req, res) => {
  try {
    const { answers } = req.body || {};
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'answers object required' });
    }
    const userDir = req.userCtx?.userDir || __dirname;
    const path = join(userDir, 'config', 'form-answers.yml');
    let store = {};
    if (existsSync(path)) {
      try { store = yaml.load(readFileSync(path, 'utf-8')) || {}; } catch { /* start fresh */ }
    }
    let changed = false;
    for (const [key, value] of Object.entries(answers)) {
      if (value && typeof value === 'string' && value.trim()) {
        if (store[key] !== value.trim()) { store[key] = value.trim(); changed = true; }
      }
    }
    if (changed) {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(path, yaml.dump(store, { indent: 2, lineWidth: -1, noRefs: true }));
    }
    res.json({ success: true, stored: Object.keys(store) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Portal login requirements + per-user portal credentials ─────────
// Auto-fill needs an active account session on login-gated portals.
// Login method: Google OAuth (Continue-with-Google in the user's persistent
// browser profile) — preferred — or the portal email/password stored below.
app.get('/portals/requirements', (req, res) => {
  res.json({
    googleOAuth: true,
    loginMethod: 'google_oauth',
    loginNote: 'We use Google OAuth to log in to portals and fill application forms. Google sign-in is automatic and per-user; portal passwords are only needed as a fallback for portals without Google login.',
    portals: PORTAL_LOGIN_REQUIREMENTS,
  });
});

// Which portals have stored fallback creds for this user. NEVER exposes
// passwords — only whether one exists. Masked emails only.
app.get('/portal-creds', (req, res) => {
  try {
    const userId = req.userCtx?.userId;
    if (!userId) return res.status(400).json({ error: 'X-User-Id header required' });
    const creds = getPortalCreds(userId);
    const list = Object.keys(creds).map((key) => {
      const c = creds[key] || {};
      const email = c.email || '';
      return {
        portal: c.portal || key,
        email: email ? (email.length > 6 ? email.slice(0, 3) + '…' + email.slice(-10) : '•••') : '',
        hasPassword: !!c.password,
        hasProfile: !!(c.fullName || c.phone),
      };
    });
    res.json({ success: true, creds: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save portal fallback creds (email/password) for this user. The file is
// AES-256-GCM encrypted at rest under the user's data dir. If password is
// omitted, the existing one is preserved.
app.post('/portal-creds', (req, res) => {
  try {
    const userId = req.userCtx?.userId;
    if (!userId) return res.status(400).json({ error: 'X-User-Id header required' });
    const { portal, email, password, fullName, phone } = req.body || {};
    if (!portal || !email) return res.status(400).json({ error: 'portal and email required' });
    const key = String(portal).toLowerCase();
    const creds = getPortalCreds(userId);
    const prev = creds[key] || {};
    creds[key] = {
      portal,
      email,
      password: (password && String(password).trim()) ? String(password) : (prev.password || ''),
      fullName: fullName || prev.fullName || '',
      phone: phone || prev.phone || '',
      updatedAt: new Date().toISOString(),
    };
    setPortalCreds(userId, creds);
    res.json({ success: true, stored: key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/portal-creds/:portal', (req, res) => {
  try {
    const userId = req.userCtx?.userId;
    if (!userId) return res.status(400).json({ error: 'X-User-Id header required' });
    const removed = deletePortalCreds(userId, req.params.portal);
    res.json({ success: true, removed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Portal session status (persisted, no browser launch) ─────────────
// Reports whether a Google session has already been captured in the user's
// Playwright profile by reading the cookie DB directly — no browser needed,
// so the app can gate the "Connect your job portals" step for existing users.
app.get('/portal/session/status', (req, res) => {
  try {
    const userDir = req.userCtx?.userDir || __dirname;
    const SESSION_COOKIES = ['SID', 'HSID', 'SAPISID', '__Secure-1PSID'];
    const TRACK_COOKIES = [...SESSION_COOKIES, '__Host-GAPS', 'NID', 'OTZ'];

    // Seeded from the app's WebView OAuth login (google-cookies.json) — the
    // one-login-for-both path. Present before any Playwright run has consumed
    // them, so the app can report "connected" immediately.
    const seedFile = join(userDir, 'google-cookies.json');
    let seeded = false;
    let seededNames = [];
    if (existsSync(seedFile)) {
      try {
        const data = JSON.parse(readFileSync(seedFile, 'utf-8'));
        const list = Array.isArray(data) ? data : (data.cookies || []);
        seededNames = SESSION_COOKIES.filter((n) => list.some((c) => c && c.name === n));
        seeded = seededNames.length > 0;
      } catch { /* ignore corrupt seed file */ }
    }

    // Live Playwright profile cookie DB (consumed by login-session/apply-job).
    const cookiesDb = join(userDir, '.pwprofile', 'Default', 'Cookies');
    let profileNames = [];
    let profileExists = false;
    if (existsSync(cookiesDb)) {
      profileExists = true;
      const r = spawnSync('sqlite3', [
        cookiesDb,
        `SELECT name FROM cookies WHERE host_key LIKE '%google.com' AND name IN ('${TRACK_COOKIES.join("','")}');`,
      ], { encoding: 'utf-8', timeout: 10000 });
      if (!r.error && r.status === 0) {
        profileNames = (r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
      }
    }
    const signedInNames = SESSION_COOKIES.filter((n) => profileNames.includes(n));
    const googleSession = signedInNames.length > 0 || seeded;
    const allNames = [...new Set([...profileNames, ...seededNames])];
    res.json({
      success: true,
      profileExists,
      googleSession,
      signedInNames,
      seeded,
      via: signedInNames.length > 0 ? 'profile' : (seeded ? 'oauth-seed' : 'none'),
      hasGaps: allNames.includes('__Host-GAPS'),
      cookieCount: allNames.length,
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── One-time interactive login session (Google OAuth) ────────────────
// The app renders a live remote view of the persistent browser profile so
// the user can sign in with Google ONCE. The resulting session cookies are
// saved into .pwprofile and reused by every future auto-fill run.
let loginSession = null;

app.post('/login/session/open', async (req, res) => {
  try {
    const userId = req.userCtx?.userId;
    const userDir = req.userCtx?.userDir || __dirname;
    const url = (req.body || {}).url;
    if (!userId) return res.status(400).json({ error: 'X-User-Id header required' });

    if (loginSession) {
      try { loginSession.proc?.kill(); } catch {}
      loginSession = null;
    }

    const port = 18000 + Math.floor(Math.random() * 30000);
    const scriptArgs = [join(__dirname, 'login-session.mjs'), '--port', String(port), '--user-dir', userDir];
    if (url) scriptArgs.push('--url', url);
    if (userId) scriptArgs.push('--email', userId);

    const proc = spawn('node', scriptArgs, {
      cwd: userDir,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let procError = '';
    proc.stderr.on('data', (d) => { procError += d; });
    proc.on('exit', (code) => {
      if (loginSession && loginSession.proc === proc) loginSession = null;
    });

    loginSession = { port, proc, userId, startedAt: Date.now() };

    // Wait for the script to announce its listening port.
    const started = await new Promise((resolve) => {
      let buf = '';
      const to = setTimeout(() => resolve(false), 25000);
      proc.stdout.on('data', (d) => {
        buf += d;
        const m = buf.match(/LOGIN_SESSION_PORT:(\d+)/);
        if (m) { clearTimeout(to); resolve(true); }
        if (/RESULT:/i.test(buf)) { clearTimeout(to); resolve(true); }
      });
      proc.on('exit', () => { clearTimeout(to); resolve(false); });
    });

    if (!started) {
      try { proc.kill(); } catch {}
      loginSession = null;
      return res.json({ success: false, error: procError || 'Browser session failed to start' });
    }
    res.json({ success: true, port });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/login/session/state', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/state`, { signal: AbortSignal.timeout(15000) });
    const data = await r.json();
    res.json({ success: true, ...data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/login/session/tap', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/tap`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}), signal: AbortSignal.timeout(15000),
    });
    res.json({ success: true, ...await r.json() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/login/session/type', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/type`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}), signal: AbortSignal.timeout(15000),
    });
    res.json({ success: true, ...await r.json() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/login/session/navigate', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/navigate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}), signal: AbortSignal.timeout(50000),
    });
    res.json({ success: true, ...await r.json() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/login/session/back', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/back`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(30000),
    });
    res.json({ success: true, ...await r.json() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/login/session/account', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/account`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}), signal: AbortSignal.timeout(20000),
    });
    res.json({ success: true, ...await r.json() });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/login/session/finish', async (req, res) => {
  try {
    if (!loginSession) return res.json({ success: false, error: 'No active session' });
    const r = await fetch(`http://127.0.0.1:${loginSession.port}/finish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(20000),
    });
    const data = await r.json();
    loginSession = null;
    res.json({ success: true, ...data });
  } catch (e) {
    loginSession = null;
    res.json({ success: false, error: e.message });
  }
});

// ── Google session cookie seeding ────────────────────────────────────
// The user's single Google login in the app's WebView leaves real browser
// session cookies. The app extracts them (CookieManager) and POSTs them here,
// so every Playwright run (login-session.mjs + apply-job.mjs) can seed them —
// portals then recognise the user without a second login. Stored per-user at
// <userDir>/google-cookies.json, read by seed-cookies.mjs.
const GOOGLE_COOKIE_DOMAINS = new Map([
  // __Host-* cookies are host-only on accounts.google.com.
  ['__Host-GAPS', 'accounts.google.com'],
  ['__Host-3PLSID', 'accounts.google.com'],
]);

function parseGoogleCookieString(cookieString) {
  const out = [];
  if (!cookieString || typeof cookieString !== 'string') return out;
  for (const pair of cookieString.split(/;\s*/)) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name || !value) continue;
    const hostOnly = name.startsWith('__Host-');
    out.push({
      name,
      value,
      domain: GOOGLE_COOKIE_DOMAINS.get(name) || (hostOnly ? 'accounts.google.com' : '.google.com'),
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    });
  }
  return out;
}

app.post('/login/session/seed', (req, res) => {
  try {
    const body = req.body || {};
    const raw = body.cookieString || body.cookies || '';
    const rawLen = typeof raw === 'string' ? raw.length : (Array.isArray(raw) ? raw.length : -1);
    console.log(`[seed] request userId=${req.userCtx?.userId || 'MISSING'} rawLen=${rawLen}`);
    // Cookies must land in the right user's dir — never fall back to root.
    if (!req.userCtx?.userId || !req.userCtx?.userDir) {
      console.log(`[seed] REJECTED missing X-User-Id (rawLen=${rawLen})`);
      return res.status(400).json({ success: false, error: 'X-User-Id header required' });
    }
    const userDir = req.userCtx.userDir;
    const cookies = typeof raw === 'string' ? parseGoogleCookieString(raw) : raw;
    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log(`[seed] REJECTED no parseable cookies (userId=${req.userCtx.userId} rawLen=${rawLen})`);
      return res.json({ success: false, error: 'no google cookies provided', count: 0 });
    }
    const target = join(userDir, 'google-cookies.json');
    writeFileSync(target, JSON.stringify({ cookies, updatedAt: new Date().toISOString() }, null, 2));
    console.log(`[seed] userId=${req.userCtx.userId} count=${cookies.length} → ${target}`);
    res.json({ success: true, count: cookies.length, file: target });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /email/send-confirm — Send email after user confirmation ───
app.post('/email/send-confirm', async (req, res) => {
  try {
    const { to, subject, body, company, role } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'to and body required' });

    const userId = req.userCtx?.userId;
    const userOAuth = userId ? getUserOAuth(userId) : null;
    const hasUserOAuth2 = hasUsableOAuth(userOAuth);
    const hasLegacyOAuth2 = process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    const userEmail = userOAuth?.userEmail || process.env.GMAIL_USER;

    if (!userEmail || (!hasUserOAuth2 && !hasLegacyOAuth2)) {
      return res.status(400).json({ error: 'No email auth configured' });
    }

    let accessToken;
    if (hasUserOAuth2) {
      accessToken = userOAuth.accessToken;
      if (!accessToken || (userOAuth.expiresAt && Date.now() > userOAuth.expiresAt - 300000)) {
        const tokenResp = await fetch(GMAIL_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: userOAuth.clientId, client_secret: userOAuth.clientSecret,
            refresh_token: userOAuth.refreshToken, grant_type: 'refresh_token',
          }),
        });
        if (!tokenResp.ok) return res.status(500).json({ error: 'Token refresh failed' });
        const td = await tokenResp.json();
        accessToken = td.access_token;
        userOAuth.accessToken = accessToken;
        userOAuth.expiresAt = td.expires_in ? Date.now() + td.expires_in * 1000 : 0;
        setUserOAuth(userId, userOAuth);
      }
    } else {
      accessToken = await getGmailAccessToken();
    }

    // Build RFC 2822 message
    const lines = [
      `From: ${userEmail}`,
      `To: ${to}`,
      `Subject: ${subject || `Application for ${role || 'Unknown Role'} at ${company || 'Unknown Company'}`}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      '',
      body,
    ];
    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });

    if (!sendResp.ok) {
      const err = await sendResp.text();
      return res.status(500).json({ error: `Gmail send failed: ${sendResp.status}` });
    }

    const sent = await sendResp.json();
    res.json({ success: true, messageId: sent.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /scheduler/status — Check scheduler state (per-user) ────────────
app.get('/scheduler/status', (req, res) => {
  let userDir = req.userCtx?.userDir || __dirname;
  const checkpointPath = join(userDir, 'data', '.scheduler-checkpoint.json');
  const cp = {};
  try {
    if (existsSync(checkpointPath)) {
      Object.assign(cp, JSON.parse(readFileSync(checkpointPath, 'utf-8')));
    }
  } catch {}
  res.json({
    status: 'running',
    userId: req.userCtx?.userId || 'legacy',
    lastScan: cp.lastScan || null,
    lastTriage: cp.lastTriage || null,
    lastEvaluate: cp.lastEvaluate || null,
    lastFollowup: cp.lastFollowup || null,
    lastAdapt: cp.lastAdapt || null,
    todayAppsSent: (cp.dailyApps && cp.dailyApps[new Date().toISOString().slice(0, 10)]) || 0,
  });
});

// ── POST /notifications/check — Check for new opportunities/replies ──
app.post('/notifications/check', async (req, res) => {
  try {
    const userId = req.userCtx?.userId;
    const userDir = req.userCtx?.userDir || __dirname;
    const notifications = [];

    // Check inbox for new recruiter emails
    try {
      const inboxResp = await fetch(`http://127.0.0.1:8787/email/inbox?daysBack=1&maxEmails=10`, {
        headers: userId ? { 'X-User-Id': userId } : {},
      });
      if (inboxResp.ok) {
        const inboxData = await inboxResp.json();
        for (const email of (inboxData.emails || [])) {
          const subj = (email.subject || '').toLowerCase();
          const body = (email.body || email.preview || '').toLowerCase();
          const fromL = (email.fromEmail || email.from || '').toLowerCase();
          const digestFrom = ['naukri', 'indeed', 'linkedin', 'glassdoor', 'monster', 'hirist', 'quora', 'buzzfeed', 'medium', 'substack', 'newsletter', 'digest', 'no-reply', 'noreply', 'updates@', 'donotreply'];
          if (digestFrom.some(d => fromL.includes(d))) continue;

          if (/interview|schedule|meeting/i.test(subj) || /schedule|availability/i.test(body)) {
            const dt = extractInterviewDateTime(email.subject, email.body || email.preview);
            const when = dt ? `\n**When:** ${dt.human}` : '';
            notifications.push({
              type: 'interview',
              title: 'Interview Scheduled',
              message: `${email.from}: ${email.subject}${when}`,
              email,
              scheduledAt: dt ? dt.iso : null,
              scheduledHuman: dt ? dt.human : null,
            });

            // Persist to interviews.json for reminders
            try {
              const interviews = loadInterviews(req);
              const key = `${email.fromEmail || email.from || ''}|${(email.subject || '').slice(0, 60)}`;
              let rec = interviews.find(i => i.key === key);
              if (!rec) {
                rec = {
                  key,
                  id: email.gmailId || String(Date.now()),
                  from: email.from || '',
                  subject: email.subject || '',
                  detectedAt: new Date().toISOString(),
                  reminderSentAt: null,
                  status: 'scheduled',
                };
                interviews.push(rec);
              }
              if (dt) {
                rec.scheduledAt = dt.iso;
                rec.scheduledHuman = dt.human;
                rec.date = dt.date;
                rec.time = dt.time;
                rec.confidence = dt.confidence;
              }
              saveInterviews(req, interviews);
            } catch { /* persist non-fatal */ }
          } else if (/recruiter|hiring|your application|opportunity/i.test(subj) ||
                     /resume|application|profile|position/i.test(body)) {
            notifications.push({
              type: 'recruiter_reply',
              title: 'Recruiter Reply',
              message: `${email.from}: ${email.subject}`,
              email,
            });
          } else if (/offer|congratulations|pleased to inform/i.test(subj)) {
            notifications.push({
              type: 'offer',
              title: 'Offer Received!',
              message: `${email.from}: ${email.subject}`,
              email,
            });
          }
        }
      }
    } catch { /* inbox check failed — non-fatal */ }

    // Emit reminders for scheduled interviews coming up (dedup via reminderSentAt)
    try {
      const interviews = loadInterviews(req);
      const now = Date.now();
      let changed = false;
      for (const rec of interviews) {
        if (rec.status !== 'scheduled' || !rec.scheduledAt) continue;
        const schedMs = new Date(rec.scheduledAt).getTime();
        const diffH = Math.round((schedMs - now) / 3600000);
        // Remind once when within 24h of the interview (or already past within the day)
        if (diffH <= 24 && diffH > -24) {
          if (!rec.reminderSentAt) {
            rec.reminderSentAt = new Date().toISOString();
            changed = true;
            const when = diffH < 0
              ? `happened ${Math.abs(diffH)}h ago`
              : diffH <= 1 ? `in about ${Math.max(diffH, 0)}h` : `in ${diffH}h`;
            notifications.push({
              type: 'interview_reminder',
              title: '\u23F0 Interview Reminder',
              message: `${rec.scheduledHuman || ''}\n${rec.from}: ${rec.subject}\n**${when}**`,
              interview: rec,
            });
          }
        }
      }
      if (changed) saveInterviews(req, interviews);
    } catch { /* reminders non-fatal */ }

    // Check tracker for new evaluated jobs
    try {
      const trackerPath = join(userDir, 'data', 'applications.md');
      if (existsSync(trackerPath)) {
        const tracker = readFileSync(trackerPath, 'utf-8');
        const lines = tracker.split('\n');
        const recent = lines.filter(l => {
          if (!l.startsWith('|')) return false;
          const parts = l.split('|').map(p => p.trim());
          const date = parts[1] || '';
          const today = new Date().toISOString().slice(0, 10);
          return date === today;
        });
        if (recent.length > 0) {
          notifications.push({
            type: 'new_opportunities',
            title: `${recent.length} New Jobs Evaluated Today`,
            message: recent.map(l => {
              const parts = l.split('|').map(p => p.trim());
              return `${parts[2]} - ${parts[3]} (${parts[4]})`;
            }).join('\n'),
          });
        }
      }
    } catch { /* tracker check failed — non-fatal */ }

    res.json({ notifications, count: notifications.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /interview-prep/generate — Generate interview prep ────────
app.post('/interview-prep/generate', async (req, res) => {
  try {
    const { company, role } = req.body;
    if (!company) return res.status(400).json({ error: 'company required' });

    const userDir = req.userCtx?.userDir || __dirname;
    const prompt = `Generate interview preparation for ${company} - ${role || 'Unknown Role'}.

Use web search to research ${company} on Glassdoor (and Blind/Levels.fyi if available):
- Glassdoor overall rating, interview difficulty rating, % of candidates who get an offer
- Real interview questions reported by candidates on Glassdoor (cite each question to Glassdoor)
- Common feedback on the interview process (rounds, timelines, format)
- Pros/cons of working at ${company} reported on Glassdoor

Then produce:
1. Likely technical questions based on the role (label [inferred from JD] vs [sourced from Glassdoor])
2. STAR stories from the candidate's experience
3. Company-specific questions
4. Questions to ask the interviewer
5. Red flags to watch for

Include a "Glassdoor Snapshot" section at the top: rating, interview difficulty, offer rate, and 3-5 real reported interview questions with sources. Do NOT fabricate ratings or questions — if a metric isn't found, say "not found".

Use the candidate's CV and profile for personalized answers.`;

    const result = await runOpencode(prompt, 120000, userDir);
    res.json({ company, role, preparation: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
