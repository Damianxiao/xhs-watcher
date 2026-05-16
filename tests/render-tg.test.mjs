import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTelegramMessages } from '../lib/render.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/broadcast.json', import.meta.url), 'utf8'),
);

test('produces one message per signal card plus a footer', () => {
  const msgs = renderTelegramMessages(fixture);
  assert.equal(msgs.length, 2);
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
