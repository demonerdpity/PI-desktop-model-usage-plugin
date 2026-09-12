"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const pricing = require("../lib/pricing");

test("pricing requires exact provider/model aliases", () => {
  assert.ok(pricing.lookupPrice("openai", "gpt-4o"));
  assert.ok(pricing.lookupPrice("anthropic", "claude-3-5-sonnet-20241022"));
  assert.equal(pricing.lookupPrice("openai", "gpt-4o-custom"), null);
  assert.equal(pricing.lookupPrice("relay.example", "gpt-4o"), null);
});

test("estimate reports amount and coverage without inventing missing fields", () => {
  const full = pricing.estimateUsageCost("openai", "gpt-4o", { input: 1_000_000, output: 1_000_000, total: 2_000_000 });
  assert.equal(full.amount, 12.5);
  assert.equal(full.coverage, 1);
  const partial = pricing.estimateUsageCost("openai", "gpt-4o", { input: 1_000_000, total: 2_000_000 });
  assert.equal(partial.coverage, 0.5);
  assert.equal(pricing.estimateUsageCost("openai", "custom", { input: 4, total: 4 }), null);
});

test("dated GPT-4o aliases keep their historical official rate", () => {
  const older = pricing.estimateUsageCost("openai", "gpt-4o-2024-05-13", { input: 1_000_000, output: 1_000_000, total: 2_000_000 });
  const newer = pricing.estimateUsageCost("openai", "gpt-4o-2024-08-06", { input: 1_000_000, output: 1_000_000, total: 2_000_000 });
  assert.equal(older.amount, 20);
  assert.equal(newer.amount, 12.5);
  assert.ok(new Date(pricing.PRICE_SNAPSHOT.retrievedAt) >= new Date("2025-05-14"));
});
