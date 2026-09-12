"use strict";

/**
 * Small, dependency-free domain vocabulary shared by the scanner, adapters and
 * aggregation layer. The module deliberately has no knowledge of transcript
 * objects: callers hand it already-selected scalar values only.
 */

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"];
const TOKEN_ALIASES = {
  input: ["input", "inputTokens", "input_tokens", "promptTokens", "prompt_tokens"],
  output: ["output", "outputTokens", "output_tokens", "completionTokens", "completion_tokens"],
  cacheRead: [
    "cacheRead",
    "cacheReadTokens",
    "cache_read",
    "cache_read_input_tokens",
    "cached_input_tokens",
  ],
  cacheWrite: [
    "cacheWrite",
    "cacheWriteTokens",
    "cache_write",
    "cache_write_input_tokens",
    "cache_creation_input_tokens",
  ],
  reasoning: ["reasoning", "reasoningTokens", "reasoning_tokens", "reasoning_output_tokens"],
  total: ["total", "totalTokens", "total_tokens"],
};
const MAX_ID_LENGTH = 256;
const MAX_PROVIDER_LENGTH = 160;
const MAX_MODEL_LENGTH = 240;

function finiteNonNegative(value, { integer = false } = {}) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  if (integer && (!Number.isSafeInteger(number) || !Number.isInteger(number))) return null;
  if (number > Number.MAX_SAFE_INTEGER) return null;
  return number;
}

function scalarText(value, maxLength = MAX_ID_LENGTH, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return text.slice(0, maxLength) || fallback;
}

function firstOwn(object, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(object, name)) return object[name];
  }
  return undefined;
}

/**
 * Normalize usage without carrying through any unknown/nested values. Missing
 * fields remain absent; total is derived only when at least one component is
 * present, and the marker lets provenance distinguish that from an explicit
 * provider total.
 */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const result = {};
  let present = 0;
  for (const field of TOKEN_FIELDS) {
    const raw = firstOwn(usage, TOKEN_ALIASES[field]);
    if (raw === undefined || raw === null || raw === "") continue;
    const value = finiteNonNegative(raw, { integer: true });
    if (value === null) return null;
    result[field] = value;
    present += 1;
  }
  if (!present) return null;
  if (!Object.prototype.hasOwnProperty.call(result, "total")) {
    const components = TOKEN_FIELDS.filter((field) => field !== "total");
    const known = components.some((field) => Object.hasOwn(result, field));
    if (known) {
      result.total = components.reduce((sum, field) => {
        const next = sum + (result[field] ?? 0);
        return Math.min(Number.MAX_SAFE_INTEGER, next);
      }, 0);
      if (!Number.isSafeInteger(result.total)) return null;
      result.totalDerived = true;
    }
  } else {
    result.totalDerived = false;
  }
  return result;
}

function tokenTotal(tokens) {
  if (!tokens || typeof tokens !== "object") return 0;
  const explicit = finiteNonNegative(tokens.total, { integer: true });
  if (explicit !== undefined && explicit !== null) return explicit;
  return TOKEN_FIELDS.filter((field) => field !== "total").reduce(
    (sum, field) => Math.min(Number.MAX_SAFE_INTEGER, sum + (finiteNonNegative(tokens[field], { integer: true }) ?? 0)),
    0,
  );
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
}

function addTokens(left, right) {
  const result = emptyTokens();
  for (const field of TOKEN_FIELDS) {
    result[field] = Math.min(
      Number.MAX_SAFE_INTEGER,
      (finiteNonNegative(left?.[field], { integer: true }) ?? 0) +
        (finiteNonNegative(right?.[field], { integer: true }) ?? 0),
    );
  }
  return result;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) value = value.getTime();
  if (typeof value === "string") {
    const numeric = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    const parsed = Number.isNaN(numeric) ? Date.parse(value) : numeric;
    value = Number.isNaN(parsed) ? NaN : parsed;
  }
  if (typeof value === "number" && value > 0 && value < 100_000_000_000) value *= 1000;
  const result = finiteNonNegative(value, { integer: false });
  if (result === undefined || result === null || result < 0 || result > 8640000000000000) return null;
  return result;
}

function normalizeFact(input) {
  if (!input || typeof input !== "object") return null;
  const timestamp = normalizeTimestamp(input.timestamp ?? input.createdAt);
  const usage = normalizeUsage(input.tokens ?? input.usage);
  const id = scalarText(input.id, MAX_ID_LENGTH);
  if (!id || timestamp === null || !usage) return null;
  return {
    id,
    timestamp,
    providerId: scalarText(input.providerId, MAX_PROVIDER_LENGTH, "unknown"),
    modelId: scalarText(input.modelId, MAX_MODEL_LENGTH, "unknown"),
    tokens: usage,
    requestCount: 1,
    sourceFileId: scalarText(input.sourceFileId, MAX_ID_LENGTH, "unknown"),
  };
}

function metricProvenance({
  sourceType = "local-provider-report",
  collectedAt = Date.now(),
  estimated = false,
  coverage = 1,
  note = "",
} = {}) {
  return {
    sourceType: scalarText(sourceType, 80, "unknown"),
    collectedAt: normalizeTimestamp(collectedAt) ?? Date.now(),
    estimated: Boolean(estimated),
    coverage: Math.max(0, Math.min(1, Number.isFinite(Number(coverage)) ? Number(coverage) : 0)),
    note: scalarText(note, 320),
  };
}

function quotaWindow(input) {
  if (!input || typeof input !== "object") return null;
  const used = finiteNonNegative(input.used);
  const limit = finiteNonNegative(input.limit);
  const remaining = finiteNonNegative(input.remaining);
  const resetAt = input.resetAt == null ? null : normalizeTimestamp(input.resetAt);
  if (used === undefined && limit === undefined && remaining === undefined && resetAt === null) return null;
  return {
    ...(used !== undefined && used !== null ? { used } : {}),
    ...(limit !== undefined && limit !== null ? { limit } : {}),
    ...(remaining !== undefined && remaining !== null ? { remaining } : {}),
    ...(resetAt !== null ? { resetAt } : {}),
  };
}

function capabilities(overrides = {}) {
  return {
    requests: Boolean(overrides.requests),
    tokens: Boolean(overrides.tokens),
    cost: Boolean(overrides.cost),
    quota: Boolean(overrides.quota),
    reset: Boolean(overrides.reset),
    history: Boolean(overrides.history),
  };
}

function channelSnapshot(input = {}) {
  return {
    id: scalarText(input.id, MAX_PROVIDER_LENGTH, "unknown"),
    label: scalarText(input.label, MAX_PROVIDER_LENGTH, scalarText(input.id, MAX_PROVIDER_LENGTH, "unknown")),
    requests: finiteNonNegative(input.requests, { integer: true }) ?? 0,
    tokens: finiteNonNegative(input.tokens, { integer: true }) ?? 0,
    models: Array.isArray(input.models) ? input.models.map((value) => scalarText(value, MAX_MODEL_LENGTH)).filter(Boolean) : [],
    cost: input.cost == null ? null : finiteNonNegative(input.cost),
    costCoverage: Math.max(0, Math.min(1, Number(input.costCoverage) || 0)),
    lastActivityAt: normalizeTimestamp(input.lastActivityAt),
    trend: Array.isArray(input.trend) ? input.trend : [],
    quota: quotaWindow(input.quota),
    capabilities: capabilities(input.capabilities),
    provenance: input.provenance || {},
  };
}

module.exports = {
  MAX_ID_LENGTH,
  TOKEN_FIELDS,
  TOKEN_ALIASES,
  addTokens,
  capabilities,
  channelSnapshot,
  emptyTokens,
  finiteNonNegative,
  metricProvenance,
  normalizeFact,
  normalizeTimestamp,
  normalizeUsage,
  quotaWindow,
  scalarText,
  tokenTotal,
};
