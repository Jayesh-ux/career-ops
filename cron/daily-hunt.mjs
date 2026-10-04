#!/usr/bin/env node
/**
 * daily-hunt.mjs — unattended daily job-hunt run:
 *   scan → triage inbox → auto-follow-up overdue threads → write digest
 *
 * Safe defaults:
 *   - Follow-ups are ONLY sent for applications already in the tracker that
 *     the cadence engine marks urgent/overdue. Fresh ("cold") applications are
 *     NEVER sent automatically — they land in the digest for human review.
 *   - Follow-ups stop automatically when a thread becomes Interview/Offer.
 *   - Everything is logged to follow-ups.md, applications.md, and a daily
 *     digest file. Set AUTO_SEND_FOLLOWUPS=0 to run in triage-only mode.
 *
 * Env:
 *   BRIDGE_URL             default http://127.0.0.1:8787
 *   USER_ID                default hsinghjayesh@gmail.com
 *   FOLLOWUP_MAX_PER_RUN   default 3 (hard cap on follow-up sends per run)
 *   AUTO_SEND_FOLLOWUPS    default 1 (0 = draft-only, list what would be sent)
 *   SCAN                   default 1 (run scan too; 0 = inbox+fups only)
 *
 * Cron (IST):  0 8 * * 2-6  node /root/career-ops/cron/daily-hunt.mjs
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
// Support the scheduler's invocation: node cron/daily-hunt.mjs --followups-only --user-dir <dir>
const USER_DIR_ARG = argv.indexOf('--user-dir') !== -1 ? argv[argv.indexOf('--user-dir') + 1] : null;
const FOLLOWUPS_ONLY = argv.includes('--followups-only');
const JOB_URL_SLOT = argv.filter(a => !a.startsWith('--')).find(a => /^https?:\/\//.test(a));
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:8787';
// When invoked by the scheduler with --user-dir, that dir IS the user tree.
const USER_ID = USER_DIR_ARG ? basename(USER_DIR_ARG) : (process.env.USER_ID || 'hsinghjayesh@gmail.com');
const FOLLOWUP_MAX_PER_RUN = Math.max(0, parseInt(process.env.FOLLOWUP_MAX_PER_RUN || '3', 10));
const AUTO_SEND = (process.env.AUTO_SEND_FOLLOWUPS ?? '1') !== '0';
const DO_SCAN = !FOLLOWUPS_ONLY && (process.env.SCAN ?? '1') !== '0';

const USER_DIR = USER_DIR_ARG || join(ROOT, 'data', 'users', USER_ID);
const USER_DATA = join(USER_DIR, 'data');
const USER_APPS = join(USER_DATA, 'applications.md');
const USER_FUPS = join(USER_DATA, 'follow-ups.md');

function api(path, opts = {}) {
  const res = spawnSync('curl', ['-s', '-m', '150'].concat(
    ['-X', opts.method || 'GET'],
    ['-H', `X-User-Id: ${USER_ID}`],
    ...(opts.body ? ['-H', 'Content-Type: application/json', '-d', JSON.stringify(opts.body)] : []),
    [`${BRIDGE}${path}`]
  ), { encoding: 'utf-8', timeout: 180000 });
  if (res.status !== 0) throw new Error(`curl ${path} failed: ${res.stderr || res.error || res.status}`);
  if (!res.stdout.trim()) return null;
  try { return JSON.parse(res.stdout); } catch { return { raw: res.stdout }; }
}

function istNow() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function istWeekday() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date());
}

const log = [];
function note(line) { log.push(line); console.log(line); }

const today = istNow();
const weekday = istWeekday();

export async function main() {
  note(`== Daily hunt ${today} (${weekday} IST) — user ${USER_ID} ==`);

  // ── Phase 0: bridge health ──────────────────────────────────────────
  try {
    const h = api('/health');
    note(`bridge: ${h?.status === 'ok' ? 'up' : 'UNKNOWN ' + JSON.stringify(h)}`);
  } catch (e) {
    note(`bridge DOWN (${e.message}) — attempting restart`);
    const r = spawnSync('bash', ['-lc', `cd ${ROOT} && (nohup node bridge-server.mjs >/tmp/bridge.log 2>&1 &) && sleep 3 && curl -s -m 10 ${BRIDGE}/health`], { encoding: 'utf-8', timeout: 30000 });
    note(`restart: ${(r.stdout || '').trim() || 'in progress'}`);
  }

  // ── Phase 1: portal scan (zero-token, location-filtered) ────────────
  if (DO_SCAN) {
    try {
      const r = spawnSync('node', ['scan.mjs'], { cwd: ROOT, encoding: 'utf-8', timeout: 8 * 60 * 1000, env: { ...process.env, FORCE_COLOR: '0' } });
      const found = (r.stdout || '').match(/Total jobs found:\s+(\d+)/);
      const added = (r.stdout || '').match(/New offers added:\s+(\d+)/);
      note(`scan: ${found ? found[1] : '?'} jobs, ${added ? added[1] : '0'} new in-zone offers`);
    } catch (e) {
      note(`scan failed: ${e.message}`);
    }
  }

  // ── Phase 2: inbox triage (read-only; updates tracker statuses) ─────
  // Only recruiter replies to OUR applied threads matter. Job-board alerts
  // (indeed/linkedin/internshala/shine/jobrapido/bebee) are noise even though
  // they trip the generic classifier — filter them out by sender domain.
  const ALERT_DOMAINS = /(indeed|linkedin|internshala|shine|jobrapido|bebee|hirist|naukri|foundit|timesjobs|monster|cutshort|apna|instahyre|unstop|updates\.evernote|news\.|academia)/i;
  let triage = { interview: [], offer: [], rejection: [], recruiter_reply: [] };
  try {
    const t = await api('/email/triage', { method: 'POST', body: { daysBack: 3, maxEmails: 80 } });
    if (t?.emails) {
      for (const e of t.emails) {
        const c = e.classification;
        if (c !== 'interview' && c !== 'offer' && c !== 'rejection' && c !== 'recruiter_reply') continue;
        const sender = `${e.fromEmail || ''} ${e.from || ''}`;
        if (sender.includes(USER_ID)) continue;                      // skip our own sent mail
        if (ALERT_DOMAINS.test(`${sender} ${e.subject || ''}`)) continue;
        if (!triage[c]) triage[c] = [];
        triage[c].push(`${e.fromEmail || e.from}${e.subject ? ' | ' + e.subject : ''}`.slice(0, 120));
      }
      note(`triage: real recruiter signals after alert-filter (interview=${triage.interview.length}, offer=${triage.offer.length}, rejection=${triage.rejection.length}, recruiter=${triage.recruiter_reply.length})`);
    }
  } catch (e) { note(`triage failed: ${e.message}`); }

  // ── Phase 3: follow-up cadence + auto-send ──────────────────────────
  let followups = { sent: [], skipped: [], would_send: [] };
  try {
    const fu = await api('/followups');
    const actionable = fu?.entries || [];
    // Auto-follow-up rule (user intent: "follow up until interviews scheduled"):
    //   - applied / responded threads when cadence is overdue/urgent → follow up
    //   - interview threads only when STALLED >3 days past nextFollowupDate AND
    //     the notes record a promised next step the recruiter hasn't delivered.
    //     Fresh interviews (interview happening now) are never nagged.
    const maxFups = fu?.cadenceConfig?.applied_max_followups ?? 2;
    const due = actionable.filter(e => {
      if (e.status === 'offer' || e.status === 'rejected') return false;
      if (!e.nextFollowupDate || e.nextFollowupDate > today) return false;
      if (e.status === 'interview') {
        const stalls = (e.notes || '').match(/\b(assessment|assignment|task|round|test|review|update|next step)\b/i);
        if (!stalls) return false;
        // Don't re-nag a stalled interview more than once per
        // responded_subsequent cadence: skip if we already followed up
        // within the last 3 days (e.daysSinceLastFollowup from the cadence).
        if (e.daysSinceLastFollowup !== null && e.daysSinceLastFollowup < 3) return false;
        return e.daysUntilNext !== null ? e.daysUntilNext <= -3 : false;
      }
      return (e.urgency === 'overdue' || e.urgency === 'urgent');
    });
    note(`followups: ${due.length} due (${actionable.length} actionable)`);

    // Prioritize the warmest threads for the daily cap: stalled-interview >
    // responded > applied, then most overdue first. So a recruiter who owes a
    // promised assessment (EloVient-type) never loses the cap to cold leads.
    const prio = s => s === 'interview' ? 0 : s === 'responded' ? 1 : 2;
    due.sort((a, b) => {
      const p = prio(a.status) - prio(b.status);
      if (p !== 0) return p;
      // Within a status tier, nag the FRESHEST due thread first ("warmest") —
      // nextFollowupDate DESC = closest to today goes first, so ancient stale
      // leads (>30d) never eat the daily cap in front of a just-due one.
      return (b.nextFollowupDate || '').localeCompare(a.nextFollowupDate || '');
    });

    const skipped = [];
    const runSends = [];
    for (const e of due) {
      if (runSends.length >= FOLLOWUP_MAX_PER_RUN) { skipped.push('per-run cap reached'); break; }
      const contact = e.contacts?.[0]?.email || (e.notes && (e.notes.match(/[\w.-]+@[\w.-]+\.\w+/) || [])[0]);
      if (!contact) { skipped.push(`${e.num} ${e.company}: no contact email`); continue; }
      if (e.followupCount >= maxFups) { skipped.push(`${e.num} ${e.company}: maxed follow-ups`); continue; }

      const draft = await api('/followup/draft', {
        method: 'POST',
        body: { company: e.company, role: e.role, followupCount: e.followupCount, contactEmail: contact, appliedDate: e.appliedDate },
      });
      if (!draft?.body) { skipped.push(`${e.num} ${e.company}: draft failed (${draft?.error || draft?.raw?.slice(0, 80) || 'no body'})`); continue; }

      if (AUTO_SEND) {
        const sent = await api('/email/reply/send', {
          method: 'POST',
          body: {
            to: contact,
            subject: draft.subject || `Re: Application for ${e.role} at ${e.company}`,
            body: draft.body,
            inReplyTo: null,
            threadId: null,
          },
        });
        const ok = sent?.success || sent?.messageId;
        runSends.push({ num: e.num, company: e.company, contact, ok: !!ok, detail: sent });
        if (ok) {
          followups.sent.push(`${e.num} ${e.company} -> ${contact}`);
          // record ONLY on successful send so cadence advances honestly
          appendToFollowupsMd(e, contact, draft.subject || actionLabel('sent'));
        } else {
          followups.skipped.push(`${e.num} ${e.company}: send failed (${sent?.error || sent?.raw?.slice(0, 120) || 'unknown'})`);
        }
      } else {
        followups.would_send.push(`${e.num} ${e.company} -> ${contact}`);
        runSends.push({ num: e.num, company: e.company, contact, ok: false, detail: { draft: true } });
      }
    }
    note(`followups sent: ${followups.sent.length}${AUTO_SEND ? '' : ' (DRY RUN — drafts only, AUTO_SEND=0 → no emails sent)'}`);
    if (followups.sent.length) note(`  ${followups.sent.join('\n  ')}`);
    if (followups.would_send.length) note(`  would send on next auto run:\n  ${followups.would_send.join('\n  ')}`);
    if (skipped.length) note(`  skipped: ${skipped.length} (${skipped.slice(0, 8).join('; ')}${skipped.length > 8 ? '; …' : ''})`);
  } catch (e) { note(`followups failed: ${e.message}`); }

  // ── Phase 4: digest ─────────────────────────────────────────────────
  const digestLines = [
    `# Daily Hunt — ${today} (${weekday})`,
    ``,
    `## Scan`,
    `Ran on the ${today} IST cadence. See \`data/pipeline.md\` for new in-zone offers not yet evaluated.`,
    ``,
    `## Inbox triage`,
    JSON.stringify(triage, null, 2),
    ``,
    `## Follow-ups`,
    `Sent: ${followups.sent.length}`,
    ...(followups.sent.length ? [``, `- ${followups.sent.join(`\n- `)}`] : []),
    `Skipped: ${followups.skipped.length}`,
    `Maxed/no-contact/interview: (see run log)`,
    ``,
    `## Actions`,
    `- Review new in-zone offers in \`pipeline.md\` and evaluate the fresh ones.`,
    `- Follow the threads listed above; if any reply lands, update statuses.`,
    ``,
  ].join('\n');
  mkdirSync(join(USER_DATA, 'hunt-digests'), { recursive: true });
  writeFileSync(join(USER_DATA, 'hunt-digests', `${today}.md`), digestLines);
  note(`digest written to hunt-digests/${today}.md`);

  const runLog = log.join('\n');
  appendFileSync(join(USER_DATA, 'hunt-digests', 'runs.log'), `\n## ${today} ${weekday}\n${runLog}\n`);
  return runLog;
}

function actionLabel(s) { return s; }

function appendToFollowupsMd(e, contact, subject) {
  if (!existsSync(USER_FUPS)) {
    writeFileSync(USER_FUPS, `# Follow-ups\n\n| # | App | Date | Company | Role | Channel | Contact | Notes |\n|---|-----|------|---------|------|---------|---------|-------|\n`);
  }
  const prior = readFileSync(USER_FUPS, 'utf-8');
  const nextNum = (prior.match(/^\|\s*(\d+)\s*\|/gm) || []).reduce((m, L) => Math.max(m, parseInt(L.match(/\d+/)[0], 10) || 0), 0) + 1;
  appendFileSync(USER_FUPS, `| ${nextNum} | ${e.num} | ${today} | ${e.company.replace(/\|/g, '/')} | ${e.role.replace(/\|/g, '/')} | email | ${contact} | ${subject ? subject.replace(/\|/g, '/') : 'Follow-up sent'} |\n`);
}

// Allow `node cron/daily-hunt.mjs` and `import` usage
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(code => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}