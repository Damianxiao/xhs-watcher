const VERDICT_LABELS = {
  signal: '🟢 信号',
  maybe: '🟡 存疑',
  known: '🔘 已知话题',
  ad: '📢 广告/卖课',
  noise: '🗑 无干货',
};

function formatTimestamp(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    // Fallback: render current time in CST
    return formatTimestamp(new Date().toISOString());
  }
  // Shift epoch by +8h, then read UTC fields → represents CST wall clock
  const cst = new Date(d.getTime() + 8 * 3600_000);
  const yyyy = cst.getUTCFullYear();
  const mm = String(cst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(cst.getUTCDate()).padStart(2, '0');
  const hh = String(cst.getUTCHours()).padStart(2, '0');
  const mi = String(cst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function renderTerminal(broadcast) {
  if (broadcast.error) {
    return `⚠️ XHS watcher: ${broadcast.error}${broadcast.message ? ` — ${broadcast.message}` : ''}`;
  }

  const { stats, cards = [], filtered_summary = [] } = broadcast;

  if (stats.new === 0) {
    return `📡 ${formatTimestamp(broadcast.broadcast_at)} · ${stats.window_hours}h 窗口无新帖（库存 ${stats.already_seen} 条已扫过）`;
  }

  const lines = [];
  lines.push(`## 📡 XHS Claude Code 播报 — ${formatTimestamp(broadcast.broadcast_at)} CST`);
  lines.push('');
  lines.push(
    `扫描窗口 ${stats.window_hours}h · 命中 ${stats.total} 条 · 新增 ${stats.new} / 已知库 ${stats.already_seen}`,
  );
  const v = stats.by_verdict ?? { signal: 0, maybe: 0, known: 0, ad: 0, noise: 0 };
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

// Returns one or two TG messages for a signal/maybe card:
//   [0] = summary card (LLM verdict + workflow_name + key_steps + ...)
//   [1] = original post content as <blockquote>, only if content non-empty
// Both are auto-truncated with a "详见原帖" link suffix when over TG_MAX.
function renderSignalCardTG(card) {
  const label = SIGNAL_LABELS_TG[card.verdict] ?? card.verdict;
  const url = card.url;
  const titleLine = card.workflow_name || card.title || '';

  // --- summary message ---
  const sumParts = [];
  sumParts.push(`<b>${escapeHtml(label)} — ${escapeHtml(titleLine)}</b>`);
  if (card.one_liner) { sumParts.push(''); sumParts.push(`<i>${escapeHtml(card.one_liner)}</i>`); }
  if (card.key_steps?.length) {
    sumParts.push('');
    sumParts.push('<b>关键步骤</b>');
    for (const s of card.key_steps) sumParts.push(`• ${escapeHtml(s)}`);
  }
  if (card.applicable) {
    sumParts.push('');
    sumParts.push(`<b>适用</b> ${escapeHtml(card.applicable)}`);
  }
  if (card.verdict_reason) {
    sumParts.push(`<b>判断</b> ${escapeHtml(card.verdict_reason)}`);
  }
  if (Array.isArray(card.tags) && card.tags.length) {
    sumParts.push('');
    sumParts.push(card.tags.map((t) => '#' + escapeHtml(t)).join(' '));
  }
  sumParts.push('');
  const meta = `${escapeHtml(card.author)} · ${escapeHtml(card.published_relative)} · 赞${card.metrics?.likes ?? '-'} · 收${card.metrics?.collects ?? '-'}`;
  sumParts.push(`<a href="${escapeHtml(url)}">${meta}</a>`);

  let summary = sumParts.join('\n');
  if (summary.length > TG_MAX) {
    const suffix = `\n\n... <a href="${escapeHtml(url)}">详见原帖</a>`;
    summary = summary.slice(0, TG_MAX - suffix.length) + suffix;
  }

  // --- content message (only if original_content present) ---
  const content = (card.original_content ?? '').trim();
  if (!content) return [summary];

  const header = `<b>📝 原帖正文</b>\n<blockquote>`;
  const closeNormal = `</blockquote>`;
  const closeTrunc = `</blockquote>\n\n<a href="${escapeHtml(url)}">详见原帖</a>`;
  const escContent = escapeHtml(content);
  let contentMsg;
  const fits = TG_MAX - header.length - closeNormal.length;
  if (escContent.length <= fits) {
    contentMsg = header + escContent + closeNormal;
  } else {
    const trunc = TG_MAX - header.length - closeTrunc.length;
    contentMsg = header + escContent.slice(0, trunc) + closeTrunc;
  }
  return [summary, contentMsg];
}

function renderFooterTG(broadcast) {
  const s = broadcast.stats;
  const ts = formatTimestamp(broadcast.broadcast_at);
  const v = s.by_verdict ?? { signal: 0, maybe: 0, known: 0, ad: 0, noise: 0 };
  const filtered = v.known + v.ad + v.noise;
  return `📊 xhs-watcher · ${ts} CST\n窗口 ${s.window_hours}h · 信号 ${v.signal} · 存疑 ${v.maybe} · 已过滤 ${filtered}`;
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
  // renderSignalCardTG returns 1 or 2 messages per card (summary + content).
  const msgs = signalCards.flatMap(renderSignalCardTG);
  msgs.push(renderFooterTG(broadcast));
  return msgs;
}
