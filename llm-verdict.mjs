#!/usr/bin/env node
// llm-verdict.mjs — read scrape JSON from stdin, classify each post via
// OpenAI-compatible LLM endpoint, emit broadcast JSON (DESIGN §7.2) to stdout.
// Progress logs go to stderr to keep stdout clean for the pipe.
import 'dotenv/config';
import { loadConfig } from './lib/config.mjs';
import { classifyPost } from './lib/verdict.mjs';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function emptyBroadcast(scrape) {
  return {
    broadcast_at: new Date().toISOString(),
    stats: {
      window_hours: scrape?.stats?.window_hours ?? null,
      total: scrape?.stats?.total ?? 0,
      new: 0,
      already_seen: scrape?.stats?.already_seen ?? 0,
      by_verdict: { signal: 0, maybe: 0, known: 0, ad: 0, noise: 0 },
    },
    cards: [],
    filtered_summary: [],
  };
}

async function main() {
  const cfg = loadConfig();
  const baseUrl = process.env.XHS_WATCHER_LLM_BASE_URL;
  const apiKey = process.env.XHS_WATCHER_LLM_API_KEY;
  const model = process.env.XHS_WATCHER_LLM_MODEL;

  const stdinRaw = await readStdin();
  let scrape;
  try {
    scrape = JSON.parse(stdinRaw);
  } catch (err) {
    process.stderr.write(`llm-verdict: stdin is not valid JSON: ${err.message}\n`);
    process.exit(1);
  }

  // Pass-through error broadcasts (scrape failed upstream).
  if (scrape.error) {
    process.stdout.write(JSON.stringify(scrape, null, 2));
    process.exit(0);
  }

  // Empty scrape: emit minimal broadcast, skip LLM calls.
  if (!scrape.stats || scrape.stats.new === 0 || !Array.isArray(scrape.posts) || scrape.posts.length === 0) {
    process.stderr.write('llm-verdict: no new posts — emitting empty broadcast\n');
    process.stdout.write(JSON.stringify(emptyBroadcast(scrape), null, 2));
    process.exit(0);
  }

  if (!baseUrl || !apiKey || !model) {
    process.stderr.write(
      'llm-verdict: missing LLM env (need XHS_WATCHER_LLM_BASE_URL, XHS_WATCHER_LLM_API_KEY, XHS_WATCHER_LLM_MODEL)\n',
    );
    process.exit(1);
  }

  const results = [];
  const posts = scrape.posts;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    let result;
    try {
      result = await classifyPost(post, cfg, { baseUrl, apiKey, model });
    } catch (err) {
      process.stderr.write(`  ! post ${i + 1}/${posts.length}: LLM error — ${err.message}\n`);
      result = {
        verdict: 'maybe',
        verdict_reason: `LLM 调用失败: ${err.message}`,
        workflow_name: '',
        one_liner: (post.title ?? '').slice(0, 80),
        key_steps: [],
        applicable: '',
      };
    }
    const tag = result.workflow_name ? ` (${result.workflow_name})` : '';
    process.stderr.write(`  → post ${i + 1}/${posts.length}: verdict=${result.verdict}${tag}\n`);
    results.push({ post, ...result });
  }

  const cards = results
    .filter((r) => r.verdict === 'signal' || r.verdict === 'maybe')
    .map((r) => ({
      note_id: r.post.note_id,
      verdict: r.verdict,
      title: r.post.title,
      workflow_name: r.workflow_name,
      one_liner: r.one_liner,
      key_steps: r.key_steps,
      applicable: r.applicable,
      verdict_reason: r.verdict_reason,
      original_content: r.post.content ?? '',
      tags: Array.isArray(r.post.tags) ? r.post.tags : [],
      author: '@' + (r.post.author?.name ?? 'unknown'),
      published_relative: r.post.published_relative,
      metrics: {
        likes: r.post.metrics?.likes ?? null,
        collects: r.post.metrics?.collects ?? null,
      },
      url: r.post.url,
    }));

  const filtered_summary = results
    .filter((r) => ['known', 'ad', 'noise'].includes(r.verdict))
    .map((r) => ({
      note_id: r.post.note_id,
      verdict: r.verdict,
      title: r.post.title,
      verdict_reason: r.verdict_reason,
      author: '@' + (r.post.author?.name ?? 'unknown'),
      published_relative: r.post.published_relative,
      metrics: {
        likes: r.post.metrics?.likes ?? null,
      },
      url: r.post.url,
    }));

  const by_verdict = { signal: 0, maybe: 0, known: 0, ad: 0, noise: 0 };
  for (const r of results) {
    by_verdict[r.verdict] = (by_verdict[r.verdict] ?? 0) + 1;
  }

  const broadcast = {
    broadcast_at: new Date().toISOString(),
    stats: {
      window_hours: scrape.stats.window_hours,
      total: scrape.stats.total,
      new: scrape.stats.new,
      already_seen: scrape.stats.already_seen,
      by_verdict,
    },
    cards,
    filtered_summary,
  };

  process.stdout.write(JSON.stringify(broadcast, null, 2));
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`llm-verdict: unexpected error: ${err.message}\n`);
  process.exit(1);
});
