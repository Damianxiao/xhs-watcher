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
  const old = new Date('2026-04-01T00:00:00+08:00');
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
