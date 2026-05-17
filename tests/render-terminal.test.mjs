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

test('renderTerminal renders CST timestamp regardless of host tz', () => {
  // The fixture's broadcast_at is 2026-05-16T14:00:00+08:00
  const out = renderTerminal(fixture);
  assert.match(out, /2026-05-16 14:00 CST/);
});
