import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import 'dotenv/config';

export function loadConfig(path = 'watcher.yml') {
  const raw = readFileSync(path, 'utf8');
  const cfg = yaml.load(raw);

  // Multi-keyword: source.keywords (array) takes precedence; otherwise fall
  // back to single source.keyword. Always expose a normalized list +
  // resolvedUrls; keep resolvedUrl as resolvedUrls[0] for backward compat.
  const keywords = Array.isArray(cfg.source.keywords) && cfg.source.keywords.length > 0
    ? cfg.source.keywords
    : (cfg.source.keyword ? [cfg.source.keyword] : []);
  cfg.source.keywordList = keywords;
  cfg.source.resolvedUrls = keywords.map((k) =>
    cfg.source.search_url.replace('{keyword}', encodeURIComponent(k)),
  );
  cfg.source.resolvedUrl = cfg.source.resolvedUrls[0];

  if (cfg.notify?.telegram) {
    const tg = cfg.notify.telegram;
    tg.bot_token = tg.bot_token_env ? process.env[tg.bot_token_env] : undefined;
    tg.chat_id = tg.chat_id_env ? process.env[tg.chat_id_env] : undefined;
  }

  return cfg;
}
