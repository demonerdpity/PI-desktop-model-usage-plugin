# 渠道身份与归并

系统从 PI-Desktop `models.list` 获取当前可用渠道和模型的非敏感元数据，并从本地会话事实获取历史 usage。每个当前 provider id 是真实账号边界。

当且仅当当前目录中存在唯一一个可识别为 OpenAI ChatGPT/Codex 官方订阅的渠道时，历史 legacy provider id（`openai-codex`、`codex`、`chatgpt` 及现有兼容 alias）映射到该当前渠道。映射同时用于本地 usage 聚合和订阅 quota 对齐。多个候选、无候选、普通 OpenAI-compatible API 服务或其他网关不得被猜测归并。

Scenario: 唯一官方账号吸收历史 usage
- GIVEN PI-Desktop 返回一个 OpenAI ChatGPT/Codex 官方 UUID provider，且历史事实的 provider id 为 `openai-codex`
- WHEN 仪表盘刷新
- THEN 只产生一个官方渠道卡片，使用当前 provider 的名称和 id，并包含 legacy 事实的 usage

Scenario: 多账号保持身份边界
- GIVEN PI-Desktop 返回两个可匹配的 OpenAI ChatGPT/Codex 当前账号
- WHEN 仪表盘刷新
- THEN 系统不把无法判定归属的 legacy usage 或 quota 任意合并到其中一个账号

# 统一窗口卡片

渠道卡片只有一个使用情况内容区。系统按窗口语义组合 quota 和本地 usage：短窗口对应 5h，周窗口对应 Weekly，保留区间总计单独显示。每行可同时包含请求数、Token、估算费用、额度进度/百分比和重置时间；字段缺失时只省略该字段，不生成另一个空区块。

Scenario: quota 与 usage 同行显示
- GIVEN 同一渠道同时具有 5h/Weekly quota 和对应本地 usage
- WHEN 卡片渲染
- THEN 每个窗口只显示一行，行内同时显示该窗口的 quota 状态、重置信息和 usage badges

Scenario: 单来源卡片不留空区
- GIVEN 渠道只有本地 usage 或只有 quota
- WHEN 卡片渲染
- THEN 卡片显示已有窗口信息，且不显示另一个来源的空标题、空白区域或占位进度条

# 凭证与额度获取

PI-Desktop 登录状态通过 `models.list` 用于账号识别，但公开 API 不向插件提供 API key、OAuth access token 或 refresh token。插件不得读取 PI-Desktop 私有 IPC、数据库、keychain 或受保护数据目录。

订阅 quota 继续使用 Codex `auth.json` 中的访问令牌，通过 PI-Desktop `pi.net.fetch` 向 `https://chatgpt.com/backend-api/wham/usage` 发起单次只读请求。清单必须声明 `net.fetch` 和 `chatgpt.com` 域名。令牌不得进入 snapshot、settings、持久缓存、日志或错误文案。

当账号已识别但 Codex 凭证缺失、不可读、过期或被拒绝时，卡片显示精确且本地化的原因和“登录 Codex”按钮。按钮经 panel-to-main 调用启动本机 `codex login`；重复点击不得并行启动多个登录。命令无法启动时返回安全错误状态；命令成功退出时清空 quota 缓存并触发一次刷新。

Scenario: 已识别宿主账号但凭证不可共享
- GIVEN `models.list` 显示唯一官方账号，但本机没有可读 Codex access token
- WHEN 卡片渲染
- THEN 卡片归属于该官方账号，说明 PI-Desktop 不向插件共享凭证，并提供可键盘操作的登录按钮

Scenario: 登录成功后刷新额度
- GIVEN 用户点击登录按钮且本机 Codex CLI 可启动
- WHEN `codex login` 成功结束
- THEN 插件清空旧 quota 结果并刷新；若新凭证有效，同一卡片展示真实 quota

Scenario: quota 失败不破坏本地统计
- GIVEN 网络权限、网络连接或 provider 响应失败
- WHEN 刷新仪表盘
- THEN 官方卡片显示安全的失败原因，本地 usage 仍正常显示，且没有 token 泄露
