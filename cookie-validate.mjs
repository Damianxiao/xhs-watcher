#!/usr/bin/env node
// Quick liveness check for the XHS session in state/storage.json.
// Visits xiaohongshu.com and decides:
//   - logged in   → exit 0 (silent)
//   - expired     → exit 2 + JSON to stdout
//   - inconclusive → exit 5 + JSON (network / DOM drift / etc.)
//
// Designed to be cheap (one nav, no card iteration) so we can run it daily
// from a systemd timer and surface "cookie about to expire" in TG before the
// 6h scrape itself fails.

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { XHS } from './lib/selectors.mjs';

const STORAGE_PATH = 'state/storage.json';

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  if (!existsSync(STORAGE_PATH)) {
    emit({ error: 'login_expired', message: `${STORAGE_PATH} 缺失 — 请粘贴 cookie 到 ~/xhs-cookies-new.txt` });
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: STORAGE_PATH });
    const page = await context.newPage();
    await page.goto('https://www.xiaohongshu.com/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.waitForTimeout(2500);

    // URL redirect to passport = definitively expired.
    if (page.url().includes(XHS.loginIndicators.redirectHostname)) {
      emit({ error: 'login_expired', message: 'session 已过期，跳转到 passport — 请粘贴新 cookie 到 ~/xhs-cookies-new.txt' });
      process.exit(2);
    }

    // Inline login wall = also expired.
    const state = await page.evaluate((t) => {
      const body = document.body && document.body.innerText ? document.body.innerText : '';
      // Heuristic: logged-in users see "创作中心 / 业务合作 / 发布 / 通知 / 我"
      // in the nav. Anonymous users see "登录" / 登录后查看 etc.
      const hasLoginWall = body.includes(t) || body.includes('登录') && !body.includes('创作中心');
      const hasLoggedInNav = body.includes('创作中心') && body.includes('通知');
      return { hasLoginWall, hasLoggedInNav };
    }, XHS.loginIndicators.loginRequiredText);

    if (state.hasLoggedInNav && !state.hasLoginWall) {
      // Logged in. Silent success.
      process.exit(0);
    }
    if (state.hasLoginWall) {
      emit({ error: 'login_expired', message: 'XHS 首页显示登录墙 — 请粘贴新 cookie 到 ~/xhs-cookies-new.txt' });
      process.exit(2);
    }
    emit({ error: 'inconclusive', message: '无法判定 session 状态（既无登录墙也无 logged-in nav） — 可能是 XHS 改版或风控' });
    process.exit(5);
  } catch (err) {
    emit({ error: 'network', message: err.message });
    process.exit(5);
  } finally {
    await browser.close();
  }
}

main();
