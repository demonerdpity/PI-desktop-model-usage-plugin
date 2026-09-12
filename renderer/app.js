"use strict";

(function () {
  const bridge = window.pluginBridge;
  const boot = window.__modelUsageBoot || { cached: null, apply() {}, prefersLight: () => false, themeTrail: [] };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const POLL_VISIBLE_MS = 1500;
  const POLL_HIDDEN_MS = 6000;
  const STORAGE_KEY = "modelUsageDashboard.preferences.v1";
  const strings = {
    en: {
      title: "Model Usage Dashboard", appearance: "Appearance", theme: "Theme", language: "Language", followApp: "Follow app", light: "Light", dark: "Dark", following: "Following PI-Desktop", reload: "Reload latest data", range7: "7D", range30: "30D", range90: "90D", scanning: (done, total) => total ? `Scanning ${done} of ${total} files…` : "Scanning local sessions…", stale: "Showing last good data · stale", failed: "Refresh failed · showing last good data", ready: "Up to date", idle: "Waiting for first scan", emptyTitle: "No usage records yet", emptyBody: "This panel reads assistant meta.usage from PI-Desktop local sessions. Run a conversation, then run the open command again.", errorTitle: "Dashboard unavailable", errorBody: "The panel could not read its private plugin settings.", requests: "Requests", tokens: "Total tokens", input: "Input", output: "Output", cost: "API-equivalent estimate", estimate: (coverage) => `Official exact-price coverage ${coverage}%`, trend: "Usage trend", trendSub: (days) => `Local calendar days · last ${days} days`, trendTokens: "Tokens", trendRequests: "Requests", trendCost: "Cost", providers: "Providers", providersSub: (count) => `${count} provider channels · kept separate by provider id`, models: "Models", modelsSub: (count) => `${count} exact model ids in the recorded history`, provider: "Provider", model: "Model", requestsShort: "Requests", tokensShort: "Tokens", modelsShort: "Models", costShort: "Estimate", quotaShort: "Quota", providerUnknown: "No records", current: "Enabled", noCost: "Not available", provenance: "Data sources and limits", usageSource: "Usage source", costSource: "Cost source", quotaSource: "Quota / reset", localUsage: "PI-Desktop assistant meta.usage · local only", priceEstimate: "Versioned official API price snapshot · estimate only", quotaHidden: "Hidden: the current public host API provides no safe quota, balance, or reset data.", refreshed: (date) => `Updated ${date}`, coverage: (value) => `${Math.round(value * 100)}% coverage`, unknown: "Unknown", date: (value) => new Date(value + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
    },
    zh: {
      title: "模型用量仪表盘", appearance: "外观", theme: "主题", language: "语言", followApp: "跟随应用", light: "浅色", dark: "深色", following: "跟随 PI-Desktop", reload: "刷新最新快照", range7: "7天", range30: "30天", range90: "90天", scanning: (done, total) => total ? `正在扫描 ${done} / ${total} 个文件…` : "正在扫描本地会话…", stale: "显示上次成功数据 · 已过期", failed: "刷新失败 · 保留上次成功数据", ready: "数据已更新", idle: "等待首次扫描", emptyTitle: "暂无用量记录", emptyBody: "本面板只读取 PI-Desktop 本地会话中的 assistant meta.usage。运行一次对话后，再次执行打开命令。", errorTitle: "无法读取仪表盘", errorBody: "面板无法读取插件私有设置。", requests: "请求数", tokens: "总 Token", input: "输入", output: "输出", cost: "API 等价估算", estimate: (coverage) => `官方精确价格覆盖 ${coverage}%`, trend: "用量趋势", trendSub: (days) => `本地日历日 · 最近 ${days} 天`, trendTokens: "Token", trendRequests: "请求", trendCost: "费用", providers: "提供商", providersSub: (count) => `${count} 个渠道 · 按 provider id 独立统计`, models: "模型", modelsSub: (count) => `历史中 ${count} 个精确模型 id`, provider: "提供商", model: "模型", requestsShort: "请求", tokensShort: "Token", modelsShort: "模型数", costShort: "估算", quotaShort: "额度", providerUnknown: "尚无记录", current: "已启用", noCost: "不可用", provenance: "数据来源与限制", usageSource: "用量来源", costSource: "费用来源", quotaSource: "额度 / 重置", localUsage: "PI-Desktop assistant meta.usage · 仅本地", priceEstimate: "版本化官方 API 价格快照 · 仅为估算", quotaHidden: "隐藏：当前公开宿主 API 未向插件提供安全的额度、余额或重置数据。", refreshed: (date) => `${date} 更新`, coverage: (value) => `覆盖 ${Math.round(value * 100)}%`, unknown: "未知", date: (value) => new Date(value + "T12:00:00").toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
    }
  };
  Object.assign(strings.en, { cache: "Cache read / write", reasoning: "Reasoning", refreshFailed: "Refresh failed", partial: (count) => `Up to date · ${count} damaged lines skipped` });
  Object.assign(strings.zh, { cache: "缓存读取 / 写入", reasoning: "推理", refreshFailed: "刷新失败", partial: (count) => `数据已更新 · 已跳过 ${count} 条损坏记录` });

  const state = {
    locale: "en", appearance: null, snapshot: null, scan: null, range: 30, trend: "tokens", preferences: { theme: "auto", locale: "auto" }, status: "loading", menu: false, timer: null, lastKey: ""
  };

  function $(id) { return document.getElementById(id); }
  function text(id, value) { const node = $(id); if (node) node.textContent = value == null ? "" : String(value); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function safeNumber(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
  function fmt(value) { return Math.round(safeNumber(value)).toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US"); }
  function fmtCost(value) { return safeNumber(value).toLocaleString(state.locale === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }); }
  function t(key, ...args) { const value = strings[state.locale][key]; return typeof value === "function" ? value(...args) : value; }
  function readPreferences() { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); return value && typeof value === "object" ? { theme: value.theme || "auto", locale: value.locale || "auto" } : { theme: "auto", locale: "auto" }; } catch (_) { return { theme: "auto", locale: "auto" }; } }
  function savePreferences() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.preferences)); } catch (_) {} }
  function hostLocale() { return String(state.appearance?.locale || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en"; }
  function resolvedLocale() { return state.preferences.locale === "auto" ? hostLocale() : state.preferences.locale === "zh" ? "zh" : "en"; }
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
    const pluginCss = state.preferences.theme === "auto" ? state.appearance?.pluginTheme?.css : null;
    let style = $("pluginThemeCss");
    if (pluginCss) {
      if (!style) { style = document.createElement("style"); style.id = "pluginThemeCss"; document.head.appendChild(style); }
      style.textContent = pluginCss.slice(0, 262144);
    } else if (style) style.remove();
    try { localStorage.setItem(boot.cacheKey || "modelUsageDashboard.appearance.v1", JSON.stringify({ base, locale: state.locale })); } catch (_) {}
    if (boot.themeTrail) boot.themeTrail.push(base);
  }
  function setSelected(selector, value, dataName) { document.querySelectorAll(selector).forEach((node) => { const selected = node.dataset[dataName] === String(value); node.classList.toggle("selected", selected); node.setAttribute("aria-pressed", String(selected)); }); }
  function settingsKey(settings) { return JSON.stringify([settings?.dashboardSnapshot?.generatedAt || 0, settings?.scanState?.status || "", settings?.scanState?.finishedAt || 0, settings?.hostAppearance?.base || "", settings?.hostAppearance?.locale || ""]); }

  async function readSettings(force) {
    if (!bridge || typeof bridge.invoke !== "function") { state.status = "error"; render(); return; }
    try {
      const settings = await bridge.invoke("plugin.getSettings");
      const key = settingsKey(settings);
      state.appearance = settings?.hostAppearance || state.appearance;
      state.scan = settings?.scanState || null;
      state.snapshot = settings?.dashboardSnapshot || null;
      state.status = "ok";
      applyAppearance();
      if (force || key !== state.lastKey) { state.lastKey = key; render(); }
    } catch (_) {
      state.status = "error";
      render();
    }
  }

  function renderStatic() {
    text("appTitle", t("title"));
    text("themeLabel", t("theme")); text("languageLabel", t("language"));
    text("themeAuto", t("followApp")); text("themeLight", t("light")); text("themeDark", t("dark")); text("localeAuto", t("followApp"));
    text("reloadButton", "↻");
    $("reloadButton").setAttribute("aria-label", t("reload")); $("appearanceButton").setAttribute("aria-label", t("appearance"));
    text("range7", t("range7")); text("range30", t("range30")); text("range90", t("range90"));
    text("requestsLabel", t("requests")); text("tokensLabel", t("tokens")); text("inputLabel", t("input")); text("outputLabel", t("output")); text("cacheLabel", t("cache")); text("reasoningLabel", t("reasoning")); text("costLabel", t("cost"));
    text("trendTitle", t("trend")); text("trendTokens", t("trendTokens")); text("trendRequests", t("trendRequests")); text("trendCost", t("trendCost"));
    text("providersTitle", t("providers")); text("modelsTitle", t("models"));
    text("providerNameHead", t("provider")); text("providerRequestsHead", t("requestsShort")); text("providerTokensHead", t("tokensShort")); text("providerModelsHead", t("modelsShort")); text("providerCostHead", t("costShort")); text("providerQuotaHead", t("quotaShort"));
    text("modelNameHead", t("model")); text("modelProviderHead", t("provider")); text("modelRequestsHead", t("requestsShort")); text("modelTokensHead", t("tokensShort")); text("modelCostHead", t("costShort"));
    text("provenanceSummary", t("provenance"));
    setSelected("[data-range]", state.range, "range"); setSelected("[data-trend]", state.trend, "trend");
    setSelected("[data-theme-choice]", state.preferences.theme, "themeChoice"); setSelected("[data-locale-choice]", state.preferences.locale, "localeChoice");
  }

  function renderToolbar() {
    setSelected("[data-range]", state.range, "range");
    const scan = state.scan || {};
    const damaged = Math.max(safeNumber(scan.malformedLines), safeNumber(scan.truncatedLines)) + safeNumber(scan.filesSkipped);
    if (scan.status === "scanning") text("toolbarStatus", t("scanning", scan.filesScanned || 0, scan.filesTotal || 0));
    else if (scan.status === "failed") text("toolbarStatus", scan.stale ? t("failed") : t("refreshFailed"));
    else if (scan.stale) text("toolbarStatus", t("stale"));
    else if (scan.status === "ready" && damaged) text("toolbarStatus", t("partial", damaged));
    else if (scan.status === "ready") text("toolbarStatus", t("ready"));
    else text("toolbarStatus", t("idle"));
    const progress = $("scanProgress");
    const total = safeNumber(scan.filesTotal); const done = Math.min(total, safeNumber(scan.filesScanned));
    const percent = total ? Math.round((done / total) * 100) : 0;
    progress.hidden = scan.status !== "scanning"; progress.setAttribute("aria-valuenow", String(percent)); $("scanProgressFill").style.width = `${percent}%`;
    const costButton = $("trendCost");
    const selectedCost = state.snapshot?.trends?.[String(state.range)]?.cost;
    const costAvailable = Boolean(state.snapshot?.capabilities?.cost && selectedCost);
    costButton.disabled = !costAvailable; costButton.setAttribute("aria-disabled", String(!costAvailable));
    costButton.title = costAvailable ? t("cost") : t("noCost");
  }

  function renderState() {
    const snapshot = state.snapshot;
    const showState = state.status === "error" || !snapshot || !snapshot.hasData;
    $("state").hidden = !showState;
    $("dashboard").hidden = showState;
    if (!showState) return;
    if (state.status === "error") { text("stateTitle", t("errorTitle")); text("stateBody", t("errorBody")); return; }
    text("stateTitle", t("emptyTitle")); text("stateBody", t("emptyBody"));
  }

  function renderMetrics() {
    const totals = state.snapshot?.trends?.[String(state.range)]?.totals || state.snapshot?.totals || {};
    text("requestsValue", fmt(totals.requests)); text("tokensValue", fmt(totals.tokens)); text("inputValue", fmt(totals.input)); text("outputValue", fmt(totals.output)); text("cacheValue", `${fmt(totals.cacheRead)} / ${fmt(totals.cacheWrite)}`); text("reasoningValue", fmt(totals.reasoning));
    text("requestsNote", state.snapshot?.provenance?.usage?.sourceType || t("localUsage"));
    text("tokensNote", state.snapshot?.capabilities?.tokens ? t("localUsage") : t("noCost"));
    const fields = totals.tokenCapabilities || {};
    $("inputCard").hidden = fields.input === false; $("outputCard").hidden = fields.output === false;
    $("cacheCard").hidden = !fields.cacheRead && !fields.cacheWrite; $("reasoningCard").hidden = !fields.reasoning;
    text("inputNote", totals.input ? `${Math.round((totals.input / Math.max(1, totals.tokens)) * 100)}%` : "");
    text("outputNote", totals.output ? `${Math.round((totals.output / Math.max(1, totals.tokens)) * 100)}%` : "");
    text("cacheNote", fields.cacheRead || fields.cacheWrite ? t("localUsage") : ""); text("reasoningNote", fields.reasoning ? t("localUsage") : "");
    // Only the selected window's cost may be rendered: falling back to the
    // 30-day overview would print one window's amount next to another window's
    // request and token totals.
    const cost = state.snapshot?.trends?.[String(state.range)]?.cost || null;
    const showCost = Boolean(state.snapshot?.capabilities?.cost && cost);
    $("costCard").hidden = !showCost;
    if (showCost) { text("costValue", fmtCost(cost.amount)); text("costNote", t("estimate", Math.round((cost.coverage || 0) * 100))); }
  }

  function svgElement(name, attrs) { const node = document.createElementNS(SVG_NS, name); Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value))); return node; }
  function renderChart() {
    const chart = $("trendChart"); clear(chart);
    const trend = state.snapshot?.trends?.[String(state.range)]; const rows = trend?.days || [];
    // A cost trend is only real when this window actually priced tokens;
    // plotting it otherwise would draw a fabricated zero-cost line.
    if (state.trend === "cost" && !(state.snapshot?.capabilities?.cost && trend?.cost)) state.trend = "tokens";
    const metric = state.trend; const values = rows.map((row) => metric === "cost" ? safeNumber(row.cost) : safeNumber(row[metric]));
    const width = 900; const height = 220; const pad = { left: 8, right: 8, top: 18, bottom: 27 }; const max = Math.max(1, ...values); const step = rows.length > 1 ? (width - pad.left - pad.right) / (rows.length - 1) : width;
    for (let i = 0; i < 4; i += 1) { const y = pad.top + ((height - pad.top - pad.bottom) * i) / 3; chart.appendChild(svgElement("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: "chart-grid" })); }
    if (!rows.length) return;
    const points = values.map((value, index) => `${pad.left + index * step},${height - pad.bottom - (value / max) * (height - pad.top - pad.bottom)}`);
    chart.appendChild(svgElement("path", { d: `M ${pad.left},${height - pad.bottom} L ${points.join(" L ")} L ${width - pad.right},${height - pad.bottom} Z`, class: "chart-area" }));
    chart.appendChild(svgElement("polyline", { points: points.join(" "), class: "chart-line" }));
    if (rows.length <= 31) points.forEach((point, index) => { const [cx, cy] = point.split(","); const dot = svgElement("circle", { cx, cy, r: 3.2, class: "chart-dot" }); dot.setAttribute("aria-label", `${rows[index].date}: ${metric === "cost" ? fmtCost(values[index]) : fmt(values[index])}`); chart.appendChild(dot); });
    const labelIndices = rows.length > 1 ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1] : [0];
    for (const index of labelIndices) { const label = svgElement("text", { x: pad.left + index * step, y: height - 6, class: "chart-label", "text-anchor": index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle" }); label.textContent = t("date", rows[index].date); chart.appendChild(label); }
    const tableBody = $("trendTable").querySelector("tbody"); clear(tableBody); rows.forEach((row) => { const tr = document.createElement("tr"); [row.date, fmt(row.requests), fmt(row.tokens), row.cost == null ? t("noCost") : fmtCost(row.cost)].forEach((value) => { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); }); tableBody.appendChild(tr); });
    text("trendTableCaption", `${t("trend")} ${t("trendSub", state.range)}`); text("trendSubtitle", t("trendSub", state.range));
    setSelected("[data-trend]", state.trend, "trend");
  }

  function td(value, className) { const node = document.createElement("td"); node.textContent = value; if (className) node.className = className; return node; }
  function renderProviders() {
    const body = $("providersBody"); clear(body); const providers = state.snapshot?.trends?.[String(state.range)]?.providers || state.snapshot?.providers || []; const hasCost = Boolean(state.snapshot?.capabilities?.cost);
    document.querySelectorAll(".cost-column").forEach((node) => { node.hidden = !hasCost; });
    document.querySelectorAll(".quota-column").forEach((node) => { node.hidden = true; });
    text("providersSubtitle", t("providersSub", providers.length));
    providers.forEach((provider) => { const row = document.createElement("tr"); const name = document.createElement("td"); const primary = document.createElement("span"); primary.className = "cell-primary"; primary.textContent = provider.label || provider.id; name.appendChild(primary); const secondary = document.createElement("span"); secondary.className = "cell-secondary"; secondary.textContent = provider.requests ? provider.id : t("providerUnknown"); name.appendChild(secondary); row.appendChild(name); row.appendChild(td(fmt(provider.requests), "numeric")); row.appendChild(td(fmt(provider.tokens), "numeric")); row.appendChild(td(fmt(provider.modelCount || provider.models?.length || 0), "numeric")); if (hasCost) row.appendChild(td(provider.cost == null ? t("noCost") : `${fmtCost(provider.cost)} · ${Math.round((provider.costCoverage || 0) * 100)}%`, "numeric")); body.appendChild(row); });
  }
  function renderModels() {
    const body = $("modelsBody"); clear(body); const models = state.snapshot?.trends?.[String(state.range)]?.models || state.snapshot?.models || []; const hasCost = Boolean(state.snapshot?.capabilities?.cost); text("modelsSubtitle", t("modelsSub", models.length));
    models.forEach((model) => { const row = document.createElement("tr"); const name = td(model.label || model.id); name.className = "cell-primary"; row.appendChild(name); row.appendChild(td(model.providerId || t("unknown"))); row.appendChild(td(fmt(model.requests), "numeric")); row.appendChild(td(fmt(model.tokens), "numeric")); if (hasCost) row.appendChild(td(model.cost == null ? t("noCost") : `${fmtCost(model.cost)} · ${Math.round((model.costCoverage || 0) * 100)}%`, "numeric")); body.appendChild(row); });
  }
  function renderProvenance() {
    const grid = $("provenanceGrid"); clear(grid); const entries = [[t("usageSource"), t("localUsage")], [t("costSource"), t("priceEstimate")], [t("quotaSource"), t("quotaHidden")]];
    entries.forEach(([heading, body]) => { const item = document.createElement("div"); item.className = "provenance-item"; const strong = document.createElement("strong"); strong.textContent = heading; item.appendChild(strong); item.appendChild(document.createTextNode(body)); grid.appendChild(item); });
  }
  function render() {
    applyAppearance(); renderStatic(); renderToolbar(); renderState();
    if (state.snapshot?.hasData) { renderMetrics(); renderChart(); renderProviders(); renderModels(); renderProvenance(); }
    document.documentElement.dataset.booting = "false";
    const menu = $("appearanceMenu"); menu.hidden = !state.menu; $("appearanceButton").setAttribute("aria-expanded", String(state.menu));
    text("appearanceNote", state.preferences.theme === "auto" && state.preferences.locale === "auto" ? t("following") : t("following"));
  }

  function updatePreference(key, value) { state.preferences[key] = value; savePreferences(); state.menu = false; render(); }
  function bind() {
    $("reloadButton").addEventListener("click", () => void readSettings(true));
    $("appearanceButton").addEventListener("click", (event) => { event.stopPropagation(); state.menu = !state.menu; render(); });
    document.querySelectorAll("[data-theme-choice]").forEach((node) => node.addEventListener("click", () => updatePreference("theme", node.dataset.themeChoice)));
    document.querySelectorAll("[data-locale-choice]").forEach((node) => node.addEventListener("click", () => updatePreference("locale", node.dataset.localeChoice)));
    document.querySelectorAll("[data-range]").forEach((node) => node.addEventListener("click", () => { state.range = Number(node.dataset.range); render(); }));
    document.querySelectorAll("[data-trend]").forEach((node) => node.addEventListener("click", () => { if (!node.disabled) { state.trend = node.dataset.trend; render(); } }));
    document.addEventListener("click", () => { if (state.menu) { state.menu = false; render(); } });
    $("appearanceMenu").addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.menu) { state.menu = false; render(); } });
    document.addEventListener("visibilitychange", restartPolling); window.addEventListener("focus", () => void readSettings(false));
  }
  function restartPolling() { if (state.timer) clearInterval(state.timer); state.timer = setInterval(() => void readSettings(false), document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS); }
  async function init() { state.preferences = readPreferences(); state.appearance = boot.cached; applyAppearance(); render(); bind(); await readSettings(true); restartPolling(); }
  window.__modelUsageDashboard = { state, readSettings, render, applyAppearance, setRange(value) { state.range = Number(value) || 30; render(); } };
  void init();
})();
