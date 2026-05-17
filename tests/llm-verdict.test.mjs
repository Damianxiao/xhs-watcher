import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPost, _internal } from '../lib/verdict.mjs';

const WATCHER_CFG = {
  signal: {
    brief: '目标读者：Claude Code power user。判断标准：能否告诉他不知道的东西？',
    verdicts: {
      signal: { label: '🟢 信号', examples: ['新 hook 配方', '隐藏行为'] },
      maybe: { label: '🟡 存疑', hint: '缺细节让用户判断' },
      known: { label: '🔘 已知', examples: ['老生常谈'] },
      ad: { label: '📢 广告', examples: ['卖课'] },
      noise: { label: '🗑 无干货', examples: ['纯感叹'] },
    },
  },
};

const POST = {
  note_id: 'abc123',
  url: 'https://www.xiaohongshu.com/explore/abc123',
  title: 'Skill 化 git worktree',
  author: { name: 'somebody' },
  published_relative: '4小时前',
  published_at: '2026-05-17T10:00:00+08:00',
  content: '用 PostToolUse hook 自动给每个 worktree 注入 CLAUDE.md...',
  metrics: { likes: '234', collects: '89' },
};

function mockFetchReturning(replyContent, { status = 200 } = {}) {
  return async (_url, _init) => ({
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify({ error: 'mock' }); },
    async json() {
      return {
        choices: [{ message: { content: replyContent } }],
      };
    },
  });
}

test('classifyPost: clean JSON reply → result matches', async () => {
  const llmReply = JSON.stringify({
    verdict: 'signal',
    workflow_name: 'Skill 化 git worktree',
    one_liner: '用 PostToolUse hook 注入 CLAUDE.md',
    key_steps: ['钩子监听 git worktree add', '模板渲染 CLAUDE.md'],
    applicable: '多 feature 并行开发',
    verdict_reason: '比 superpowers 多了上下文注入维度',
  });
  const r = await classifyPost(POST, WATCHER_CFG, {
    fetch: mockFetchReturning(llmReply),
    baseUrl: 'https://mock/v1',
    apiKey: 'sk-mock',
    model: 'mock-model',
  });
  assert.equal(r.verdict, 'signal');
  assert.equal(r.workflow_name, 'Skill 化 git worktree');
  assert.equal(r.one_liner, '用 PostToolUse hook 注入 CLAUDE.md');
  assert.deepEqual(r.key_steps, ['钩子监听 git worktree add', '模板渲染 CLAUDE.md']);
  assert.equal(r.applicable, '多 feature 并行开发');
  assert.match(r.verdict_reason, /superpowers/);
});

test('classifyPost: prose with embedded JSON block → still parses', async () => {
  const llmReply = `好的，我的判断是：
\`\`\`json
{
  "verdict": "known",
  "verdict_reason": "TDD 入门，老生常谈"
}
\`\`\`
以上。`;
  const r = await classifyPost(POST, WATCHER_CFG, {
    fetch: mockFetchReturning(llmReply),
    baseUrl: 'https://mock/v1',
    apiKey: 'sk-mock',
    model: 'mock-model',
  });
  assert.equal(r.verdict, 'known');
  assert.match(r.verdict_reason, /老生常谈/);
});

test('classifyPost: garbage reply → defaults to maybe with parse-failed reason', async () => {
  const llmReply = 'sorry, I cannot determine this';
  const r = await classifyPost(POST, WATCHER_CFG, {
    fetch: mockFetchReturning(llmReply),
    baseUrl: 'https://mock/v1',
    apiKey: 'sk-mock',
    model: 'mock-model',
  });
  assert.equal(r.verdict, 'maybe');
  assert.match(r.verdict_reason, /未能解析为 JSON/);
});

test('extractFirstJsonObject handles nested braces and string braces', () => {
  const txt = 'prefix {"a": "x{y}z", "b": {"c": 1}} suffix';
  const out = _internal.extractFirstJsonObject(txt);
  assert.equal(out, '{"a": "x{y}z", "b": {"c": 1}}');
});
