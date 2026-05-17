#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { loadConfig } from './lib/config.mjs';
import { Seen } from './lib/seen.mjs';
import { acquireLock, releaseLock } from './lib/lock.mjs';
import { parseXhsRelativeTime } from './lib/time-parser.mjs';
import { XHS } from './lib/selectors.mjs';

const STORAGE_PATH = 'state/storage.json';
const SEEN_PATH = 'state/seen.json';
const LOCK_PATH = 'state/.lock';

let lockAcquired = false;

process.on('SIGINT', () => {
  if (lockAcquired) releaseLock(LOCK_PATH);
  process.exit(130);
});
process.on('SIGTERM', () => {
  if (lockAcquired) releaseLock(LOCK_PATH);
  process.exit(143);
});

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function exit(payload, code) {
  emit(payload);
  process.exit(code);
}

function randomBetween([lo, hi]) {
  return lo + Math.floor(Math.random() * (hi - lo));
}

async function detectLoginExpired(page) {
  if (page.url().includes(XHS.loginIndicators.redirectHostname)) return true;
  const overlay = await page.locator(XHS.loginIndicators.loginRequiredOverlay).count();
  return overlay > 0;
}

async function main() {
  const cfg = loadConfig();

  if (!existsSync(STORAGE_PATH)) {
    exit(
      { error: 'login_expired', message: `${STORAGE_PATH} not found — run \`node login.mjs\`` },
      2,
    );
  }

  const lock = acquireLock(LOCK_PATH);
  if (!lock.acquired) {
    exit({ error: 'already_running', message: `lock held by PID ${lock.holder?.pid}` }, 6);
  }
  lockAcquired = true;

  const seen = Seen.load(SEEN_PATH);
  const scrapedAt = new Date();

  const browser = await chromium.launch({ headless: true });
  let exitCode = 0;
  let payload;
  try {
    const context = await browser.newContext({ storageState: STORAGE_PATH });
    const page = await context.newPage();
    await page.goto(cfg.source.resolvedUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    if (await detectLoginExpired(page)) {
      throw Object.assign(new Error('login expired'), { code: 'login_expired', exit: 2 });
    }

    const feed = page.locator(XHS.feedContainer).first();
    await feed.waitFor({ timeout: 10_000 }).catch(() => {
      throw Object.assign(new Error('feed container missing'), {
        code: 'selector_missing',
        exit: 4,
      });
    });

    const cards = page.locator(XHS.noteCard);
    const count = await cards.count();

    const posts = [];
    let totalInWindow = 0;
    let alreadySeen = 0;
    const windowMs = cfg.window.hours * 3600_000;

    for (let i = 0; i < count && posts.length < cfg.window.max_posts_per_run; i++) {
      const card = cards.nth(i);
      const href = await card.locator(XHS.cardLink).first().getAttribute('href').catch(() => null);
      if (!href) continue;
      const noteId = (href.match(/\/(?:explore|discovery\/item)\/([\w-]+)/) || [])[1];
      if (!noteId) continue;

      const relTime = (await card.locator(XHS.cardRelativeTime).first().textContent().catch(() => ''))?.trim();
      let publishedAt;
      try {
        publishedAt = parseXhsRelativeTime(relTime, scrapedAt);
      } catch {
        continue;
      }
      if (scrapedAt.getTime() - publishedAt.getTime() > windowMs) break;
      totalInWindow++;

      if (seen.has(noteId)) {
        alreadySeen++;
        continue;
      }

      const title = (await card.locator(XHS.cardTitle).first().textContent().catch(() => ''))?.trim() ?? '';
      const author = (await card.locator(XHS.cardAuthor).first().textContent().catch(() => ''))?.trim() ?? '';
      const url = href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`;

      const detailPage = await context.newPage();
      let detail = { content: '', tags: [], metrics: {}, image_count: 0 };
      try {
        await detailPage.goto(url, { waitUntil: 'domcontentloaded' });
        await detailPage.waitForTimeout(cfg.scrape.detail_wait_ms);
        detail.content = (await detailPage.locator(XHS.detailContent).first().textContent().catch(() => ''))?.trim() ?? '';
        const tagEls = detailPage.locator(XHS.detailTags);
        const tagCount = await tagEls.count();
        for (let t = 0; t < tagCount; t++) detail.tags.push((await tagEls.nth(t).textContent()).trim());
        detail.metrics.likes = await detailPage.locator(XHS.detailMetrics.likes).first().textContent().catch(() => null);
        detail.metrics.collects = await detailPage.locator(XHS.detailMetrics.collects).first().textContent().catch(() => null);
        detail.metrics.comments = await detailPage.locator(XHS.detailMetrics.comments).first().textContent().catch(() => null);
        detail.image_count = await detailPage.locator(XHS.detailImages).count();
      } catch {
        // tolerate failures on detail page; keep partial info
      } finally {
        await detailPage.close();
      }

      posts.push({
        note_id: noteId,
        url,
        title,
        author: { name: author, id: null },
        published_at: publishedAt.toISOString(),
        published_relative: relTime,
        content: detail.content,
        tags: detail.tags,
        metrics: detail.metrics,
        image_count: detail.image_count,
      });
      seen.markSeen(noteId, { title, firstSeen: scrapedAt });

      await page.waitForTimeout(randomBetween(cfg.scrape.card_delay_ms));
    }

    seen.setLastRunAt(scrapedAt);
    seen.gc(30, scrapedAt);
    seen.save();

    payload = {
      scraped_at: scrapedAt.toISOString(),
      keyword: cfg.source.keyword,
      stats: {
        window_hours: cfg.window.hours,
        total: totalInWindow,
        new: posts.length,
        already_seen: alreadySeen,
      },
      posts,
      error: null,
    };
    // Note: the /loop LLM augments `stats` with `by_verdict` when transforming
    // this output into `broadcast.json` (DESIGN §7.2). Names `total / new /
    // already_seen / window_hours` are stable across scrape and broadcast.
  } catch (err) {
    payload = { error: err.code ?? 'network', message: err.message };
    exitCode = err.exit ?? 5;
  } finally {
    await browser.close();
    if (lockAcquired) { releaseLock(LOCK_PATH); lockAcquired = false; }
  }

  emit(payload);
  process.exit(exitCode);
}

main().catch((err) => {
  if (lockAcquired) { releaseLock(LOCK_PATH); lockAcquired = false; }
  emit({ error: 'network', message: err.message });
  process.exit(5);
});
