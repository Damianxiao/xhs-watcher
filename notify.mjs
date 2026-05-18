#!/usr/bin/env node
import { Seen } from './lib/seen.mjs';
import { loadConfig } from './lib/config.mjs';
import { renderTerminal, renderTelegramMessages } from './lib/render.mjs';
import { sendAll } from './lib/tg.mjs';

function parseArgs(argv) {
  const flags = { terminal: false, tg: false, updateVerdicts: false, dryRun: false };
  for (const a of argv) {
    if (a === '--terminal') flags.terminal = true;
    else if (a === '--tg') flags.tg = true;
    else if (a === '--update-verdicts') flags.updateVerdicts = true;
    else if (a === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  const broadcastJson = await readStdin();
  const broadcast = JSON.parse(broadcastJson);

  // Mode A: update verdicts in seen.json
  if (flags.updateVerdicts) {
    const seenPath = 'state/seen.json';
    const seen = Seen.load(seenPath);
    for (const card of broadcast.cards ?? []) {
      if (card.note_id && card.verdict) seen.setVerdict(card.note_id, card.verdict);
    }
    for (const f of broadcast.filtered_summary ?? []) {
      if (f.note_id && f.verdict) seen.setVerdict(f.note_id, f.verdict);
    }
    seen.save();
    console.log(`✓ verdict updated for ${(broadcast.cards?.length ?? 0) + (broadcast.filtered_summary?.length ?? 0)} notes`);
    return;
  }

  // Mode B: render and dispatch
  let tgError = null;
  if (flags.terminal || (!flags.terminal && !flags.tg)) {
    console.log(renderTerminal(broadcast));
  }

  if (flags.tg && cfg.notify?.telegram?.enabled) {
    // Skip TG broadcast in two "nothing actionable" cases — keeps the channel
    // free of recurring footer-only messages once the system reaches steady
    // state. Error broadcasts (broadcast.error truthy) always go through so
    // the user knows about login_expired / network / etc.
    //
    //   (a) stats.new === 0 — scrape returned no new posts at all
    //   (b) cards + known items both 0 — only ad/noise produced, nothing
    //       worth surfacing. (`known` items DO get a compact TG render and
    //       therefore count as actionable.)
    const cardCount = (broadcast.cards ?? []).length;
    const knownCount = (broadcast.filtered_summary ?? []).filter((f) => f.verdict === 'known').length;
    const actionable = cardCount + knownCount;
    const isNothingActionable = !broadcast.error &&
      (broadcast.stats?.new === 0 || actionable === 0);
    const notifyOnEmpty = cfg.notify.telegram.notify_on_empty ?? false;
    if (isNothingActionable && !notifyOnEmpty) {
      // intentional no-op for TG; terminal already rendered the broadcast
    } else {
    const msgs = renderTelegramMessages(broadcast);
    if (flags.dryRun) {
      console.log('--- TG dry-run, messages would be sent: ---');
      for (const m of msgs) console.log('---\n' + m);
    } else {
      const tg = cfg.notify.telegram;
      if (!tg.bot_token || !tg.chat_id) {
        tgError = 'TG token or chat_id missing (check .env)';
      } else {
        const results = await sendAll(msgs, {
          botToken: tg.bot_token,
          chatId: tg.chat_id,
          parseMode: tg.parse_mode ?? 'HTML',
        });
        const failed = results.filter((r) => !r.ok);
        if (failed.length > 0) {
          tgError = failed.map((f) => f.error).join('; ');
        }
      }
    }
    }
  }

  if (tgError) {
    const onFailure = cfg.notify?.telegram?.on_failure ?? 'warn';
    if (onFailure === 'abort') {
      process.stderr.write(`\nTG push failed: ${tgError}\n`);
      process.exit(1);
    } else {
      console.log(`\n⚠️ TG push failed: ${tgError}`);
    }
  }
}

main().catch((err) => {
  console.error(`notify.mjs error: ${err.message}`);
  process.exit(1);
});
