"use strict";

const { normalizeTimestamp, scalarText } = require("../domain");

/**
 * Normalizes the provider's own subscription usage response into the channel
 * card contract. Transport and credentials deliberately live in sibling
 * modules so this file stays a pure, fixture-testable parser.
 *
 * A missing window is never converted into 100% remaining: absence must stay
 * visibly unavailable instead of looking like an untouched quota.
 */

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_CHANNEL_ID = "openai-codex";
const CODEX_CHANNEL_LABEL = "OpenAI Codex";

/**
 * Local provider ids the quota card may attach to. PI-Desktop reports the
 * transport that served a request, which is not necessarily the subscription
 * that granted it, so the quota card is merged onto a matching local card when
 * one exists instead of creating a duplicate channel.
 */
const CODEX_PROVIDER_ALIASES = Object.freeze(["openai-codex", "codex", "chatgpt", "openai"]);

const PLAN_DISPLAY_NAMES = Object.freeze({
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  prolite: "Pro Lite",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
  edu: "Edu",
});

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

function integer(value) {
  const number = nonNegative(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function windowLabel(seconds) {
  if (seconds === 7 * 24 * 60 * 60) return "Weekly";
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function planDisplayName(value) {
  const raw = scalarText(value, 40).toLowerCase();
  if (!raw) return "";
  if (PLAN_DISPLAY_NAMES[raw]) return PLAN_DISPLAY_NAMES[raw];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function resetInstant({ explicitResetAt, resetAfterSeconds, collectedAt }) {
  const collectedAtMs = normalizeTimestamp(collectedAt);
  const explicit = normalizeTimestamp(explicitResetAt);
  if (explicit !== null) return explicit;
  if (resetAfterSeconds === null || collectedAtMs === null) return null;
  return normalizeTimestamp(collectedAtMs + resetAfterSeconds * 1000);
}

/** Parse one window from the provider's usage response. */
function parseRateLimitWindow(input, { collectedAt = Date.now() } = {}) {
  const window = plainObject(input);
  if (!window) return null;
  const usedPercent = percent(window.used_percent);
  const windowSeconds = nonNegative(window.limit_window_seconds);
  if (usedPercent === null || windowSeconds === null || windowSeconds <= 0) return null;
  const resetAfterSeconds = nonNegative(window.reset_after_seconds);
  const resetAt = resetInstant({
    explicitResetAt: window.reset_at,
    resetAfterSeconds,
    collectedAt,
  });
  return {
    label: windowLabel(windowSeconds),
    usedPercent,
    remainingPercent: 100 - usedPercent,
    ...(resetAt === null ? {} : { resetAt }),
    ...(resetAfterSeconds === null ? {} : { resetAfterSeconds }),
    windowSeconds,
  };
}

function parseSpendControl(body, { collectedAt = Date.now() } = {}) {
  const individual = plainObject(plainObject(body?.spend_control)?.individual_limit);
  if (!individual) return null;
  const total = nonNegative(individual.limit);
  const used = nonNegative(individual.used);
  const explicitRemaining = nonNegative(individual.remaining);
  const remaining = explicitRemaining ?? (total !== null && used !== null ? Math.max(0, total - used) : null);
  const explicitPercent = percent(individual.remaining_percent);
  const remainingPercent = explicitPercent ?? (
    total !== null && total > 0 && remaining !== null ? Math.max(0, Math.min(100, (remaining / total) * 100)) : null
  );
  if (total === null && used === null && remaining === null && remainingPercent === null) return null;
  const resetAfterSeconds = nonNegative(individual.reset_after_seconds);
  const resetAt = resetInstant({
    explicitResetAt: individual.reset_at,
    resetAfterSeconds,
    collectedAt,
  });
  return {
    ...(total === null ? {} : { total }),
    ...(used === null ? {} : { used }),
    ...(remaining === null ? {} : { remaining }),
    ...(remainingPercent === null ? {} : { remainingPercent }),
    ...(resetAt === null ? {} : { resetAt }),
    ...(resetAfterSeconds === null ? {} : { resetAfterSeconds }),
    unlimited: false,
  };
}

function parseCredits(body) {
  const credits = plainObject(body?.credits);
  if (!credits) return null;
  const unlimited = typeof credits.unlimited === "boolean" ? credits.unlimited : false;
  const balance = scalarText(credits.balance, 80);
  const remaining = nonNegative(credits.remaining ?? credits.balance);
  if (!unlimited && !balance && remaining === null) return null;
  // `has_credits: false` with nothing left on the meter means the plan has no
  // credit programme at all. Reporting a "0 balance" row there would be noise,
  // so the whole block is omitted instead.
  const declaresCredits = typeof credits.has_credits === "boolean" ? credits.has_credits : null;
  if (declaresCredits === false && !unlimited && !(remaining > 0)) return null;
  return {
    unlimited,
    ...(balance ? { balance } : {}),
    ...(remaining === null ? {} : { remaining }),
  };
}

function parseMonthlyCreditUsage(payload, options = {}) {
  const body = plainObject(payload);
  return parseSpendControl(body, options) || parseCredits(body);
}

/** Manual "rate limit reset" passes the provider grants the account. Display only. */
function parseResetCredits(payload) {
  const body = plainObject(payload);
  const record = plainObject(body?.rate_limit_reset_credits);
  if (!record) return null;
  const available = integer(record.available_count);
  const applicable = integer(record.applicable_available_count);
  if (available === null && applicable === null) return null;
  return {
    ...(available === null ? {} : { availableCount: available }),
    ...(applicable === null ? {} : { applicableCount: applicable }),
  };
}

function parseCodexUsage(payload, { collectedAt = Date.now() } = {}) {
  const body = plainObject(payload);
  const rateLimit = plainObject(body?.rate_limit);
  const primary = parseRateLimitWindow(rateLimit?.primary_window, { collectedAt });
  const secondary = parseRateLimitWindow(rateLimit?.secondary_window, { collectedAt });
  const quotaWindows = [primary, secondary].filter(Boolean);
  const creditUsage = parseMonthlyCreditUsage(body, { collectedAt });
  const resetCredits = parseResetCredits(body);
  return {
    id: CODEX_CHANNEL_ID,
    label: CODEX_CHANNEL_LABEL,
    plan: planDisplayName(body?.plan_type),
    quotaWindows,
    quotaAvailable: quotaWindows.length > 0,
    creditUsage,
    resetCredits,
    provenance: {
      quota: quotaWindows.length
        ? { available: true, sourceType: "provider-subscription-api", endpoint: CODEX_USAGE_ENDPOINT, collectedAt }
        : {
            available: false,
            reason: "provider-response-without-window",
            note: "The provider answered without a usable quota window for this account.",
            sourceType: "provider-subscription-api",
            endpoint: CODEX_USAGE_ENDPOINT,
            collectedAt,
          },
    },
  };
}

/**
 * Builds the card for the signed-in Codex subscription, including the honest
 * "unavailable" card that explains why no window could be shown.
 */
function codexChannelFromResult(result, { collectedAt = Date.now(), planHint = "" } = {}) {
  if (result?.ok) {
    const channel = parseCodexUsage(result.payload, { collectedAt });
    if (channel.quotaAvailable) return { ...channel, plan: channel.plan || planDisplayName(planHint) };
    if (channel.plan) return channel;
    return { ...channel, plan: planDisplayName(planHint) };
  }
  return {
    id: CODEX_CHANNEL_ID,
    label: CODEX_CHANNEL_LABEL,
    plan: planDisplayName(planHint),
    quotaWindows: [],
    quotaAvailable: false,
    creditUsage: null,
    resetCredits: null,
    provenance: {
      quota: {
        available: false,
        reason: scalarText(result?.reason, 80, "provider-unavailable"),
        sourceType: "provider-subscription-api",
        endpoint: CODEX_USAGE_ENDPOINT,
        collectedAt,
      },
    },
  };
}

/**
 * Chooses the local card the subscription quota belongs to. When PI-Desktop
 * already reports a matching provider, the quota is merged into it so the user
 * sees one card per account instead of a duplicate.
 */
function alignQuotaChannelId(channel, providerIds = []) {
  if (!channel) return channel;
  const known = providerIds.map((value) => scalarText(value, 160)).filter(Boolean);
  if (!known.length) return channel;
  const currentId = scalarText(channel.id, 160);
  const candidates = [...new Set([CODEX_CHANNEL_ID, ...CODEX_PROVIDER_ALIASES].map((value) => value.toLowerCase()))]
    // Longest alias first so `openai-codex` wins over `openai`.
    .sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    const match = known.find((value) => value.toLowerCase() === candidate);
    if (!match) continue;
    // An already-correct id keeps the same object so callers can pass it through.
    return match === currentId ? channel : { ...channel, id: match };
  }
  return channel;
}

module.exports = {
  CODEX_CHANNEL_ID,
  CODEX_CHANNEL_LABEL,
  CODEX_PROVIDER_ALIASES,
  CODEX_USAGE_ENDPOINT,
  alignQuotaChannelId,
  codexChannelFromResult,
  parseCodexUsage,
  parseMonthlyCreditUsage,
  parseRateLimitWindow,
  parseResetCredits,
  planDisplayName,
  windowLabel,
};
