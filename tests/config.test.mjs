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
