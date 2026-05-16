# xhs-watcher

> 通用 Xiaohongshu (小红书) 关键词监视器。每 N 小时扫一遍指定关键词的新帖，用 LLM 按"信息差"标准过滤，把信号同步播报到终端 + Telegram。

**默认配置**：监视 `claude code` 关键词，过滤出对 Claude Code power user 有价值的新工作流 / 隐藏玩法 / 新 hook & skill & MCP 配方。

详细设计见 [`DESIGN.md`](./DESIGN.md)。实现计划见 `IMPLEMENTATION_PLAN.md`（由 `superpowers:writing-plans` 生成）。

---

## 状态

🚧 设计阶段已完成，实现尚未开始。

---

## 概览

```
scrape.mjs (Playwright) ─► /loop LLM 判定 verdict ─► notify.mjs (终端 + Telegram)
        │                                                    ▲
        ▼                                                    │
   state/seen.json ◄──────────────────────────────────────────
```

- **scrape.mjs**：登录态从 `state/storage.json` 加载，按时间窗口（默认 12h）抓取新帖。
- **/loop LLM**：每 6h 自动跑一轮，按 `watcher.yml` 中的信号定义判定 verdict。
- **notify.mjs**：终端 Markdown + Telegram HTML 双路输出。

## 安装（待实现完成后）

```sh
git clone https://github.com/<you>/xhs-watcher
cd xhs-watcher
npm install
npx playwright install chromium

cp .env.example .env
# 编辑 .env 填入 TG bot token + chat id

node login.mjs
# 浏览器弹出 → 扫码登录 XHS → 回终端按 Enter
```

启动 `/loop`（在 Claude Code 中）：
```
/loop 6h <粘贴 LOOP_PROMPT.md 内容>
```

## 安全提示

- **绝不**把 `state/storage.json`、`.env`、bot token 提交到 git
- bot token 一旦泄露，立即去 [@BotFather](https://t.me/BotFather) `/revoke`
- `state/storage.json` 等同 XHS 登录态，泄露相当于账号被盗

## License

MIT
