#!/usr/bin/env node
/**
 * evaluate-url.mjs — Auto-evaluate a job URL via the running bridge.
 *
 * The bridge's /auto-pipeline fetches the JD, delegates scoring to opencode
 * (the career-ops agent, which reads cv.md + config/profile.yml), writes an
 * evaluation report, and adds a "Evaluated" tracker row. This wrapper applies
 * the career-ops quality gate (score >= 4.0) and prints a JSON summary so the
 * scheduler's 06:05 auto-evaluate step can pick qualifying jobs.
 *
 * Usage:
 *   node evaluate-url.mjs <url> --user-dir <userDir>
 *
 * Output (JSON on stdout):
 *   {"score":"4.2","company":"...","role":"...","fit":"...","qualifying":true,...}
 *
 * Exit codes: 0 = evaluated (score printed), 1 = failed to evaluate.
 */
import { basename } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//i.test(a));
let userDir = process.env.CAREER_OPS || __dirname;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--user-dir' && args[i + 1]) userDir = args[++i];
}
if (!url) {
  console.error('usage: node evaluate-url.mjs <url> [--user-dir <dir>]');
  process.exit(1);
}

const userId = basename(userDir);
const bridgeUrl = process.env.BRIDGE_URL || 'http://127.0.0.1:8787';

async function main() {
  const resp = await fetch(`${bridgeUrl}/auto-pipeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: JSON.stringify({ url, company: null, role: null }),
  });
  if (!resp.ok) {
    throw new Error(`bridge /auto-pipeline failed: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const score = parseFloat(String(data.score || 'NaN'));
  const qualifying = !Number.isNaN(score) && score >= 4.0;
  console.log(JSON.stringify({ ...data, qualifying }));
}

main().catch((e) => {
  console.error(`[evaluate-url] ${e.message}`);
  process.exit(1);
});
