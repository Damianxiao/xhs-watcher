#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const STORAGE_PATH = 'state/storage.json';

async function waitForEnter(msg) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  await rl.question(msg);
  rl.close();
}

async function main() {
  console.log('Opening browser. Scan or enter credentials to log in to xiaohongshu.com.');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://www.xiaohongshu.com/');

  console.log('');
  await waitForEnter('登录完成后回到这里按 Enter ▶ ');

  mkdirSync(dirname(STORAGE_PATH), { recursive: true });
  await context.storageState({ path: STORAGE_PATH });
  await browser.close();
  console.log(`✅ 登录态已保存到 ${STORAGE_PATH}`);
}

main().catch((err) => {
  console.error(`login.mjs error: ${err.message}`);
  process.exit(1);
});
