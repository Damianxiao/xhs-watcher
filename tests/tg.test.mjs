import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendMessage, sendAll } from '../lib/tg.mjs';

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

test('sendAll retries once after first failure', async () => {
  const calls = [];
  const mockFetch = async () => {
    calls.push(1);
    if (calls.length === 1) return { ok: false, status: 500, json: async () => ({ ok: false, description: 'transient' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 99 } }) };
  };
  const results = await sendAll(['hi'], { botToken: 'T', chatId: '@x', parseMode: 'HTML' }, {
    fetch: mockFetch,
    sleepMs: 0,
    sleep: () => Promise.resolve(),
  });
  assert.equal(calls.length, 2);
  assert.equal(results[0].ok, true);
});
