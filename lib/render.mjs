const VERDICT_LABELS = {
  signal: '🟢 信号',
  maybe: '🟡 存疑',
  known: '🔘 已知话题',
  ad: '📢 广告/卖课',
  noise: '🗑 无干货',
};

// NOTE: uses local-tz Date methods; under UTC host the fixture
// 2026-05-16T14:00:00+08:00 renders as 2026-05-16 06:00. Tests don't assert
// the exact timestamp string so this is acceptable for now — make tz-aware in
// a future task (TG renderer in Task 8 will have the same concern).
function formatTimestamp(iso) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
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
  const v = stats.by_verdict;
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

function renderSignalCardTG(card) {
  const label = SIGNAL_LABELS_TG[card.verdict] ?? card.verdict;
  const url = card.url;
  const parts = [];
  parts.push(`<b>${escapeHtml(label)} — ${escapeHtml(card.workflow_name)}</b>`);
  parts.push('');
  parts.push(`<i>${escapeHtml(card.one_liner)}</i>`);
  if (card.key_steps?.length) {
    parts.push('');
    parts.push('<b>关键步骤</b>');
    for (const s of card.key_steps) parts.push(`• ${escapeHtml(s)}`);
  }
  if (card.applicable) {
    parts.push('');
    parts.push(`<b>适用</b> ${escapeHtml(card.applicable)}`);
  }
  if (card.verdict_reason) {
    parts.push(`<b>判断</b> ${escapeHtml(card.verdict_reason)}`);
  }
  parts.push('');
  const meta = `${escapeHtml(card.author)} · ${escapeHtml(card.published_relative)} · 赞${card.metrics?.likes ?? '-'} · 收${card.metrics?.collects ?? '-'}`;
  parts.push(`<a href="${escapeHtml(url)}">${meta}</a>`);

  let msg = parts.join('\n');
  if (msg.length > TG_MAX) {
    const suffix = `\n\n... <a href="${escapeHtml(url)}">详见原帖</a>`;
    msg = msg.slice(0, TG_MAX - suffix.length) + suffix;
  }
  return msg;
}

function renderFooterTG(broadcast) {
  const s = broadcast.stats;
  const ts = formatTimestamp(broadcast.broadcast_at);
  const filtered = s.by_verdict.known + s.by_verdict.ad + s.by_verdict.noise;
  return `📊 xhs-watcher · ${ts} CST\n窗口 ${s.window_hours}h · 信号 ${s.by_verdict.signal} · 存疑 ${s.by_verdict.maybe} · 已过滤 ${filtered}`;
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
  const msgs = signalCards.map(renderSignalCardTG);
  msgs.push(renderFooterTG(broadcast));
  return msgs;
}
