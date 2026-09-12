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
      channelsSub: (count) => `${count} channel${count === 1 ? "" : "s"} · quota windows from the provider adapter`,
      account: "Account",
      plan: "Plan",
      quota: "Quota",
      quotaWindow: "Quota window",
      quotaUnavailable: "Quota unavailable",
      noPercent: "Percentage unavailable",
      remaining: "remaining",
      used: "used",
      resetAt: "Reset at",
      resetAfter: "Reset in",
      requests: "Requests",
      tokens: "Tokens",
      estimate: "Estimate",
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
      channelsSub: (count) => `${count} 个渠道 · 额度窗口由渠道适配器提供`,
      account: "账号",
      plan: "计划",
      quota: "额度",
      quotaWindow: "额度窗口",
      quotaUnavailable: "额度接口不可用",
      noPercent: "百分比不可用",
      remaining: "剩余",
      used: "已用",
      resetAt: "重置时间",
      resetAfter: "重置倒计时",
      requests: "请求",
      tokens: "Token",
      estimate: "估算费用",
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
      settings?.hostAppearance?.locale || ""
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
      return { ...channel, requests: usage.requests, tokens: usage.tokens, cost: usage.cost, costCoverage: usage.costCoverage, models: usage.models, modelCount: usage.modelCount, trend: usage.trend, lastActivityAt: usage.lastActivityAt };
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

  function firstArray(values) {
    for (const value of values) if (Array.isArray(value)) return value;
    return [];
  }
  function quotaData(channel, snapshot) {
    const directQuota = isObject(channel?.quota) ? channel.quota : null;
    const globalQuota = isObject(snapshot?.quota) ? snapshot.quota : isObject(snapshot?.provenance?.quota) ? snapshot.provenance.quota : null;
    const windows = firstArray([
      channel?.quotaWindows,
      directQuota?.quotaWindows,
      directQuota?.windows,
      channel?.quota?.windows,
      globalQuota?.quotaWindows,
      globalQuota?.windows
    ]).filter(isObject);
    const explicitlyUnavailable = channel?.quota === false || directQuota?.available === false;
    const explicitlyAvailable = directQuota?.available === true || channel?.quotaAvailable === true;
    const globalUnavailable = !directQuota && !windows.length && globalQuota?.available === false;
    return {
      available: !explicitlyUnavailable && !globalUnavailable && (explicitlyAvailable || windows.length > 0) && windows.length > 0,
      windows
    };
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
  function metricValue(channel, keys) {
    const sources = [channel, channel?.usage, channel?.metrics];
    for (const source of sources) {
      if (!isObject(source)) continue;
      for (const key of keys) {
        if (!hasOwn(source, key)) continue;
        const raw = source[key];
        const direct = numberValue(raw);
        if (direct !== null) return direct;
        if (key === "tokens" && isObject(raw)) {
          const total = numberValue(raw.total);
          if (total !== null) return total;
        }
      }
    }
    return null;
  }
  function costValue(channel) {
    if (channel?.capabilities?.cost === false) return null;
    const sources = [channel, channel?.usage, channel?.metrics];
    for (const source of sources) {
      if (!isObject(source)) continue;
      for (const key of ["cost", "estimate", "costEstimate"]) {
        if (!hasOwn(source, key)) continue;
        const raw = source[key];
        const amount = isObject(raw) ? raw.amount : raw;
        const value = numberValue(amount);
        if (value !== null) return { amount: value, currency: isObject(raw) ? raw.currency : "USD" };
      }
    }
    return null;
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
  function renderQuotaWindow(window, index) {
    const item = makeElement("div", "quota-window");
    const top = makeElement("div", "quota-window-top");
    const label = displayValue(window.label) || displayValue(window.name) || displayValue(window.id) || `${t("quotaWindow")} ${index + 1}`;
    top.appendChild(makeElement("span", "quota-label", label));
    const percent = quotaPercent(window);
    top.appendChild(makeElement("span", percent ? "quota-percent" : "quota-percent missing", percent ? `${percentText(percent.value)} ${t(percent.kind)}` : t("noPercent")));
    item.appendChild(top);

    const progress = makeElement("div", percent ? "quota-progress" : "quota-progress is-empty");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-label", label);
    if (percent) {
      progress.setAttribute("aria-valuenow", String(percent.value));
      const fill = makeElement("span", percent.kind === "remaining" ? "quota-progress-fill remaining" : "quota-progress-fill used");
      fill.style.width = `${percent.value}%`;
      progress.appendChild(fill);
    } else {
      progress.setAttribute("aria-valuetext", t("noPercent"));
    }
    item.appendChild(progress);

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
  function renderChannel(channel, snapshot) {
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

    const quotaBlock = makeElement("section", "quota-block");
    quotaBlock.appendChild(makeElement("div", "quota-heading", t("quota")));
    const quotaInfo = quotaData(channel, snapshot);
    if (!quotaInfo.available) {
      quotaBlock.appendChild(makeElement("div", "quota-unavailable", t("quotaUnavailable")));
    } else {
      quotaInfo.windows.forEach((window, index) => quotaBlock.appendChild(renderQuotaWindow(window, index)));
    }
    article.appendChild(quotaBlock);

    const requests = channel?.capabilities?.requests === false ? null : metricValue(channel, ["requests", "requestCount"]);
    const tokens = channel?.capabilities?.tokens === false ? null : metricValue(channel, ["tokens", "totalTokens", "tokenCount"]);
    const cost = channel?.capabilities?.cost === false ? null : costValue(channel);
    if (requests !== null || tokens !== null || cost) {
      const footer = makeElement("footer", "channel-footer");
      if (tokens !== null) appendDetail(footer, t("tokens"), fmt(tokens));
      if (requests !== null) appendDetail(footer, t("requests"), fmt(requests));
      if (cost) appendDetail(footer, t("estimate"), fmtCost(cost.amount, cost.currency));
      article.appendChild(footer);
    }
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
    channels.forEach((channel) => list.appendChild(renderChannel(channel, state.snapshot)));
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