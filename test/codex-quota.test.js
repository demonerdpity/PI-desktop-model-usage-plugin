"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  alignQuotaChannelId,
  codexChannelFromResult,
  parseCodexUsage,
  parseRateLimitWindow,
  planDisplayName,
  windowLabel,
} = require("../lib/adapters/codex-quota");
const { channelSnapshot } = require("../lib/domain");

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

  assert.equal(result.plan, "Plus");
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

test("parses Cockpit-compatible monthly credit totals without retaining raw data", () => {
  const collectedAt = Date.parse("2026-02-10T12:00:00Z");
  const result = parseCodexUsage({
    spend_control: {
      individual_limit: {
        limit: 100,
        used: 37.5,
        reset_after_seconds: 3600,
      },
    },
  }, { collectedAt });
  assert.deepEqual(result.creditUsage, {
    total: 100,
    used: 37.5,
    remaining: 62.5,
    remainingPercent: 62.5,
    resetAt: collectedAt + 3_600_000,
    resetAfterSeconds: 3600,
    unlimited: false,
  });
  assert.equal(Object.hasOwn(result, "raw_data"), false);
});

test("parses legacy credits balance and rejects boolean numeric values", () => {
  const legacy = parseCodexUsage({ credits: { unlimited: false, balance: "42.5" } });
  assert.deepEqual(legacy.creditUsage, { unlimited: false, balance: "42.5", remaining: 42.5 });
  const invalid = parseCodexUsage({ credits: { unlimited: false, balance: false, remaining: true } });
  assert.equal(invalid.creditUsage, null);
});
describe("Codex quota parser extensions", () => {
  it("parses realistic primary and weekly windows with deterministic resets", () => {
    const collectedAt = Date.parse("2026-02-10T12:00:00Z");
    const primary = parseRateLimitWindow({
      used_percent: 99,
      limit_window_seconds: 18_000,
      reset_after_seconds: 12_443,
      reset_at: 1_789_218_810,
    }, { collectedAt });
    assert.deepEqual(primary, {
      label: "5h",
      usedPercent: 99,
      remainingPercent: 1,
      resetAt: 1_789_218_810_000,
      resetAfterSeconds: 12_443,
      windowSeconds: 18_000,
    });

    const secondary = parseRateLimitWindow({
      used_percent: 16,
      limit_window_seconds: 604_800,
      reset_after_seconds: 599_243,
    }, { collectedAt });
    assert.equal(secondary.label, "Weekly");
    assert.equal(secondary.usedPercent, 16);
    assert.equal(secondary.remainingPercent, 84);
    assert.equal(secondary.windowSeconds, 604_800);
    assert.equal(secondary.resetAt, collectedAt + 599_243_000);

    assert.equal(parseRateLimitWindow({ used_percent: 20, limit_window_seconds: 0 }), null);
    assert.equal(parseRateLimitWindow({ used_percent: 20, limit_window_seconds: -1 }), null);
    assert.equal(parseRateLimitWindow({ used_percent: -1, limit_window_seconds: 60 }), null);
    assert.equal(parseRateLimitWindow({ used_percent: 101, limit_window_seconds: 60 }), null);
    assert.equal(parseRateLimitWindow({ limit_window_seconds: 60 }), null);
    assert.equal(parseRateLimitWindow(null), null);
    assert.equal(parseRateLimitWindow([]), null);
  });

  it("normalizes a full provider response and drops an inactive zero credit block", () => {
    const collectedAt = Date.parse("2026-02-10T12:00:00Z");
    const result = parseCodexUsage({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 99,
          limit_window_seconds: 18_000,
          reset_after_seconds: 12_443,
          reset_at: 1_789_218_810,
        },
        secondary_window: {
          used_percent: 16,
          limit_window_seconds: 604_800,
          reset_after_seconds: 599_243,
        },
      },
      credits: { has_credits: false, unlimited: false, balance: "0" },
      rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
    }, { collectedAt });

    assert.equal(result.id, "openai-codex");
    assert.equal(result.label, "OpenAI Codex");
    assert.equal(result.plan, "Plus");
    assert.equal(result.quotaAvailable, true);
    assert.equal(result.quotaWindows.length, 2);
    assert.equal(result.creditUsage, null);
    assert.deepEqual(result.resetCredits, { availableCount: 1, applicableCount: 0 });
    assert.equal(result.provenance.quota.available, true);
    assert.equal(result.provenance.quota.sourceType, "provider-subscription-api");
    assert.equal(result.provenance.quota.endpoint, "https://chatgpt.com/backend-api/wham/usage");
  });

  it("prefers spend-control credit values and preserves active legacy balances", () => {
    const credits = parseCodexUsage({ credits: { has_credits: true, balance: "12.5" } });
    assert.equal(credits.creditUsage.balance, "12.5");

    const spendControl = parseCodexUsage({
      credits: { has_credits: true, balance: "9" },
      spend_control: { individual_limit: { limit: 200, used: 50 } },
    });
    assert.deepEqual(spendControl.creditUsage, {
      total: 200,
      used: 50,
      remaining: 150,
      remainingPercent: 75,
      unlimited: false,
    });
  });

  it("keeps missing rate-limit windows unavailable", () => {
    for (const payload of [{ plan_type: "plus" }, { plan_type: "plus", rate_limit: {} }]) {
      const result = parseCodexUsage(payload, { collectedAt: Date.parse("2026-02-10T12:00:00Z") });
      assert.equal(result.quotaAvailable, false);
      assert.deepEqual(result.quotaWindows, []);
      assert.equal(result.provenance.quota.reason, "provider-response-without-window");
    }
  });

  it("builds honest channels from successful and failed quota requests", () => {
    const collectedAt = Date.parse("2026-02-10T12:00:00Z");
    const parsed = codexChannelFromResult({
      ok: true,
      payload: { plan_type: "pro", rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 3600 } } },
    }, { collectedAt });
    assert.equal(parsed.plan, "Pro");

    const hinted = codexChannelFromResult({
      ok: true,
      payload: { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 3600 } } },
    }, { collectedAt, planHint: "prolite" });
    assert.equal(hinted.plan, "Pro Lite");

    const unauthorized = codexChannelFromResult({ ok: false, reason: "provider-unauthorized" }, {
      collectedAt,
      planHint: "team",
    });
    assert.equal(unauthorized.quotaAvailable, false);
    assert.deepEqual(unauthorized.quotaWindows, []);
    assert.equal(unauthorized.provenance.quota.reason, "provider-unauthorized");
    assert.equal(unauthorized.plan, "Team");

    const unavailable = codexChannelFromResult({ ok: false }, { collectedAt, planHint: "free" });
    assert.equal(unavailable.provenance.quota.reason, "provider-unavailable");
    assert.equal(unavailable.plan, "Free");
  });

  it("maps known and unknown plan display names", () => {
    const expected = {
      plus: "Plus",
      pro: "Pro",
      prolite: "Pro Lite",
      team: "Team",
      business: "Business",
      enterprise: "Enterprise",
      edu: "Edu",
      free: "Free",
    };
    for (const [input, output] of Object.entries(expected)) assert.equal(planDisplayName(input), output);
    assert.equal(planDisplayName("newtier"), "Newtier");
    assert.equal(planDisplayName(""), "");
    assert.equal(planDisplayName(null), "");
  });

  it("labels quota windows by their duration", () => {
    const labels = {
      18_000: "5h",
      604_800: "Weekly",
      86_400: "1d",
      3_600: "1h",
      120: "2m",
      45: "45s",
    };
    for (const [seconds, label] of Object.entries(labels)) assert.equal(windowLabel(Number(seconds)), label);
  });

  it("aligns Codex quota ids without losing unmatched channels", () => {
    const codexChannel = { id: "openai-codex", label: "Fixture" };
    const localChannel = { id: "local-channel", label: "Fixture" };
    assert.strictEqual(alignQuotaChannelId(codexChannel, []), codexChannel);
    assert.strictEqual(alignQuotaChannelId(codexChannel, ["openai-codex"]), codexChannel);

    const exact = alignQuotaChannelId(localChannel, ["openai-codex"]);
    assert.equal(exact.id, "openai-codex");

    const longest = alignQuotaChannelId(localChannel, ["openai", "openai-codex"]);
    assert.equal(longest.id, "openai-codex");
    assert.equal(alignQuotaChannelId(codexChannel, [], "account-uuid").id, "account-uuid");
    assert.equal(alignQuotaChannelId(localChannel, ["anthropic"]).id, "local-channel");
    assert.equal(alignQuotaChannelId(localChannel, [null, 42, {}]).id, "local-channel");
    assert.equal(alignQuotaChannelId(null, ["openai"]), null);
  });

  it("keeps subscription quota provenance through channelSnapshot", () => {
    const source = codexChannelFromResult({ ok: false, reason: "credential-file-missing" }, {
      collectedAt: Date.parse("2026-02-10T12:00:00Z"),
    });
    const snapshot = channelSnapshot({ ...source, subscriptionQuota: true });
    assert.equal(snapshot.subscriptionQuota, true);
    assert.equal(snapshot.provenance.quota.reason, "credential-file-missing");
  });
});
