"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const main = require("../main");

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mud-main-"));
  const sessions = path.join(root, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const record = { type: "message", id: "main-test", role: "assistant", createdAt: new Date().toISOString(), meta: { providerId: "openai", modelId: "gpt-4o", usage: { input: 2, output: 3, total: 5 } }, content: "PRIVATE" };
  fs.writeFileSync(path.join(sessions, "one.jsonl"), `${JSON.stringify(record)}\n`);
  return { root, sessions };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("timed out waiting for plugin refresh");
}

test("startup warms without opening; command opens before shared refresh", async () => {
  const { root, sessions } = makeRoot();
  const calls = [];
  let registered;
  const previousPi = globalThis.pi;
  globalThis.pi = {
    plugin: {
      getDataPath: async () => path.join(root, "plugins", "data", "pi.model-usage-dashboard"),
      setSettings: async (value) => calls.push(["settings", value]),
    },
    app: { getAppearance: async () => ({ base: "dark", locale: "en" }) },
    models: { list: async () => [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", label: "GPT-4o" }] },
    commands: { register: async (command) => { registered = command; }, unregister: async () => {} },
    ui: { openPanel: async () => calls.push(["open"]), showToast: async () => {} },
    events: { on: () => {}, off: () => {} },
  };
  try {
    main.__test.reset();
    main.__test.setSessionRoot(sessions);
    await main.onLoad();
    await waitFor(() => Boolean(main.__test.getState().currentSnapshot));
    const startupSnapshot = main.__test.getState().currentSnapshot;
    assert.equal(startupSnapshot.capabilities.quota, false);
    assert.equal(startupSnapshot.providers.every((provider) => provider.quotaAvailable === false && provider.quotaWindows.length === 0), true);
    assert.equal(calls.some((entry) => entry[0] === "open"), false);
    calls.length = 0;
    await registered.run();
    assert.equal(calls[0][0], "open");
    await new Promise((resolve) => setTimeout(resolve, 30));
    calls.length = 0;
    const first = main.__test.refreshFacts("test");
    const second = main.__test.refreshFacts("test-again");
    assert.strictEqual(first, second);
    await first;
    await main.onUnload();
    await main.onUnload();
  } finally {
    main.__test.reset();
    globalThis.pi = previousPi;
  }
});

/** Builds a structurally valid JWT so credential parsing can be exercised. */
function fakeJwt({ exp, plan = "plus", accountId = "acct-test" }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "RS256", typ: "JWT" }),
    encode({
      exp,
      "https://api.openai.com/auth": { chatgpt_account_id: accountId, chatgpt_plan_type: plan },
    }),
    "test-signature",
  ].join(".");
}

/** The provider's own usage body shape, with no real account data in it. */
const USAGE_BODY = {
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: 99, limit_window_seconds: 18000, reset_after_seconds: 12443 },
    secondary_window: { used_percent: 16, limit_window_seconds: 604800, reset_after_seconds: 599243 },
  },
  credits: { has_credits: false, unlimited: false, balance: "0" },
  rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
};

/**
 * Points credential discovery at a throwaway CODEX_HOME holding a synthetic
 * login, so no test ever reads the developer's real credentials.
 */
function writeSyntheticCredentials({ exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "mud-codex-"));
  const token = fakeJwt({ exp });
  fs.writeFileSync(
    path.join(codexHome, "auth.json"),
    JSON.stringify({ tokens: { access_token: token, account_id: "acct-test" }, last_refresh: new Date().toISOString() }),
  );
  return { codexHome, token };
}

function stubHost(overrides = {}) {
  return {
    plugin: { getDataPath: async () => null, setSettings: async () => {} },
    app: { getAppearance: async () => ({ base: "dark", locale: "en" }) },
    models: { list: async () => [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", label: "GPT-4o" }] },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {}, showToast: async () => {} },
    events: { on: () => {}, off: () => {} },
    ...overrides,
  };
}

/** Runs one quota resolution against an injected host transport. */
async function resolveQuotaWith({ codexHome, token, transport }) {
  const previousPi = globalThis.pi;
  const previousCodexHome = process.env.CODEX_HOME;
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  // Point the home directory at an empty sandbox so the "no Codex login" case
  // can never read the developer's real ~/.codex/auth.json.
  const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "mud-home-"));
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  if (codexHome) process.env.CODEX_HOME = codexHome;
  else delete process.env.CODEX_HOME;
  globalThis.pi = stubHost(transport ? { net: { fetch: transport } } : {});
  try {
    main.__test.reset();
    return { channels: await main.__test.resolveQuotaChannels(Date.now()), token };
  } finally {
    globalThis.pi = previousPi;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousUserProfile;
    main.__test.reset();
  }
}

test("subscription quota is fetched through pi.net.fetch and never reaches the snapshot", async () => {
  const { root, sessions } = makeRoot();
  const { codexHome, token } = writeSyntheticCredentials();
  const requests = [];
  const previousPi = globalThis.pi;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  globalThis.pi = {
    plugin: {
      getDataPath: async () => path.join(root, "plugins", "data", "pi.model-usage-dashboard"),
      setSettings: async () => {},
    },
    app: { getAppearance: async () => ({ base: "dark", locale: "en" }) },
    models: { list: async () => [{ providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", label: "GPT-4o" }] },
    commands: { register: async () => {}, unregister: async () => {} },
    ui: { openPanel: async () => {}, showToast: async () => {} },
    events: { on: () => {}, off: () => {} },
    net: {
      fetch: async (input) => {
        requests.push(input);
        return { status: 200, headers: {}, bodyText: JSON.stringify(USAGE_BODY) };
      },
    },
  };
  try {
    main.__test.reset();
    main.__test.setSessionRoot(sessions);
    await main.onLoad();
    await waitFor(() => Boolean(main.__test.getState().currentSnapshot));
    const snapshot = main.__test.getState().currentSnapshot;

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].headers.Authorization, `Bearer ${token}`);
    assert.equal(requests[0].headers["ChatGPT-Account-Id"], "acct-test");
    assert.equal(requests[0].body, undefined);

    assert.equal(snapshot.capabilities.quota, true);
    const channel = snapshot.providers.find((provider) => provider.id === "openai");
    assert.ok(channel, "the quota card must be merged onto the matching local provider");
    assert.equal(channel.subscriptionQuota, true);
    assert.equal(channel.quotaAvailable, true);
    assert.equal(channel.plan, "Plus");
    assert.deepEqual(channel.quotaWindows.map((window) => window.label), ["5h", "Weekly"]);
    assert.deepEqual(channel.quotaWindows.map((window) => window.usedPercent), [99, 16]);
    assert.equal(channel.quotaWindows[0].resetAfterSeconds, 12443);
    assert.equal(channel.creditUsage, null, "a zero balance on a plan without credits must stay hidden");
    assert.deepEqual(channel.resetCredits, { availableCount: 1, applicableCount: 0 });
    assert.equal(channel.provenance.quota.available, true);
    assert.equal(channel.provenance.quota.sourceType, "provider-subscription-api");

    // The access token is main-process-only: it must not appear anywhere in the
    // payload published to the panel and persisted to disk.
    assert.equal(JSON.stringify(snapshot).includes(token), false);

    // A second resolution inside the cache window must not re-ask the provider.
    const cached = await main.__test.resolveQuotaChannels(Date.now());
    assert.equal(requests.length, 1);
    assert.equal(cached.length, 1);
    await main.onUnload();
  } finally {
    main.__test.reset();
    globalThis.pi = previousPi;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("quota failures surface a reason code instead of invented percentages", async () => {
  const sentinel = /USAGE_BODY|token/;
  const { codexHome, token } = writeSyntheticCredentials();
  const cases = [
    { status: 401, reason: "provider-unauthorized" },
    { status: 403, reason: "provider-forbidden" },
    { status: 429, reason: "provider-rate-limited" },
    { status: 503, reason: "provider-http-503" },
  ];
  for (const entry of cases) {
    const { channels } = await resolveQuotaWith({
      codexHome,
      token,
      transport: async () => ({ status: entry.status, headers: {}, bodyText: "{}" }),
    });
    assert.equal(channels.length, 1);
    const [channel] = channels;
    assert.equal(channel.subscriptionQuota, true);
    assert.equal(channel.quotaAvailable, false);
    assert.deepEqual(channel.quotaWindows, []);
    assert.equal(channel.provenance.quota.reason, entry.reason);
    assert.equal(JSON.stringify(channel).includes(token), false);
    assert.equal(sentinel.test(JSON.stringify(channel)), false);
  }
});

test("quota transport problems are distinguishable and cost no network call", async () => {
  const { codexHome } = writeSyntheticCredentials();

  const noHostApi = await resolveQuotaWith({ codexHome, transport: null });
  assert.equal(noHostApi.channels[0].provenance.quota.reason, "network-runtime-missing");

  const offline = await resolveQuotaWith({
    codexHome,
    transport: async () => {
      throw Object.assign(new Error("offline"), { name: "AbortError" });
    },
  });
  assert.equal(offline.channels[0].provenance.quota.reason, "network-timeout");

  const blocked = await resolveQuotaWith({
    codexHome,
    transport: async () => {
      throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
    },
  });
  assert.equal(blocked.channels[0].provenance.quota.reason, "egress-blocked");

  const expired = writeSyntheticCredentials({ exp: Math.floor(Date.now() / 1000) - 60 });
  let calls = 0;
  const stale = await resolveQuotaWith({
    codexHome: expired.codexHome,
    transport: async () => {
      calls += 1;
      return { status: 200, headers: {}, bodyText: JSON.stringify(USAGE_BODY) };
    },
  });
  assert.equal(stale.channels[0].provenance.quota.reason, "credential-expired");
  assert.equal(calls, 0, "an expired token must never be sent");

  const signedOut = await resolveQuotaWith({ codexHome: null, transport: null });
  assert.deepEqual(signedOut.channels, [], "a machine with no Codex login gets no Codex card");
});
