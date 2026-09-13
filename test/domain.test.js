"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const domain = require("../lib/domain");

test("normalizeUsage keeps only safe scalar token fields", () => {
  assert.deepEqual(domain.normalizeUsage({ input_tokens: 4, outputTokens: 6, nested: { prompt: "secret" } }), {
    input: 4,
    output: 6,
    total: 10,
    totalDerived: true,
  });
  assert.equal(domain.normalizeUsage({ input: -1 }), null);
  assert.equal(domain.normalizeUsage({ output: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(domain.normalizeUsage({ input: "not-a-number" }), null);
});

test("normalizeFact rejects missing usage and timestamps", () => {
  assert.equal(domain.normalizeFact({ id: "x", timestamp: Date.now() }), null);
  const fact = domain.normalizeFact({ id: "x", createdAt: "2026-01-01T00:00:00Z", providerId: "openai", modelId: "gpt-4o", usage: { input: 2, output: 1 } });
  assert.equal(fact.requestCount, 1);
  assert.equal(fact.tokens.total, 3);
  assert.equal(fact.providerId, "openai");
});

test("quota remains absent when no real adapter value exists", () => {
  assert.equal(domain.quotaWindow({}), null);
  assert.deepEqual(domain.capabilities({ requests: true, tokens: true }), { requests: true, tokens: true, cost: false, quota: false, reset: false, history: false });
});

test("quota windows keep only verified percentages and reset values", () => {
  assert.deepEqual(domain.quotaWindow({ label: "5h", usedPercent: 40, remainingPercent: 60, resetAt: 1_770_768_000 }), {
    label: "5h",
    usedPercent: 40,
    remainingPercent: 60,
    resetAt: 1_770_768_000_000,
  });
  assert.equal(domain.quotaWindow({ label: "Weekly", usedPercent: 101 }), null);
  const channel = domain.channelSnapshot({
    id: "codex",
    quotaWindows: [{ label: "5h", remainingPercent: 55 }],
  });
  assert.equal(channel.quotaAvailable, true);
  assert.equal(channel.capabilities.quota, true);
  assert.equal(channel.capabilities.reset, false);
});

test("channel snapshots reject zero reset times and whitelist provenance", () => {
  const channel = domain.channelSnapshot({
    id: "codex",
    quotaWindows: [{ label: "5h", usedPercent: 20, resetAt: 0 }],
    provenance: {
      quota: {
        available: true,
        sourceType: "provider-subscription-api",
        endpoint: "https://chatgpt.com/backend-api/wham/usage?token=PRIVATE",
        rawResponse: { token: "PRIVATE" },
        accessToken: "PRIVATE",
      },
      rawResponse: "PRIVATE",
    },
  });
  assert.equal(Object.hasOwn(channel.quotaWindows[0], "resetAt"), false);
  assert.deepEqual(channel.provenance, {
    quota: {
      available: true,
      sourceType: "provider-subscription-api",
      endpoint: "https://chatgpt.com/backend-api/wham/usage",
    },
  });
  assert.equal(JSON.stringify(channel).includes("PRIVATE"), false);
});

test("credit usage is normalized without raw provider data", () => {
  const channel = domain.channelSnapshot({
    id: "codex",
    creditUsage: {
      total: 100,
      used: 40,
      remaining: 60,
      remainingPercent: 60,
      resetAt: 1_770_768_000,
      rawResponse: { accessToken: "PRIVATE" },
    },
  });
  assert.deepEqual(channel.creditUsage, {
    total: 100,
    used: 40,
    remaining: 60,
    remainingPercent: 60,
    resetAt: 1_770_768_000_000,
    unlimited: false,
  });
  assert.equal(JSON.stringify(channel).includes("PRIVATE"), false);
});
