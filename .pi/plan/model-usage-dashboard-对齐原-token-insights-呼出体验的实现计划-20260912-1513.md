## 目标与已确认基线

在空工作区实现一个 PI-Desktop 原生、本地优先的模型用量仪表盘，按 PI-Desktop 渠道展示请求数、Token、费用/估算、额度、重置时间与趋势；指标必须有真实来源，不可用时隐藏。

本计划已核验：

- PI-Desktop 官方仓库 `vastsa/pi-desktop`，提交 `21897ed`。
- 官方市场分发仓库 `vastsa/pi-desktop-plugins`，提交 `b600109`。
- 原市场插件 `pi.token-insights` 0.4.8 的 `manifest.json`、`main.js` 与面板源码。
- 成熟方案 CodexBar、claude-usage、TokenTracker、ccusage 的数据采集、去重、费用和隐私策略。

PI-Desktop ADR 0173 指定用量仪表盘由插件持有；ADR 0171 定义宿主 completed-turn Token 汇总。当前公开插件 SDK 不暴露 `stats.getTokenUsageHistory`，不向插件提供 provider 密钥或安全 secret setting，因此首版绝不绕过权限模型调用需密钥的余额接口。

## 1. 与原 Token Insights 一致的呼出体验

新插件使用独立身份，避免覆盖或冲突已安装的 `pi.token-insights`：

- 插件 ID：`pi.model-usage-dashboard`
- 命令 ID：`modelUsageDashboard.open`
- 英文标题：`Model Usage Dashboard: Open`
- 中文检索词：`模型用量`、`用量`、`统计`、`费用`、`额度`
- 英文检索词：`model usage`、`usage`、`tokens`、`cost`、`quota`、`stats`
- 分类：`Productivity`

呼出流程严格复刻原 Token Insights：

1. 用户按 `Cmd/Ctrl+K` 或 `Cmd/Ctrl+Shift+P` 打开 PI-Desktop 全局搜索的 Commands 区域。
2. 输入“模型用量”“usage”“tokens”等关键词并执行 `Model Usage Dashboard: Open`。
3. 命令先立即调用 `pi.ui.openPanel()`，打开或聚焦宿主管理的单实例独立面板。
4. 面板尺寸与原插件一致：默认 `1120 × 800`，由宿主提供最小化、最大化/还原与关闭胶囊。
5. 面板先同步显示上次成功的本地快照，不等待扫描；随后命令在后台启动一次新扫描。
6. 并发/重复呼出共享同一个扫描 Promise，不产生重复扫描；已有面板只被聚焦，数据平滑更新。
7. 扫描失败时保留 last-good 数据，顶部标记 stale，并发 PI-Desktop warning toast，不把面板清空。
8. 面板工具栏的“刷新数据”只重新读取最新已发布快照，保持原插件的只读 panel bridge 语义；需要立即重扫时再次执行全局搜索命令。
9. `onStartup` 可低优先级预热快照，但不得主动弹窗；只有用户执行命令才显示面板。

`manifest.json` 采用 `schemaVersion: 1`、本地化标题、`ui.panel` 权限、`onCommand:modelUsageDashboard.open` 与 `onStartup`。不复用原插件 ID 或命令 ID。

## 2. 插件骨架与文件

```text
manifest.json
main.js
lib/domain.js
lib/scanner.js
lib/aggregate.js
lib/pricing.js
lib/store.js
lib/provider-catalog.js
lib/adapters/local-pi.js
lib/adapters/host-stats.js
renderer/index.html
renderer/boot.js
renderer/app.js
renderer/styles.css
assets/icon.png
fixtures/
test/
package.json
README.md
CHANGELOG.md
```

- `main.js`：生命周期、命令、扫描并发、目录 watcher、快照发布和卸载清理。
- `renderer/*`：无 Node、无 CDN 的隔离页面，通过 `window.pluginBridge` 读取 settings/appearance。
- 所有交付 JS/HTML/CSS 均可直接执行；PI-Desktop 加载时不需要安装依赖或编译 TypeScript。

## 3. 数据模型与渠道能力矩阵

`lib/domain.js` 定义：

- `UsageFact`：事实 ID、时间、providerId、modelId、请求数、input/output/cacheRead/cacheWrite/reasoning/total Token、来源文件 ID。
- `MetricProvenance`：来源类型、采集时间、是否估算、覆盖率、来源说明。
- `ChannelSnapshot`：渠道身份、今日/7日/30日/总计、模型明细、同步状态与 capabilities。
- `QuotaWindow`：used、limit、remaining、resetAt；只有 adapter 返回真实值时才展示。
- `ProviderAdapter`：`discover`、`scan`、`getCapabilities`、`getProvenance`。

所有数值必须是非负 safe integer/finite decimal；缺失不是零。UI 按 capability 隐藏 requests/tokens/cost/quota/reset/history 中不可用的字段。

## 4. 真实数据采集

### PI-Desktop 渠道事实

- 扫描 `~/.pi-desktop/sessions/*.jsonl`，只提取 assistant 行中的 `id`、`createdAt`、`meta.providerId`、`meta.modelId`、`meta.usage`。
- 支持 input、output、cache read、cache write、reasoning、total Token；一条有效 assistant usage 计一次请求。
- 不保存、不输出 prompt、回复、thinking、工具参数/结果、附件、项目路径或完整会话 ID。
- 同文件重复消息 keep-last；按稳定 message ID 跨 fork 文件去重；忽略 `.revisions.jsonl`，避免历史修订重复计费。
- 文件追加走增量游标；文件缩短、替换、删除时重建对应来源事实，避免旧统计残留。
- 直接从 providerId 分渠道，因此 OpenAI、Anthropic、Gemini、OpenRouter、New API/Sub2API、帅 API 与官方 OAuth 渠道不会因使用相同模型而混账。

### 渠道目录

- 优先调用 `pi.models.list()` 获取当前已启用、已认证的 provider/model 显示名；若当前 SDK/manifest 校验不支持该权限，则回退本地 providerId 并在 README 记录兼容限制。
- 与历史 JSONL provider 联合：当前未使用渠道显示“尚无记录”，已删除但有历史的渠道仍可追溯。
- 不根据名称猜测 auth kind、订阅等级、余额或配额。

### 宿主 completed-turn 兼容层

- `host-stats.js` 探测未来公开的 `stats.getTokenUsageHistory` 插件 API。
- 当前 `UNSUPPORTED` 时使用消息事实，不尝试任意 Electron IPC。
- 将来可用时，只把 completed-turn 超过 transcript assistant 合计的差额记为 Subagent，绝不整桶叠加造成双计数。

## 5. 费用、额度与重置时间

- 内置一份版本化、带 `sourceUrl`/`retrievedAt` 的精简官方 API 价格快照，覆盖常见 OpenAI、Anthropic、Gemini 模型。
- 仅 exact alias 匹配；自定义/未知模型不估价，不显示 `$0`。
- 由 Token × 官方单价得到的金额始终命名为“API 等价估算”，展示价格日期和估算覆盖率；不冒充官方订阅账单或中转站扣款。
- 同币种且同语义才能汇总；真实账单与估算永不相加。
- 官方 ChatGPT/Claude 订阅只展示本地可验证请求与 Token；不能确认 auth kind 时不宣称套餐类型。
- OpenAI/Anthropic Admin、OpenRouter `/api/v1/credits`/`key`、Sub2API `/v1/usage`、New API/帅 API 余额能力保留 adapter 契约，但在 PI-Desktop 提供 provider-scoped credential broker 或安全 secret storage 前不启用。
- 额度、余额、重置时间没有真实返回值时整个字段隐藏，并在来源说明中标注“当前宿主未向插件提供”。不由 Token 曲线推测订阅额度。

## 6. 本地存储与刷新可靠性

- 在 `pi.plugin.getDataPath()` 对应私有目录保存版本化 source stamp、紧凑事实与 last-good 快照；临时文件 + rename 原子替换。
- 只保留哈希后的来源标识、短去重 ID 与标量统计；不存凭据、正文、邮箱、项目路径或完整 session ID。
- 扫描进度最多每 400ms 发布一次，显示真实“已扫描/总文件数”和 determinate progress bar。
- source watcher 30 秒 debounce，watch 触发的重扫至少间隔 5 分钟；数据超过 15 分钟时下一次变化可立即补扫。
- 90 天细粒度事实、1 年日聚合；启动时清理过期派生缓存。清除缓存不删除 PI-Desktop 会话。
- `onUnload` 关闭 watchers/timers，并使待处理任务停止发布新状态。

## 7. 仪表盘 UI

- 使用 `<meta name="pi-plugin-chrome" content="v3">` 与原 Token Insights 当前 paint-through 体验；若目标 PI-Desktop 构建仅支持 v2，则按官方兼容行为回退。
- 自有标题栏绘制在 46px 宿主区域，右侧始终预留原插件验证过的 104px window-control capsule 安全区；空白区域可拖动，按钮设为 `no-drag`。
- 根视口不重复保留 scrollbar gutter；仅内容 scroller 使用稳定 gutter，避免 Windows 右侧空白轨道。
- 启动时同步采用 OS 明暗偏好避免首帧错色，再读取 `app.getAppearance` 并监听 `appearance:changed`；中文/英文和插件主题实时同步。
- 视觉遵循 PI-Desktop：暗色 `#181818/#212121` 基线、中性灰、无渐变装饰、13–14px 紧凑排版、语义 token、明显 focus ring、减少动画。
- 顶部：标题、7/30/90 天范围、来源说明、刷新最新快照、scan/stale 状态。
- KPI：请求数、总 Token、input/output/cache/reasoning、API 等价费用；不可用费用卡隐藏。
- 渠道表/卡：按 providerId 展示请求、Token、估算费用、模型数、最后活动与微趋势；额度/重置只在真实 capability 存在时出现。
- 趋势：本地 SVG 请求/Token/费用图，可切换总览或单渠道，并提供可访问的数据表替代。
- 来源抽屉：逐指标展示来源、更新时间、精确/估算、覆盖率、缺失原因。
- 状态覆盖首次扫描、无数据、部分损坏、失败但有缓存、stale、旧宿主；保留上一快照而非全屏报错。

## 8. 文档与隐私披露

README 提供逐渠道能力表，明确首版：

- 所有 PI-Desktop provider：请求、Token、模型、趋势可用。
- 已知官方模型：API 等价费用估算可用。
- 官方订阅：不显示无法公开验证的账单、额度与重置时间。
- OpenRouter/Sub2API/New API/帅 API：本地调用统计可用，远端余额等待宿主安全凭据能力。

列出所有读取路径、写入路径、网络请求（首版为无）、字段白名单、数据保留与删除方式。

## 9. 验证

### 自动测试

- manifest：独立 ID、命令 ID、关键词、1120×800 面板与最小权限。
- 呼出：命令执行先 openPanel、后后台扫描；重复执行聚焦面板且合并并发扫描；onStartup 不弹窗。
- parser：标准/旧 schema/缺字段/负数/超 safe integer/截断行/fork/修订/文件替换与删除。
- 聚合：时区/DST、空桶、7/30/90 天、渠道隔离、费用覆盖率、unknown model 不估价。
- 隐私：派生目录、日志和 panel payload 不含 fixture 中的正文、thinking、工具内容、路径、密钥。
- UI：capability 显隐、loading/empty/partial/stale、深浅色、中英文、键盘与 reduced motion。

### PI-Desktop 集成验收

1. 用 `Cmd/Ctrl+K` 和 `Cmd/Ctrl+Shift+P` 分别搜索英文/中文关键词。
2. 确认执行 `Model Usage Dashboard: Open` 后立即出现与原 Token Insights 同规格独立面板，扫描在后台进行。
3. 面板已打开时再次执行命令，确认聚焦同一面板、仅有一次扫描。
4. 用 OpenAI、Anthropic、Gemini、OpenRouter、帅 API 与可用 OAuth 渠道产生请求，对照 JSONL 的 assistant `meta.usage` 核验逐渠道统计。
5. 模拟扫描失败，确认 last-good 数据保留、stale 标记和 warning toast。
6. 检查 46px 标题栏、104px 胶囊安全区、Windows scrollbar、明暗主题和中英文切换。
7. 运行 `pnpm pi-plugin check <plugin-dir>` 与 `pnpm pi-plugin pack <plugin-dir>`，验证可安装 `.piplug` 与 sha256。

## 不在本次范围

- 替换或修改原 `pi.token-insights`。
- 修改 PI-Desktop 核心或调用未公开 IPC。
- 浏览器 Cookie 导入、私有网页接口、CLI PTY 抓屏。
- 明文存储 API/Admin key 或放开任意域名网络出口。
- 把估算写成实际账单，或推测官方订阅额度/重置时间。