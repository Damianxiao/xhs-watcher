import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import 'dotenv/config';

export function loadConfig(path = 'watcher.yml') {
  const raw = readFileSync(path, 'utf8');
  const cfg = yaml.load(raw);

  cfg.source.resolvedUrl = cfg.source.search_url.replace(
    '{keyword}',
    encodeURIComponent(cfg.source.keyword),
  );

  if (cfg.notify?.telegram) {
    const tg = cfg.notify.telegram;
    tg.bot_token = tg.bot_token_env ? process.env[tg.bot_token_env] : undefined;
    tg.chat_id = tg.chat_id_env ? process.env[tg.chat_id_env] : undefined;
  }

  return cfg;
}
