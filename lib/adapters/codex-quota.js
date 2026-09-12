"use strict";

const { normalizeTimestamp, scalarText } = require("../domain");

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function scalarNumber(value) {
  if (value === undefined || value === null || value === "" || typeof value === "boolean") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(value) {
  const number = scalarNumber(value);
  return number !== null && number >= 0 && number <= 100 ? number : null;
}

function nonNegative(value) {
  const number = scalarNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function windowLabel(seconds) {
  if (seconds === 7 * 24 * 60 * 60) return "Weekly";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/**
 * Parse one window from ChatGPT's usage response. Unlike Cockpit Tools, a
 * missing window is never converted to 100% remaining: absence must remain
 * visibly unavailable.
 */
function parseRateLimitWindow(input, { collectedAt = Date.now() } = {}) {
  const window = plainObject(input);
  if (!window) return null;
  const usedPercent = percent(window.used_percent);
  const windowSeconds = nonNegative(window.limit_window_seconds);
  if (usedPercent === null || windowSeconds === null || windowSeconds <= 0) return null;
  const resetAfterSeconds = nonNegative(window.reset_after_seconds);
  const explicitResetAt = normalizeTimestamp(window.reset_at);
  const collectedAtMs = normalizeTimestamp(collectedAt);
  const resetAt = explicitResetAt ?? (
    resetAfterSeconds === null || collectedAtMs === null ? null : normalizeTimestamp(collectedAtMs + resetAfterSeconds * 1000)
  );
  return {
    label: windowLabel(windowSeconds),
    usedPercent,
    remainingPercent: 100 - usedPercent,
    ...(resetAt === null ? {} : { resetAt }),
    ...(resetAfterSeconds === null ? {} : { resetAfterSeconds }),
    windowSeconds,
  };
}

/**
 * Normalize a successful `GET /backend-api/wham/usage` response into the card
 * contract. Authentication and network transport intentionally stay outside
 * this parser so credentials can remain in a future host-owned auth proxy.
 */
function parseCodexUsage(payload, { collectedAt = Date.now() } = {}) {
  const body = plainObject(payload);
  const rateLimit = plainObject(body?.rate_limit);
  const primary = parseRateLimitWindow(rateLimit?.primary_window, { collectedAt });
  const secondary = parseRateLimitWindow(rateLimit?.secondary_window, { collectedAt });
  const quotaWindows = [primary, secondary].filter(Boolean);
  return {
    id: "openai-codex",
    label: "OpenAI Codex",
    plan: scalarText(body?.plan_type, 80),
    quotaWindows,
    quotaAvailable: quotaWindows.length > 0,
    provenance: {
      quota: quotaWindows.length
        ? { available: true, sourceType: "provider-subscription-api", endpoint: CODEX_USAGE_ENDPOINT, collectedAt }
        : { available: false, reason: "The provider response did not include a usable quota window." },
    },
  };
}

module.exports = {
  CODEX_USAGE_ENDPOINT,
  parseCodexUsage,
  parseRateLimitWindow,
};
