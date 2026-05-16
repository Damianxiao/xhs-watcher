# xhs-watcher `/loop` prompt

Paste this content as the body of a `/loop 6h <body>` invocation inside Claude Code. The model should execute these steps every iteration.

---

执行 xhs-watcher 监视任务（仓库位于 `~/xhs-watcher`）：

1. **Bash**: `cd ~/xhs-watcher && node scrape.mjs > /tmp/xhs-scrape.json; echo "EXIT=$?"`
2. **Read** `/tmp/xhs-scrape.json`. Branch on `error`:
   - `login_expired` → run step 5 with a broadcast object `{ "error": "login_expired", "message": "请运行 cd ~/xhs-watcher && node login.mjs 重新登录" }` and stop.
   - `cf_challenge` → broadcast `{ "error": "cf_challenge", "message": "风控触发，等下一轮自动重试" }` and stop.
   - `selector_missing` → broadcast `{ "error": "selector_missing", "message": "XHS DOM 变了，需要修 lib/selectors.mjs" }` and stop.
   - `network` → broadcast `{ "error": "network", "message": "<原 message>" }` and stop.
   - `already_running` → silently exit (no broadcast).
   - `null` + `stats.new == 0` → broadcast `{ "scraped_at": ..., "stats": {...}, "cards": [], "filtered_summary": [] }` so the renderer says "窗口无新帖" and stop.
   - `null` + `stats.new > 0` → continue to step 3.

3. For each `post` in `scrape.posts`, determine `verdict ∈ {signal, maybe, known, ad, noise}` per the `signal.brief` and `signal.verdicts.*.examples` from `watcher.yml`. Be strict: target reader already knows superpowers / hooks / TDD / worktree basics.

4. **Write** `/tmp/xhs-broadcast.json` matching DESIGN.md §7.2:
   - For `signal` and `maybe` cards: extract `workflow_name` (you invent it), `one_liner`, `key_steps` (2-4 bullets max), `applicable`, `verdict_reason`. Include `author`, `published_relative`, `metrics`, `url`.
   - For `known | ad | noise`: only include in `filtered_summary` with `note_id`, `verdict`, `title`, `author`, `published_relative`, `url`.
   - Fill `stats.by_verdict` with counts.

5. **Bash**: `cat /tmp/xhs-broadcast.json | node ~/xhs-watcher/notify.mjs --terminal --tg`
6. **Bash**: `cat /tmp/xhs-broadcast.json | node ~/xhs-watcher/notify.mjs --update-verdicts`
7. Print one-line summary to chat: `📡 完成：信号 N · 存疑 M · 已过滤 K`.
