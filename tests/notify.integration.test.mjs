import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const FIXTURE = join(__dirname, 'fixtures', 'broadcast.json');
const BROADCAST = readFileSync(FIXTURE, 'utf8');

function makeSandbox() {
  // Sandbox directory mirrors enough of the repo to run notify.mjs:
  // - watcher.yml (config root)
  // - state/ dir for --update-verdicts
  // notify.mjs and lib/ are referenced by ABSOLUTE path so we don't need to copy them.
  const sandbox = mkdtempSync(join(tmpdir(), 'notify-it-'));
  copyFileSync(join(REPO_ROOT, 'watcher.yml'), join(sandbox, 'watcher.yml'));
  mkdirSync(join(sandbox, 'state'), { recursive: true });
  return sandbox;
}

function runNotify(sandbox, args, stdinPayload, extraEnv = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [join(REPO_ROOT, 'notify.mjs'), ...args], {
      cwd: sandbox,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    proc.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });
}

test('notify.mjs --terminal renders Markdown signal card from stdin', async () => {
  const sandbox = makeSandbox();
  try {
    const { code, stdout } = await runNotify(sandbox, ['--terminal'], BROADCAST);
    assert.equal(code, 0);
    assert.match(stdout, /🟢 信号 1 — Skill 化 git worktree/);
    assert.match(stdout, /扫描窗口 12h/);
  } finally {
    rmSync(sandbox, { recursive: true });
  }
});

test('notify.mjs --tg --dry-run emits TG messages without network call', async () => {
  const sandbox = makeSandbox();
  try {
    // No real TG token in env — would fail any real fetch
    const { code, stdout } = await runNotify(sandbox, ['--tg', '--dry-run'], BROADCAST, {
      XHS_WATCHER_TG_BOT_TOKEN: 'fake',
      XHS_WATCHER_TG_CHAT_ID: '@fake',
    });
    assert.equal(code, 0);
    assert.match(stdout, /TG dry-run/);
    assert.match(stdout, /Skill 化 git worktree/);
    assert.match(stdout, /xhs-watcher/); // footer
  } finally {
    rmSync(sandbox, { recursive: true });
  }
});

test('notify.mjs --update-verdicts updates verdicts for existing notes', async () => {
  const sandbox = makeSandbox();
  try {
    // Pre-populate seen.json so setVerdict has something to update
    // (Seen.setVerdict is a no-op for unknown ids)
    const seenInit = {
      schema_version: 1,
      last_run_at: null,
      notes: {
        abc: { first_seen: '2026-05-16T10:00:00+08:00', title: 'pre', verdict: null },
        k1:  { first_seen: '2026-05-16T11:00:00+08:00', title: 'pre', verdict: null },
        a1:  { first_seen: '2026-05-16T11:00:00+08:00', title: 'pre', verdict: null },
        n1:  { first_seen: '2026-05-16T11:00:00+08:00', title: 'pre', verdict: null },
      },
    };
    writeFileSync(join(sandbox, 'state', 'seen.json'), JSON.stringify(seenInit));

    const { code, stdout } = await runNotify(sandbox, ['--update-verdicts'], BROADCAST);
    assert.equal(code, 0);
    assert.match(stdout, /verdict updated/);

    const after = JSON.parse(readFileSync(join(sandbox, 'state', 'seen.json'), 'utf8'));
    assert.equal(after.notes.abc.verdict, 'signal');
    assert.equal(after.notes.k1.verdict, 'known');
    assert.equal(after.notes.a1.verdict, 'ad');
    assert.equal(after.notes.n1.verdict, 'noise');
  } finally {
    rmSync(sandbox, { recursive: true });
  }
});

test('notify.mjs renders error broadcast cleanly', async () => {
  const sandbox = makeSandbox();
  try {
    const errBroadcast = JSON.stringify({ error: 'login_expired', message: '请重新登录' });
    const { code, stdout } = await runNotify(sandbox, ['--terminal'], errBroadcast);
    assert.equal(code, 0);
    assert.match(stdout, /⚠️/);
    assert.match(stdout, /login_expired/);
    assert.match(stdout, /请重新登录/);
  } finally {
    rmSync(sandbox, { recursive: true });
  }
});

test('notify.mjs --tg with missing env prints TG push failed warning', async () => {
  const sandbox = makeSandbox();
  try {
    const env = { ...process.env };
    delete env.XHS_WATCHER_TG_BOT_TOKEN;
    delete env.XHS_WATCHER_TG_CHAT_ID;
    // Provide an empty .env in the sandbox so dotenv doesn't pick up the parent's
    writeFileSync(join(sandbox, '.env'), '');
    const { code, stdout } = await new Promise((resolve) => {
      const proc = spawn('node', [join(REPO_ROOT, 'notify.mjs'), '--terminal', '--tg'], {
        cwd: sandbox,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
      let out = '';
      let err = '';
      proc.stdout.on('data', (b) => { out += b.toString('utf8'); });
      proc.stderr.on('data', (b) => { err += b.toString('utf8'); });
      proc.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
      proc.stdin.write(BROADCAST);
      proc.stdin.end();
    });
    assert.equal(code, 0); // on_failure: warn → exit 0
    assert.match(stdout, /TG push failed/);
    assert.match(stdout, /token or chat_id missing/);
  } finally {
    rmSync(sandbox, { recursive: true });
  }
});
