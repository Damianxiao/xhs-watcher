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
