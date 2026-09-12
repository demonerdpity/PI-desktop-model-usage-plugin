## 调研结论与实现边界

### PI-Desktop 官方契约（仓库提交 `21897ed`）

- `docs/adr/0173-plugin-owned-token-usage-dashboard.md` 已明确：用户侧全局用量仪表盘由市场插件 **`pi.token-insights`** 承担，命令面板关键词为 `usage`、`tokens`、`用量`；插件可以扫描本地 JSONL，并在未来折入宿主 completed-turn remainder 以覆盖子智能体用量。
- `docs/adr/0171-host-owned-completed-turn-token-history.md` 已明确：宿主持久化 `session.endTurn.usage`，内部已有 `stats.getTokenUsageHistory`，但 ADR 0173 同时说明“公开的一方插件 API 包装”尚属后续工作。
- 当前 `@pi-desktop/plugin-sdk` **没有**向插件公开 `stats.getTokenUsageHistory`，也不允许读取 `pi.sqlite`、宿主 secrets 或 provider key；manifest 的 `secret` setting 当前会被校验器拒绝。
- `pi.models.list()` 只返回已启用且已认证渠道的 provider/model 显示信息，不返回密钥、API base URL 或 auth kind，适合作为渠道目录与标签来源。
- 插件是独立 Node 进程，面板是无 Node、context-isolated 的 Electron 页面；面板只能经 `window.pluginBridge` 与插件入口通信。
- 插件面板必须采用 chrome v2、46px 宿主拖拽带、`appearance:changed` 实时主题/语言同步，以及 PI-Desktop 的中性灰、紧凑、高可读、键盘优先设计规范。

### 成熟方案可借鉴部分

- **CodexBar (`f9bc62c`)**：provider adapter、能力不齐时保持 unknown、last-good/stale 状态、5 分钟低频同步、来源与估算覆盖率；Sub2API 只读 `GET /v1/usage`，OpenRouter 使用 `/api/v1/credits` 与 `/api/v1/key`，OpenAI/Anthropic 组织统计必须使用独立 Admin key。
- **claude-usage (`3eea154`)**：被动增量扫描本地 JSONL，只提取 assistant usage，SQLite/聚合不保存会话正文；订阅用户的 API 等价费用必须标为估算而非实际账单。
- **TokenTracker (`8b4ca1a`)**：多来源 adapter、内容零留存、来源健康诊断、unknown model 不估价、last-good quota cache、按请求 ID 去重。
- **ccusage (`aaa8992`)**：每个来源独立 adapter、统一 UsageEntry、显式 cost source/mode、models.dev/LiteLLM 离线快照与缺价检测。

### 首版必须诚实限制

- 本插件不会绕过 PI-Desktop 权限模型读取已配置渠道密钥，也不会读取浏览器 Cookie、调用网页私有接口、执行 CLI `/usage` 抓屏或要求用户把密钥明文存进普通 settings。
- 因此首版可以真实展示所有 PI-Desktop 已产生记录的渠道（包括 OpenAI、Anthropic、Gemini、OpenRouter、New API/Sub2API/帅 API，以及 ChatGPT/Claude OAuth 订阅）的 **请求数、Token、模型分布、历史趋势**。
- **费用**仅在模型与官方公开 API 价格精确匹配时显示为“API 等价估算”；未知/自定义模型不显示费用。它不是订阅账单，也不是中转站实际扣费。
- **余额、额度使用率、重置时间、官方账单费用**在当前 SDK 下无法从 PI-Desktop 凭据安全查询，首版按渠道能力隐藏，并在来源说明中注明“宿主未向插件提供该指标”，绝不显示 0 或推测值。
- 代码中保留正式 adapter 接口；未来 PI-Desktop 发布 provider-scoped credential broker、secure plugin secret 或 stats 插件 API 后，可直接加入 OpenAI Admin、Anthropic Admin、OpenRouter、Sub2API/New API 等只读连接器，不重构 UI/存储。

## 实施步骤

### 1. 建立符合官方模板的插件骨架

在空工作区创建：

```text
manifest.json
main.js
renderer/index.html
renderer/app.js
renderer/styles.css
lib/domain.js
lib/scanner.js
lib/aggregate.js
lib/pricing.js
lib/store.js
lib/provider-catalog.js
lib/adapters/local-pi.js
lib/adapters/host-stats.js
assets/icon.png
fixtures/
test/
README.md
CHANGELOG.md
package.json
```

- 插件 ID 使用 ADR 指定的 `pi.token-insights`，版本从 `0.1.0` 开始。
- manifest 声明 `ui.panel`、`models.list`，命令 `token-insights.open`，关键词包含 `usage`、`tokens`、`用量`、`费用`；以 `onStartup` 激活本地扫描器。
- 使用 980×720 可调整独立面板，不挤入窄 work panel；入口脚本为可直接执行的 CommonJS，发布包不依赖宿主安装 npm 包。
- `main.js` 实现 `onLoad`、`onUnload`、命令注册及自定义 `onPanelInvoke` 通道：`dashboard.snapshot`、`dashboard.refresh`、`dashboard.clearCache`、`dashboard.openSourceDocs`。

### 2. 定义统一事实模型与能力矩阵

`lib/domain.js` 定义：

- `UsageFact`：稳定事实 ID、timestamp、providerId、modelId、input/output/cacheRead/cacheWrite/reasoning/total tokens、requestCount、sourceFileId。
- `MetricProvenance`：`local-provider-report`、`host-rollup`、`official-billing`、`official-pricing-estimate`，附采集时间、来源说明、是否估算、覆盖率。
- `ChannelSnapshot`：渠道身份、可用指标、今日/7日/30日/总计、模型明细、同步状态。
- `QuotaWindow`：used/limit/remaining/resetAt；首版 schema 保留但只有真实 adapter 返回时才渲染。
- `ProviderAdapter` 契约：`discover`、`scan`、`getCapabilities`、`getProvenance`；UI 完全依据 capabilities 显隐。

所有整数做 safe-integer/非负校验；异常 usage 行跳过并计入诊断，不污染合计。

### 3. 实现 PI-Desktop 本地会话扫描器

`lib/adapters/local-pi.js` + `lib/scanner.js`：

- 只扫描 PI-Desktop 的已知本地会话目录 `~/.pi-desktop/sessions/*.jsonl`；不打开 `pi.sqlite`、secrets、provider 配置或其他会话正文数据库。
- 流式逐行处理，仅保留 assistant 记录的 `id`、`createdAt`、`meta.providerId`、`meta.modelId`、`meta.usage` 标量；prompt、thinking、tool args/results、附件和回复正文不写缓存、不写日志、不传给面板。
- 支持 input/output/cache read/cache write/reasoning/total Token；一个有效 assistant usage 记录计一个请求。
- 以 `source path hash + file identity/size/mtime` 保存游标。文件追加时增量扫描；缩短、替换、删除或 schema 变化时只重建该来源，避免旧数据残留。
- 以稳定 message ID 跨文件去重，处理 fork 克隆前缀；同文件重复 ID keep-last。忽略 `.revisions.jsonl`，避免已废弃修订重复计费。
- 对截断行、未知字段和旧版本记录容错；扫描工作分片执行并可取消，避免大历史阻塞插件加载。
- 首次启动与手动刷新执行扫描；后台 service 以低频间隔检查文件 stamp，只处理变化文件。保留 last-good 快照，失败时标为 stale 而非清空。

### 4. 渠道发现与归类

`lib/provider-catalog.js`：

- 调用 `pi.models.list()` 获取当前已认证渠道的 `providerId/providerName/modelId/label`，与 JSONL 中历史 provider/model 联合，确保当前未使用渠道也可显示“尚无记录”，历史已删除渠道仍可追溯。
- 不按模型品牌误合并渠道：用户自定义的帅 API/New API providerId 保持独立卡片；同模型经不同中转调用时按 providerId 分开统计。
- 已知 provider 仅用于图标和官方价目映射，不据此猜测 auth kind、订阅等级、余额或额度。
- `host-stats.js` 封装未来 `stats.getTokenUsageHistory` 能力探测；当前收到 `UNSUPPORTED` 时静默回退本地扫描。未来 API 可用后，仅用 completed-turn 大于消息事实总额的差额补齐子智能体，绝不整桶叠加造成双计数。

### 5. 本地缓存、聚合与费用估算

`lib/store.js`：

- 在 `pi.plugin.getDataPath()` 下保存版本化的 `index.json`、每来源 compact fact cache 和 `state.json`；采用临时文件 + rename 原子替换。
- 不保存 prompt、回复、完整 JSONL 行、API key、Cookie、邮箱、项目路径或会话标题；source path 在持久化前做不可逆哈希。
- 缓存完全可由源文件重建；“清除本地缓存”只删除插件派生数据，不删除 PI-Desktop 会话。
- 默认保存日聚合与必要去重 ID；细粒度事实控制在最近 90 天，日聚合保留 1 年，启动时清理过期派生数据。

`lib/aggregate.js`：

- 按本地日历生成 7/30/90 天日桶，填充空桶；总览与渠道/模型榜单使用同一事实立方。
- 请求、Token 可跨渠道汇总；货币仅同币种、同语义汇总。真实账单与估算永不相加。
- 派生值带 coverage：例如只有 76% Token 能匹配官方价格时，费用卡明确显示“估算覆盖 76%”。

`lib/pricing.js`：

- 内置一份带 `sourceUrl`、`retrievedAt`、provider、model exact aliases、input/output/cache 价格的精简官方价目快照，仅覆盖首批 OpenAI/Anthropic/Gemini 常用模型。
- 只精确匹配，不用模糊包含猜价；unknown/custom model 返回 unavailable，而不是 `$0`。
- 对订阅/OAuth 无法辨别时，货币标题固定为“API 等价估算”，来源抽屉说明它不代表订阅实际费用或中转扣款。

### 6. 实现 PI-Desktop 风格仪表盘

`renderer/` 使用原生 HTML/CSS/JS，避免 CDN 和额外网络权限：

- `<meta name="pi-plugin-chrome" content="v2">`；正常流使用 `--pi-plugin-titlebar-height`，sticky toolbar 锚在该变量下。
- 初始化调用 `app.getAppearance`，监听 `appearance:changed`；支持 dark/light/system 及 zh-CN/en 即时切换。
- 完整使用 PI-Desktop 中性语义 token：`#181818/#212121` 暗色基线、无渐变/装饰大图、13–14px 紧凑排版、12–16px 卡片圆角、克制语义色、明显 focus-visible。
- 顶部：页面标题、时间范围（7/30/90 天）、刷新、最后更新时间和 stale 状态。
- KPI：请求数、总 Token、输入/输出/缓存拆分、API 等价费用；没有可用费用时整卡隐藏。
- 渠道区域：按 providerId 卡片/表格显示名称、模型数、请求、Token、估算费用及趋势微图；quota/reset/balance 字段只在能力存在时出现。
- 趋势区：纯本地 SVG 折线/柱形图，可切换 requests/tokens/cost、总览/单渠道；提供文本表格替代与键盘可操作 tooltip。
- 来源抽屉：逐项显示数据来源、更新时间、精确/估算、覆盖率、缺失原因；用户能明确看到“来自 PI-Desktop 本地会话 usage”或“当前宿主未提供额度 API”。
- 状态完整覆盖：首次扫描、无渠道、渠道无记录、部分损坏、扫描失败、stale、旧宿主不支持 `models.list`；不使用误导性的全局错误页。
- 遵守 `prefers-reduced-motion`、WCAG 对比度、色彩非唯一表达和完整 Tab 顺序。

### 7. 文档与未来扩展点

README 明确列出渠道能力矩阵：

| 来源 | 请求/Token/趋势 | 估算费用 | 真实费用 | 额度/重置 |
|---|---:|---:|---:|---:|
| PI-Desktop 本地记录（所有 provider） | 是 | 已知官方模型可用 | 否 | 否 |
| OpenAI/Anthropic Admin API | 预留 | 预留 | 待宿主安全凭据能力 | 不适用/按 API 返回 |
| OpenRouter | 本地记录可用 | 已知模型可用 | 待宿主安全凭据能力 | 待宿主安全凭据能力 |
| Sub2API/New API/帅 API | 本地记录可用 | 不猜测中转价 | 待安全 connector | 待安全 connector |
| ChatGPT/Claude 官方订阅 | 本地记录可用 | 明标 API 等价 | 无公开账单 API | 宿主未提供则隐藏 |

同时记录未来 adapter 的准确公开端点，但首版不调用：OpenAI `/v1/organization/{usage/completions,costs}`、Anthropic `/v1/organizations/{usage_report/messages,cost_report}`、OpenRouter `/api/v1/{credits,key}`、Sub2API `/v1/usage`。只有 PI-Desktop 增加 provider-scoped broker/secure secret 后才启用。

## 验证计划

### 自动测试

- JSONL parser：标准/缺字段/负数/超 safe integer/截断行/旧 schema/重复消息/跨文件 fork/文件替换与删除。
- 聚合：本地日历边界、夏令时、空桶、7/30/90 天、缓存 Token、渠道隔离、费用覆盖率、未知模型不计价。
- 隐私：扫描派生目录和日志，断言不含 fixture 的 prompt、reply、thinking、tool args、路径、密钥样例。
- Bridge：未知 channel 拒绝、刷新并发合并、卸载取消任务、panel payload 大小有界。
- UI：字段 capability 显隐、loading/empty/partial/stale、主题和中英文、键盘访问、reduced motion。

### PI-Desktop 集成验收

1. 用官方仓库的 `panel-basic` 契约加载开发插件。
2. 用 OpenAI API、Anthropic API、Gemini、OpenRouter、自定义帅 API，以及可用的 ChatGPT/Claude OAuth 渠道各产生测试请求。
3. 对照 `sessions/*.jsonl` 的 assistant `meta.usage`，核验每渠道请求数与各类 Token 完全一致，且同模型不同 provider 不串账。
4. 构造 fork、修订、子智能体与损坏尾行，确认不双计数、不崩溃，并对当前尚不能从公开插件 API获取的子智能体 remainder 给出覆盖说明。
5. 检查插件缓存、日志和面板 payload，无 prompt、回复、工具内容或 secret。
6. 在深/浅色、中文/英文、不同面板尺寸下做可视检查。
7. 从 PI-Desktop 仓库运行 `pnpm pi-plugin check <plugin-dir>`，再运行 `pnpm pi-plugin pack <plugin-dir>`，确认生成可安装的未压缩 `.piplug` 及 sha256。

## 明确不在本次实现中的内容

- 修改 PI-Desktop 核心以公开 `stats.getTokenUsageHistory` 或 provider credential broker。
- 浏览器 Cookie 导入、网页抓取、私有 Claude/Gemini quota API、CLI PTY 自动化。
- 明文持久化 Admin/API key，或对任意第三方域名放开网络出口。
- 将 API 单价估算称为实际费用，或由本地 Token 推断官方订阅额度/重置时间。