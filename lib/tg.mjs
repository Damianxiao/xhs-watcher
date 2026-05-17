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

export async function sendAll(messages, opts, { fetch: fetchImpl, sleepMs = 200, sleep, retryDelayMs = 500 } = {}) {
  const sleeper = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const results = [];
  for (const text of messages) {
    let r = await sendMessage({ ...opts, text }, { fetch: fetchImpl });
    if (!r.ok) {
      await sleeper(retryDelayMs);
      r = await sendMessage({ ...opts, text }, { fetch: fetchImpl });
    }
    results.push(r);
    if (sleepMs > 0) await sleeper(sleepMs);
  }
  return results;
}
