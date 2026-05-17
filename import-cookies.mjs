#!/usr/bin/env node
// Headless-friendly alternative to `node login.mjs`.
//
// Use when:
//   - running on a server with no display (xvfb/X11 unavailable)
//   - the QR-scan flow in login.mjs cannot work
//
// How to get the cookie header:
//   1. Log in to xiaohongshu.com on your normal browser (any device with a display)
//   2. Open DevTools (F12) → Network tab → reload the page
//   3. Click any request whose Name is `xiaohongshu.com` (or similar)
//   4. Headers panel → "Request Headers" → find the line starting with `cookie:`
//   5. Copy the entire value after `cookie:`
//
// Then on this machine:
//   echo '<paste cookie value>' | node import-cookies.mjs
//   # or
//   node import-cookies.mjs cookies.txt    # file containing the raw header value
//
// Critical cookies for XHS: `web_session`, `a1`, `webId`. If any are missing,
// the script warns; the scraper will likely still hit `login_expired`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const STORAGE_PATH = 'state/storage.json';
const DOMAIN = '.xiaohongshu.com';

function parseCookieHeader(raw) {
  return raw
    .replace(/^Cookie:\s*/i, '')
    .trim()
    .split(/;\s*/)
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = (eq === -1 ? pair : pair.slice(0, eq)).trim();
      const value = (eq === -1 ? '' : pair.slice(eq + 1)).trim();
      return {
        name,
        value,
        domain: DOMAIN,
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 365 * 86400,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      };
    })
    .filter((c) => c.name);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let raw;
  const arg = process.argv[2];
  if (arg && arg !== '-') {
    raw = readFileSync(arg, 'utf8');
  } else if (process.stdin.isTTY) {
    console.error('Usage:');
    console.error('  echo "<cookie header value>" | node import-cookies.mjs');
    console.error('  node import-cookies.mjs <path-to-file-with-cookie-header>');
    console.error('');
    console.error('Get the cookie header from your browser DevTools (Network → any xhs request → Headers → cookie).');
    process.exit(64);
  } else {
    raw = await readStdin();
  }

  const cookies = parseCookieHeader(raw);
  if (cookies.length === 0) {
    console.error('No cookies parsed. The input should be the cookie header value, e.g.');
    console.error('  a1=...; webId=...; gid=...; web_session=...');
    process.exit(65);
  }

  const storage = { cookies, origins: [] };
  mkdirSync(dirname(STORAGE_PATH), { recursive: true });
  writeFileSync(STORAGE_PATH, JSON.stringify(storage, null, 2), 'utf8');
  console.log(`✅ imported ${cookies.length} cookies → ${STORAGE_PATH}`);

  const got = new Set(cookies.map((c) => c.name));
  const critical = ['web_session', 'a1', 'webId'];
  const missing = critical.filter((k) => !got.has(k));
  if (missing.length) {
    console.error(`⚠️  warning: missing typical XHS cookies: ${missing.join(', ')}`);
    console.error('   the scraper may still see login_expired. Make sure you copied the cookie');
    console.error('   value from a logged-in xiaohongshu.com tab.');
  } else {
    console.log('   contains web_session + a1 + webId ✓');
  }
}

main().catch((err) => {
  console.error(`import-cookies.mjs error: ${err.message}`);
  process.exit(1);
});
