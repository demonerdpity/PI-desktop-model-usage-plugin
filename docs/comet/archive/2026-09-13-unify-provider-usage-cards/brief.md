# 目标

让每个真实渠道只显示一张卡片，并在同一组 5h、Weekly 等时间窗口中同时呈现官方订阅额度与本地/API 使用量；当订阅凭证不可读取时，卡片给出准确原因和可点击的 Codex 登录入口。

# 范围

- 将唯一的当前 OpenAI ChatGPT/Codex 官方账号与历史 `openai-codex`、`codex`、`chatgpt` 等本地 usage 标识归并为同一渠道；若存在多个可匹配的当前官方账号则保持分离，不猜测归属。
- 订阅额度和本地/API 使用量使用同一组窗口行：行首是窗口名，行内同时显示请求、Token、估算费用、额度百分比/进度和重置时间；没有订阅额度的 API 渠道不渲染空额度区，没有本地数据的订阅渠道也不再渲染独立空 usage 区。
- PI-Desktop 已登录模型仅用于识别当前官方账号。其公开插件 API 不交付 OAuth 密钥，因此插件继续从 Codex 的 `auth.json` 读取可用于 quota 接口的短期访问令牌。
- 补齐调用 ChatGPT usage 接口所需的 PI-Desktop `net.fetch` 权限和 `chatgpt.com` 域名范围。
- 凭证缺失、过期或被服务端拒绝时，在对应官方卡片内显示“登录 Codex”操作；该操作调用本机 `codex login`，完成后自动刷新卡片。启动失败时在卡片内显示可操作错误，不伪称授权成功。

## Source coverage

| 来源单元 | 读取状态 | 保留语义 | Spec 位置 | 验收 ID | 覆盖状态 | 理由 |
| --- | --- | --- | --- | --- | --- | --- |
| 用户文字 1：实际只有一个官方渠道，但界面显示两个且信息不同 | complete | 唯一官方账号与历史官方标识归并，歧义时不猜测 | 渠道身份与归并 | A1 | covered | 当前截图和源码共同证明 UUID 当前账号与 `openai-codex` 历史标识未对齐 |
| 用户文字 2：API/本地使用与官方订阅信息结合、UI 统一、避免空区块 | complete | 同一窗口行组合 quota 与 usage，按可用字段渐进呈现 | 统一窗口卡片 | A2、A3 | covered | 图二明确展示了请求、Token、费用、进度和重置时间共处一行 |
| 用户文字 3：PI-Desktop 已登录时应拿到信息；不能时卡片可点击授权；认真研究接口 | complete | 识别宿主登录，遵守宿主不泄露 token 的边界，补齐网络声明并提供 Codex 登录入口 | 凭证与额度获取 | A4、A5、A6 | covered | 已核对 PI-Desktop 官方插件 API、OAuth 边界和现有 ChatGPT usage 请求实现 |
| 图一 `codex-clipboard-5078...png` | complete | 作为重复卡片、错误凭证状态和分离式空 UI 的现状证据 | 全部章节 | A1、A2、A4 | covered | 仅承载可观察缺陷，不要求复刻其布局 |
| 图二 `codex-clipboard-1fba...png` | complete | 窗口行组合 badges、进度百分比和重置时间的视觉目标 | 统一窗口卡片 | A2、A3 | covered | 采用结构与信息层级，不要求逐像素复制 |

# 非目标

- 不绕过 PI-Desktop 的 secret store 或读取其受保护 OAuth token。
- 不自建 OAuth 服务、回调协议、凭证存储或 quota 后端。
- 不把不同的 API 服务、网关或多个真实 OpenAI OAuth 账号错误合并。
- 不新增 UI 框架或运行时依赖，也不逐像素复刻参考截图。

# 验收示例

- A1：给定 `models.list` 中恰有一个名为 OpenAI ChatGPT/Codex 的当前 UUID 渠道，且本地历史包含 `openai-codex` usage，刷新后只显示一个官方渠道卡片，卡片同时保留当前账号名称和历史 usage；给定两个匹配账号时不任意归并历史 usage。
- A2：给定官方 quota 和相同渠道的本地 usage，5h 与 Weekly 各只显示一行，该行同时包含对应的额度进度/百分比、重置时间以及请求、Token、可用时的费用。
- A3：给定只有 API/本地 usage 的渠道，卡片只显示有数据的统一窗口行而没有空订阅区；给定只有 quota 的渠道，卡片只显示 quota 行而没有独立的空 API/本地区。
- A4：给定 PI-Desktop 已登录的唯一官方账号但没有可读 Codex `auth.json`，仍只显示该官方卡片，并准确说明宿主登录已识别但凭证按平台安全边界不可交给插件，同时显示键盘可操作的“登录 Codex”按钮。
- A5：点击“登录 Codex”时只启动一次本机 `codex login`；启动失败显示错误，进程成功结束后清空 quota 缓存并刷新，绝不把 token 写入 dashboard snapshot、settings 或日志。
- A6：安装清单声明 `net.fetch` 和 `chatgpt.com`，有效 Codex 凭证下 quota 请求通过 PI-Desktop 审计网络 API 发往既有 usage endpoint；网络、权限和服务端失败仍降级成卡片内原因而不影响本地 usage。

# 约束与不变量

- 访问令牌只存在于请求调用栈和 Authorization header；任何公开状态、缓存、日志和 UI 都不得包含 token。
- 使用 PI-Desktop 公开插件 API，不探测私有 IPC、数据库或 keychain。
- 保留多个真实账号和不同网关的身份边界；只有唯一匹配时才迁移 legacy alias。
- 继续使用现有 DOM/CSS、聚合器和 Node 标准库；不增加依赖。
- 中英文文案、键盘操作和 progressbar 的可访问属性保持可用。

# 决策

- 单个 Native change 推进：身份归并、quota/usage 数据结合和卡片渲染共同修改同一核心数据流，拆分会增加协调成本。
- 当前官方账号通过 `models.list` 的 `providerName` 与模型信息识别；仅当候选唯一时建立 legacy alias 映射。
- PI-Desktop 的 `models.list` 只返回可用模型元数据且明确不返回密钥，所以“复用 PI 登录”限定为账号发现与卡片归属；quota 授权使用本机 Codex CLI 的既有登录存储。
- 登录入口直接启动已安装的 `codex login`，不实现第二套 OAuth。
- quota 与 usage 在渲染时按窗口种类组合，保留两套数据各自的真实时间语义，不伪造 API 限额百分比。

# 待解决问题

无。

# 验证预期

- 运行 `npm test`。
- 增加最小测试覆盖：唯一/多账号 legacy 归并、quota 对齐、清单网络权限、登录启动与刷新、统一窗口渲染结构。
- 使用 preview fixture 或等价 DOM 检查确认官方单卡、API-only、quota-only 和 quota+usage 四种卡片没有空区块。
