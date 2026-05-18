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

    const windowMs = cfg.window.hours * 3600_000;
    // Per-keyword accumulators. Dedup by note_id happens at the end (the
    // same post can surface in multiple keyword searches — count it once
    // for stats and emit one record).
    const postsByNoteId = new Map();
    let totalInWindowAcc = 0;
    let alreadySeenAcc = 0;

    const waitArgs = {
      feedSel: XHS.feedContainer,
      overlaySel: XHS.loginIndicators.loginRequiredOverlay,
      loginText: XHS.loginIndicators.loginRequiredText,
    };
    const evalState = (s) => {
      if (document.querySelector(s.feedSel)) return 'feed';
      if (document.querySelector(s.overlaySel)) return 'login';
      if (document.body && document.body.innerText.includes(s.loginText)) return 'login';
      return false;
    };

    // Navigate to a keyword URL and wait for the page to settle into either
    // `feed` or `login`. Returns the resolved state, or `'nav_failed'` if the
    // navigation itself errored (network timeout, DNS, TLS, etc.).
    async function navAndSettle(url) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      } catch {
        return 'nav_failed';
      }
      if (page.url().includes(XHS.loginIndicators.redirectHostname)) return 'login';
      const handle = await page
        .waitForFunction(evalState, waitArgs, { timeout: 15_000 })
        .catch(() => null);
      let state = handle ? await handle.jsonValue() : null;
      if (state === 'login') {
        // Login modal sometimes flashes during initial render — recheck after a
        // short wait before declaring the session dead.
        await page.waitForTimeout(3000);
        state = await page.evaluate(evalState, waitArgs);
      }
      return state;
    }

    for (const kw of cfg.source.keywordList) {
      const url = cfg.source.search_url.replace('{keyword}', encodeURIComponent(kw));
      let settled = await navAndSettle(url);

      // XHS occasionally either serves a stripped page (no feed, no login
      // wall) or times out the navigation itself. One retry with a 5s gap
      // clears the vast majority of both cases. After the retry, give up on
      // this keyword and continue — partial results are fine.
      if (settled !== 'feed' && settled !== 'login') {
        await page.waitForTimeout(5000);
        settled = await navAndSettle(url);
      }

      // If still not feed/login after retry, surface as network if the goto
      // itself failed, or selector_missing if nav succeeded but DOM is off.
      if (settled === 'nav_failed') {
        throw Object.assign(new Error(`navigation timeout/error for keyword "${kw}"`), {
          code: 'network',
          exit: 5,
        });
      }

      if (settled === 'login') {
        throw Object.assign(new Error('login expired'), { code: 'login_expired', exit: 2 });
      }
      if (settled !== 'feed') {
        throw Object.assign(new Error('feed container missing'), {
          code: 'selector_missing',
          exit: 4,
        });
      }

      const cards = page.locator(XHS.noteCard);
      const count = await cards.count();

      for (let i = 0; i < count && postsByNoteId.size < cfg.window.max_posts_per_run; i++) {
        const card = cards.nth(i);
        const href = await card.locator(XHS.cardLink).first().getAttribute('href').catch(() => null);
        if (!href) continue;
        // Tokenized URL: /search_result/<id>?xsec_token=... — used for navigation.
        // Also accept /explore/<id> and /discovery/item/<id> defensively.
        const noteId = (href.match(/\/(?:search_result|explore|discovery\/item)\/([\w-]+)/) || [])[1];
        if (!noteId) continue;

        const relTime = (await card.locator(XHS.cardRelativeTime).first().textContent().catch(() => ''))?.trim();
        let publishedAt;
        try {
          publishedAt = parseXhsRelativeTime(relTime, scrapedAt);
        } catch {
          continue;
        }
        // NOTE: XHS search results are NOT strictly time-sorted even with
        // sort=time — verified 2026-05-17, top of feed was 4天前 / 3天前 /
        // 1天前 / 2天前. So we cannot `break` on first-out-of-window; we must
        // scan the full feed (capped at max_posts_per_run).
        if (scrapedAt.getTime() - publishedAt.getTime() > windowMs) continue;
        totalInWindowAcc++;

        if (seen.has(noteId)) {
          alreadySeenAcc++;
          continue;
        }
        // Cross-keyword in-memory dedup: if we already collected this note
        // under a previous keyword in this run, skip re-fetch.
        if (postsByNoteId.has(noteId)) continue;

        const title = (await card.locator(XHS.cardTitle).first().textContent().catch(() => ''))?.trim() ?? '';
        const authorRaw = (await card.locator(XHS.cardAuthor).first().textContent().catch(() => ''))?.trim() ?? '';
        // a.author text contains "<name>\n<relative time>" or "<name><relative time>".
        // Strip the trailing time suffix to get just the display name.
        const author = authorRaw
          .replace(/[\s\n]*\d+\s*(?:秒|分钟|小时|天|周|个月|年)前\s*$/, '')
          .replace(/[\s\n]*(?:刚刚|今天|昨天)(?:\s+\d{1,2}:\d{2})?\s*$/, '')
          .trim();
        const cardLikes = (await card.locator(XHS.cardLikes).first().textContent().catch(() => ''))?.trim();
        // Build navigation URL: prepend host if relative. Also produce a clean
        // user-facing /explore/<id>?xsec_token=... form for display + TG link
        // (XHS auto-redirects /search_result/ → /explore/ during nav anyway).
        const rawHref = href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`;
        const tokenMatch = rawHref.match(/[?&](xsec_token=[^&]+)/);
        const xsecToken = tokenMatch ? tokenMatch[1] : '';
        const postUrl = xsecToken
          ? `https://www.xiaohongshu.com/explore/${noteId}?${xsecToken}`
          : rawHref;

        const detailPage = await context.newPage();
        let detail = { content: '', tags: [], metrics: {}, image_count: 0 };
        try {
          await detailPage.goto(rawHref, { waitUntil: 'domcontentloaded' });
          // Wait for the content container; bail after detail_wait_ms if it
          // never appears (some posts may be restricted / deleted).
          await detailPage.locator(XHS.detailContent).first().waitFor({ timeout: cfg.scrape.detail_wait_ms + 3000 }).catch(() => {});
          detail.content = (await detailPage.locator(XHS.detailContent).first().textContent().catch(() => ''))?.trim() ?? '';
          const tagEls = detailPage.locator(XHS.detailTags);
          const tagCount = await tagEls.count();
          for (let t = 0; t < tagCount; t++) {
            const tagText = (await tagEls.nth(t).textContent().catch(() => '')).trim();
            if (tagText) detail.tags.push(tagText.replace(/^#/, ''));
          }
          detail.metrics.likes = (await detailPage.locator(XHS.detailMetrics.likes).first().textContent().catch(() => null))?.trim() || null;
          detail.metrics.collects = (await detailPage.locator(XHS.detailMetrics.collects).first().textContent().catch(() => null))?.trim() || null;
          detail.metrics.comments = (await detailPage.locator(XHS.detailMetrics.comments).first().textContent().catch(() => null))?.trim() || null;
          detail.image_count = await detailPage.locator(XHS.detailImages).count();
        } catch {
          // tolerate failures on detail page; keep partial info
        } finally {
          await detailPage.close();
        }

        // Prefer detail-page metrics; fall back to the like count visible on
        // the search card when the detail-page selectors miss.
        const metrics = { ...detail.metrics };
        if (!metrics.likes && cardLikes) metrics.likes = cardLikes;

        postsByNoteId.set(noteId, {
          note_id: noteId,
          url: postUrl,
          title,
          author: { name: author, id: null },
          published_at: publishedAt.toISOString(),
          published_relative: relTime,
          content: detail.content,
          tags: detail.tags,
          metrics,
          image_count: detail.image_count,
        });
        seen.markSeen(noteId, { title, firstSeen: scrapedAt });

        await page.waitForTimeout(randomBetween(cfg.scrape.card_delay_ms));
      }
    }

    const posts = Array.from(postsByNoteId.values());

    seen.setLastRunAt(scrapedAt);
    seen.gc(30, scrapedAt);
    seen.save();

    payload = {
      scraped_at: scrapedAt.toISOString(),
      keyword: cfg.source.keywordList.join(', '),
      stats: {
        window_hours: cfg.window.hours,
        total: totalInWindowAcc,
        new: posts.length,
        already_seen: alreadySeenAcc,
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
