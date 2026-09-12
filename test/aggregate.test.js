"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const aggregate = require("../lib/aggregate");
const { localDayKey } = aggregate;

function fact(id, timestamp, providerId, modelId, tokens) {
  return { id, timestamp, providerId, modelId, requestCount: 1, tokens };
}

test("aggregate creates 7/30/90 local-calendar buckets and keeps providers separate", () => {
  const now = new Date(2026, 1, 10, 12, 0, 0).getTime();
  const facts = [
    fact("a", new Date(2026, 1, 10, 9).getTime(), "openai", "gpt-4o", { input: 100, output: 50, total: 150 }),
    fact("b", new Date(2026, 1, 9, 9).getTime(), "relay", "gpt-4o", { input: 100, output: 50, total: 150 }),
  ];
  const result = aggregate.aggregate(facts, { now, catalog: { providers: [{ id: "anthropic", label: "Anthropic", models: [] }] } });
  assert.equal(result.trends["7"].days.length, 7);
  assert.equal(result.trends["30"].days.length, 30);
  assert.equal(result.trends["90"].days.length, 90);
  assert.equal(result.trends["7"].totals.requests, 2);
  assert.equal(result.providers.some((entry) => entry.id === "openai"), true);
  assert.equal(result.providers.some((entry) => entry.id === "relay"), true);
  assert.equal(result.providers.some((entry) => entry.id === "anthropic" && entry.requests === 0), true);
  assert.equal(result.providers.find((entry) => entry.id === "relay").cost, null);
  assert.equal(result.trends["7"].days.some((entry) => entry.date === localDayKey(now) && entry.tokens === 150), true);
});

test("provider and model breakdowns follow the selected window and provider trends stay isolated", () => {
  const now = new Date(2026, 1, 10, 12).getTime();
  const result = aggregate.aggregate([
    fact("recent", now, "openai", "gpt-4o", { input: 10, output: 5, total: 15 }),
    fact("older", now - 10 * 86_400_000, "relay", "custom", { input: 20, total: 20 }),
  ], { now });
  assert.equal(result.trends["7"].providers.find((item) => item.id === "relay"), undefined);
  assert.equal(result.trends["30"].providers.find((item) => item.id === "relay").requests, 1);
  assert.equal(result.trends["7"].models.length, 1);
  const openai = result.trends["30"].providers.find((item) => item.id === "openai");
  assert.equal(openai.trend.reduce((sum, day) => sum + day.requests, 0), 1);
});

test("aggregate hides quota/reset and exposes estimate coverage", () => {
  const now = new Date(2026, 1, 10, 12).getTime();
  const result = aggregate.aggregate([fact("a", now, "openai", "gpt-4o", { input: 1_000_000, total: 2_000_000 })], { now });
  assert.equal(result.capabilities.quota, false);
  assert.equal(result.capabilities.reset, false);
  assert.equal(result.cost.coverage, 0.5);
  assert.equal(result.cost.estimated, true);
});

test("aggregate merges verified quota-only channels without inventing unsupported windows", () => {
  const now = new Date(2026, 1, 10, 12).getTime();
  const result = aggregate.aggregate([], {
    now,
    quotaChannels: [{
      id: "openai-codex",
      label: "OpenAI Codex",
      accountLabel: "Account 1",
      plan: "plus",
      quotaWindows: [
        { label: "5h", usedPercent: 25, remainingPercent: 75, resetAt: now + 60_000 },
        { label: "Weekly", usedPercent: 60, remainingPercent: 40 },
      ],
      provenance: { quota: { available: true, sourceType: "provider-subscription-api" } },
    }],
  });
  const codex = result.providers.find((entry) => entry.id === "openai-codex");
  assert.equal(codex.requests, 0);
  assert.equal(codex.plan, "plus");
  assert.equal(codex.quotaWindows.length, 2);
  assert.equal(codex.quotaWindows[0].remainingPercent, 75);
  assert.equal(result.capabilities.quota, true);
  assert.equal(result.capabilities.reset, true);

  const unsupported = aggregate.aggregate([], { now, quotaChannels: [{ id: "relay", label: "Relay", quotaWindows: [] }] });
  const relay = unsupported.providers.find((entry) => entry.id === "relay");
  assert.equal(relay.quotaAvailable, false);
  assert.deepEqual(relay.quotaWindows, []);
  assert.equal(unsupported.capabilities.quota, false);
});

test("a later empty duplicate cannot erase an earlier verified quota channel", () => {
  const result = aggregate.aggregate([], {
    quotaChannels: [
      { id: "codex", label: "Codex", accountLabel: "Local label", plan: "plus", quotaWindows: [{ label: "5h", remainingPercent: 80 }] },
      { id: "codex", label: "Codex", quotaWindows: [], provenance: { quota: { available: false, reason: "temporary failure" } } },
    ],
  });
  const channel = result.providers.find((entry) => entry.id === "codex");
  assert.equal(channel.quotaAvailable, true);
  assert.equal(channel.quotaWindows[0].remainingPercent, 80);
  assert.equal(channel.accountLabel, "Local label");
  assert.equal(channel.plan, "plus");
  assert.equal(channel.provenance.quota.available, true);
});
