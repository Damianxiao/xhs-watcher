// Pure LLM-driven verdict classifier. Given a scraped post + watcher config
// signal definition, calls an OpenAI-compatible /chat/completions endpoint
// and returns a normalized verdict record.
//
// fetch is injected so callers can mock it in tests; CLI passes globalThis.fetch.

const DEFAULT_TIMEOUT_MS = 30_000;
const VALID_VERDICTS = ['signal', 'maybe', 'known', 'ad', 'noise'];

function buildSystemPrompt(signal) {
  const brief = signal.brief?.trim() ?? '';
  const verdictsBlock = Object.entries(signal.verdicts ?? {})
    .map(([k, v]) => {
      const lines = [`- ${k} (${v.label ?? k}):`];
      if (v.hint) lines.push(`    提示：${v.hint}`);
      if (Array.isArray(v.examples) && v.examples.length > 0) {
        lines.push(`    示例：`);
        for (const ex of v.examples) lines.push(`      - ${ex}`);
      }
      return lines.join('\n');
    })
    .join('\n');

  return `你是 xhs-watcher 的严格信号过滤器，专注于 Claude Code power-user 信息差。

【判断标准】
${brief}

【verdict 候选】
${verdictsBlock}

【任务】
我会给你一条小红书帖子（标题 + 正文摘要 + 作者 + 时间 + 链接 + 点赞数）。请：
1. 判断它属于哪一个 verdict（必须是 signal / maybe / known / ad / noise 之一）
2. 仅当 verdict 是 signal 或 maybe 时，从正文中提炼出工作流名 / 一句话 / 关键步骤 / 适用场景
3. 始终给出 verdict_reason（为什么是这个 verdict）

【输出格式】严格只返回一个 JSON 对象，**不要 markdown 代码块，不要任何前后文字**。结构如下：
{
  "verdict": "signal|maybe|known|ad|noise",
  "workflow_name": "...",           // signal/maybe 时必填，其余可省略
  "one_liner": "...",                // signal/maybe 时必填
  "key_steps": ["...", "..."],       // signal/maybe 时必填，2-4 条
  "applicable": "...",               // signal/maybe 时必填
  "verdict_reason": "..."             // 永远必填，简短说明
}`;
}

function buildUserPrompt(post) {
  const author = post.author?.name ?? 'unknown';
  const likes = post.metrics?.likes ?? 'n/a';
  const collects = post.metrics?.collects ?? 'n/a';
  const content = (post.content ?? '').slice(0, 500);
  return [
    `标题: ${post.title ?? ''}`,
    `作者: @${author}`,
    `发布: ${post.published_relative ?? post.published_at ?? ''}`,
    `点赞: ${likes} · 收藏: ${collects}`,
    `链接: ${post.url ?? ''}`,
    `正文摘要（前 500 字）:`,
    content || '（无正文，仅标题）',
  ].join('\n');
}

// Extract the first balanced top-level {...} JSON object from a string.
// Used to salvage results when the LLM wraps JSON in prose / fenced blocks.
function extractFirstJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseLlmReply(content) {
  if (!content) return null;
  // Try strict parse first.
  try { return JSON.parse(content); } catch { /* fall through */ }
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const extracted = extractFirstJsonObject(content);
  if (extracted) {
    try { return JSON.parse(extracted); } catch { /* fall through */ }
  }
  return null;
}

function normalizeVerdict(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const v = parsed.verdict;
  if (!VALID_VERDICTS.includes(v)) return null;
  const out = { verdict: v, verdict_reason: parsed.verdict_reason ?? '' };
  if (v === 'signal' || v === 'maybe') {
    out.workflow_name = parsed.workflow_name ?? '';
    out.one_liner = parsed.one_liner ?? '';
    out.key_steps = Array.isArray(parsed.key_steps) ? parsed.key_steps : [];
    out.applicable = parsed.applicable ?? '';
  }
  return out;
}

export async function classifyPost(post, watcherConfig, opts = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    baseUrl,
    apiKey,
    model,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxTokens = 800,
    temperature = 0.2,
  } = opts;

  if (!baseUrl) throw new Error('classifyPost: baseUrl required');
  if (!apiKey) throw new Error('classifyPost: apiKey required');
  if (!model) throw new Error('classifyPost: model required');

  const systemPrompt = buildSystemPrompt(watcherConfig.signal ?? {});
  const userPrompt = buildUserPrompt(post);

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? '';
  const parsed = parseLlmReply(content);
  const normalized = normalizeVerdict(parsed);
  if (!normalized) {
    return {
      verdict: 'maybe',
      verdict_reason: 'LLM 输出未能解析为 JSON',
      workflow_name: '',
      one_liner: (post.title ?? '').slice(0, 80),
      key_steps: [],
      applicable: '',
    };
  }
  return normalized;
}

// Exported for tests.
export const _internal = { buildSystemPrompt, buildUserPrompt, parseLlmReply, normalizeVerdict, extractFirstJsonObject };
