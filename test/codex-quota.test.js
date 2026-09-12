"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCodexUsage, parseRateLimitWindow } = require("../lib/adapters/codex-quota");

test("parses real Codex primary and secondary quota windows", () => {
  const collectedAt = Date.parse("2026-02-10T12:00:00Z");
  const result = parseCodexUsage({
    plan_type: "plus",
    rate_limit: {
      primary_window: {
        used_percent: 38,
        limit_window_seconds: 18_000,
        reset_after_seconds: 900,
      },
      secondary_window: {
        used_percent: 72,
        limit_window_seconds: 604_800,
        reset_at: 1_770_768_000,
      },
    },
  }, { collectedAt });

  assert.equal(result.plan, "plus");
  assert.equal(result.quotaAvailable, true);
  assert.deepEqual(result.quotaWindows[0], {
    label: "5h",
    usedPercent: 38,
    remainingPercent: 62,
    resetAt: collectedAt + 900_000,
    resetAfterSeconds: 900,
    windowSeconds: 18_000,
  });
  assert.equal(result.quotaWindows[1].label, "Weekly");
  assert.equal(result.quotaWindows[1].usedPercent, 72);
  assert.equal(result.quotaWindows[1].remainingPercent, 28);
  assert.equal(result.quotaWindows[1].resetAt, 1_770_768_000_000);
  assert.equal(result.provenance.quota.available, true);
});

test("missing or invalid Codex windows never become fabricated 100% quotas", () => {
  const missing = parseCodexUsage({ plan_type: "plus", rate_limit: {} });
  assert.equal(missing.quotaAvailable, false);
  assert.deepEqual(missing.quotaWindows, []);
  assert.equal(missing.provenance.quota.available, false);

  assert.equal(parseRateLimitWindow({ used_percent: 101 }, { label: "5h", collectedAt: Date.now() }), null);
  assert.equal(parseRateLimitWindow({ reset_after_seconds: 60 }, { label: "5h", collectedAt: Date.now() }), null);
});

test("a network or credential error body yields no quota data", () => {
  const result = parseCodexUsage({ detail: { code: "unauthorized" } });
  assert.equal(result.quotaAvailable, false);
  assert.deepEqual(result.quotaWindows, []);
});

test("boolean and duration-less fields cannot fabricate quota values or labels", () => {
  const booleanPercent = parseCodexUsage({
    rate_limit: { primary_window: { used_percent: false, limit_window_seconds: 18_000 } },
  });
  assert.deepEqual(booleanPercent.quotaWindows, []);

  const missingDuration = parseCodexUsage({
    rate_limit: { primary_window: { used_percent: 0 } },
  });
  assert.deepEqual(missingDuration.quotaWindows, []);

  const booleanDuration = parseCodexUsage({
    rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: true } },
  });
  assert.deepEqual(booleanDuration.quotaWindows, []);

  const booleanReset = parseCodexUsage({
    rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18_000, reset_after_seconds: false } },
  });
  assert.equal(booleanReset.quotaWindows.length, 1);
  assert.equal(Object.hasOwn(booleanReset.quotaWindows[0], "resetAt"), false);
  assert.equal(Object.hasOwn(booleanReset.quotaWindows[0], "resetAfterSeconds"), false);
});
