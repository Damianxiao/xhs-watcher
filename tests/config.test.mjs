import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../lib/config.mjs';

const FIXTURE = new URL('./fixtures/watcher.test.yml', import.meta.url).pathname;
const MULTI_FIXTURE = new URL('./fixtures/watcher.multi.test.yml', import.meta.url).pathname;

test('loads YAML and substitutes keyword in URL', () => {
  const cfg = loadConfig(FIXTURE);
  assert.equal(cfg.source.resolvedUrl, 'https://example.com/search?q=test%20keyword');
  // Single-keyword backward compat: keywordList length 1, resolvedUrls[0] === resolvedUrl
  assert.equal(cfg.source.keywordList.length, 1);
  assert.equal(cfg.source.resolvedUrls.length, 1);
  assert.equal(cfg.source.resolvedUrls[0], cfg.source.resolvedUrl);
});

test('multi-keyword: keywords array yields keywordList + resolvedUrls of same length', () => {
  const cfg = loadConfig(MULTI_FIXTURE);
  assert.equal(cfg.source.keywordList.length, 3);
  assert.equal(cfg.source.resolvedUrls.length, 3);
  assert.deepEqual(cfg.source.keywordList, ['Claude Code', 'claude code', 'claudecode']);
  // Verify each URL has correctly url-encoded keyword
  assert.equal(cfg.source.resolvedUrls[0], 'https://example.com/search?q=Claude%20Code');
  assert.equal(cfg.source.resolvedUrls[1], 'https://example.com/search?q=claude%20code');
  assert.equal(cfg.source.resolvedUrls[2], 'https://example.com/search?q=claudecode');
  // resolvedUrl preserved for backward compat
  assert.equal(cfg.source.resolvedUrl, cfg.source.resolvedUrls[0]);
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
