# xhs-watcher — Design Spec

**日期** 2026-05-16
**状态** Approved (brainstorming complete, awaiting implementation plan)
**License** MIT
**仓库定位** 通用 Xiaohongshu (XHS) 关键词监视器。默认配置 = 监视 "claude code" 信息差，但关键词、信号定义、通知渠道全部走配置文件。

---

## 1. 目标

每 6 小时自动扫描 XHS 上指定关键词的最新帖子，使用 LLM 按"信息差"标准过滤，把信号同步播报到：
- 终端（Claude Code `/loop` 会话中）
- Telegram 频道

**核心场景**：用户是 Claude Code power user，希望不错过别人发现的新工作流、隐藏功能、新 hook/skill/MCP 配方，但不愿被卖课、感叹文、低质内容淹没。

**非目标**：
- 不抓全量历史，只看时间窗内（默认 12h）的新帖
- 不做 OCR / 图像理解（文本足够判断信号）
- 不做评论区抓取
- 不替代浏览 — 是"信号雷达"，深入研究仍需点开原帖

---

## 2. 架构

```
┌──────────────┐   stdout JSON    ┌────────────┐   render Markdown    ┌────────────┐
│  scrape.mjs  │ ───────────────► │  /loop LLM │ ───────────────────► │ notify.mjs │
│  (Playwright)│                  │  (filter)  │                      │ terminal+TG│
└──────┬───────┘                  └──────┬─────┘                      └────────────┘
       │                                 │
       ▼                                 ▼
  state/seen.json (read)           state/seen.json (write verdicts)
  state/storage.json (read)
```

三段责任划分：
- **scrape.mjs**：确定性，只负责"拿到时间窗内的新帖原始数据"
- **/loop LLM**：唯一的语义判断环节，按 watcher.yml 中的 signal 定义打 verdict 并渲染卡片
- **notify.mjs**：确定性，只负责"把渲染好的内容分发到启用的渠道"

**为什么这么分**：scrape 和 notify 都是纯机械逻辑，可独立测试和调试；LLM 判断逻辑是唯一会演进的部分，集中在 prompt + 配置里，改动不需要碰代码。

---

## 3. 仓库结构

```
xhs-watcher/
├── README.md
├── LICENSE                  # MIT
├── DESIGN.md                # 本文档
├── LOOP_PROMPT.md           # /loop 用的完整 prompt
├── package.json
├── .gitignore
├── .env.example
├── watcher.yml              # 默认配置（Claude Code）
├── watcher.example.yml      # 备用示例（如 "comfyui 工作流"）展示通用性
├── scrape.mjs               # Playwright 抓取
├── login.mjs                # 一次性登录交互
├── notify.mjs               # 终端 + TG 渲染分发
├── lib/
│   ├── config.mjs           # 读 watcher.yml + .env
│   ├── time-parser.mjs      # "X小时前" → ISO
│   ├── seen.mjs             # seen.json 读写 + GC
│   └── tg.mjs               # Telegram Bot API 客户端
└── state/
    └── .gitkeep             # 占位；state/ 实际内容全部 .gitignore
```

**`.gitignore` 关键项**：
```
state/
!state/.gitkeep
.env
.env.local
*.local.yml
node_modules/
```

---

## 4. 配置文件 (`watcher.yml`)

```yaml
source:
  platform: xiaohongshu
  search_url: "https://www.xiaohongshu.com/search_result?keyword={keyword}&sort=time"
  keyword: "claude code"

window:
  hours: 12
  max_posts_per_run: 100

scrape:
  card_delay_ms: [800, 2500]    # 卡片间随机等待区间
  detail_wait_ms: 1000           # 详情页 DOM 静止等待
  user_agent: ""                 # 留空 = Playwright 默认

signal:
  brief: |
    目标读者：已经把 Claude Code 当主力工具的 power user
    （熟悉 hooks / skills / subagents / MCP / settings.json / CLAUDE.md / superpowers 等）。
    判断标准：这条帖子能否告诉这个读者他不知道的东西？

  verdicts:
    signal:
      label: "🟢 信号"
      examples:
        - 新 feature 的非官方玩法
        - 隐藏行为 / undocumented behavior
        - 新 hook / skill / MCP / subagent 配方
        - Anthropic 刚出更新的具体应用
        - 跨工具集成新姿势
    maybe:
      label: "🟡 存疑"
      hint: "看起来像信号但缺细节，让用户自己判断"
    known:
      label: "🔘 已知"
      examples:
        - prompt engineering 老生常谈
        - superpowers / git worktree / TDD 等已知话题且无新角度
    ad:
      label: "📢 广告"
      examples:
        - 训练营 / 付费课
        - "AI 替代程序员"情绪文
    noise:
      label: "🗑 无干货"
      examples:
        - 纯感叹
        - "todo app 炫耀"
        - 和 Cursor/Copilot 的泛对比

output:
  language: zh-CN
  card_fields: [workflow_name, one_liner, key_steps, applicable, verdict_reason]

notify:
  telegram:
    enabled: true
    bot_token_env: XHS_WATCHER_TG_BOT_TOKEN
    chat_id_env: XHS_WATCHER_TG_CHAT_ID
    parse_mode: HTML
    max_chars_per_message: 4000
    one_message_per_signal: true
    include_filtered: false
    on_failure: warn               # warn | abort
```

**通用性设计**：`source.platform: xiaohongshu` 是 schema 上的接口。未来添加 `twitter` / `hackernews` 仅需要在 `scrape.mjs` 内部分支化抓取逻辑 + 在 README 写新的登录流程，本文档不展开。

---

## 5. `scrape.mjs` — 抓取脚本

### 5.1 输入
- `watcher.yml`（关键词、URL、窗口、超时等）
- `state/storage.json`（Playwright storageState）
- `state/seen.json`（去重表）

### 5.2 流程

1. 检查 `state/.lock` —— 若存在且 PID 仍活着，立即退出并输出 `{error: "already_running"}`；若 PID 已死则视为崩溃残留，清掉继续
2. 写入 `state/.lock`（PID + 启动时间）
3. 启动 Playwright Chromium，加载 `state/storage.json`
4. 打开 `source.search_url`（关键词替换后），等 `domcontentloaded` + 1s
5. 检测登录态：
   - 若跳转到 `passport.xiaohongshu.com` 或出现登录弹窗选择器 → 输出 `{error: "login_expired"}`，exit 2
6. 等卡片列表渲染（具体选择器在实现期通过 inspect 确定）
7. 顺序遍历卡片：
   - 解析相对时间（"X小时前 / 今天 HH:MM / 昨天 HH:MM"）→ 绝对 ISO 时间
   - 若超出 `window.hours` → **停止滚动**（已按时间排序，后面只会更老）
   - 若 `note_id` 已在 `seen.json` → 计数到 `already_seen`，跳过
   - 否则点进详情页，抓正文 / 图片 alt / 点赞 / 收藏 / 评论数 / 标签
   - 抓完后随机 sleep `scrape.card_delay_ms`
8. 写回 `seen.json`：
   - 新条目添加 `{first_seen, title}`
   - 已存在条目仅更新 `last_seen_at`（在顶层，不是每条）
   - GC 删除 `first_seen` > 30 天的条目
9. 删除 `state/.lock`
10. 输出 JSON 到 stdout，exit 0

**单次最多抓 100 条**（`window.max_posts_per_run`）防止配置错误时把网站打爆 / 内存爆炸。

### 5.3 输出 schema

```json
{
  "scraped_at": "2026-05-16T14:00:00+08:00",
  "keyword": "claude code",
  "stats": {
    "window_hours": 12,
    "total": 23,
    "new": 7,
    "already_seen": 16
  },
  "posts": [
    {
      "note_id": "abc123",
      "url": "https://www.xiaohongshu.com/explore/abc123",
      "title": "...",
      "author": { "name": "xxx", "id": "..." },
      "published_at": "2026-05-16T10:30:00+08:00",
      "published_relative": "4小时前",
      "content": "...",
      "tags": ["claude code", "ai"],
      "metrics": { "likes": 234, "collects": 89, "comments": 12 },
      "image_count": 5
    }
  ],
  "error": null
}
```

### 5.4 错误码（exit code ≠ 0）

| `error` 值 | exit | 含义 | /loop 响应 |
|---|---|---|---|
| `login_expired` | 2 | Cookie 失效或跳转登录页 | 播报"请重新登录"，不更新 seen.json |
| `selector_missing` | 4 | DOM 结构变化（XHS 改版） | 播报"页面结构变了，需修脚本"，不更新 |
| `network` | 5 | 超时/DNS 等可重试错误 | 播报"网络问题"，下一轮自动重试 |
| `already_running` | 6 | 前一轮还在跑 | 播报"前一轮未完成，跳过"，不更新 |

### 5.5 反爬礼貌

- 卡片间随机 sleep（默认 800-2500ms）
- 详情页打开后 wait `domcontentloaded` + `detail_wait_ms`
- 不并发，串行遍历
- 单次最多 100 条
- 不抓评论区

---

## 6. `login.mjs` — 登录态获取

仅在以下场景手动运行：
- 首次安装
- `scrape.mjs` 返回 `login_expired`
- 主动切换账号

流程：
1. Playwright Chromium **headed 模式**
2. 打开 `https://www.xiaohongshu.com`
3. 终端提示：`请在浏览器中扫码登录，登录成功后回到这里按 Enter`
4. 用户扫码 → 登录成功 → 回终端 Enter
5. `context.storageState({ path: 'state/storage.json' })`
6. 关闭浏览器，打印 `✅ 登录态已保存`

**安全**：`state/storage.json` 严禁 commit，已在 `.gitignore`。

---

## 7. LLM 过滤 + 渲染（`/loop` 的工作）

### 7.1 输入
- `scrape.mjs` 的 stdout JSON
- `watcher.yml` 中 `signal.brief` + `signal.verdicts`

### 7.2 LLM 决策

对每条 post，判定 verdict ∈ {signal, maybe, known, ad, noise}。判断依据是 `signal.brief` 中的"目标读者 + 标准"，配合 `verdicts.*.examples` 校准。

**输出结构**（供 notify.mjs 渲染）：

```json
{
  "broadcast_at": "2026-05-16T14:00:00+08:00",
  "stats": {
    "window_hours": 12,
    "total": 23,
    "new": 7,
    "already_seen": 16,
    "by_verdict": { "signal": 2, "maybe": 1, "known": 1, "ad": 2, "noise": 1 }
  },
  "cards": [
    {
      "note_id": "abc123",
      "verdict": "signal",
      "workflow_name": "Skill 化 git worktree",
      "one_liner": "用 PostToolUse hook 自动给每个新建 worktree 注入定制 CLAUDE.md。",
      "key_steps": [
        "`.claude/hooks/PostToolUse-Bash.json` 监听 `git worktree add`",
        "钩子脚本读 worktree 路径 → 模板渲染 CLAUDE.md 写入"
      ],
      "applicable": "多 feature 并行开发，每个 agent 拿到不同上下文",
      "verdict_reason": "比 superpowers:using-git-worktrees 多了上下文注入维度",
      "author": "@xxx",
      "published_relative": "4小时前",
      "metrics": { "likes": 234, "collects": 89 },
      "url": "https://..."
    }
  ],
  "filtered_summary": [
    { "note_id": "...", "verdict": "ad", "title": "..." }
  ]
}
```

### 7.3 终端渲染格式

```markdown
## 📡 XHS Claude Code 播报 — 2026-05-16 14:00 CST

扫描窗口 12h · 命中 23 条 · 新增 7 / 已知库 16
信号 2 · 存疑 1 · 已知 1 · 广告 2 · 无干货 1

---

### 🟢 信号 1 — Skill 化 git worktree
**作者** @somebody · **4小时前** · **赞 234 · 收 89** · [原帖](https://...)
**一句话** 用 PostToolUse hook 自动给每个新建 worktree 注入定制 CLAUDE.md。
**关键步骤**
- `.claude/hooks/PostToolUse-Bash.json` 监听 `git worktree add`
- 钩子脚本读 worktree 路径 → 模板渲染 CLAUDE.md 写入
**适用** 多 feature 并行开发
**我的判断** 比 superpowers:using-git-worktrees 多了上下文注入维度

### 🟡 存疑 1 — ...

---

<details>
<summary>🔘 已知话题 (1)</summary>

- @xxx · 4h · [又一篇 TDD 入门](url)

</details>

<details>
<summary>📢 广告/卖课 (2)</summary>

- @xxx · 3h · "三天精通 Claude Code"

</details>
```

### 7.4 Telegram 渲染格式

- **范围**：仅 `verdict ∈ {signal, maybe}`，每条一条 TG 消息
- **格式**：HTML（`parse_mode: HTML`）
- **消息上限**：4000 字符（留 96 字符 buffer），超长截断并附 `... <a href="url">详见原帖</a>`
- **on_failure: warn**：TG 发送失败时，终端播报末尾追加 `⚠️ TG push failed: <reason>`，不影响终端播报

**单卡片 HTML 模板**：

```html
<b>🟢 信号 — {workflow_name}</b>

<i>{one_liner}</i>

<b>关键步骤</b>
• {key_steps[0]}
• {key_steps[1]}

<b>适用</b> {applicable}
<b>判断</b> {verdict_reason}

<a href="{url}">@{author} · {published_relative} · 赞{likes} · 收{collects}</a>
```

**footer 消息**（所有信号发完后追加一条）：

```
📊 xhs-watcher · 2026-05-16 14:00 CST
窗口 12h · 信号 2 · 存疑 1 · 已过滤 4
```

---

## 8. `notify.mjs` — 分发脚本

### 8.1 CLI 接口

```
node notify.mjs --terminal --tg                # 从 stdin 读 broadcast JSON，分发
node notify.mjs --update-verdicts              # 从 stdin 读 verdict 回写 seen.json
node notify.mjs --terminal --tg --dry-run      # 调试，渲染但不发 TG
```

### 8.2 终端渠道
直接 console.log 渲染好的 Markdown。

### 8.3 TG 渠道
- 读 `XHS_WATCHER_TG_BOT_TOKEN` + `XHS_WATCHER_TG_CHAT_ID`
- HTTP POST `https://api.telegram.org/bot<TOKEN>/sendMessage`
- 每条消息间 sleep 200ms（避免 TG rate limit）
- 失败重试 1 次，仍失败则在结果对象里记 `tg_error`

### 8.4 verdict 回写
读 broadcast JSON 中每个 card 的 `note_id + verdict`，更新 `seen.json` 对应条目的 `verdict` 字段。这是为未来跨轮智能（"昨天判过 noise 的，今天再出现可降权"）预留的；v1 实现可以只存不用。

---

## 9. 状态文件

### 9.1 `state/seen.json`

```json
{
  "schema_version": 1,
  "last_run_at": "2026-05-16T14:00:00+08:00",
  "notes": {
    "abc123": {
      "first_seen": "2026-05-14T08:00:00+08:00",
      "title": "...",
      "verdict": "signal"
    },
    "def456": {
      "first_seen": "2026-05-15T12:00:00+08:00",
      "title": "...",
      "verdict": "noise"
    }
  }
}
```

**GC 策略**：每次 scrape 跑完后，删除 `first_seen` > 30 天的条目。30 天是经验值（够覆盖任何合理的时间窗 + 容错），实际可调。

### 9.2 `state/storage.json`
Playwright storageState 原生格式（cookies + localStorage）。生命周期同 XHS 登录态（经验上数月到半年）。

### 9.3 `state/.lock`
PID + 启动 ISO 时间，文本格式。scrape.mjs 启动写入、退出删除。

---

## 10. `/loop` 调用形态

`LOOP_PROMPT.md` 提供完整可粘贴的 prompt。/loop 命令：

```
/loop 6h <粘贴 LOOP_PROMPT.md 内容>
```

`LOOP_PROMPT.md` 内容（Claude 在 /loop 中执行的步骤骨架）：

```
执行 xhs-watcher 监视任务（仓库位于 ~/xhs-watcher）：

1. Bash: cd ~/xhs-watcher && node scrape.mjs > /tmp/xhs-scrape.json
   读取 exit code 和 /tmp/xhs-scrape.json

2. Read /tmp/xhs-scrape.json，检查 error 字段：
   - error: login_expired  → Bash: 调 notify.mjs 发送 "请重新登录"，结束
   - error: selector_missing → Bash: 调 notify.mjs 发送 "页面结构变了"，结束
   - error: network        → Bash: 调 notify.mjs 发送 "网络问题，下轮重试"，结束
   - error: already_running → 静默结束（不打扰用户）
   - error: null + stats.new == 0 → Bash: 调 notify.mjs 发送 "📡 窗口无新帖"，结束
   - error: null + stats.new > 0  → 进入下一步

3. 对每条 post 按 watcher.yml 中 signal.brief 判定 verdict
   ∈ {signal, maybe, known, ad, noise}

4. Write /tmp/xhs-broadcast.json，结构见 DESIGN.md §7.2

5. Bash: cat /tmp/xhs-broadcast.json | node notify.mjs --terminal --tg
6. Bash: cat /tmp/xhs-broadcast.json | node notify.mjs --update-verdicts

7. 终端简短打印本轮统计（"📡 完成：信号 N · 存疑 M · 已过滤 K"）
```

**为什么用临时文件而不是管道**：Claude 的 LLM 输出无法被 Bash 真正"pipe"成下一步的 stdin —— 必须落盘到 `/tmp/xhs-broadcast.json` 后再用 `cat | node notify.mjs` 读入。这也方便在调试期手动 inspect。

**笔记本关机问题**：/loop 仅在 Claude Code 进程运行时触发。如果笔记本关机超过 12h（窗口），就会漏。已在 §11 提示。

---

## 11. 已知限制 / 风险

1. **/loop 不跨进程**：笔记本关机或 Claude Code 退出期间不会跑。如果你需要 7x24 运行，应该把 scrape.mjs + notify.mjs 移到服务器 cron，本文档不覆盖该模式。
2. **XHS 风控**：随机延迟 + 单次上限是软对抗。如果 IP 被封或触发 cf 验证，错误码会上报，需人工介入。
3. **DOM 选择器易变**：XHS 前端改版会导致 `selector_missing`。实现时把选择器集中到 `lib/selectors.mjs`，便于一处修复。
4. **登录态有效期不确定**：经验上数月，但偶尔被风控强制刷新。`login_expired` 触发后用户需手动 `node login.mjs`。
5. **LLM 判断质量**：v1 全凭 prompt + watcher.yml。如果用户发现误判，调 `signal.brief` 或在 `verdicts.*.examples` 加例子即可，不需要改代码。
6. **TG 速率**：bot API 每秒 30 条群组消息上限。单次最多 100 帖 × 信号率假设 30% ≈ 30 条 TG 消息，加上 200ms 间隔，最长约 6 秒，远低于 limit。
7. **重复内容**：seen.json 仅按 `note_id` 去重。同一作者重新发或转发不会被识别为重复 —— 接受这个开销。

---

## 12. 安全

- **绝不提交**：`state/storage.json`、`state/seen.json`、`.env`、任何 `*.local.yml`
- **环境变量**：`XHS_WATCHER_TG_BOT_TOKEN`、`XHS_WATCHER_TG_CHAT_ID` 通过 `.env`（dotenv 加载）或直接 export
- **`.env.example`**：仅放占位值，commit
- **README 警示**：明确说明 token 泄露的后果与 BotFather `/revoke` 流程

---

## 13. 测试策略

- **scrape.mjs**：mock Playwright，喂入预录的 HTML fixture，断言 JSON 输出
- **time-parser.mjs**：单元测试，覆盖"X 分钟前/X 小时前/今天 HH:MM/昨天 HH:MM/YYYY-MM-DD"全部分支
- **seen.mjs**：单元测试，覆盖 GC、新增、查询
- **notify.mjs TG 路径**：mock `fetch`，断言 POST body 结构与 chat_id
- **LLM 判断**：手动跑几轮，调 `signal.brief` 直到误判率可接受。无自动化测试，因为这是 prompt engineering，不是代码逻辑

---

## 14. 实施顺序建议

1. 仓库骨架 + `.gitignore` + `package.json` + LICENSE + README 占位
2. `lib/time-parser.mjs` + 单元测试
3. `lib/seen.mjs` + 单元测试
4. `lib/config.mjs`（读 watcher.yml + .env）
5. `login.mjs`（最简，能跑通存盘即可）
6. `scrape.mjs` 主流程（用 `login.mjs` 产物，连真实 XHS）
7. `notify.mjs` 终端渲染
8. `lib/tg.mjs` + `notify.mjs` TG 渲染
9. `LOOP_PROMPT.md` 编写
10. README 完善（首次安装 + 故障排查）
11. 整体联调，调一两轮真实 `/loop`

详细的 step-by-step 实现计划由 `superpowers:writing-plans` 生成。
