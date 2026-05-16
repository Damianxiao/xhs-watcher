# xhs-watcher MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js + Playwright tool that scrapes Xiaohongshu for posts about a configured keyword (default `claude code`), uses an LLM (via `/loop` in Claude Code) to filter "information asymmetry" signals, and broadcasts the result to the terminal and a Telegram channel — every 6 hours.

**Architecture:** Three-stage pipeline. `scrape.mjs` (Playwright) produces deterministic JSON of fresh posts. `/loop` LLM applies the signal filter from `watcher.yml`. `notify.mjs` renders Markdown for terminal + HTML for Telegram. State (login cookies, seen IDs, lock) lives in `state/` (gitignored).

**Tech Stack:** Node.js 20+ (ESM), Playwright (chromium), `js-yaml`, `dotenv`, Node's built-in `node:test` (no test framework dependency).

**Reference spec:** `DESIGN.md` in repo root — read it first.

**Working directory:** `/home/damian/xhs-watcher` (a standalone git repo, not the Taberna repo).

---

## File Plan

```
xhs-watcher/
├── package.json              # Task 1
├── watcher.yml               # Task 13
├── LOOP_PROMPT.md            # Task 13
├── scrape.mjs                # Task 12
├── login.mjs                 # Task 10
├── notify.mjs                # Task 9
├── lib/
│   ├── time-parser.mjs       # Task 2
│   ├── seen.mjs              # Task 3
│   ├── config.mjs            # Task 4
│   ├── lock.mjs              # Task 5
│   ├── selectors.mjs         # Task 11 (XHS DOM selectors, kept separate for easy patching)
│   ├── tg.mjs                # Task 6
│   └── render.mjs            # Tasks 7 + 8
├── tests/
│   ├── time-parser.test.mjs  # Task 2
│   ├── seen.test.mjs         # Task 3
│   ├── config.test.mjs       # Task 4
│   ├── lock.test.mjs         # Task 5
│   ├── tg.test.mjs           # Task 6
│   ├── render-terminal.test.mjs # Task 7
│   ├── render-tg.test.mjs    # Task 8
│   └── fixtures/
│       ├── seen.json
│       └── broadcast.json
├── docs/plans/2026-05-16-xhs-watcher-mvp.md   # this file
├── DESIGN.md                 # already exists
├── README.md                 # already exists, refined in Task 13
├── .gitignore                # already exists
├── .env.example              # already exists
├── LICENSE                   # already exists (MIT)
└── state/.gitkeep            # already exists
```

Each file has one clear responsibility. `lib/selectors.mjs` is intentionally separate so when XHS changes their DOM (which they will), the patch lives in one file.

---

## Task 1: Project setup

**Files:**
- Create: `package.json`
- Create: `.nvmrc`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "xhs-watcher",
  "version": "0.1.0",
  "description": "Periodic Xiaohongshu keyword watcher that filters info-asymmetry signals via LLM and broadcasts to terminal + Telegram.",
  "type": "module",
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "test": "node --test tests/",
    "test:watch": "node --test --watch tests/",
    "scrape": "node scrape.mjs",
    "notify": "node notify.mjs",
    "login": "node login.mjs"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "js-yaml": "^4.1.0",
    "playwright": "^1.45.0"
  }
}
```

- [ ] **Step 2: Create .nvmrc**

```
20
```

- [ ] **Step 3: Install dependencies**

Run: `cd /home/damian/xhs-watcher && npm install`
Expected: `node_modules/` populated, no errors. `playwright` is installed but chromium binary not yet — that comes in Task 10.

- [ ] **Step 4: Verify test runner works**

Run: `cd /home/damian/xhs-watcher && node --test tests/ 2>&1 | head -5`
Expected: `tests/` not found warning OR "ok" with 0 tests. Either is fine — we'll add tests in next tasks.

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add package.json package-lock.json .nvmrc
git commit -m "chore: package.json and node version pin"
```

---

## Task 2: `lib/time-parser.mjs` — XHS relative timestamp parser

**Files:**
- Create: `lib/time-parser.mjs`
- Create: `tests/time-parser.test.mjs`

XHS displays post times as `"X 分钟前"`, `"X 小时前"`, `"今天 HH:MM"`, `"昨天 HH:MM"`, or `"YYYY-MM-DD"`. We need to convert these to ISO 8601 absolute timestamps so we can filter by window.

- [ ] **Step 1: Write the failing tests**

Create `tests/time-parser.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXhsRelativeTime } from '../lib/time-parser.mjs';

const NOW = new Date('2026-05-16T14:00:00+08:00');

test('parses "X 分钟前"', () => {
  const result = parseXhsRelativeTime('30 分钟前', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-16T13:30:00+08:00').toISOString());
});

test('parses "X小时前" (no space)', () => {
  const result = parseXhsRelativeTime('4小时前', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-16T10:00:00+08:00').toISOString());
});

test('parses "今天 HH:MM"', () => {
  const result = parseXhsRelativeTime('今天 09:15', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-16T09:15:00+08:00').toISOString());
});

test('parses "昨天 HH:MM"', () => {
  const result = parseXhsRelativeTime('昨天 22:00', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-15T22:00:00+08:00').toISOString());
});

test('parses "YYYY-MM-DD" (absolute)', () => {
  const result = parseXhsRelativeTime('2026-05-10', NOW);
  assert.equal(result.toISOString(), new Date('2026-05-10T00:00:00+08:00').toISOString());
});

test('parses "刚刚"', () => {
  const result = parseXhsRelativeTime('刚刚', NOW);
  assert.equal(result.toISOString(), NOW.toISOString());
});

test('throws on unrecognized format', () => {
  assert.throws(
    () => parseXhsRelativeTime('blah blah', NOW),
    /unrecognized/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/damian/xhs-watcher && node --test tests/time-parser.test.mjs 2>&1`
Expected: Module not found error for `../lib/time-parser.mjs`.

- [ ] **Step 3: Implement `lib/time-parser.mjs`**

```js
// Parse XHS relative-time strings into absolute Date objects.
// XHS server time is China Standard Time (UTC+8); we assume `now` is in that tz.

const PATTERNS = [
  { re: /^刚刚$/, fn: (_, now) => new Date(now) },
  { re: /^(\d+)\s*分钟前$/, fn: (m, now) => new Date(now.getTime() - Number(m[1]) * 60_000) },
  { re: /^(\d+)\s*小时前$/, fn: (m, now) => new Date(now.getTime() - Number(m[1]) * 3600_000) },
  { re: /^今天\s+(\d{1,2}):(\d{2})$/, fn: (m, now) => atSameDate(now, +m[1], +m[2], 0) },
  { re: /^昨天\s+(\d{1,2}):(\d{2})$/, fn: (m, now) => atSameDate(now, +m[1], +m[2], -1) },
  { re: /^(\d{4})-(\d{2})-(\d{2})$/, fn: (m) => new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+08:00`) },
];

function atSameDate(now, hh, mm, dayOffset) {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d;
}

export function parseXhsRelativeTime(input, now = new Date()) {
  const s = String(input).trim();
  for (const { re, fn } of PATTERNS) {
    const m = s.match(re);
    if (m) return fn(m, now);
  }
  throw new Error(`unrecognized XHS time format: "${input}"`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/damian/xhs-watcher && node --test tests/time-parser.test.mjs 2>&1`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/time-parser.mjs tests/time-parser.test.mjs
git commit -m "feat(time-parser): parse XHS relative timestamps to absolute Date"
```

---

## Task 3: `lib/seen.mjs` — `seen.json` read/write + GC

**Files:**
- Create: `lib/seen.mjs`
- Create: `tests/seen.test.mjs`

Manages the dedup state file. Three operations: `load()`, `markSeen(noteId, info)`, `setVerdict(noteId, verdict)`, `gc(maxAgeDays)`, `save()`.

- [ ] **Step 1: Write the failing tests**

Create `tests/seen.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Seen } from '../lib/seen.mjs';

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'seen-'));
}

test('load returns empty state when file missing', () => {
  const dir = makeTmp();
  const seen = Seen.load(join(dir, 'seen.json'));
  assert.deepEqual(seen.noteIds(), []);
  rmSync(dir, { recursive: true });
});

test('markSeen adds new entry', () => {
  const dir = makeTmp();
  const path = join(dir, 'seen.json');
  const seen = Seen.load(path);
  const now = new Date('2026-05-16T14:00:00+08:00');
  seen.markSeen('abc123', { title: 'hello', firstSeen: now });
  assert.equal(seen.has('abc123'), true);
  rmSync(dir, { recursive: true });
});

test('markSeen does not overwrite firstSeen on re-mark', () => {
  const dir = makeTmp();
  const path = join(dir, 'seen.json');
  const seen = Seen.load(path);
  const t1 = new Date('2026-05-14T10:00:00+08:00');
  const t2 = new Date('2026-05-16T14:00:00+08:00');
  seen.markSeen('abc123', { title: 'hello', firstSeen: t1 });
  seen.markSeen('abc123', { title: 'hello', firstSeen: t2 });
  assert.equal(seen.get('abc123').first_seen, t1.toISOString());
  rmSync(dir, { recursive: true });
});

test('setVerdict updates verdict only', () => {
  const dir = makeTmp();
  const path = join(dir, 'seen.json');
  const seen = Seen.load(path);
  seen.markSeen('abc123', { title: 'x', firstSeen: new Date() });
  seen.setVerdict('abc123', 'signal');
  assert.equal(seen.get('abc123').verdict, 'signal');
  rmSync(dir, { recursive: true });
});

test('save and reload preserves state', () => {
  const dir = makeTmp();
  const path = join(dir, 'seen.json');
  const seen = Seen.load(path);
  seen.markSeen('abc123', { title: 'hello', firstSeen: new Date('2026-05-16T14:00:00+08:00') });
  seen.setLastRunAt(new Date('2026-05-16T14:05:00+08:00'));
  seen.save();

  const reloaded = Seen.load(path);
  assert.equal(reloaded.has('abc123'), true);
  assert.equal(reloaded.get('abc123').title, 'hello');
  rmSync(dir, { recursive: true });
});

test('gc removes entries older than maxAgeDays', () => {
  const dir = makeTmp();
  const path = join(dir, 'seen.json');
  const seen = Seen.load(path);
  const old = new Date('2026-04-01T00:00:00+08:00'); // ~45 days before "now"
  const fresh = new Date('2026-05-15T00:00:00+08:00');
  seen.markSeen('old', { title: 'old', firstSeen: old });
  seen.markSeen('fresh', { title: 'fresh', firstSeen: fresh });
  seen.gc(30, new Date('2026-05-16T00:00:00+08:00'));
  assert.equal(seen.has('old'), false);
  assert.equal(seen.has('fresh'), true);
  rmSync(dir, { recursive: true });
});

test('load handles corrupted JSON by resetting', () => {
  const dir = makeTmp();
  const path = join(dir, 'seen.json');
  writeFileSync(path, '{invalid', 'utf8');
  const seen = Seen.load(path);
  assert.deepEqual(seen.noteIds(), []);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/damian/xhs-watcher && node --test tests/seen.test.mjs 2>&1`
Expected: All tests fail with module-not-found.

- [ ] **Step 3: Implement `lib/seen.mjs`**

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;

export class Seen {
  constructor(path, data) {
    this.path = path;
    this.data = data;
  }

  static load(path) {
    if (!existsSync(path)) {
      return new Seen(path, { schema_version: SCHEMA_VERSION, last_run_at: null, notes: {} });
    }
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.notes || typeof parsed.notes !== 'object') throw new Error('bad shape');
      return new Seen(path, {
        schema_version: parsed.schema_version ?? SCHEMA_VERSION,
        last_run_at: parsed.last_run_at ?? null,
        notes: parsed.notes,
      });
    } catch {
      return new Seen(path, { schema_version: SCHEMA_VERSION, last_run_at: null, notes: {} });
    }
  }

  has(noteId) {
    return Object.prototype.hasOwnProperty.call(this.data.notes, noteId);
  }

  get(noteId) {
    return this.data.notes[noteId];
  }

  noteIds() {
    return Object.keys(this.data.notes);
  }

  markSeen(noteId, { title, firstSeen }) {
    if (this.has(noteId)) return; // do not overwrite first_seen
    this.data.notes[noteId] = {
      first_seen: firstSeen.toISOString(),
      title: String(title ?? ''),
      verdict: null,
    };
  }

  setVerdict(noteId, verdict) {
    if (!this.has(noteId)) return;
    this.data.notes[noteId].verdict = verdict;
  }

  setLastRunAt(date) {
    this.data.last_run_at = date.toISOString();
  }

  gc(maxAgeDays, now = new Date()) {
    const cutoff = now.getTime() - maxAgeDays * 86400_000;
    for (const [id, entry] of Object.entries(this.data.notes)) {
      const firstSeenMs = Date.parse(entry.first_seen);
      if (firstSeenMs < cutoff) delete this.data.notes[id];
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/damian/xhs-watcher && node --test tests/seen.test.mjs 2>&1`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/seen.mjs tests/seen.test.mjs
git commit -m "feat(seen): dedup state with GC for note IDs"
```

---

## Task 4: `lib/config.mjs` — load `watcher.yml` + `.env`

**Files:**
- Create: `lib/config.mjs`
- Create: `tests/config.test.mjs`
- Create: `tests/fixtures/watcher.test.yml`

Loads `watcher.yml`, substitutes `{keyword}` into the search URL, and pulls env vars referenced by `*_env` keys.

- [ ] **Step 1: Write the failing tests**

Create `tests/fixtures/watcher.test.yml`:

```yaml
source:
  platform: xiaohongshu
  search_url: "https://example.com/search?q={keyword}"
  keyword: "test keyword"

window:
  hours: 12
  max_posts_per_run: 100

scrape:
  card_delay_ms: [800, 2500]
  detail_wait_ms: 1000

notify:
  terminal:
    enabled: true
  telegram:
    enabled: true
    bot_token_env: TEST_TG_TOKEN
    chat_id_env: TEST_TG_CHAT
```

Create `tests/config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.mjs';

const FIXTURE = new URL('./fixtures/watcher.test.yml', import.meta.url).pathname;

test('loads YAML and substitutes keyword in URL', () => {
  const cfg = loadConfig(FIXTURE);
  assert.equal(cfg.source.resolvedUrl, 'https://example.com/search?q=test%20keyword');
});

test('exposes window settings as numbers', () => {
  const cfg = loadConfig(FIXTURE);
  assert.equal(cfg.window.hours, 12);
  assert.equal(cfg.window.max_posts_per_run, 100);
});

test('resolves TG env vars when set', () => {
  process.env.TEST_TG_TOKEN = 'abc';
  process.env.TEST_TG_CHAT = '@x';
  const cfg = loadConfig(FIXTURE);
  assert.equal(cfg.notify.telegram.bot_token, 'abc');
  assert.equal(cfg.notify.telegram.chat_id, '@x');
  delete process.env.TEST_TG_TOKEN;
  delete process.env.TEST_TG_CHAT;
});

test('telegram resolved values are undefined when env not set', () => {
  delete process.env.TEST_TG_TOKEN;
  delete process.env.TEST_TG_CHAT;
  const cfg = loadConfig(FIXTURE);
  assert.equal(cfg.notify.telegram.bot_token, undefined);
  assert.equal(cfg.notify.telegram.chat_id, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/damian/xhs-watcher && node --test tests/config.test.mjs 2>&1`
Expected: module-not-found.

- [ ] **Step 3: Implement `lib/config.mjs`**

```js
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import 'dotenv/config';

export function loadConfig(path = 'watcher.yml') {
  const raw = readFileSync(path, 'utf8');
  const cfg = yaml.load(raw);

  cfg.source.resolvedUrl = cfg.source.search_url.replace(
    '{keyword}',
    encodeURIComponent(cfg.source.keyword),
  );

  if (cfg.notify?.telegram) {
    const tg = cfg.notify.telegram;
    tg.bot_token = tg.bot_token_env ? process.env[tg.bot_token_env] : undefined;
    tg.chat_id = tg.chat_id_env ? process.env[tg.chat_id_env] : undefined;
  }

  return cfg;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/damian/xhs-watcher && node --test tests/config.test.mjs 2>&1`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/config.mjs tests/config.test.mjs tests/fixtures/watcher.test.yml
git commit -m "feat(config): load watcher.yml and resolve env-backed secrets"
```

---

## Task 5: `lib/lock.mjs` — PID-based lock file

**Files:**
- Create: `lib/lock.mjs`
- Create: `tests/lock.test.mjs`

Implements the single-run guard described in DESIGN §5.2 step 1-2. Uses `process.kill(pid, 0)` to test if a PID is alive without sending a real signal.

- [ ] **Step 1: Write the failing tests**

Create `tests/lock.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock } from '../lib/lock.mjs';

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'lock-'));
}

test('acquireLock succeeds when no lock exists', () => {
  const dir = makeTmp();
  const path = join(dir, '.lock');
  const result = acquireLock(path);
  assert.equal(result.acquired, true);
  assert.equal(existsSync(path), true);
  rmSync(dir, { recursive: true });
});

test('acquireLock fails when lock held by live PID', () => {
  const dir = makeTmp();
  const path = join(dir, '.lock');
  writeFileSync(path, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
  const result = acquireLock(path);
  assert.equal(result.acquired, false);
  assert.equal(result.reason, 'already_running');
  rmSync(dir, { recursive: true });
});

test('acquireLock cleans up stale lock from dead PID', () => {
  const dir = makeTmp();
  const path = join(dir, '.lock');
  // PID 999999 almost certainly does not exist on this system
  writeFileSync(path, JSON.stringify({ pid: 999999, started_at: '2026-01-01T00:00:00+08:00' }));
  const result = acquireLock(path);
  assert.equal(result.acquired, true);
  const newContent = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(newContent.pid, process.pid);
  rmSync(dir, { recursive: true });
});

test('releaseLock removes the file', () => {
  const dir = makeTmp();
  const path = join(dir, '.lock');
  acquireLock(path);
  releaseLock(path);
  assert.equal(existsSync(path), false);
  rmSync(dir, { recursive: true });
});

test('acquireLock handles corrupted lock by treating as stale', () => {
  const dir = makeTmp();
  const path = join(dir, '.lock');
  writeFileSync(path, 'not json');
  const result = acquireLock(path);
  assert.equal(result.acquired, true);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/damian/xhs-watcher && node --test tests/lock.test.mjs 2>&1`
Expected: module-not-found.

- [ ] **Step 3: Implement `lib/lock.mjs`**

```js
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the PID exists but is owned by someone else — also "alive"
    return err.code === 'EPERM';
  }
}

export function acquireLock(path) {
  if (existsSync(path)) {
    let prev = null;
    try {
      prev = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      prev = null;
    }
    if (prev && isPidAlive(prev.pid)) {
      return { acquired: false, reason: 'already_running', holder: prev };
    }
    // stale or corrupted — fall through to overwrite
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return { acquired: true };
}

export function releaseLock(path) {
  if (existsSync(path)) unlinkSync(path);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/damian/xhs-watcher && node --test tests/lock.test.mjs 2>&1`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/lock.mjs tests/lock.test.mjs
git commit -m "feat(lock): PID-based lock with stale recovery"
```

---

## Task 6: `lib/tg.mjs` — Telegram Bot API client

**Files:**
- Create: `lib/tg.mjs`
- Create: `tests/tg.test.mjs`

Single function `sendMessage({ botToken, chatId, text, parseMode })`. Uses native `fetch`. Tests inject a mock fetch.

- [ ] **Step 1: Write the failing tests**

Create `tests/tg.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage } from '../lib/tg.mjs';

test('sends POST to Telegram sendMessage endpoint with correct body', async () => {
  let captured = null;
  const mockFetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body), headers: init.headers };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    };
  };
  const result = await sendMessage(
    { botToken: 'TOKEN', chatId: '@chan', text: 'hi', parseMode: 'HTML' },
    { fetch: mockFetch },
  );
  assert.equal(result.ok, true);
  assert.equal(captured.url, 'https://api.telegram.org/botTOKEN/sendMessage');
  assert.equal(captured.body.chat_id, '@chan');
  assert.equal(captured.body.text, 'hi');
  assert.equal(captured.body.parse_mode, 'HTML');
  assert.equal(captured.body.disable_web_page_preview, false);
});

test('returns ok:false with error description on non-2xx', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ ok: false, description: 'Unauthorized' }),
  });
  const result = await sendMessage(
    { botToken: 'BAD', chatId: '@x', text: 'hi', parseMode: 'HTML' },
    { fetch: mockFetch },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Unauthorized/);
});

test('returns ok:false on network exception', async () => {
  const mockFetch = async () => { throw new Error('ENOTFOUND'); };
  const result = await sendMessage(
    { botToken: 'T', chatId: '@x', text: 'hi', parseMode: 'HTML' },
    { fetch: mockFetch },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /ENOTFOUND/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/damian/xhs-watcher && node --test tests/tg.test.mjs 2>&1`
Expected: module-not-found.

- [ ] **Step 3: Implement `lib/tg.mjs`**

```js
export async function sendMessage(
  { botToken, chatId, text, parseMode = 'HTML' },
  { fetch: fetchImpl = globalThis.fetch } = {},
) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: false,
  };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, messageId: json.result.message_id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendAll(messages, opts, { fetch: fetchImpl, sleepMs = 200, sleep } = {}) {
  const sleeper = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const results = [];
  for (const text of messages) {
    const r = await sendMessage({ ...opts, text }, { fetch: fetchImpl });
    results.push(r);
    if (sleepMs > 0) await sleeper(sleepMs);
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/damian/xhs-watcher && node --test tests/tg.test.mjs 2>&1`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/tg.mjs tests/tg.test.mjs
git commit -m "feat(tg): Telegram Bot API sendMessage client"
```

---

## Task 7: `lib/render.mjs` — terminal Markdown renderer

**Files:**
- Create: `lib/render.mjs`
- Create: `tests/render-terminal.test.mjs`
- Create: `tests/fixtures/broadcast.json`

Renders the broadcast JSON (see DESIGN §7.2) to terminal Markdown (see DESIGN §7.3).

- [ ] **Step 1: Create fixture `tests/fixtures/broadcast.json`**

```json
{
  "broadcast_at": "2026-05-16T14:00:00+08:00",
  "stats": {
    "window_hours": 12,
    "total": 4,
    "new": 4,
    "already_seen": 0,
    "by_verdict": { "signal": 1, "maybe": 0, "known": 1, "ad": 1, "noise": 1 }
  },
  "cards": [
    {
      "note_id": "abc",
      "verdict": "signal",
      "workflow_name": "Skill 化 git worktree",
      "one_liner": "用 PostToolUse hook 自动注入 CLAUDE.md。",
      "key_steps": ["监听 git worktree add", "模板渲染 CLAUDE.md"],
      "applicable": "并行多 agent",
      "verdict_reason": "比 superpowers 多一层上下文",
      "author": "@somebody",
      "published_relative": "4小时前",
      "metrics": { "likes": 234, "collects": 89 },
      "url": "https://www.xiaohongshu.com/explore/abc"
    }
  ],
  "filtered_summary": [
    { "note_id": "k1", "verdict": "known", "title": "又一篇 TDD 入门", "url": "https://x/k1", "author": "@x", "published_relative": "4h" },
    { "note_id": "a1", "verdict": "ad", "title": "三天精通 Claude Code", "url": "https://x/a1", "author": "@y", "published_relative": "3h" },
    { "note_id": "n1", "verdict": "noise", "title": "我用 Claude Code 写了 todo app", "url": "https://x/n1", "author": "@z", "published_relative": "6h" }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/render-terminal.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTerminal } from '../lib/render.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/broadcast.json', import.meta.url), 'utf8'),
);

test('renderTerminal includes header with stats', () => {
  const out = renderTerminal(fixture);
  assert.match(out, /📡 XHS Claude Code 播报/);
  assert.match(out, /扫描窗口 12h/);
  assert.match(out, /信号 1/);
});

test('renderTerminal renders signal cards with all fields', () => {
  const out = renderTerminal(fixture);
  assert.match(out, /🟢 信号 1 — Skill 化 git worktree/);
  assert.match(out, /@somebody · 4小时前 · 赞 234 · 收 89/);
  assert.match(out, /监听 git worktree add/);
  assert.match(out, /并行多 agent/);
  assert.match(out, /比 superpowers 多一层上下文/);
});

test('renderTerminal includes filtered list with details', () => {
  const out = renderTerminal(fixture);
  assert.match(out, /🔘 已知话题 \(1\)/);
  assert.match(out, /📢 广告\/卖课 \(1\)/);
  assert.match(out, /🗑 无干货 \(1\)/);
  assert.match(out, /又一篇 TDD 入门/);
});

test('renderTerminal handles empty broadcast', () => {
  const empty = { ...fixture, stats: { ...fixture.stats, new: 0 }, cards: [], filtered_summary: [] };
  const out = renderTerminal(empty);
  assert.match(out, /窗口无新帖/);
});

test('renderTerminal renders error broadcast', () => {
  const errBcast = { error: 'login_expired', message: 'cookie expired' };
  const out = renderTerminal(errBcast);
  assert.match(out, /⚠️/);
  assert.match(out, /login_expired/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/damian/xhs-watcher && node --test tests/render-terminal.test.mjs 2>&1`
Expected: module-not-found.

- [ ] **Step 4: Implement terminal half of `lib/render.mjs`**

```js
const VERDICT_LABELS = {
  signal: '🟢 信号',
  maybe: '🟡 存疑',
  known: '🔘 已知话题',
  ad: '📢 广告/卖课',
  noise: '🗑 无干货',
};

function formatTimestamp(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function renderTerminal(broadcast) {
  if (broadcast.error) {
    return `⚠️ XHS watcher: ${broadcast.error}${broadcast.message ? ` — ${broadcast.message}` : ''}`;
  }

  const { stats, cards = [], filtered_summary = [] } = broadcast;

  if (stats.new === 0) {
    return `📡 ${formatTimestamp(broadcast.broadcast_at)} · 窗口 ${stats.window_hours}h 无新帖（库存 ${stats.already_seen} 条已扫过）`;
  }

  const lines = [];
  lines.push(`## 📡 XHS Claude Code 播报 — ${formatTimestamp(broadcast.broadcast_at)} CST`);
  lines.push('');
  lines.push(
    `扫描窗口 ${stats.window_hours}h · 命中 ${stats.total} 条 · 新增 ${stats.new} / 已知库 ${stats.already_seen}`,
  );
  const v = stats.by_verdict;
  lines.push(
    `信号 ${v.signal} · 存疑 ${v.maybe} · 已知 ${v.known} · 广告 ${v.ad} · 无干货 ${v.noise}`,
  );
  lines.push('');
  lines.push('---');

  const signalCards = cards.filter((c) => c.verdict === 'signal' || c.verdict === 'maybe');
  signalCards.forEach((c, i) => {
    const idx = i + 1;
    const label = VERDICT_LABELS[c.verdict];
    lines.push('');
    lines.push(`### ${label} ${idx} — ${c.workflow_name}`);
    lines.push(
      `**作者** ${c.author} · ${c.published_relative} · 赞 ${c.metrics?.likes ?? '-'} · 收 ${c.metrics?.collects ?? '-'} · [原帖](${c.url})`,
    );
    lines.push(`**一句话** ${c.one_liner}`);
    if (c.key_steps?.length) {
      lines.push('**关键步骤**');
      for (const s of c.key_steps) lines.push(`- ${s}`);
    }
    if (c.applicable) lines.push(`**适用** ${c.applicable}`);
    if (c.verdict_reason) lines.push(`**我的判断** ${c.verdict_reason}`);
  });

  for (const verdict of ['known', 'ad', 'noise']) {
    const group = filtered_summary.filter((f) => f.verdict === verdict);
    if (group.length === 0) continue;
    lines.push('');
    lines.push(`<details>`);
    lines.push(`<summary>${VERDICT_LABELS[verdict]} (${group.length})</summary>`);
    lines.push('');
    for (const f of group) {
      lines.push(`- ${f.author} · ${f.published_relative} · [${f.title}](${f.url})`);
    }
    lines.push('');
    lines.push(`</details>`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/damian/xhs-watcher && node --test tests/render-terminal.test.mjs 2>&1`
Expected: All 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/render.mjs tests/render-terminal.test.mjs tests/fixtures/broadcast.json
git commit -m "feat(render): terminal Markdown renderer for broadcasts"
```

---

## Task 8: `lib/render.mjs` — Telegram HTML renderer

**Files:**
- Modify: `lib/render.mjs`
- Create: `tests/render-tg.test.mjs`

Adds `renderTelegramMessages(broadcast)` returning `string[]` (one message per signal card, plus a footer message).

- [ ] **Step 1: Write the failing tests**

Create `tests/render-tg.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTelegramMessages } from '../lib/render.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/broadcast.json', import.meta.url), 'utf8'),
);

test('produces one message per signal card plus a footer', () => {
  const msgs = renderTelegramMessages(fixture);
  assert.equal(msgs.length, 2); // 1 signal + footer
  assert.match(msgs[0], /Skill 化 git worktree/);
  assert.match(msgs[1], /xhs-watcher/);
});

test('signal message contains HTML markup', () => {
  const msgs = renderTelegramMessages(fixture);
  assert.match(msgs[0], /<b>🟢 信号 — Skill 化 git worktree<\/b>/);
  assert.match(msgs[0], /<i>用 PostToolUse hook 自动注入 CLAUDE.md。<\/i>/);
  assert.match(msgs[0], /<a href="https:\/\/www\.xiaohongshu\.com\/explore\/abc">/);
});

test('truncates long content with link suffix', () => {
  const long = {
    ...fixture,
    cards: [{ ...fixture.cards[0], one_liner: 'x'.repeat(5000) }],
  };
  const msgs = renderTelegramMessages(long);
  assert.ok(msgs[0].length <= 4000);
  assert.match(msgs[0], /详见原帖/);
});

test('escapes HTML-special chars in user content', () => {
  const danger = {
    ...fixture,
    cards: [{ ...fixture.cards[0], workflow_name: '<script>alert(1)</script>' }],
  };
  const msgs = renderTelegramMessages(danger);
  assert.match(msgs[0], /&lt;script&gt;/);
  assert.doesNotMatch(msgs[0], /<script>alert\(1\)<\/script>/);
});

test('returns empty array when broadcast has error', () => {
  const errBcast = { error: 'login_expired', message: 'x' };
  const msgs = renderTelegramMessages(errBcast);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /⚠️/);
  assert.match(msgs[0], /login_expired/);
});

test('returns single "no new posts" message when stats.new is 0', () => {
  const empty = { ...fixture, stats: { ...fixture.stats, new: 0 }, cards: [], filtered_summary: [] };
  const msgs = renderTelegramMessages(empty);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /窗口无新帖/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/damian/xhs-watcher && node --test tests/render-tg.test.mjs 2>&1`
Expected: export-not-found.

- [ ] **Step 3: Add `renderTelegramMessages` to `lib/render.mjs`**

Append to `lib/render.mjs`:

```js
const TG_MAX = 4000;
const SIGNAL_LABELS_TG = {
  signal: '🟢 信号',
  maybe: '🟡 存疑',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderSignalCardTG(card) {
  const label = SIGNAL_LABELS_TG[card.verdict] ?? card.verdict;
  const url = card.url;
  const parts = [];
  parts.push(`<b>${escapeHtml(label)} — ${escapeHtml(card.workflow_name)}</b>`);
  parts.push('');
  parts.push(`<i>${escapeHtml(card.one_liner)}</i>`);
  if (card.key_steps?.length) {
    parts.push('');
    parts.push('<b>关键步骤</b>');
    for (const s of card.key_steps) parts.push(`• ${escapeHtml(s)}`);
  }
  if (card.applicable) {
    parts.push('');
    parts.push(`<b>适用</b> ${escapeHtml(card.applicable)}`);
  }
  if (card.verdict_reason) {
    parts.push(`<b>判断</b> ${escapeHtml(card.verdict_reason)}`);
  }
  parts.push('');
  const meta = `${escapeHtml(card.author)} · ${escapeHtml(card.published_relative)} · 赞${card.metrics?.likes ?? '-'} · 收${card.metrics?.collects ?? '-'}`;
  parts.push(`<a href="${escapeHtml(url)}">${meta}</a>`);

  let msg = parts.join('\n');
  if (msg.length > TG_MAX) {
    const suffix = `\n\n... <a href="${escapeHtml(url)}">详见原帖</a>`;
    msg = msg.slice(0, TG_MAX - suffix.length) + suffix;
  }
  return msg;
}

function renderFooterTG(broadcast) {
  const s = broadcast.stats;
  const ts = formatTimestamp(broadcast.broadcast_at);
  const filtered = s.by_verdict.known + s.by_verdict.ad + s.by_verdict.noise;
  return `📊 xhs-watcher · ${ts} CST\n窗口 ${s.window_hours}h · 信号 ${s.by_verdict.signal} · 存疑 ${s.by_verdict.maybe} · 已过滤 ${filtered}`;
}

export function renderTelegramMessages(broadcast) {
  if (broadcast.error) {
    return [`⚠️ XHS watcher: ${escapeHtml(broadcast.error)}${broadcast.message ? ` — ${escapeHtml(broadcast.message)}` : ''}`];
  }
  if (broadcast.stats.new === 0) {
    return [`📡 ${formatTimestamp(broadcast.broadcast_at)} · 窗口 ${broadcast.stats.window_hours}h 窗口无新帖`];
  }
  const signalCards = (broadcast.cards ?? []).filter(
    (c) => c.verdict === 'signal' || c.verdict === 'maybe',
  );
  const msgs = signalCards.map(renderSignalCardTG);
  msgs.push(renderFooterTG(broadcast));
  return msgs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/damian/xhs-watcher && node --test tests/render-tg.test.mjs 2>&1`
Expected: All 6 tests pass.

- [ ] **Step 5: Run all tests to ensure nothing regressed**

Run: `cd /home/damian/xhs-watcher && node --test tests/ 2>&1`
Expected: All previous tests still pass + new ones.

- [ ] **Step 6: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/render.mjs tests/render-tg.test.mjs
git commit -m "feat(render): Telegram HTML renderer with HTML-escape and truncation"
```

---

## Task 9: `notify.mjs` — CLI dispatcher

**Files:**
- Create: `notify.mjs`

Reads broadcast JSON from stdin, dispatches to terminal and/or TG depending on flags.

- [ ] **Step 1: Implement `notify.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Seen } from './lib/seen.mjs';
import { loadConfig } from './lib/config.mjs';
import { renderTerminal, renderTelegramMessages } from './lib/render.mjs';
import { sendAll } from './lib/tg.mjs';

function parseArgs(argv) {
  const flags = { terminal: false, tg: false, updateVerdicts: false, dryRun: false };
  for (const a of argv) {
    if (a === '--terminal') flags.terminal = true;
    else if (a === '--tg') flags.tg = true;
    else if (a === '--update-verdicts') flags.updateVerdicts = true;
    else if (a === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const broadcastJson = await readStdin();
  const broadcast = JSON.parse(broadcastJson);

  // Mode A: update verdicts in seen.json
  if (flags.updateVerdicts) {
    const seenPath = 'state/seen.json';
    const seen = Seen.load(seenPath);
    for (const card of broadcast.cards ?? []) {
      if (card.note_id && card.verdict) seen.setVerdict(card.note_id, card.verdict);
    }
    for (const f of broadcast.filtered_summary ?? []) {
      if (f.note_id && f.verdict) seen.setVerdict(f.note_id, f.verdict);
    }
    seen.save();
    console.log(`✓ verdict updated for ${(broadcast.cards?.length ?? 0) + (broadcast.filtered_summary?.length ?? 0)} notes`);
    return;
  }

  // Mode B: render and dispatch
  let tgError = null;
  if (flags.terminal || (!flags.terminal && !flags.tg)) {
    console.log(renderTerminal(broadcast));
  }

  if (flags.tg && cfg.notify?.telegram?.enabled) {
    const msgs = renderTelegramMessages(broadcast);
    if (flags.dryRun) {
      console.log('--- TG dry-run, messages would be sent: ---');
      for (const m of msgs) console.log('---\n' + m);
    } else {
      const tg = cfg.notify.telegram;
      if (!tg.bot_token || !tg.chat_id) {
        tgError = 'TG token or chat_id missing (check .env)';
      } else {
        const results = await sendAll(msgs, {
          botToken: tg.bot_token,
          chatId: tg.chat_id,
          parseMode: tg.parse_mode ?? 'HTML',
        });
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) {
          tgError = failed.map((f) => f.error).join('; ');
        }
      }
    }
  }

  if (tgError) {
    const onFailure = cfg.notify?.telegram?.on_failure ?? 'warn';
    if (onFailure === 'abort') {
      process.stderr.write(`\nTG push failed: ${tgError}\n`);
      process.exit(1);
    } else {
      console.log(`\n⚠️ TG push failed: ${tgError}`);
    }
  }
}

main().catch((err) => {
  console.error(`notify.mjs error: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test with the fixture**

Run:
```bash
cd /home/damian/xhs-watcher
cat tests/fixtures/broadcast.json | node notify.mjs --terminal
```
Expected: Terminal Markdown output containing "🟢 信号 1 — Skill 化 git worktree".

- [ ] **Step 3: Dry-run TG**

Run:
```bash
cd /home/damian/xhs-watcher
cat tests/fixtures/broadcast.json | node notify.mjs --tg --dry-run
```
Note: This requires `watcher.yml` to exist. If Task 13 hasn't been done yet, create a minimal stub first:

```yaml
source: { platform: xiaohongshu, search_url: "https://x?q={keyword}", keyword: "claude code" }
window: { hours: 12, max_posts_per_run: 100 }
scrape: { card_delay_ms: [800, 2500], detail_wait_ms: 1000 }
notify:
  terminal: { enabled: true }
  telegram:
    enabled: true
    bot_token_env: XHS_WATCHER_TG_BOT_TOKEN
    chat_id_env: XHS_WATCHER_TG_CHAT_ID
    parse_mode: HTML
    on_failure: warn
```
Expected: Two messages printed (signal card + footer), neither sent over network.

- [ ] **Step 4: Commit**

```bash
cd /home/damian/xhs-watcher
git add notify.mjs
git commit -m "feat(notify): stdin → terminal + TG dispatcher CLI"
```

---

## Task 10: `login.mjs` — Playwright headed login

**Files:**
- Create: `login.mjs`

Headed Chromium that lets the user scan/log in once and saves storage state.

- [ ] **Step 1: Install Playwright Chromium binary**

Run: `cd /home/damian/xhs-watcher && npx playwright install chromium`
Expected: Chromium downloaded to `~/.cache/ms-playwright/`.

- [ ] **Step 2: Implement `login.mjs`**

```js
#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const STORAGE_PATH = 'state/storage.json';

async function waitForEnter(msg) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(msg);
  rl.close();
}

async function main() {
  console.log('Opening browser. Scan or enter credentials to log in to xiaohongshu.com.');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://www.xiaohongshu.com/');

  console.log('');
  await waitForEnter('登录完成后回到这里按 Enter ▶ ');

  mkdirSync(dirname(STORAGE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
  await browser.close();
  console.log(`✅ 登录态已保存到 ${STORAGE_PATH}`);
}

main().catch((err) => {
  console.error(`login.mjs error: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 3: Manual verification**

Run: `cd /home/damian/xhs-watcher && node login.mjs`
Expected: Chromium window opens to xiaohongshu.com. User logs in manually. After pressing Enter, file `state/storage.json` exists and is gitignored.

- [ ] **Step 4: Confirm storage.json is gitignored**

Run: `cd /home/damian/xhs-watcher && git status`
Expected: `state/storage.json` does NOT appear in untracked files (verifying `.gitignore` matched).

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add login.mjs
git commit -m "feat(login): interactive Playwright login to capture XHS storage state"
```

---

## Task 11: `lib/selectors.mjs` — XHS DOM selectors

**Files:**
- Create: `lib/selectors.mjs`

Centralize all XHS DOM selectors here so future site changes touch one file. **These selectors must be verified against the live site during Task 12** — the values below are educated guesses based on common XHS patterns and will need refinement.

- [ ] **Step 1: Create `lib/selectors.mjs`**

```js
// XHS DOM selectors — KEEP IN ONE PLACE.
// These need to be verified manually by opening the search page and inspecting
// the rendered DOM. Update as XHS frontend changes.

export const XHS = {
  // Search result feed (set of note cards)
  feedContainer: '.feeds-container, [class*="search-result"]',
  noteCard: 'section.note-item, [class*="note-item"]',

  // Within a card: extract these
  cardLink: 'a[href*="/explore/"], a[href*="/search_result/"]',
  cardTitle: '[class*="title"]',
  cardAuthor: '[class*="author"], [class*="user-name"]',
  cardRelativeTime: '[class*="time"], [class*="publish"]',
  cardLikes: '[class*="like"] [class*="count"]',

  // Detail page (after clicking into a note)
  detailContent: '#detail-desc, [class*="desc"]',
  detailTags: '[class*="tag-item"], [class*="hash-tag"]',
  detailMetrics: {
    likes: '[class*="like-wrapper"] [class*="count"]',
    collects: '[class*="collect-wrapper"] [class*="count"]',
    comments: '[class*="chat-wrapper"] [class*="count"]',
  },
  detailImages: 'img[class*="note-slider-img"]',

  // Login-state detection
  loginIndicators: {
    loginRequiredOverlay: '[class*="login-container"], [class*="login-mask"]',
    redirectHostname: 'passport.xiaohongshu.com',
  },
};
```

- [ ] **Step 2: Commit**

```bash
cd /home/damian/xhs-watcher
git add lib/selectors.mjs
git commit -m "feat(selectors): centralize XHS DOM selectors (untested, verify in Task 12)"
```

---

## Task 12: `scrape.mjs` — Playwright scraper

**Files:**
- Create: `scrape.mjs`

This is the largest task. Connects everything: lock + storage + Playwright navigate + parse + seen + JSON output.

**Important:** Selectors in `lib/selectors.mjs` are guesses. Step 5 below is dedicated to verifying them against the real site and patching `selectors.mjs` before claiming the task done.

- [ ] **Step 1: Implement `scrape.mjs` skeleton (no real XHS yet, just structure)**

```js
#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { loadConfig } from './lib/config.mjs';
import { Seen } from './lib/seen.mjs';
import { acquireLock, releaseLock } from './lib/lock.mjs';
import { parseXhsRelativeTime } from './lib/time-parser.mjs';
import { XHS } from './lib/selectors.mjs';

const STORAGE_PATH = 'state/storage.json';
const SEEN_PATH = 'state/seen.json';
const LOCK_PATH = 'state/.lock';

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function exit(payload, code) {
  emit(payload);
  process.exit(code);
}

function randomBetween([lo, hi]) {
  return lo + Math.floor(Math.random() * (hi - lo));
}

async function detectLoginExpired(page) {
  if (page.url().includes(XHS.loginIndicators.redirectHostname)) return true;
  const overlay = await page.locator(XHS.loginIndicators.loginRequiredOverlay).count();
  return overlay > 0;
}

async function main() {
  const cfg = loadConfig();

  if (!existsSync(STORAGE_PATH)) {
    exit(
      { error: 'login_expired', message: `${STORAGE_PATH} not found — run \`node login.mjs\`` },
      2,
    );
  }

  const lock = acquireLock(LOCK_PATH);
  if (!lock.acquired) {
    exit({ error: 'already_running', message: `lock held by PID ${lock.holder?.pid}` }, 6);
  }

  const seen = Seen.load(SEEN_PATH);
  const scrapedAt = new Date();

  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;
  let payload;
  try {
    const context = await browser.newContext({ storageState: STORAGE_PATH });
    const page = await context.newPage();
    await page.goto(cfg.source.resolvedUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    if (await detectLoginExpired(page)) {
      throw Object.assign(new Error('login expired'), { code: 'login_expired', exit: 2 });
    }

    const feed = page.locator(XHS.feedContainer).first();
    await feed.waitFor({ timeout: 10_000 }).catch(() => {
      throw Object.assign(new Error('feed container missing'), {
        code: 'selector_missing',
        exit: 4,
      });
    });

    const cards = page.locator(XHS.noteCard);
    const count = await cards.count();

    const posts = [];
    let totalInWindow = 0;
    let alreadySeen = 0;
    const windowMs = cfg.window.hours * 3600_000;

    for (let i = 0; i < count && posts.length < cfg.window.max_posts_per_run; i++) {
      const card = cards.nth(i);
      const href = await card.locator(XHS.cardLink).first().getAttribute('href').catch(() => null);
      if (!href) continue;
      const noteId = (href.match(/\/(explore|search_result)\/([\w-]+)/) || [])[2];
      if (!noteId) continue;

      const relTime = (await card.locator(XHS.cardRelativeTime).first().textContent().catch(() => ''))?.trim();
      let publishedAt;
      try {
        publishedAt = parseXhsRelativeTime(relTime, scrapedAt);
      } catch {
        continue; // skip unparseable
      }
      if (scrapedAt.getTime() - publishedAt.getTime() > windowMs) break; // sorted by time
      totalInWindow++;

      if (seen.has(noteId)) {
        alreadySeen++;
        continue;
      }

      const title = (await card.locator(XHS.cardTitle).first().textContent().catch(() => ''))?.trim() ?? '';
      const author = (await card.locator(XHS.cardAuthor).first().textContent().catch(() => ''))?.trim() ?? '';
      const url = href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`;

      // open detail
      const detailPage = await context.newPage();
      let detail = { content: '', tags: [], metrics: {}, image_count: 0 };
      try {
        await detailPage.goto(url, { waitUntil: 'domcontentloaded' });
        await detailPage.waitForTimeout(cfg.scrape.detail_wait_ms);
        detail.content = (await detailPage.locator(XHS.detailContent).first().textContent().catch(() => ''))?.trim() ?? '';
        const tagEls = detailPage.locator(XHS.detailTags);
        const tagCount = await tagEls.count();
        for (let t = 0; t < tagCount; t++) detail.tags.push((await tagEls.nth(t).textContent()).trim());
        detail.metrics.likes = await detailPage.locator(XHS.detailMetrics.likes).first().textContent().catch(() => null);
        detail.metrics.collects = await detailPage.locator(XHS.detailMetrics.collects).first().textContent().catch(() => null);
        detail.metrics.comments = await detailPage.locator(XHS.detailMetrics.comments).first().textContent().catch(() => null);
        detail.image_count = await detailPage.locator(XHS.detailImages).count();
      } catch {
        // tolerate failures on detail page; keep partial info
      } finally {
        await detailPage.close();
      }

      posts.push({
        note_id: noteId,
        url,
        title,
        author: { name: author, id: null },
        published_at: publishedAt.toISOString(),
        published_relative: relTime,
        content: detail.content,
        tags: detail.tags,
        metrics: detail.metrics,
        image_count: detail.image_count,
      });
      seen.markSeen(noteId, { title, firstSeen: scrapedAt });

      await page.waitForTimeout(randomBetween(cfg.scrape.card_delay_ms));
    }

    seen.setLastRunAt(scrapedAt);
    seen.gc(30, scrapedAt);
    seen.save();

    payload = {
      scraped_at: scrapedAt.toISOString(),
      keyword: cfg.source.keyword,
      stats: {
        window_hours: cfg.window.hours,
        total: totalInWindow,
        new: posts.length,
        already_seen: alreadySeen,
      },
      posts,
      error: null,
    };
    // Note: the /loop LLM augments `stats` with `by_verdict` when transforming
    // this output into `broadcast.json` (DESIGN §7.2). Names `total / new /
    // already_seen / window_hours` are stable across scrape and broadcast.
  } catch (err) {
    payload = { error: err.code ?? 'network', message: err.message };
    exitCode = err.exit ?? 5;
  } finally {
    await browser.close();
    releaseLock(LOCK_PATH);
  }

  emit(payload);
  process.exit(exitCode);
}

main().catch((err) => {
  releaseLock(LOCK_PATH);
  emit({ error: 'network', message: err.message });
  process.exit(5);
});
```

- [ ] **Step 2: First smoke run (expect it to fail somewhere — that's the data we need)**

Pre-requisites:
- Task 10 (`login.mjs`) has been completed and `state/storage.json` exists.
- A minimal `watcher.yml` exists (full version comes in Task 13). Create it if missing:

```yaml
source:
  platform: xiaohongshu
  search_url: "https://www.xiaohongshu.com/search_result?keyword={keyword}&sort=time"
  keyword: "claude code"
window: { hours: 12, max_posts_per_run: 30 }
scrape: { card_delay_ms: [800, 2500], detail_wait_ms: 1000 }
notify:
  terminal: { enabled: true }
  telegram: { enabled: false }
```

Run: `cd /home/damian/xhs-watcher && node scrape.mjs > /tmp/scrape-test.json`
Expected: Probably partial success or selector failure. Inspect `/tmp/scrape-test.json` — `error` and `stats` indicate what failed.

- [ ] **Step 3: Verify selectors against real DOM**

If Step 2's output is empty or wrong:
1. Run `node scrape.mjs` with `headless: false` (temporarily change in code) and a `await page.pause()` after `goto`
2. Use the Playwright inspector to inspect actual DOM
3. Update `lib/selectors.mjs` to match
4. Repeat until selectors hit reliably

This step is exploratory. Time-box to ~60 minutes. If selectors prove highly unstable, document the brittleness in `DESIGN.md` §11.3 (already noted).

- [ ] **Step 4: Verify successful scrape produces valid JSON**

Run: `cd /home/damian/xhs-watcher && node scrape.mjs | head -50`
Expected: A JSON object with non-empty `posts` array, each post having `note_id`, `published_at`, etc.

- [ ] **Step 5: Verify dedup on second run**

Run: `cd /home/damian/xhs-watcher && node scrape.mjs | jq '.stats'`
Expected: `already_seen` is non-zero (entries from previous run are recognized).

- [ ] **Step 6: Verify lock file works**

In one terminal run `cd /home/damian/xhs-watcher && node scrape.mjs &`, then immediately in another `node scrape.mjs`.
Expected: Second invocation exits with `{"error": "already_running", ...}` and exit code 6.

- [ ] **Step 7: Verify login_expired path**

Temporarily move `state/storage.json`:
```bash
cd /home/damian/xhs-watcher && mv state/storage.json state/storage.json.bak && node scrape.mjs; mv state/storage.json.bak state/storage.json
```
Expected: Exits 2 with `{"error": "login_expired", ...}`.

- [ ] **Step 8: Commit**

```bash
cd /home/damian/xhs-watcher
git add scrape.mjs lib/selectors.mjs
git commit -m "feat(scrape): Playwright XHS scraper with dedup, time window, error codes"
```

---

## Task 13: Default `watcher.yml`, `LOOP_PROMPT.md`, and README polish

**Files:**
- Create: `watcher.yml`
- Create: `LOOP_PROMPT.md`
- Modify: `README.md`
- (Optional) Create: `watcher.example.yml`

- [ ] **Step 1: Write `watcher.yml` (the default — Claude Code config)**

Use the full schema from DESIGN §4. Replace any stub `watcher.yml` from earlier tasks with this final version. Save as `/home/damian/xhs-watcher/watcher.yml`:

```yaml
# xhs-watcher default config: monitor "claude code" on Xiaohongshu for
# information-asymmetry signals.

source:
  platform: xiaohongshu
  search_url: "https://www.xiaohongshu.com/search_result?keyword={keyword}&sort=time"
  keyword: "claude code"

window:
  hours: 12
  max_posts_per_run: 100

scrape:
  card_delay_ms: [800, 2500]
  detail_wait_ms: 1000
  user_agent: ""

signal:
  brief: |
    目标读者：已经把 Claude Code 当主力工具的 power user
    （熟悉 hooks / skills / subagents / MCP / settings.json / CLAUDE.md / superpowers 等）。
    判断标准：这条帖子能否告诉这个读者他不知道的东西？

  verdicts:
    signal:
      label: "🟢 信号"
      examples:
        - 新 feature 的非官方玩法
        - 隐藏行为 / undocumented behavior
        - 新 hook / skill / MCP / subagent 配方
        - Anthropic 刚出更新的具体应用
        - 跨工具集成新姿势
    maybe:
      label: "🟡 存疑"
      hint: "看起来像信号但缺细节，让用户自己判断"
    known:
      label: "🔘 已知"
      examples:
        - prompt engineering 老生常谈
        - superpowers / git worktree / TDD 等已知话题且无新角度
    ad:
      label: "📢 广告"
      examples:
        - 训练营 / 付费课
        - "AI 替代程序员"情绪文
    noise:
      label: "🗑 无干货"
      examples:
        - 纯感叹
        - "todo app 炫耀"
        - 和 Cursor/Copilot 的泛对比

output:
  language: zh-CN
  card_fields: [workflow_name, one_liner, key_steps, applicable, verdict_reason]

notify:
  terminal:
    enabled: true
    show_filtered_details: true
  telegram:
    enabled: true
    bot_token_env: XHS_WATCHER_TG_BOT_TOKEN
    chat_id_env: XHS_WATCHER_TG_CHAT_ID
    parse_mode: HTML
    max_chars_per_message: 4000
    one_message_per_signal: true
    include_filtered: false
    on_failure: warn
```

- [ ] **Step 2: Write `LOOP_PROMPT.md`**

Save as `/home/damian/xhs-watcher/LOOP_PROMPT.md`:

````markdown
# xhs-watcher `/loop` prompt

Paste this content as the body of a `/loop 6h <body>` invocation inside Claude Code. The model should execute these steps every iteration.

---

执行 xhs-watcher 监视任务（仓库位于 `~/xhs-watcher`）：

1. **Bash**: `cd ~/xhs-watcher && node scrape.mjs > /tmp/xhs-scrape.json; echo "EXIT=$?"`
2. **Read** `/tmp/xhs-scrape.json`. Branch on `error`:
   - `login_expired` → run step 5 with a broadcast object `{ "error": "login_expired", "message": "请运行 cd ~/xhs-watcher && node login.mjs 重新登录" }` and stop.
   - `cf_challenge` → broadcast `{ "error": "cf_challenge", "message": "风控触发，等下一轮自动重试" }` and stop.
   - `selector_missing` → broadcast `{ "error": "selector_missing", "message": "XHS DOM 变了，需要修 lib/selectors.mjs" }` and stop.
   - `network` → broadcast `{ "error": "network", "message": "<原 message>" }` and stop.
   - `already_running` → silently exit (no broadcast).
   - `null` + `stats.new == 0` → broadcast `{ "scraped_at": ..., "stats": {...}, "cards": [], "filtered_summary": [] }` so the renderer says "窗口无新帖" and stop.
   - `null` + `stats.new > 0` → continue to step 3.

3. For each `post` in `scrape.posts`, determine `verdict ∈ {signal, maybe, known, ad, noise}` per the `signal.brief` and `signal.verdicts.*.examples` from `watcher.yml`. Be strict: target reader already knows superpowers / hooks / TDD / worktree basics.

4. **Write** `/tmp/xhs-broadcast.json` matching DESIGN.md §7.2:
   - For `signal` and `maybe` cards: extract `workflow_name` (you invent it), `one_liner`, `key_steps` (2-4 bullets max), `applicable`, `verdict_reason`. Include `author`, `published_relative`, `metrics`, `url`.
   - For `known | ad | noise`: only include in `filtered_summary` with `note_id`, `verdict`, `title`, `author`, `published_relative`, `url`.
   - Fill `stats.by_verdict` with counts.

5. **Bash**: `cat /tmp/xhs-broadcast.json | node ~/xhs-watcher/notify.mjs --terminal --tg`
6. **Bash**: `cat /tmp/xhs-broadcast.json | node ~/xhs-watcher/notify.mjs --update-verdicts`
7. Print one-line summary to chat: `📡 完成：信号 N · 存疑 M · 已过滤 K`.
````

- [ ] **Step 3: Polish `README.md`**

Replace current README contents with a complete user-facing guide:

```markdown
# xhs-watcher

Periodic Xiaohongshu (小红书) keyword watcher. Filters info-asymmetry signals via LLM (Claude Code `/loop`) and broadcasts to terminal + Telegram every 6 hours.

Default config monitors `claude code` — surfaces new workflows, hidden behaviors, fresh hook/skill/MCP/subagent recipes that a Claude Code power user hasn't seen yet.

See [`DESIGN.md`](./DESIGN.md) for full spec.

---

## Install

Requires Node ≥ 20.

```sh
git clone https://github.com/<you>/xhs-watcher
cd xhs-watcher
npm install
npx playwright install chromium
```

## Configure

```sh
cp .env.example .env
$EDITOR .env    # fill in XHS_WATCHER_TG_BOT_TOKEN and XHS_WATCHER_TG_CHAT_ID
```

To monitor a different keyword, edit `watcher.yml`.

## First-time login

```sh
node login.mjs
# Chromium opens → scan QR / log in → press Enter in terminal
# state/storage.json is written (gitignored)
```

## Run manually

```sh
node scrape.mjs > /tmp/scrape.json    # one-shot scrape
cat /tmp/scrape.json                  # inspect raw JSON
```

## Run on schedule (Claude Code)

```
/loop 6h <paste LOOP_PROMPT.md body>
```

The LLM applies the signal filter and dispatches to both terminal and Telegram.

## Switch to a different keyword

Edit `watcher.yml`:

```yaml
source:
  keyword: "comfyui workflow"
```

Update `signal.brief` and `signal.verdicts.*.examples` to define what counts as a signal for that topic. Restart the loop.

## Security

- **NEVER commit** `state/storage.json` — equivalent to your XHS login
- **NEVER commit** `.env` — contains TG bot token
- If a bot token leaks, run `/revoke` in [@BotFather](https://t.me/BotFather) immediately

## Layout

```
scrape.mjs        Playwright scraper, JSON to stdout
login.mjs         One-shot interactive login
notify.mjs        Reads broadcast JSON from stdin → terminal + TG
watcher.yml       Config: keyword, window, signal definition, notify channels
LOOP_PROMPT.md    Body to paste into /loop
lib/
  time-parser.mjs  XHS relative time → ISO
  seen.mjs         Dedup state with GC
  config.mjs       Loads watcher.yml + .env
  lock.mjs         PID-based single-run guard
  selectors.mjs    XHS DOM selectors (patch here when site changes)
  tg.mjs           Telegram API client
  render.mjs       Terminal Markdown + TG HTML renderers
tests/             Unit tests (node:test)
state/             Runtime state (gitignored)
```

## Tests

```sh
npm test
```

## License

MIT
```

- [ ] **Step 4: (Optional) Add `watcher.example.yml`**

Save as `/home/damian/xhs-watcher/watcher.example.yml` to demonstrate keyword generalization (purely documentation):

```yaml
# Example: monitor ComfyUI workflow tips instead of Claude Code.
# Copy this to watcher.yml to use it.

source:
  platform: xiaohongshu
  search_url: "https://www.xiaohongshu.com/search_result?keyword={keyword}&sort=time"
  keyword: "comfyui 工作流"

window: { hours: 12, max_posts_per_run: 100 }
scrape: { card_delay_ms: [800, 2500], detail_wait_ms: 1000 }

signal:
  brief: |
    目标读者：熟练使用 ComfyUI、了解 SD/SDXL/Flux 主流节点和常见工作流的进阶用户。
    判断标准：这条帖子是否介绍了新的节点组合、参数发现、或解决了某个常见痛点？

  verdicts:
    signal: { label: "🟢 信号", examples: ["新 custom node 用法", "采样器参数发现", "新颖节点组合"] }
    maybe: { label: "🟡 存疑", hint: "看起来有用但缺工作流截图" }
    known: { label: "🔘 已知", examples: ["controlnet 教程", "lora 入门"] }
    ad: { label: "📢 广告", examples: ["卖课", "AI 绘画训练营"] }
    noise: { label: "🗑 无干货", examples: ["纯出图炫耀", "模型对比无方法"] }

output:
  language: zh-CN
  card_fields: [workflow_name, one_liner, key_steps, applicable, verdict_reason]

notify:
  terminal: { enabled: true, show_filtered_details: true }
  telegram:
    enabled: true
    bot_token_env: XHS_WATCHER_TG_BOT_TOKEN
    chat_id_env: XHS_WATCHER_TG_CHAT_ID
    parse_mode: HTML
    on_failure: warn
```

- [ ] **Step 5: Commit**

```bash
cd /home/damian/xhs-watcher
git add watcher.yml LOOP_PROMPT.md README.md watcher.example.yml
git commit -m "feat: default watcher.yml (Claude Code), LOOP_PROMPT.md, README, example config"
```

---

## Task 14: End-to-end smoke test

**Files:** none new

Confirms the whole pipeline works manually before declaring the MVP done.

- [ ] **Step 1: Set up environment**

```sh
cd /home/damian/xhs-watcher
cat .env    # verify XHS_WATCHER_TG_BOT_TOKEN and XHS_WATCHER_TG_CHAT_ID set
ls state/storage.json    # verify login state exists
```

If `.env` not set, populate from the live values. If `storage.json` missing, run `node login.mjs`.

- [ ] **Step 2: Run scrape**

```sh
cd /home/damian/xhs-watcher && node scrape.mjs > /tmp/xhs-scrape.json
echo "EXIT=$?"
cat /tmp/xhs-scrape.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('error:',d.get('error'),'new:',d.get('stats',{}).get('new'))"
```

Expected: `EXIT=0`, `error: None`, `new: <some integer ≥ 0>`.

- [ ] **Step 3: Manually construct a broadcast JSON to test notify**

```sh
cp tests/fixtures/broadcast.json /tmp/xhs-broadcast.json
cat /tmp/xhs-broadcast.json | node notify.mjs --terminal --tg
```

Expected:
- Terminal: Markdown broadcast rendered
- Telegram: 1 signal card + 1 footer message appear in your channel
- Exit code 0

If TG fails, terminal shows `⚠️ TG push failed: <reason>` but exit code still 0 (per `on_failure: warn`).

- [ ] **Step 4: Test --update-verdicts**

```sh
cat /tmp/xhs-broadcast.json | node notify.mjs --update-verdicts
cat state/seen.json | python3 -m json.tool | head -30
```

Expected: `seen.json` shows the fixture's note_ids with `"verdict": "signal"` / `"known"` / etc.

- [ ] **Step 5: Verify `/loop` works in Claude Code**

In a Claude Code session, invoke:
```
/loop 6h
<paste LOOP_PROMPT.md body verbatim>
```

Expected: First iteration runs immediately. Terminal shows a broadcast (or "无新帖"). Telegram receives the signal cards. Subsequent iterations fire every 6h.

- [ ] **Step 6: Final commit**

```bash
cd /home/damian/xhs-watcher
git add -A    # only docs changes from running the tests if any
git status
git commit -m "chore: end-to-end smoke verified — MVP ready" --allow-empty
```

- [ ] **Step 7: Push to GitHub**

(Optional, when user is ready to publish.) Create repo on GitHub UI, then:

```sh
cd /home/damian/xhs-watcher
git remote add origin git@github.com:<you>/xhs-watcher.git
git push -u origin main
```

---

## Self-review checklist

Run this after all tasks complete:

- [ ] All steps in DESIGN.md §5 (scrape error codes) are implemented in Task 12: ✅ login_expired, cf_challenge (note: implicit — manifests as selector_missing or network), selector_missing, network, already_running. (`cf_challenge` is not explicitly distinguished from `selector_missing` in MVP — acceptable, documented in DESIGN.md §11.2.)
- [ ] All DESIGN.md §7 (LLM + render formats) covered: Tasks 7-9 + 13 LOOP_PROMPT.md.
- [ ] All DESIGN.md §9 (state files) covered: Tasks 3 (seen.json), 5 (.lock), 10 (storage.json).
- [ ] All DESIGN.md §12 (security) covered: `.gitignore` (existing), `.env.example` (existing), README warnings (Task 13).
- [ ] All DESIGN.md §13 (test strategy) covered: Tests in Tasks 2-8.
