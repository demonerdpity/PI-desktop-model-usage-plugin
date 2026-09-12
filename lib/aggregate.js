(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./domain"), require("./pricing"));
  else root.ModelUsageAggregate = factory(null, null);
})(typeof globalThis !== "undefined" ? globalThis : this, function (domain, pricing) {
  "use strict";

  const TOKEN_FIELDS = domain?.TOKEN_FIELDS || ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"];
  const WINDOWS = [7, 30, 90];
  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const integer = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  };
  const tokensOf = (fact) => fact?.tokens || {};
  const safeAdd = (left, right) => Math.min(Number.MAX_SAFE_INTEGER, number(left) + number(right));
  const tokenTotal = (tokens) => {
    if (Number.isSafeInteger(Number(tokens?.total)) && Number(tokens.total) >= 0) return Number(tokens.total);
    return TOKEN_FIELDS.filter((field) => field !== "total").reduce((sum, field) => safeAdd(sum, integer(tokens?.[field])), 0);
  };
  const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 });
  const emptyMetric = () => ({ requests: 0, tokens: emptyTokens(), observedFields: Object.fromEntries(TOKEN_FIELDS.map((field) => [field, 0])), observedTokens: 0, pricedTokens: 0, cost: 0 });

  function addMetric(target, fact, costEstimate) {
    target.requests = safeAdd(target.requests, integer(fact?.requestCount) || 1);
    const tokens = tokensOf(fact);
    for (const field of TOKEN_FIELDS) {
      target.tokens[field] = safeAdd(target.tokens[field], integer(tokens[field]));
      if (Object.prototype.hasOwnProperty.call(tokens, field)) target.observedFields[field] = safeAdd(target.observedFields[field], 1);
    }
    target.observedTokens = safeAdd(target.observedTokens, tokenTotal(tokens));
    if (costEstimate) {
      target.cost = safeAdd(target.cost, number(costEstimate.amount));
      target.pricedTokens = safeAdd(target.pricedTokens, number(costEstimate.pricedTokens));
    }
  }

  function mergeMetric(left, right) {
    const out = emptyMetric();
    out.requests = safeAdd(left.requests, right.requests);
    out.observedTokens = safeAdd(left.observedTokens, right.observedTokens);
    out.pricedTokens = safeAdd(left.pricedTokens, right.pricedTokens);
    out.cost = safeAdd(left.cost, right.cost);
    for (const field of TOKEN_FIELDS) out.tokens[field] = safeAdd(left.tokens[field], right.tokens[field]);
    for (const field of TOKEN_FIELDS) out.observedFields[field] = safeAdd(left.observedFields?.[field], right.observedFields?.[field]);
    return out;
  }

  function localDayKey(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dateFromKey(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }

  function shiftDay(key, amount) {
    const date = dateFromKey(key);
    date.setDate(date.getDate() + amount);
    return localDayKey(date.getTime());
  }

  function daysForWindow(size, now = Date.now()) {
    const today = localDayKey(now);
    if (!today) return [];
    const days = [];
    for (let offset = size - 1; offset >= 0; offset -= 1) days.push(shiftDay(today, -offset));
    return days;
  }

  function asCatalog(catalog = {}) {
    return {
      providers: Array.isArray(catalog.providers) ? catalog.providers : [],
      providerLabels: catalog.providerLabels || {},
      modelLabels: catalog.modelLabels || {},
    };
  }

  function estimate(providerId, modelId, tokens) {
    if (!pricing?.estimateUsageCost) return null;
    return pricing.estimateUsageCost(providerId, modelId, tokens);
  }

  function metricPayload(metric) {
    const coverage = metric.observedTokens ? metric.pricedTokens / metric.observedTokens : 0;
    return {
      requests: metric.requests,
      tokens: metric.tokens.total,
      input: metric.tokens.input,
      output: metric.tokens.output,
      cacheRead: metric.tokens.cacheRead,
      cacheWrite: metric.tokens.cacheWrite,
      reasoning: metric.tokens.reasoning,
      cost: metric.pricedTokens > 0 ? metric.cost : null,
      costCoverage: coverage,
      pricedTokens: metric.pricedTokens,
      observedTokens: metric.observedTokens,
      tokenCapabilities: Object.fromEntries(TOKEN_FIELDS.map((field) => [field, Boolean(metric.observedFields?.[field])])),
    };
  }

  function costPayload(metric, sources) {
    if (!metric.pricedTokens) return null;
    return {
      amount: metric.cost,
      currency: "USD",
      estimated: true,
      coverage: metric.observedTokens ? metric.pricedTokens / metric.observedTokens : 0,
      sourceType: "official-pricing-estimate",
      sources: [...sources.values()],
    };
  }

  function buildBreakdowns(facts, catalog, days) {
    const daySet = new Set(days);
    const providers = new Map();
    const models = new Map();
    const providerDays = new Map();
    const ensureProvider = (id, label) => {
      const key = String(id || "unknown");
      if (!providers.has(key)) providers.set(key, { id: key, label: label || catalog.providerLabels[key] || key, metric: emptyMetric(), models: new Set(), lastActivityAt: null, current: false });
      return providers.get(key);
    };
    for (const item of catalog.providers) {
      const provider = ensureProvider(item.id, item.label);
      provider.current = Boolean(item.current);
      for (const model of item.models || []) provider.models.add(String(model.id || model.modelId || ""));
    }
    for (const fact of facts) {
      const day = localDayKey(Number(fact?.timestamp));
      if (!daySet.has(day)) continue;
      const providerId = String(fact.providerId || "unknown");
      const modelId = String(fact.modelId || "unknown");
      const cost = estimate(providerId, modelId, fact.tokens);
      const provider = ensureProvider(providerId);
      provider.models.add(modelId);
      addMetric(provider.metric, fact, cost);
      provider.lastActivityAt = Math.max(provider.lastActivityAt || 0, Number(fact.timestamp));
      if (!providerDays.has(providerId)) providerDays.set(providerId, new Map());
      const daily = providerDays.get(providerId);
      const dailyMetric = daily.get(day) || emptyMetric();
      addMetric(dailyMetric, fact, cost);
      daily.set(day, dailyMetric);
      const modelKey = `${providerId}\u0000${modelId}`;
      if (!models.has(modelKey)) models.set(modelKey, { providerId, modelId, label: catalog.modelLabels[modelKey] || modelId, metric: emptyMetric(), lastActivityAt: null });
      const model = models.get(modelKey);
      addMetric(model.metric, fact, cost);
      model.lastActivityAt = Math.max(model.lastActivityAt || 0, Number(fact.timestamp));
    }
    const providerList = [...providers.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)).map((entry) => {
      const metric = metricPayload(entry.metric);
      const daily = providerDays.get(entry.id) || new Map();
      return {
        id: entry.id, label: entry.label, current: entry.current,
        requests: metric.requests, tokens: metric.tokens, cost: metric.cost,
        costCoverage: metric.costCoverage, models: [...entry.models].filter(Boolean).sort(),
        modelCount: entry.models.size, lastActivityAt: entry.lastActivityAt,
        trend: days.map((date) => ({ date, ...metricPayload(daily.get(date) || emptyMetric()) })),
        quota: null, resetAt: null,
        capabilities: { requests: metric.requests > 0, tokens: metric.tokens > 0, cost: metric.cost !== null, quota: false, reset: false, history: metric.requests > 0 },
        provenance: {
          usage: { sourceType: "pi-desktop-local-session-usage", estimated: false },
          cost: metric.cost === null ? null : { sourceType: "official-pricing-estimate", estimated: true, coverage: metric.costCoverage },
          quota: { available: false, reason: "The current host does not provide a safe quota API to plugins." },
        },
      };
    });
    const modelList = [...models.values()].sort((a, b) => b.metric.tokens.total - a.metric.tokens.total || a.modelId.localeCompare(b.modelId)).map((entry) => {
      const metric = metricPayload(entry.metric);
      return { providerId: entry.providerId, id: entry.modelId, label: entry.label, requests: metric.requests, tokens: metric.tokens, cost: metric.cost, costCoverage: metric.costCoverage, lastActivityAt: entry.lastActivityAt };
    });
    return { providers: providerList, models: modelList };
  }

  /**
   * Build one bounded wire snapshot from de-identified facts. The default
   * overview is the 30-day window; all 7/30/90 windows are retained as local
   * calendar buckets, including empty days.
   */
  function aggregate(factsInput, options = {}) {
    const facts = Array.isArray(factsInput) ? factsInput : [];
    const now = options.now == null ? Date.now() : options.now;
    const catalog = asCatalog(options.catalog);
    const sourceMeta = new Map();
    const allTime = emptyMetric();
    const byProvider = new Map();
    const byModel = new Map();
    const factDays = new Map();
    const maxDay = localDayKey(now);

    const ensureProvider = (id, label) => {
      const key = String(id || "unknown");
      if (!byProvider.has(key)) byProvider.set(key, { id: key, label: label || catalog.providerLabels[key] || key, metric: emptyMetric(), models: new Set(), lastActivityAt: null });
      return byProvider.get(key);
    };
    const ensureModel = (providerId, modelId, label) => {
      const key = `${providerId}\u0000${modelId}`;
      if (!byModel.has(key)) byModel.set(key, { providerId, modelId, label: label || catalog.modelLabels[key] || modelId, metric: emptyMetric(), lastActivityAt: null });
      return byModel.get(key);
    };

    for (const fact of facts) {
      if (!fact || !Number.isFinite(Number(fact.timestamp))) continue;
      const providerId = String(fact.providerId || "unknown");
      const modelId = String(fact.modelId || "unknown");
      const day = localDayKey(Number(fact.timestamp));
      if (!day) continue;
      const estimateResult = estimate(providerId, modelId, fact.tokens);
      if (estimateResult?.source) sourceMeta.set(estimateResult.source.sourceUrl, estimateResult.source);
      addMetric(allTime, fact, estimateResult);
      const provider = ensureProvider(providerId);
      provider.models.add(modelId);
      addMetric(provider.metric, fact, estimateResult);
      provider.lastActivityAt = Math.max(provider.lastActivityAt || 0, Number(fact.timestamp));
      const model = ensureModel(providerId, modelId);
      addMetric(model.metric, fact, estimateResult);
      model.lastActivityAt = Math.max(model.lastActivityAt || 0, Number(fact.timestamp));
      const dayMetric = factDays.get(day) || emptyMetric();
      addMetric(dayMetric, fact, estimateResult);
      factDays.set(day, dayMetric);
    }

    const trends = {};
    for (const size of WINDOWS) {
      const days = daysForWindow(size, now);
      const windowMetric = emptyMetric();
      const rows = days.map((date) => {
        const metric = factDays.get(date) || emptyMetric();
        const merged = mergeMetric(emptyMetric(), metric);
        const row = { date, ...metricPayload(merged) };
        Object.assign(windowMetric, mergeMetric(windowMetric, metric));
        return row;
      });
      trends[String(size)] = {
        days: rows,
        totals: metricPayload(windowMetric),
        cost: costPayload(windowMetric, sourceMeta),
      };
      Object.assign(trends[String(size)], buildBreakdowns(facts, catalog, days));
    }

    const { providers, models } = buildBreakdowns(facts, catalog, daysForWindow(30, now));

    const overview = trends["30"].totals;
    const overviewCost = trends["30"].cost;
    const hasData = allTime.requests > 0;
    return {
      schemaVersion: 1,
      generatedAt: Number(options.generatedAt) || Date.now(),
      asOf: Number(options.asOf) || now,
      hasData,
      totals: overview,
      allTime: metricPayload(allTime),
      cost: overviewCost,
      trends,
      providers,
      models,
      capabilities: {
        requests: hasData,
        tokens: hasData,
        cost: Boolean(overviewCost),
        quota: false,
        reset: false,
        history: hasData,
      },
      provenance: {
        usage: {
          sourceType: "pi-desktop-local-session-usage",
          collectedAt: Number(options.generatedAt) || Date.now(),
          estimated: false,
          note: "Assistant meta.usage scalar fields from ~/.pi-desktop/sessions/*.jsonl; revisions excluded.",
        },
        cost: overviewCost
          ? { sourceType: "official-pricing-estimate", estimated: true, coverage: overviewCost.coverage, sources: overviewCost.sources }
          : { sourceType: "official-pricing-estimate", estimated: true, coverage: 0, reason: "No exact official model/price match with usable token components." },
        quota: { available: false, reason: "The current host does not provide quota, balance, or reset data to plugins." },
      },
      diagnostics: options.diagnostics || {},
      catalog: {
        providerCount: providers.length,
        modelCount: models.length,
        modelsListSupported: options.modelsListSupported !== false,
      },
    };
  }

  function isSnapshot(value) {
    return Boolean(value && value.schemaVersion === 1 && value.trends && Array.isArray(value.providers) && Array.isArray(value.models));
  }

  return {
    WINDOWS,
    addMetric,
    buildBreakdowns,
    aggregate,
    daysForWindow,
    dateFromKey,
    emptyMetric,
    emptyTokens,
    isSnapshot,
    localDayKey,
    mergeMetric,
    shiftDay,
    tokenTotal,
  };
});
