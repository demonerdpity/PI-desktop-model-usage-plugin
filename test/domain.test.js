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
