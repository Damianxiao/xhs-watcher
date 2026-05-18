#!/bin/bash
# Orchestrator for xhs-watcher.service.
#
# Error policy: only `login_expired` is pushed to TG (it requires user action).
# All other errors (network / selector_missing / already_running) are logged
# to /tmp/xhs-watcher.log and silently retried next hour — they're transient.
#
# Lives as a file (not inline in the systemd unit) so the JSON-error-extract
# node -e doesn't go through systemd→bash→node triple-escaping.

set -u

LOG=/tmp/xhs-watcher.log
SCRAPE_OUT=/tmp/xhs-scrape.json
BROADCAST_OUT=/tmp/xhs-broadcast.json
NODE=/home/linuxbrew/.linuxbrew/bin/node

cd "$(dirname "$0")"

"$NODE" scrape.mjs > "$SCRAPE_OUT" 2>>"$LOG"
ec=$?

err=$("$NODE" -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>{try{console.log(JSON.parse(s).error||"")}catch{console.log("")}})' < "$SCRAPE_OUT")

if [ "$err" = "login_expired" ]; then
  "$NODE" notify.mjs --terminal --tg < "$SCRAPE_OUT" >>"$LOG" 2>&1
  exit 0
fi

if [ "$ec" -ne 0 ]; then
  echo "[$(date -Is)] scrape exit $ec error=$err — silent (will retry next hour)" >> "$LOG"
  exit 0
fi

"$NODE" llm-verdict.mjs < "$SCRAPE_OUT" > "$BROADCAST_OUT" 2>>"$LOG"
"$NODE" notify.mjs --terminal --tg < "$BROADCAST_OUT" >>"$LOG" 2>&1
"$NODE" notify.mjs --update-verdicts < "$BROADCAST_OUT" >>"$LOG" 2>&1
