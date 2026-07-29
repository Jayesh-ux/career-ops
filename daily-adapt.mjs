#!/usr/bin/env node
/**
 * daily-adapt.mjs — Daily adaptation: compute metrics, suggest profile changes.
 *
 * Reads tracker data, computes response rates, identifies what's working,
 * and suggests changes to modes/_profile.md. Never auto-modifies — suggests only.
 *
 * Usage:  node daily-adapt.mjs [--user-dir <dir>]
 *
 * Output: JSON to stdout with metrics and suggested changes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
let userDir = process.env.CAREER_OPS || __dirname;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
}

// ── Load tracker ────────────────────────────────────────────────────

function loadTracker() {
  const trackerPath = join(userDir, 'data', 'applications.md');
  if (!existsSync(trackerPath)) return [];

  const content = readFileSync(trackerPath, 'utf-8');
  const lines = content.split('\n');
  const entries = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length < 6) continue;
    if (parts[0] === '#' || parts[0] === '---') continue;

    entries.push({
      num: parseInt(parts[0]) || 0,
      date: parts[1] || '',
      company: parts[2] || '',
      role: parts[3] || '',
      score: parts[4] || '',
      status: parts[5] || '',
      notes: parts[8] || '',
    });
  }

  return entries;
}

// ── Load profile ────────────────────────────────────────────────────

function loadProfile() {
  const profilePath = join(userDir, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return {};
  try {
    const yaml = await import('yaml');
    return yaml.parse(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    try { return JSON.parse(readFileSync(profilePath, 'utf-8')); } catch { return {}; }
  }
}

// ── Compute metrics ─────────────────────────────────────────────────

function computeMetrics(entries) {
  const total = entries.length;
  const byStatus = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  }

  const applied = entries.filter(e => ['Applied', 'Responded', 'Interview'].includes(e.status));
  const responded = entries.filter(e => ['Responded', 'Interview'].includes(e.status));
  const interviews = entries.filter(e => e.status === 'Interview');
  const rejected = entries.filter(e => e.status === 'Rejected');

  const responseRate = applied.length > 0 ? (responded.length / applied.length * 100).toFixed(1) : 0;
  const interviewRate = applied.length > 0 ? (interviews.length / applied.length * 100).toFixed(1) : 0;

  // Score distribution
  const scores = entries.map(e => parseFloat(e.score)).filter(s => !isNaN(s));
  const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 'N/A';

  // Recent activity (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const recent = entries.filter(e => e.date >= weekAgo);
  const recentApplied = recent.filter(e => e.status === 'Applied').length;
  const recentResponded = recent.filter(e => ['Responded', 'Interview'].includes(e.status)).length;

  return {
    total,
    byStatus,
    applied: applied.length,
    responded: responded.length,
    interviews: interviews.length,
    rejected: rejected.length,
    responseRate: parseFloat(responseRate),
    interviewRate: parseFloat(interviewRate),
    avgScore,
    recent: {
      days: 7,
      applied: recentApplied,
      responded: recentResponded,
    },
  };
}

// ── Suggest changes ─────────────────────────────────────────────────

function suggestChanges(metrics, profile) {
  const changes = [];

  // Low response rate
  if (metrics.applied > 10 && metrics.responseRate < 5) {
    changes.push({
      priority: 'high',
      area: 'narrative',
      suggestion: 'Response rate is very low (< 5%). Consider reframing your professional summary to better match job descriptions. Focus on transferable skills and specific projects.',
    });
  }

  // No interviews
  if (metrics.applied > 20 && metrics.interviews === 0) {
    changes.push({
      priority: 'high',
      area: 'strategy',
      suggestion: 'No interviews after 20+ applications. Consider: (1) targeting different companies, (2) adjusting salary expectations, (3) expanding location range, (4) highlighting different skills.',
    });
  }

  // Good response rate
  if (metrics.responseRate > 15) {
    changes.push({
      priority: 'info',
      area: 'narrative',
      suggestion: `Good response rate (${metrics.responseRate}%). Current framing is working — keep emphasizing the skills and experiences that are getting traction.`,
    });
  }

  // Too many rejections
  if (metrics.rejected > metrics.applied * 0.5 && metrics.applied > 5) {
    changes.push({
      priority: 'medium',
      area: 'targeting',
      suggestion: 'High rejection rate. Consider: (1) being more selective about which jobs to apply to, (2) focusing on roles where you meet 80%+ of requirements, (3) tailoring CV more specifically to each role.',
    });
  }

  // Check if applications are too generic
  const roles = metrics.byStatus;
  if (metrics.applied > 10 && metrics.responseRate < 10) {
    changes.push({
      priority: 'medium',
      area: 'cv',
      suggestion: 'Applications may be too generic. Run skill gap analysis on your top 3 target roles and tailor your CV sections to match each one specifically.',
    });
  }

  // Stale applications (no activity in 7 days)
  if (metrics.recent.applied === 0 && metrics.recent.responded === 0) {
    changes.push({
      priority: 'medium',
      area: 'activity',
      suggestion: 'No activity in the last 7 days. Increase application volume or follow up on pending applications.',
    });
  }

  return changes;
}

// ── Main ────────────────────────────────────────────────────────────

function main() {
  const entries = loadTracker();
  const profile = loadProfile();
  const metrics = computeMetrics(entries);
  const changes = suggestChanges(metrics, profile);

  console.log(JSON.stringify({
    metrics,
    changes: changes.map(c => c.suggestion),
    changesDetail: changes,
    timestamp: new Date().toISOString(),
  }, null, 2));
}

main();
