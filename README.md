# xhs-watcher

Periodic Xiaohongshu (小红书) keyword watcher. Filters info-asymmetry signals via LLM (Claude Code `/loop`) and broadcasts to terminal + Telegram every 6 hours.

Default config monitors `claude code` — surfaces new workflows, hidden behaviors, fresh hook/skill/MCP/subagent recipes that a Claude Code power user hasn't seen yet.

See [`DESIGN.md`](./DESIGN.md) for full spec.

---

## Install

Requires Node ≥ 20.

```sh
git clone https://github.com/<you>/xhs-watcher
cd xhs-watcher
npm install
npx playwright install chromium
```

## Configure

```sh
cp .env.example .env
$EDITOR .env    # fill in XHS_WATCHER_TG_BOT_TOKEN and XHS_WATCHER_TG_CHAT_ID
```

To monitor a different keyword, edit `watcher.yml`. See `watcher.example.yml` for a non-default example.

## First-time login

Pick whichever fits your host:

**With a display (laptop, desktop)**:
```sh
node login.mjs
# Chromium opens → scan QR / log in → press Enter in terminal
# state/storage.json is written (gitignored)
```

**Headless / server (no X11)**:
```sh
# 1. On your normal browser, log in to xiaohongshu.com
# 2. DevTools → Network → click any xhs request → Headers → copy `cookie:` value
# 3. On the server:
echo '<paste cookie header value>' | node import-cookies.mjs
```

## Run manually

```sh
node scrape.mjs > /tmp/scrape.json                      # one-shot multi-keyword scrape
cat /tmp/scrape.json | node llm-verdict.mjs > /tmp/b.json  # LLM-classified broadcast
cat /tmp/b.json | node notify.mjs --terminal --tg       # render + dispatch to TG
cat /tmp/b.json | node notify.mjs --update-verdicts     # persist verdicts to seen.json
```

## Run on schedule (Linux server, systemd)

The repo ships systemd `--user` unit files (under `systemd/` if extracted; or
copy the four shown below to `~/.config/systemd/user/`). Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now xhs-watcher.timer            # main scrape, every 6h
systemctl --user enable --now xhs-cookies-validate.timer   # daily liveness check
systemctl --user enable --now xhs-cookies-refresh.path     # watcher for cookie-refresh
systemctl --user list-timers 'xhs-*'                       # confirm scheduling
```

**Refreshing cookies later** (when XHS session expires — usually weeks):

The cookie-validate timer fires daily; if your session has expired, you'll get
a TG message with the exact command to run. Refresh by writing the new cookie
header to a watched path — systemd auto-imports, deletes the source, and
triggers a verification scrape:

```sh
echo '<paste fresh cookie header>' > ~/xhs-cookies-new.txt
# That's it. Within 1-2 seconds:
#   - xhs-cookies-refresh.path triggers
#   - xhs-cookies-refresh.service runs import-cookies.mjs
#   - source file is shredded
#   - TG channel receives "✅ Cookie 已刷新"
#   - xhs-watcher.service is triggered to verify
```

## Run on schedule (Claude Code, /loop)

```
/loop 6h <paste LOOP_PROMPT.md body>
```

The LLM applies the signal filter and dispatches to both terminal and Telegram.
Useful for interactive sessions; for durable unattended runs prefer systemd.

## Switch to a different keyword

Edit `watcher.yml`:

```yaml
source:
  keyword: "comfyui workflow"
```

Update `signal.brief` and `signal.verdicts.*.examples` to define what counts as a signal for that topic. Restart the loop.

## Security

- **NEVER commit** `state/storage.json` — equivalent to your XHS login
- **NEVER commit** `.env` — contains TG bot token
- If a bot token leaks, run `/revoke` in [@BotFather](https://t.me/BotFather) immediately

## Layout

```
scrape.mjs        Playwright scraper, JSON to stdout
login.mjs         One-shot interactive login
notify.mjs        Reads broadcast JSON from stdin → terminal + TG
watcher.yml       Config: keyword, window, signal definition, notify channels
LOOP_PROMPT.md    Body to paste into /loop
lib/
  time-parser.mjs  XHS relative time → ISO
  seen.mjs         Dedup state with GC
  config.mjs       Loads watcher.yml + .env
  lock.mjs         PID-based single-run guard
  selectors.mjs    XHS DOM selectors (patch here when site changes)
  tg.mjs           Telegram API client
  render.mjs       Terminal Markdown + TG HTML renderers
tests/             Unit tests (node:test)
state/             Runtime state (gitignored)
```

## Tests

```sh
npm test
```

## License

MIT
