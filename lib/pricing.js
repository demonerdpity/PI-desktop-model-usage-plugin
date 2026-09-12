"use strict";

const { TOKEN_FIELDS, tokenTotal } = require("./domain");

/**
 * Offline, versioned official API price snapshot. Values are USD per million
 * tokens. Aliases are exact model ids, not prefixes or fuzzy matches.
 */
const PRICE_SNAPSHOT = Object.freeze({
  version: "2025-06-01",
  retrievedAt: "2025-06-01T00:00:00.000Z",
  sourceUrl: "https://platform.openai.com/docs/pricing",
  sources: {
    openai: "https://platform.openai.com/docs/pricing",
    anthropic: "https://www.anthropic.com/pricing#api",
    google: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  entries: [
    { provider: "openai", aliases: ["gpt-4o-2024-05-13"], input: 5, output: 15 },
    { provider: "openai", aliases: ["gpt-4o", "gpt-4o-2024-08-06"], input: 2.5, output: 10, cacheRead: 1.25 },
    { provider: "openai", aliases: ["gpt-4o-mini", "gpt-4o-mini-2024-07-18"], input: 0.15, output: 0.6, cacheRead: 0.075 },
    { provider: "openai", aliases: ["gpt-4.1"], input: 2, output: 8, cacheRead: 0.5 },
    { provider: "openai", aliases: ["gpt-4.1-mini"], input: 0.4, output: 1.6, cacheRead: 0.1 },
    { provider: "openai", aliases: ["gpt-4.1-nano"], input: 0.1, output: 0.4, cacheRead: 0.025 },
    { provider: "openai", aliases: ["o3"], input: 10, output: 40, cacheRead: 2.5 },
    { provider: "openai", aliases: ["o4-mini"], input: 1.1, output: 4.4, cacheRead: 0.275 },
    { provider: "anthropic", aliases: ["claude-3-5-sonnet-20240620", "claude-3-5-sonnet-20241022"], input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    { provider: "anthropic", aliases: ["claude-3-7-sonnet-20250219"], input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    { provider: "anthropic", aliases: ["claude-sonnet-4-20250514"], input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    { provider: "anthropic", aliases: ["claude-opus-4-20250514"], input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    { provider: "anthropic", aliases: ["claude-3-5-haiku-20241022"], input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
    { provider: "google", aliases: ["gemini-1.5-pro", "gemini-1.5-pro-001", "gemini-1.5-pro-002"], input: 1.25, output: 5, cacheRead: 0.3125 },
    { provider: "google", aliases: ["gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-flash-002"], input: 0.075, output: 0.3, cacheRead: 0.01875 },
    { provider: "google", aliases: ["gemini-2.0-flash", "gemini-2.0-flash-001"], input: 0.1, output: 0.4, cacheRead: 0.025 },
    { provider: "google", aliases: ["gemini-2.5-pro-preview-03-25"], input: 1.25, output: 10, cacheRead: 0.3125 },
    { provider: "google", aliases: ["gemini-2.5-flash-preview-04-17"], input: 0.3, output: 2.5, cacheRead: 0.075 },
  ],
});

const PROVIDER_ALIASES = new Map([
  ["openai", "openai"],
  ["openai-api", "openai"],
  ["chatgpt", "openai"],
  ["anthropic", "anthropic"],
  ["claude", "anthropic"],
  ["google", "google"],
  ["gemini", "google"],
  ["google-generative-ai", "google"],
]);

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildIndex(snapshot = PRICE_SNAPSHOT) {
  const index = new Map();
  for (const entry of snapshot.entries || []) {
    const provider = normalizeKey(entry.provider);
    for (const model of entry.aliases || []) {
      index.set(`${provider}\u0000${normalizeKey(model)}`, {
        provider,
        model: String(model),
        input: entry.input,
        output: entry.output,
        cacheRead: entry.cacheRead,
        cacheWrite: entry.cacheWrite,
        reasoning: entry.reasoning,
        sourceUrl: snapshot.sources?.[provider] || snapshot.sourceUrl,
        retrievedAt: snapshot.retrievedAt,
        version: snapshot.version,
      });
    }
  }
  return index;
}

const PRICE_INDEX = buildIndex();

function lookupPrice(providerId, modelId, index = PRICE_INDEX) {
  const provider = PROVIDER_ALIASES.get(normalizeKey(providerId));
  if (!provider) return null;
  return index.get(`${provider}\u0000${normalizeKey(modelId)}`) || null;
}

function estimateUsageCost(providerId, modelId, usage, index = PRICE_INDEX) {
  const price = lookupPrice(providerId, modelId, index);
  if (!price || !usage || typeof usage !== "object") return null;
  let cost = 0;
  let pricedTokens = 0;
  for (const field of TOKEN_FIELDS) {
    if (field === "total") continue;
    const value = Number(usage[field]);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    const rate = price[field];
    if (typeof rate !== "number" || !Number.isFinite(rate)) continue;
    cost += (value / 1_000_000) * rate;
    pricedTokens += value;
  }
  const observedTokens = tokenTotal(usage);
  if (!pricedTokens || !observedTokens) return null;
  return {
    amount: cost,
    currency: "USD",
    pricedTokens,
    observedTokens,
    coverage: Math.max(0, Math.min(1, pricedTokens / observedTokens)),
    source: {
      type: "official-pricing-estimate",
      estimated: true,
      sourceUrl: price.sourceUrl,
      retrievedAt: price.retrievedAt,
      version: price.version,
    },
  };
}

function estimateFactsCost(facts, index = PRICE_INDEX) {
  let amount = 0;
  let pricedTokens = 0;
  let observedTokens = 0;
  let matchedRequests = 0;
  let observedRequests = 0;
  const sources = new Map();
  for (const fact of Array.isArray(facts) ? facts : []) {
    const observed = tokenTotal(fact?.tokens);
    observedTokens += observed;
    observedRequests += 1;
    const estimate = estimateUsageCost(fact?.providerId, fact?.modelId, fact?.tokens, index);
    if (!estimate) continue;
    amount += estimate.amount;
    pricedTokens += estimate.pricedTokens;
    matchedRequests += 1;
    sources.set(estimate.source.sourceUrl, estimate.source);
  }
  return {
    amount,
    currency: "USD",
    pricedTokens,
    observedTokens,
    coverage: observedTokens ? pricedTokens / observedTokens : 0,
    requestCoverage: observedRequests ? matchedRequests / observedRequests : 0,
    matchedRequests,
    observedRequests,
    sources: [...sources.values()],
    available: pricedTokens > 0,
    estimated: true,
  };
}

function formatUsd(value, locale = "en-US") {
  if (!Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(Number(value));
}

module.exports = {
  PRICE_SNAPSHOT,
  PROVIDER_ALIASES,
  buildIndex,
  estimateFactsCost,
  estimateUsageCost,
  formatUsd,
  lookupPrice,
};
