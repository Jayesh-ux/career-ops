#!/usr/bin/env node
/**
 * seed-cookies.mjs — shared Google-session seeding + stealth for Playwright.
 *
 * After the user signs in with Google ONCE in the app's WebView, the app posts
 * the accounts.google.com session cookies to the bridge (/login/session/seed),
 * which stores them per-user at <userDir>/google-cookies.json.
 *
 * Every Playwright launch (login-session.mjs, apply-job.mjs) calls
 * seedGoogleCookies() right after creating the context, so portals recognise
 * the user's Google session automatically — no second login required.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const GOOGLE_COOKIES_FILE = 'google-cookies.json';

export function googleCookiesPath(userDir) {
  return join(userDir, GOOGLE_COOKIES_FILE);
}

export function loadGoogleCookies(userDir) {
  try {
    const p = googleCookiesPath(userDir);
    if (!existsSync(p)) return [];
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.cookies)) return data.cookies;
    return [];
  } catch {
    return [];
  }
}

export async function seedGoogleCookies(context, userDir) {
  const cookies = loadGoogleCookies(userDir);
  if (!cookies.length) return 0;
  try {
    await context.addCookies(cookies);
    return cookies.length;
  } catch {
    return 0;
  }
}

export function stealthInitScript() {
  return `(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch {}
    try { if (!window.chrome) window.chrome = { runtime: {} }; } catch {}
    try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch {}
    try { Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] }); } catch {}
    try {
      const origQuery = window.navigator.permissions && window.navigator.permissions.query;
      if (origQuery) {
        window.navigator.permissions.query = (parameters) =>
          parameters && parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : origQuery(parameters);
      }
    } catch {}
  })();`;
}
