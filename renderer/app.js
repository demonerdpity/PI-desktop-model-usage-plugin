"use strict";

(function () {
  const rootWindow = typeof window !== "undefined" ? window : {};
  const boot = rootWindow.__modelUsageBoot || { cached: null, prefersLight: () => false, themeTrail: [] };
  const POLL_VISIBLE_MS = 1500;
  const POLL_HIDDEN_MS = 6000;
  const STORAGE_KEY = "modelUsageDashboard.preferences.v1";
  const strings = {
    en: {
      title: "Model Usage Dashboard",
      appearance: "Appearance",
      theme: "Theme",
      language: "Language",
      followApp: "Follow app",
      light: "Light",
      dark: "Dark",
      following: "Following PI-Desktop",
      reload: "Reload latest data",
      scanning: (done, total) => total ? `Scanning ${done} of ${total} files…` : "Scanning local sessions…",
      stale: "Showing last good data · stale",
      failed: "Refresh failed · showing last good data",
      ready: "Up to date",
      idle: "Waiting for first scan",
      emptyTitle: "No usage records yet",
      emptyBody: "This panel reads assistant meta.usage from PI-Desktop local sessions. Run a conversation, then run the open command again.",
      errorTitle: "Dashboard unavailable",
      errorBody: "The panel could not read its private plugin settings.",
      channels: "Channels",
      channelsSub: (count) => `${count} channel${count === 1 ? "" : "s"} · verified subscription quota and locally observed usage`,
      account: "Account",
      plan: "Plan",
      subscriptionQuota: "Subscription quota",
      quotaWindow: "Quota window",
      quotaUnavailableTitle: "Subscription quota unavailable",
      quotaReasonUnknown: "No reason code was reported for this channel.",
      quotaResetCredits: "Reset credits",
      quotaResetCreditsNote: "Window resets the provider granted. Reference only — this plugin never consumes them.",
      resetCreditsAvailable: "Available",
      resetCreditsApplicable: "Usable now",
      quotaReason: {
        "no-subscription-channel": { title: "No subscription channel found", note: "No Codex sign-in and no matching provider were found on this machine." },
        "no-verified-quota-source": { title: "No verified quota source", note: "This channel exposes no provider quota window that this plugin can read." },
        "credential-file-missing": { title: "Codex sign-in required", note: "PI-Desktop identifies this account but does not expose its OAuth token to plugins. Sign in to Codex to read quota." },
        "credential-file-unreadable": { title: "Codex credentials unreadable", note: "auth.json exists but could not be read." },
        "credential-token-missing": { title: "Codex credentials incomplete", note: "auth.json contains no OAuth access token." },
        "credential-expired": { title: "Codex session expired", note: "Sign in again with the Codex CLI. This plugin never refreshes or rewrites credentials." },
        "egress-blocked": { title: "Network host not allowed", note: "chatgpt.com is not in this plugin's net.domains list, so no request was sent." },
        "network-runtime-missing": { title: "Host network API missing", note: "PI-Desktop did not expose pi.net.fetch, so no request was sent." },
        "network-timeout": { title: "Quota request timed out", note: "The provider did not answer in time. The next refresh will retry." },
        "network-error": { title: "Quota request failed", note: "The request could not reach the provider. The next refresh will retry." },
        "provider-unauthorized": { title: "Provider rejected the credentials", note: "The access token is no longer accepted (HTTP 401)." },
        "provider-forbidden": { title: "Provider denied access", note: "This account may not read usage for this plan (HTTP 403)." },
        "provider-rate-limited": { title: "Provider rate limited the request", note: "Too many usage requests (HTTP 429). The next refresh will retry." },
        "provider-response-malformed": { title: "Unreadable quota response", note: "The provider answered with a body this plugin could not parse." },
        "provider-response-without-window": { title: "No quota window reported", note: "The provider answered but reported no rate-limit window for this account." },
        "provider-unavailable": { title: "Quota service unavailable", note: "The provider returned a server error. The next refresh will retry." },
        "provider-http": { title: "Unexpected provider response", note: "The provider returned an unhandled HTTP status." }
      },
      credits: "Credits / total allowance",
      unlimited: "Unlimited",
      totalAllowance: "Total",
      usedAmount: "Used",
      remainingAmount: "Remaining",
      balance: "Balance",
      apiUsage: "API / local usage",
      usage: "Usage",
      loginCodex: "Sign in to Codex",
      loginStarting: "Opening sign-in…",
      loginRunning: "Codex sign-in is open",
      loginFailed: "Could not start Codex sign-in",
      usageWindow: "Usage window",
      usageTotal: "Total",
      usageTotalRetained: "Total (last 90 days)",
      remaining: "remaining",
      used: "used",
      resetAt: "Reset at",
      resetAfter: "Reset in",
      requests: "Requests",
      tokens: "Tokens",
      estimate: "API-equivalent estimate",
      noChannels: "No channels in this snapshot",
      unknown: "Unknown",
      partial: (count) => `Up to date · ${count} damaged lines skipped`
    },
    zh: {
      title: "模型用量仪表盘",
      appearance: "外观",
      theme: "主题",
      language: "语言",
      followApp: "跟随应用",
      light: "浅色",
      dark: "深色",
      following: "跟随 PI-Desktop",
      reload: "刷新最新快照",
      scanning: (done, total) => total ? `正在扫描 ${done} / ${total} 个文件…` : "正在扫描本地会话…",
      stale: "显示上次成功数据 · 已过期",
      failed: "刷新失败 · 保留上次成功数据",
      ready: "数据已更新",
      idle: "等待首次扫描",
      emptyTitle: "暂无用量记录",
      emptyBody: "本面板只读取 PI-Desktop 本地会话中的 assistant meta.usage。运行一次对话后，再次执行打开命令。",
      errorTitle: "无法读取仪表盘",
      errorBody: "面板无法读取插件私有设置。",
      channels: "渠道",
      channelsSub: (count) => `${count} 个渠道 · 真实订阅额度与本地观测使用`,
      account: "账号",
      plan: "计划",
      subscriptionQuota: "订阅额度",
      quotaWindow: "额度窗口",
      quotaUnavailableTitle: "订阅额度不可用",
      quotaReasonUnknown: "该渠道未报告具体原因代码。",
      quotaResetCredits: "重置额度",
      quotaResetCreditsNote: "服务端授予的窗口重置次数。仅供参考——本插件不会消耗它。",
      resetCreditsAvailable: "可用次数",
      resetCreditsApplicable: "当前可用",
      quotaReason: {
        "no-subscription-channel": { title: "未发现订阅渠道", note: "本机没有 Codex 登录凭证，也没有匹配的供应商。" },
        "no-verified-quota-source": { title: "没有可核实的额度来源", note: "该渠道没有本插件可读取的供应商额度窗口。" },
        "credential-file-missing": { title: "需要登录 Codex", note: "PI-Desktop 能识别此账号，但不会向插件暴露 OAuth 令牌。请登录 Codex 后读取额度。" },
        "credential-file-unreadable": { title: "Codex 凭证无法读取", note: "auth.json 存在但读取失败。" },
        "credential-token-missing": { title: "Codex 凭证不完整", note: "auth.json 中没有 OAuth 访问令牌。" },
        "credential-expired": { title: "Codex 登录已过期", note: "请重新用 Codex CLI 登录。本插件不会刷新或改写凭证。" },
        "egress-blocked": { title: "网络域名未被允许", note: "chatgpt.com 不在本插件的 net.domains 白名单中，因此未发出请求。" },
        "network-runtime-missing": { title: "宿主网络 API 缺失", note: "PI-Desktop 未提供 pi.net.fetch，因此未发出请求。" },
        "network-timeout": { title: "额度请求超时", note: "供应商未及时响应，下次刷新会重试。" },
        "network-error": { title: "额度请求失败", note: "请求无法到达供应商，下次刷新会重试。" },
        "provider-unauthorized": { title: "供应商拒绝了凭证", note: "访问令牌已不被接受（HTTP 401）。" },
        "provider-forbidden": { title: "供应商拒绝访问", note: "该账号无权读取此套餐的用量（HTTP 403）。" },
        "provider-rate-limited": { title: "供应商限流", note: "用量查询过于频繁（HTTP 429），下次刷新会重试。" },
        "provider-response-malformed": { title: "额度响应无法解析", note: "供应商返回了本插件无法解析的内容。" },
        "provider-response-without-window": { title: "响应中没有额度窗口", note: "供应商已响应，但未报告该账号的速率限制窗口。" },
        "provider-unavailable": { title: "额度服务不可用", note: "供应商返回了服务端错误，下次刷新会重试。" },
        "provider-http": { title: "供应商响应异常", note: "供应商返回了未处理的 HTTP 状态码。" }
      },
      credits: "Credits / 总额度",
      unlimited: "不限量",
      totalAllowance: "总额",
      usedAmount: "已用",
      remainingAmount: "剩余",
      balance: "余额",
      apiUsage: "API / 本地使用",
      usage: "使用情况",
      loginCodex: "登录 Codex",
      loginStarting: "正在打开登录…",
      loginRunning: "Codex 登录已打开",
      loginFailed: "无法启动 Codex 登录",
      usageWindow: "使用窗口",
      usageTotal: "总计",
      usageTotalRetained: "总计（近90天）",
      remaining: "剩余",
      used: "已用",
      resetAt: "重置时间",
      resetAfter: "重置倒计时",
      requests: "请求",
      tokens: "Token",
      estimate: "API 等价估算",
      noChannels: "此快照没有渠道",
      unknown: "未知",
      partial: (count) => `数据已更新 · 已跳过 ${count} 条损坏记录`
    }
  };

  const state = {
    locale: "en",
    appearance: null,
    snapshot: null,
    scan: null,
    login: null,
    range: 30,
    preferences: { theme: "auto", locale: "auto" },
    status: "loading",
    menu: false,
    timer: null,
    lastKey: ""
  };

  function $(id) { return document.getElementById(id); }
  function text(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null ? "" : String(value);
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function isObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
  function hasOwn(value, key) { return isObject(value) && Object.prototype.hasOwnProperty.call(value, key); }
  function numberValue(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  function safeNumber(value) { return numberValue(value) || 0; }
  function stringValue(value) {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }
  function displayValue(value) {
    const direct = stringValue(value);
    if (direct) return direct;
    if (!isObject(value)) return "";
    for (const key of ["label", "name"]) {
      const nested = stringValue(value[key]);
      if (nested) return nested;
    }
    return "";
  }
  function fmt(value) {
    const parsed = numberValue(value);
    return parsed === null ? "" : Math.round(parsed).toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US");
  }
  function fmtDecimal(value) {
    const parsed = numberValue(value);
    return parsed === null ? "" : parsed.toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 4 });
  }
  function fmtCost(value, currency = "USD") {
    const parsed = numberValue(value);
    if (parsed === null) return "";
    try {
      return parsed.toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: String(currency || "USD"), maximumFractionDigits: 4 });
    } catch (_) {
      return parsed.toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
    }
  }
  function t(key, ...args) {
    const value = strings[state.locale][key];
    return typeof value === "function" ? value(...args) : value;
  }
  function readPreferences() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return value && typeof value === "object"
        ? { theme: value.theme || "auto", locale: value.locale || "auto" }
        : { theme: "auto", locale: "auto" };
    } catch (_) {
      return { theme: "auto", locale: "auto" };
    }
  }
  function savePreferences() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.preferences)); } catch (_) {}
  }
  function hostLocale() {
    return String(state.appearance?.locale || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
  }
  function resolvedLocale() {
    return state.preferences.locale === "auto" ? hostLocale() : state.preferences.locale === "zh" ? "zh" : "en";
  }
  function resolvedTheme() {
    if (state.preferences.theme === "light" || state.preferences.theme === "dark") return state.preferences.theme;
    if (state.appearance?.base === "light" || state.appearance?.base === "dark") return state.appearance.base;
    return boot.prefersLight() ? "light" : "dark";
  }
  function applyAppearance() {
    state.locale = resolvedLocale();
    const base = resolvedTheme();
    document.documentElement.dataset.theme = base;
    document.documentElement.dataset.lang = state.locale;
    document.documentElement.lang = state.locale === "zh" ? "zh-CN" : "en";
    const pluginCss = state.preferences.theme === "auto" && typeof state.appearance?.pluginTheme?.css === "string"
      ? state.appearance.pluginTheme.css
      : "";
    let style = $("pluginThemeCss");
    if (pluginCss) {
      if (!style) {
        style = document.createElement("style");
        style.id = "pluginThemeCss";
        document.head.appendChild(style);
      }
      style.textContent = pluginCss.slice(0, 262144);
    } else if (style) style.remove();
    try { localStorage.setItem(boot.cacheKey || "modelUsageDashboard.appearance.v1", JSON.stringify({ base, locale: state.locale })); } catch (_) {}
    if (Array.isArray(boot.themeTrail)) boot.themeTrail.push(base);
  }
  function setSelected(selector, value, dataName) {
    document.querySelectorAll(selector).forEach((node) => {
      const selected = node.dataset[dataName] === String(value);
      node.classList.toggle("selected", selected);
      node.setAttribute("aria-pressed", String(selected));
    });
  }
  function settingsKey(settings) {
    const snapshot = settings?.dashboardSnapshot || {};
    return JSON.stringify([
      snapshot.generatedAt || 0,
      snapshot.asOf || 0,
      settings?.scanState?.status || "",
      settings?.scanState?.finishedAt || 0,
      settings?.hostAppearance?.base || "",
      settings?.hostAppearance?.locale || "",
      settings?.codexLogin?.status || "",
      settings?.codexLogin?.updatedAt || 0
    ]);
  }

  async function readSettings(force) {
    const bridge = rootWindow.pluginBridge;
    if (!bridge || typeof bridge.invoke !== "function") {
      state.status = "error";
      render();
      return;
    }
    try {
      const settings = await bridge.invoke("plugin.getSettings");
      const key = settingsKey(settings);
      state.appearance = settings?.hostAppearance || state.appearance;
      state.scan = settings?.scanState || null;
      state.login = settings?.codexLogin || null;
      state.snapshot = settings?.dashboardSnapshot || null;
      state.status = "ok";
      applyAppearance();
      if (force || key !== state.lastKey) {
        state.lastKey = key;
        render();
      }
    } catch (_) {
      state.status = "error";
      render();
    }
  }

  function renderStatic() {
    text("appTitle", t("title"));
    text("themeLabel", t("theme"));
    text("languageLabel", t("language"));
    text("themeAuto", t("followApp"));
    text("themeLight", t("light"));
    text("themeDark", t("dark"));
    text("localeAuto", t("followApp"));
    text("reloadButton", "↻");
    if ($("reloadButton")) $("reloadButton").setAttribute("aria-label", t("reload"));
    if ($("appearanceButton")) $("appearanceButton").setAttribute("aria-label", t("appearance"));
    text("channelsTitle", t("channels"));
    text("channelsSubtitle", "");
    setSelected("[data-theme-choice]", state.preferences.theme, "themeChoice");
    setSelected("[data-locale-choice]", state.preferences.locale, "localeChoice");
  }

  function renderToolbar() {
    const scan = state.scan || {};
    const damaged = Math.max(safeNumber(scan.malformedLines), safeNumber(scan.truncatedLines)) + safeNumber(scan.filesSkipped);
    if (scan.status === "scanning") text("toolbarStatus", t("scanning", scan.filesScanned || 0, scan.filesTotal || 0));
    else if (scan.status === "failed") text("toolbarStatus", scan.stale ? t("failed") : t("failed"));
    else if (scan.stale) text("toolbarStatus", t("stale"));
    else if (scan.status === "ready" && damaged) text("toolbarStatus", t("partial", damaged));
    else if (scan.status === "ready") text("toolbarStatus", t("ready"));
    else text("toolbarStatus", t("idle"));
    const progress = $("scanProgress");
    if (!progress) return;
    const total = safeNumber(scan.filesTotal);
    const done = Math.min(total, safeNumber(scan.filesScanned));
    const percent = total ? Math.round((done / total) * 100) : 0;
    progress.hidden = scan.status !== "scanning";
    progress.setAttribute("aria-valuenow", String(percent));
    const fill = $("scanProgressFill");
    if (fill) fill.style.width = `${percent}%`;
  }

  function channelList(snapshot) {
    const trend = snapshot?.trends?.[String(state.range)];
    const base = Array.isArray(snapshot?.channels) ? snapshot.channels : Array.isArray(snapshot?.providers) ? snapshot.providers : null;
    if (!base) return trend && Array.isArray(trend.providers) ? trend.providers : [];
    if (!trend || !Array.isArray(trend.providers)) return base;
    const byId = new Map(trend.providers.filter(isObject).map((provider) => [String(provider.id || ""), provider]));
    const merged = base.map((channel) => {
      const usage = byId.get(String(channel?.id || ""));
      if (!usage) return channel;
      const mergedChannel = { ...channel, requests: usage.requests, tokens: usage.tokens, cost: usage.cost, costCoverage: usage.costCoverage, models: usage.models, modelCount: usage.modelCount, trend: usage.trend, lastActivityAt: usage.lastActivityAt };
      if (hasOwn(usage, "usageWindows")) mergedChannel.usageWindows = usage.usageWindows;
      return mergedChannel;
    });
    const known = new Set(merged.map((channel) => String(channel?.id || "")));
    trend.providers.forEach((provider) => { if (isObject(provider) && !known.has(String(provider.id || ""))) merged.push(provider); });
    return merged;
  }
  function hasRenderableData(snapshot) {
    if (!snapshot) return false;
    return channelList(snapshot).some(isObject);
  }
  function renderState() {
    const snapshot = state.snapshot;
    const showState = state.status === "error" || !hasRenderableData(snapshot);
    $("state").hidden = !showState;
    $("dashboard").hidden = showState;
    if (!showState) return;
    if (state.status === "error") {
      text("stateTitle", t("errorTitle"));
      text("stateBody", t("errorBody"));
      return;
    }
    text("stateTitle", t("emptyTitle"));
    text("stateBody", t("emptyBody"));
  }
  function windowToken(value) {
    return stringValue(value).toLowerCase().replace(/[\s-]+/g, "_");
  }
  function windowKind(window) {
    if (!isObject(window)) return "";
    if (window.primary === true || window.short === true) return "short";
    if (window.secondary === true) return "weekly";
    if (window.total === true || window.isTotal === true || window.retained === true) return "total";
    for (const key of ["kind", "type", "windowType", "window", "period", "id", "key", "name", "label", "primary", "secondary", "short", "total"]) {
      const token = windowToken(window[key]);
      if (["primary", "short", "primary_window", "short_window", "5h", "5_hour", "5_hours"].includes(token)) return "short";
      if (["secondary", "weekly", "secondary_window", "weekly_window", "7d", "7_day", "7_days"].includes(token)) return "weekly";
      if (["total", "overall", "all", "all_time", "retained"].includes(token)) return "total";
    }
    return "";
  }
  function hasWindowData(window) {
    if (!isObject(window)) return false;
    const valueKeys = ["used", "limit", "remaining", "usedPercent", "remainingPercent", "resetAt", "resetAfterSeconds", "resetAfter"];
    return valueKeys.some((key) => {
      if (!hasOwn(window, key)) return false;
      const value = window[key];
      if (["usedPercent", "remainingPercent"].includes(key)) return percentValue(value) !== null;
      if (["used", "limit", "remaining", "resetAfterSeconds"].includes(key)) return numberValue(value) !== null;
      if (["resetAt", "resetAfter"].includes(key)) return numberValue(value) !== null || Boolean(displayValue(value));
      return Boolean(displayValue(value));
    });
  }
  function quotaData(channel) {
    const windows = (windowList(channel?.quotaWindows) || [])
      .filter((window) => hasWindowData(window) && quotaPercent(window) !== null && ["short", "weekly"].includes(windowKind(window)))
      .sort((left, right) => (windowKind(left) === "short" ? 0 : 1) - (windowKind(right) === "short" ? 0 : 1));
    return { available: windows.length > 0, windows };
  }
  function preferredWindowLabel(window, index, fallbackKey) {
    const kind = windowKind(window);
    if (kind === "short") return "5h";
    if (kind === "weekly") return "Weekly";
    return displayValue(window?.label) || displayValue(window?.name) || displayValue(window?.id) || `${t(fallbackKey)} ${index + 1}`;
  }
  function percentValue(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
    const raw = String(value).trim().replace(/%$/, "");
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
  }
  function percentText(value) {
    const parsed = Math.round(value * 100) / 100;
    return parsed.toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 2 }) + "%";
  }
  function quotaPercent(window) {
    const remaining = percentValue(window.remainingPercent);
    if (remaining !== null) return { value: remaining, kind: "remaining" };
    const used = percentValue(window.usedPercent);
    if (used !== null) return { value: used, kind: "used" };
    return null;
  }
  function resetAtText(value) {
    if (value === null || value === undefined || value === "") return "";
    const raw = stringValue(value);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function resetAfterText(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      let seconds = Math.round(value);
      const days = Math.floor(seconds / 86400);
      seconds %= 86400;
      const hours = Math.floor(seconds / 3600);
      seconds %= 3600;
      const minutes = Math.floor(seconds / 60);
      seconds %= 60;
      const parts = [];
      if (days) parts.push(`${days}d`);
      if (hours) parts.push(`${hours}h`);
      if (minutes) parts.push(`${minutes}m`);
      if (!parts.length) parts.push(`${seconds}s`);
      return parts.join(" ");
    }
    if (isObject(value)) return displayValue(value) || "";
    return stringValue(value);
  }
  function fieldValue(channel, quota, keys) {
    for (const source of [channel, quota]) {
      if (!isObject(source)) continue;
      for (const key of keys) {
        if (!hasOwn(source, key)) continue;
        const value = displayValue(source[key]);
        if (value) return value;
      }
    }
    return "";
  }
  function channelName(channel) {
    const provider = isObject(channel?.provider) ? channel.provider : null;
    return displayValue(channel?.label) || displayValue(channel?.name) || displayValue(channel?.channel) || displayValue(provider?.label) || displayValue(provider?.name) || displayValue(channel?.id) || displayValue(provider?.id) || t("unknown");
  }
  function metricValueFromSources(sources, keys) {
    for (const source of sources) {
      if (!isObject(source)) continue;
      for (const key of keys) {
        if (!hasOwn(source, key)) continue;
        const raw = source[key];
        const direct = numberValue(raw);
        if (direct !== null) return direct;
        if (key === "tokens" && isObject(raw)) {
          for (const tokenKey of ["total", "value"]) {
            const total = numberValue(raw[tokenKey]);
            if (total !== null) return total;
          }
        }
      }
    }
    return null;
  }
  function metricValue(channel, keys) {
    return metricValueFromSources([channel, channel?.usage, channel?.metrics], keys);
  }
  function costValueFromSources(sources) {
    for (const source of sources) {
      if (!isObject(source)) continue;
      for (const key of ["cost", "estimate", "costEstimate", "apiEquivalentCost", "estimatedCost"]) {
        if (!hasOwn(source, key)) continue;
        const raw = source[key];
        const amount = isObject(raw)
          ? hasOwn(raw, "amount") ? raw.amount : hasOwn(raw, "value") ? raw.value : raw.total
          : raw;
        const value = numberValue(amount);
        if (value !== null) return { amount: value, currency: isObject(raw) ? stringValue(raw.currency) || "USD" : "USD" };
      }
    }
    return null;
  }
  function costValue(channel) {
    if (channel?.capabilities?.cost === false) return null;
    return costValueFromSources([channel, channel?.usage, channel?.metrics]);
  }
  function makeElement(name, className, value) {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function appendDetail(parent, label, value) {
    const item = makeElement("span", "channel-detail");
    item.appendChild(makeElement("span", "detail-label", label));
    item.appendChild(makeElement("span", "detail-value", value));
    parent.appendChild(item);
  }
  function renderQuotaWindow(window, index, usageWindow) {
    const item = makeElement("div", "quota-window");
    const top = makeElement("div", "quota-window-top");
    const label = preferredWindowLabel(window, index, "quotaWindow");
    top.appendChild(makeElement("span", "quota-label", label));
    const summary = makeElement("div", "window-summary");
    const badges = renderUsageBadges(usageWindow);
    if (badges) summary.appendChild(badges);
    const percent = quotaPercent(window);
    if (percent) summary.appendChild(makeElement("span", "quota-percent", percentText(percent.value)));
    if (summary.childNodes.length) top.appendChild(summary);
    item.appendChild(top);

    if (percent) {
      const progress = makeElement("div", "quota-progress");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(percent.value));
      progress.setAttribute("aria-label", label);
      const fill = makeElement("span", percent.kind === "remaining" ? "quota-progress-fill remaining" : "quota-progress-fill used");
      fill.style.width = `${percent.value}%`;
      progress.appendChild(fill);
      item.appendChild(progress);
    }

    const reset = makeElement("div", "quota-reset");
    if (hasOwn(window, "resetAt")) {
      const value = resetAtText(window.resetAt);
      if (value) appendDetail(reset, t("resetAt"), value);
    }
    const resetAfter = hasOwn(window, "resetAfterSeconds") ? window.resetAfterSeconds : window.resetAfter;
    if (resetAfter !== undefined && resetAfter !== null) {
      const value = resetAfterText(resetAfter);
      if (value) appendDetail(reset, t("resetAfter"), value);
    }
    if (reset.childNodes.length) item.appendChild(reset);
    return item;
  }
  function windowList(value) {
    if (Array.isArray(value)) return value.filter(isObject);
    if (!isObject(value)) return null;
    return Object.entries(value).map(([key, row]) => {
      if (!isObject(row)) return null;
      return hasOwn(row, "key") ? row : { ...row, key };
    }).filter(Boolean);
  }
  function usageWindowsFor(channel) {
    return windowList(channel?.usageWindows);
  }
  function usageWindowIsRetained90(window) {
    return windowKind(window) === "total" && numberValue(window.retentionDays) === 90;
  }
  function usageWindowLabel(window, index) {
    const kind = windowKind(window);
    if (kind === "short") return "5h";
    if (kind === "weekly") return "Weekly";
    if (kind === "total") return usageWindowIsRetained90(window) ? t("usageTotalRetained") : t("usageTotal");
    return displayValue(window?.label) || displayValue(window?.name) || displayValue(window?.id) || `${t("usageWindow")} ${index + 1}`;
  }
  function usageWindowRank(window) {
    const kind = windowKind(window);
    return kind === "short" ? 0 : kind === "weekly" ? 1 : kind === "total" ? 2 : 3;
  }
  function orderedUsageWindows(windows) {
    return windows.map((window, index) => ({ window, index })).sort((left, right) => usageWindowRank(left.window) - usageWindowRank(right.window) || left.index - right.index).map((entry) => entry.window);
  }
  function appendUsageBadge(parent, label, value) {
    const badge = makeElement("span", "usage-badge");
    badge.appendChild(makeElement("span", "usage-badge-label", label));
    badge.appendChild(makeElement("strong", "usage-badge-value", value));
    parent.appendChild(badge);
  }
  function renderUsageBadges(window) {
    if (!isObject(window)) return null;
    const badges = makeElement("div", "usage-badges");
    const requests = window?.capabilities?.requests === false ? null : metricValueFromSources([window, window?.usage, window?.metrics], ["requests", "requestCount"]);
    const tokens = window?.capabilities?.tokens === false ? null : metricValueFromSources([window, window?.usage, window?.metrics], ["tokens", "totalTokens", "tokenCount"]);
    const cost = window?.capabilities?.cost === false ? null : costValueFromSources([window, window?.usage, window?.metrics]);
    if (requests !== null) appendUsageBadge(badges, t("requests"), fmt(requests));
    if (tokens !== null) appendUsageBadge(badges, t("tokens"), fmt(tokens));
    if (cost) appendUsageBadge(badges, t("estimate"), fmtCost(cost.amount, cost.currency));
    return badges.childNodes.length ? badges : null;
  }
  function hasUsageWindowData(window) {
    const requests = metricValueFromSources([window], ["requests", "requestCount"]);
    const tokens = metricValueFromSources([window], ["tokens", "totalTokens", "tokenCount"]);
    return safeNumber(requests) > 0 || safeNumber(tokens) > 0 || Boolean(costValueFromSources([window]));
  }
  function renderUsageWindow(window, index) {
    const row = makeElement("div", "usage-window");
    row.appendChild(makeElement("span", "usage-window-label", usageWindowLabel(window, index)));
    const badges = renderUsageBadges(window);
    if (badges) row.appendChild(badges);
    return row;
  }
  function canAuthorize(channel) {
    const marker = `${channelName(channel)} ${displayValue(channel?.id)}`.toLowerCase();
    return (marker.includes("openai") || marker.includes("chatgpt") || marker.includes("codex")) &&
      ["credential-file-missing", "credential-file-unreadable", "credential-token-missing", "credential-expired", "provider-unauthorized", "provider-forbidden"]
      .includes(stringValue(channel?.provenance?.quota?.reason));
  }
  function renderLoginButton() {
    const running = state.login?.status === "running";
    const failed = state.login?.status === "failed";
    const button = makeElement("button", "login-button", running ? t("loginRunning") : failed ? t("loginFailed") : t("loginCodex"));
    button.type = "button";
    button.disabled = running;
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = t("loginStarting");
      try {
        const result = await rootWindow.pluginBridge?.invoke?.("codex.login");
        button.textContent = result?.ok ? t("loginRunning") : t("loginFailed");
        button.disabled = Boolean(result?.ok);
      } catch (_) {
        button.textContent = t("loginFailed");
        button.disabled = false;
      }
    });
    return button;
  }
  function renderUsageBlock(channel, quotaInfo, showQuota) {
    const block = makeElement("section", "usage-block");
    block.appendChild(makeElement("div", "usage-heading", t("usage")));
    const usageWindows = orderedUsageWindows(usageWindowsFor(channel) || []).filter(hasUsageWindowData);
    const usedUsage = new Set();
    quotaInfo.windows.forEach((quotaWindow, index) => {
      const usageWindow = usageWindows.find((window) => windowKind(window) === windowKind(quotaWindow));
      if (usageWindow) usedUsage.add(usageWindow);
      block.appendChild(renderQuotaWindow(quotaWindow, index, usageWindow));
    });
    usageWindows.filter((window) => !usedUsage.has(window)).forEach((window, index) => block.appendChild(renderUsageWindow(window, index)));
    if (showQuota && !quotaInfo.available) {
      const unavailable = makeElement("div", "quota-unavailable");
      const reason = quotaReasonInfo(channel);
      unavailable.appendChild(makeElement("div", "quota-unavailable-title", reason.title));
      unavailable.appendChild(makeElement("small", "quota-unavailable-note", reason.note));
      if (canAuthorize(channel)) unavailable.appendChild(renderLoginButton());
      block.appendChild(unavailable);
    }
    const creditItem = renderCreditUsage(channel.creditUsage);
    if (creditItem) block.appendChild(creditItem);
    const resetCreditsItem = renderResetCredits(channel.resetCredits);
    if (resetCreditsItem) block.appendChild(resetCreditsItem);
    return block.childNodes.length > 1 ? block : null;
  }
  function renderCreditUsage(value) {
    if (!isObject(value)) return null;
    const total = numberValue(value.total);
    const used = numberValue(value.used);
    const remaining = numberValue(value.remaining);
    const remainingPercent = percentValue(value.remainingPercent);
    const balance = stringValue(value.balance);
    const unlimited = value.unlimited === true;
    if (!unlimited && total === null && used === null && remaining === null && remainingPercent === null && !balance) return null;

    const item = makeElement("div", "credit-usage");
    const top = makeElement("div", "quota-window-top");
    top.appendChild(makeElement("span", "quota-label", t("credits")));
    if (remainingPercent !== null) top.appendChild(makeElement("span", "quota-percent", `${percentText(remainingPercent)} ${t("remaining")}`));
    item.appendChild(top);

    const badges = makeElement("div", "usage-badges credit-badges");
    if (unlimited) appendUsageBadge(badges, t("remainingAmount"), t("unlimited"));
    if (total !== null) appendUsageBadge(badges, t("totalAllowance"), fmtDecimal(total));
    if (used !== null) appendUsageBadge(badges, t("usedAmount"), fmtDecimal(used));
    if (remaining !== null) appendUsageBadge(badges, t("remainingAmount"), fmtDecimal(remaining));
    if (balance) appendUsageBadge(badges, t("balance"), balance);
    if (badges.childNodes.length) item.appendChild(badges);

    if (remainingPercent !== null) {
      const progress = makeElement("div", "quota-progress");
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", "100");
      progress.setAttribute("aria-valuenow", String(remainingPercent));
      progress.setAttribute("aria-label", t("credits"));
      const fill = makeElement("span", "quota-progress-fill remaining");
      fill.style.width = `${remainingPercent}%`;
      progress.appendChild(fill);
      item.appendChild(progress);
    }

    const reset = makeElement("div", "quota-reset");
    if (hasOwn(value, "resetAt")) {
      const textValue = resetAtText(value.resetAt);
      if (textValue) appendDetail(reset, t("resetAt"), textValue);
    }
    const resetAfter = hasOwn(value, "resetAfterSeconds") ? value.resetAfterSeconds : value.resetAfter;
    if (resetAfter !== undefined && resetAfter !== null) {
      const textValue = resetAfterText(resetAfter);
      if (textValue) appendDetail(reset, t("resetAfter"), textValue);
    }
    if (reset.childNodes.length) item.appendChild(reset);
    return item;
  }

  function quotaReasonInfo(channel) {
    const entry = channel?.provenance?.quota;
    const reason = stringValue(isObject(entry) ? entry.reason : "");
    const table = t("quotaReason");
    if (reason && hasOwn(table, reason)) return table[reason];
    const status = /^provider-http-(\d{3})$/.exec(reason);
    if (status) return { title: `${table["provider-http"].title} · HTTP ${status[1]}`, note: table["provider-http"].note };
    return {
      title: t("quotaUnavailableTitle"),
      note: reason ? `${t("quotaReasonUnknown")} (${reason})` : t("quotaReasonUnknown")
    };
  }

  function renderResetCredits(value) {
    if (!isObject(value)) return null;
    const available = numberValue(value.availableCount);
    const applicable = numberValue(value.applicableCount);
    if (available === null && applicable === null) return null;
    const item = makeElement("div", "reset-credits");
    const badges = makeElement("div", "usage-badges credit-badges");
    if (available !== null) appendUsageBadge(badges, t("resetCreditsAvailable"), fmt(available));
    if (applicable !== null) appendUsageBadge(badges, t("resetCreditsApplicable"), fmt(applicable));
    return badges.childNodes.length ? (item.appendChild(badges), item) : null;
  }

  function showsSubscriptionQuota(channel, quotaInfo) {
    if (channel?.subscriptionQuota === true) return true;
    if (quotaInfo.available || isObject(channel?.creditUsage)) return true;
    const marker = `${channelName(channel)} ${displayValue(channel?.plan)}`.toLowerCase();
    return marker.includes("chatgpt") || marker.includes("oauth") || marker.includes("subscription") || marker.includes("订阅");
  }

  function renderChannel(channel) {
    const article = makeElement("article", "channel-card");
    const quota = isObject(channel?.quota) ? channel.quota : null;
    const header = makeElement("header", "channel-header");
    const heading = makeElement("div", "channel-heading");
    const name = channelName(channel);
    const title = makeElement("h2", "channel-name", name);
    title.title = name;
    heading.appendChild(title);
    const id = displayValue(channel?.id);
    if (id && id !== name) heading.appendChild(makeElement("div", "channel-id", id));
    header.appendChild(heading);
    article.appendChild(header);

    const metadata = makeElement("div", "channel-metadata");
    const account = fieldValue(channel, quota, ["accountLabel", "accountName"]);
    const plan = fieldValue(channel, quota, ["plan", "planName", "subscription", "tier"]);
    if (account) appendDetail(metadata, t("account"), account);
    if (plan) appendDetail(metadata, t("plan"), plan);
    if (metadata.childNodes.length) article.appendChild(metadata);

    const quotaInfo = quotaData(channel);
    const usageBlock = renderUsageBlock(channel, quotaInfo, showsSubscriptionQuota(channel, quotaInfo));
    if (usageBlock) article.appendChild(usageBlock);
    return article;
  }
  function renderChannels() {
    const list = $("channelList");
    if (!list) return;
    clear(list);
    const channels = channelList(state.snapshot).filter(isObject);
    text("channelsSubtitle", t("channelsSub", channels.length));
    if (!channels.length) {
      list.appendChild(makeElement("div", "channels-empty", t("noChannels")));
      return;
    }
    channels.forEach((channel) => list.appendChild(renderChannel(channel)));
  }

  function render() {
    applyAppearance();
    renderStatic();
    renderToolbar();
    renderState();
    if (!$("dashboard")?.hidden) renderChannels();
    document.documentElement.dataset.booting = "false";
    const menu = $("appearanceMenu");
    if (menu) menu.hidden = !state.menu;
    if ($("appearanceButton")) $("appearanceButton").setAttribute("aria-expanded", String(state.menu));
    text("appearanceNote", t("following"));
  }

  function updatePreference(key, value) {
    state.preferences[key] = value;
    savePreferences();
    state.menu = false;
    render();
  }
  function bind() {
    $("reloadButton")?.addEventListener("click", () => void readSettings(true));
    $("appearanceButton")?.addEventListener("click", (event) => { event.stopPropagation(); state.menu = !state.menu; render(); });
    document.querySelectorAll("[data-theme-choice]").forEach((node) => node.addEventListener("click", () => updatePreference("theme", node.dataset.themeChoice)));
    document.querySelectorAll("[data-locale-choice]").forEach((node) => node.addEventListener("click", () => updatePreference("locale", node.dataset.localeChoice)));
    document.addEventListener("click", () => { if (state.menu) { state.menu = false; render(); } });
    $("appearanceMenu")?.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.menu) { state.menu = false; render(); } });
    document.addEventListener("visibilitychange", restartPolling);
    rootWindow.addEventListener?.("focus", () => void readSettings(false));
  }
  function restartPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => void readSettings(false), document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
  }
  async function init() {
    state.preferences = readPreferences();
    state.appearance = boot.cached;
    applyAppearance();
    render();
    bind();
    await readSettings(true);
    restartPolling();
  }
  rootWindow.__modelUsageDashboard = {
    state,
    readSettings,
    render,
    applyAppearance,
  };
  void init();
})();
