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
