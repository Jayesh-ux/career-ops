#!/usr/bin/env node
/**
 * auto-reply-draft.mjs — Scan inbox, classify emails, draft replies for recruiters.
 *
 * Never auto-sends. Drafts are queued for user confirmation.
 *
 * Usage:  node auto-reply-draft.mjs [--user-dir <dir>] [--dry-run]
 *
 * Output: JSON to stdout with classified emails and drafted replies.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
  if (args[i] === '--dry-run') dryRun = true;
}

// Resolve paths
const profilePath = join(userDir, 'config', 'profile.yml');
const cvPath = join(userDir, 'cv.md');
const inboxQueuePath = join(userDir, 'data', 'agent-inbox.md');

// ── Load user profile ───────────────────────────────────────────────

function loadProfile() {
  if (!existsSync(profilePath)) return {};
  try {
    return YAML.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    try { return JSON.parse(readFileSync(profilePath, 'utf-8')); } catch { return {}; }
  }
}

function loadCv() {
  if (!existsSync(cvPath)) return '';
  return readFileSync(cvPath, 'utf-8').slice(0, 4000);
}

// ── Email classification ────────────────────────────────────────────

function classifyEmail(email) {
  const subj = (email.subject || '').toLowerCase();
  const body = (email.body || email.preview || '').toLowerCase();
  const from = (email.fromEmail || '').toLowerCase();

  // Interview scheduling
  if (/interview|schedule|meeting|phone screen|zoom|teams|on-site/i.test(subj) ||
      /schedule|availability|next step/i.test(body)) {
    return 'interview';
  }

  // Offer
  if (/offer|congratulations|pleased to inform|compensation|package/i.test(subj) ||
      /offer letter|join|start date/i.test(body)) {
    return 'offer';
  }

  // Rejection
  if (/reject|unfortunately|not moving forward|decided to pursue other/i.test(subj) ||
      /unfortunately|not selected|other candidates/i.test(body)) {
    return 'rejection';
  }

  // Recruiter reply (application status, next steps, general recruiter communication)
  if (/recruiter|talent.?acquisition|hiring manager|your application/i.test(subj) ||
      /resume|application|profile|opportunity|position|role/i.test(body)) {
    return 'recruiter_reply';
  }

  // Application confirmation
  if (/application.*received|thank you for applying|we.*review.*application/i.test(subj)) {
    return 'application_confirmation';
  }

  // Spam
  if (/unsubscribe|promotion|newsletter|discount|you won|click here|limited time/i.test(subj) ||
      /marketing|sale|offer|subscribe/i.test(body)) {
    return 'spam';
  }

  return 'noise';
}

// ── Reply drafting ──────────────────────────────────────────────────

function draftReply(email, classification, profile) {
  const c = profile.candidate || {};
  const name = c.full_name || 'Candidate';
  const phone = c.phone || '';
  const loc = profile.location?.city || '';

  let replyBody = '';
  let replySubject = `Re: ${email.subject || ''}`;

  switch (classification) {
    case 'interview':
      replyBody = `Dear Hiring Team,\n\nThank you for your invitation. I would be delighted to attend an interview at your earliest convenience. I am available on weekdays, preferably in the afternoon.\n\nPlease let me know if you need any additional information or documents from my side.\n\nLooking forward to speaking with you.\n\nBest regards,\n${name}${phone ? '\n' + phone : ''}`;
      break;

    case 'recruiter_reply':
      replyBody = `Dear Hiring Team,\n\nThank you for reaching out. I am very interested in learning more about this opportunity. Could you please share more details about the role, team, and next steps in the process?\n\nI have attached my resume for your reference.\n\nBest regards,\n${name}${phone ? '\n' + phone : ''}`;
      break;

    case 'application_confirmation':
      // No reply needed for automated confirmations
      return null;

    case 'rejection':
      // Acknowledge gracefully
      replyBody = `Dear Hiring Team,\n\nThank you for letting me know. I appreciate the time you took to review my application. I wish you and the team the best in finding the right candidate.\n\nIf similar roles open up in the future, I would welcome the opportunity to be considered again.\n\nBest regards,\n${name}`;
      break;

    case 'offer':
      replyBody = `Dear Hiring Team,\n\nThank you so much for the offer! I am thrilled about the opportunity. I would like to review the details and get back to you shortly.\n\nCould you please share the offer letter and any relevant documents?\n\nBest regards,\n${name}${phone ? '\n' + phone : ''}`;
      break;

    default:
      return null;
  }

  return { to: email.fromEmail, subject: replySubject, body: replyBody, classification };
}

// ── Queue for user confirmation ─────────────────────────────────────

function queueDraft(draft, profile) {
  if (!draft) return;

  const queueDir = join(userDir, 'data');
  if (!existsSync(queueDir)) mkdirSync(queueDir, { recursive: true });

  const entry = `\n---\n**To:** ${draft.to}\n**Subject:** ${draft.subject}\n**Classification:** ${draft.classification}\n**Date:** ${new Date().toISOString()}\n\n${draft.body}\n\n---\n[DRAFT — awaiting user confirmation]\n`;

  writeFileSync(inboxQueuePath, entry, { flag: 'a' });
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const profile = loadProfile();
  const cv = loadCv();
  const email = profile?.candidate?.email || process.env.GMAIL_USER;

  if (!email) {
    console.log(JSON.stringify({ error: 'No email configured', emails: [], drafts: [] }));
    process.exit(0);
  }

  // Try to fetch emails via bridge server if running
  try {
    const bridgeUrl = 'http://127.0.0.1:8787';
    const resp = await fetch(`${bridgeUrl}/email/inbox?daysBack=7&maxEmails=20`, {
      headers: email ? { 'X-User-Id': email } : {},
    });
    if (!resp.ok) throw new Error(`Bridge returned ${resp.status}`);
    const data = await resp.json();
    const emails = data.emails || [];

    const classified = emails.map(e => ({
      ...e,
      classification: classifyEmail(e),
    }));

    // Draft replies for recruiter emails and interviews
    const drafts = [];
    for (const e of classified) {
      if (['recruiter_reply', 'interview', 'offer', 'rejection'].includes(e.classification)) {
        const draft = draftReply(e, e.classification, profile);
        if (draft && !dryRun) {
          queueDraft(draft, profile);
          drafts.push(draft);
        } else if (draft) {
          drafts.push(draft);
        }
      }
    }

    console.log(JSON.stringify({
      emailsFound: emails.length,
      classifications: {
        interview: classified.filter(e => e.classification === 'interview').length,
        recruiter_reply: classified.filter(e => e.classification === 'recruiter_reply').length,
        rejection: classified.filter(e => e.classification === 'rejection').length,
        offer: classified.filter(e => e.classification === 'offer').length,
        spam: classified.filter(e => e.classification === 'spam').length,
        noise: classified.filter(e => e.classification === 'noise').length,
      },
      draftsQueued: drafts.length,
      drafts,
    }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message, emails: [], drafts: [] }));
  }
}

main();
