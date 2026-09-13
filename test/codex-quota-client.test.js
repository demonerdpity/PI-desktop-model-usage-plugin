"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_RESPONSE_BYTES,
  buildUsageRequest,
  createHostFetch,
  isSuccessStatus,
  reasonForStatus,
  requestCodexUsage,
} = require("../lib/adapters/codex-quota-client");

const ACCESS_TOKEN = "fixture-access-token-for-client-tests";

function responseWithText(status, bodyText) {
  return { status, text: async () => bodyText };
}

async function requestWithResponse(response) {
  let calls = 0;
  const result = await requestCodexUsage({
    accessToken: ACCESS_TOKEN,
    fetchImpl: async () => {
      calls += 1;
      return response;
    },
  });
  assert.equal(calls, 1);
  return result;
}

function assertFailureWithoutToken(result, status, reason) {
  assert.deepEqual(result, { ok: false, status, reason });
  assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
}

describe("Codex quota client request construction", () => {
  it("rejects missing or blank tokens and puts a valid token only in Authorization", () => {
    for (const accessToken of [undefined, null, "", "   ", 42]) {
      assert.equal(buildUsageRequest({ accessToken }), null);
    }

    const request = buildUsageRequest({ accessToken: ACCESS_TOKEN, accountId: "fixture-account-id" });
    assert.equal(request.url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(request.method, "GET");
    assert.equal(request.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
    assert.equal(request.headers["ChatGPT-Account-Id"], "fixture-account-id");
    assert.equal(JSON.stringify(request).split(ACCESS_TOKEN).length - 1, 1);

    for (const accountId of [undefined, null, "", 42]) {
      const withoutAccount = buildUsageRequest({ accessToken: ACCESS_TOKEN, accountId });
      assert.equal(Object.hasOwn(withoutAccount.headers, "ChatGPT-Account-Id"), false);
    }
  });
});

describe("Codex quota requests", () => {
  it("reports missing runtime, timeout, egress, and generic network failures", async () => {
    const missingRuntime = await requestCodexUsage({ accessToken: ACCESS_TOKEN, fetchImpl: null });
    assertFailureWithoutToken(missingRuntime, null, "network-runtime-missing");

    const cases = [
      { error: Object.assign(new Error("timeout fixture"), { name: "AbortError" }), reason: "network-timeout" },
      { error: Object.assign(new Error("permission fixture"), { code: "PERMISSION_DENIED" }), reason: "egress-blocked" },
      { error: new Error("network fixture"), reason: "network-error" },
    ];
    for (const { error, reason } of cases) {
      let calls = 0;
      const result = await requestCodexUsage({
        accessToken: ACCESS_TOKEN,
        fetchImpl: async () => {
          calls += 1;
          throw error;
        },
      });
      assert.equal(calls, 1);
      assertFailureWithoutToken(result, null, reason);
    }
  });

  it("parses one valid JSON object and rejects malformed successful responses", async () => {
    const payload = { plan_type: "plus", marker: "fixture" };
    const success = await requestWithResponse(responseWithText(200, JSON.stringify(payload)));
    assert.deepEqual(success, { ok: true, status: 200, payload });

    const malformedResponses = [
      responseWithText(200, "not json"),
      responseWithText(200, JSON.stringify(["array"])),
      responseWithText(200, "null"),
      responseWithText(200, "x".repeat(MAX_RESPONSE_BYTES + 1)),
      { status: 200, text: async () => { throw new Error("body fixture"); } },
    ];
    for (const response of malformedResponses) {
      const result = await requestWithResponse(response);
      assertFailureWithoutToken(result, 200, "provider-response-malformed");
    }
  });

  it("maps provider statuses without retrying or exposing the token", async () => {
    const statuses = [
      [401, "provider-unauthorized"],
      [403, "provider-forbidden"],
      [429, "provider-rate-limited"],
      [500, "provider-http-500"],
      [503, "provider-http-503"],
    ];
    for (const [status, reason] of statuses) {
      const result = await requestWithResponse({ status, text: async () => "not read" });
      assertFailureWithoutToken(result, status, reason);
    }

    const nonNumeric = await requestWithResponse({ status: "not-a-status", text: async () => "{}" });
    assertFailureWithoutToken(nonNumeric, null, "provider-response-malformed");
  });
});

describe("Codex host fetch adapter", () => {
  it("returns null when the host does not expose a callable fetch", () => {
    assert.equal(createHostFetch(null), null);
    assert.equal(createHostFetch({}), null);
    assert.equal(createHostFetch({ fetch: 1 }), null);
  });

  it("maps the request to the host and adapts status and body text", async () => {
    let received;
    const headers = { Authorization: `Bearer ${ACCESS_TOKEN}` };
    const hostFetch = createHostFetch({
      fetch: async (input) => {
        received = input;
        return { status: 200, bodyText: "{}" };
      },
    });

    const result = await hostFetch("https://fixture.example/usage", {
      method: "GET",
      headers,
      timeoutMs: 1234,
    });
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "{}");
    assert.deepEqual(received, {
      url: "https://fixture.example/usage",
      method: "GET",
      headers,
      timeoutMs: 1234,
    });

    const degraded = createHostFetch({ fetch: async () => ({}) });
    const degradedResult = await degraded("https://fixture.example/usage", {});
    assert.equal(degradedResult.status, 0);
    assert.equal(await degradedResult.text(), "");

    const nonStringBody = createHostFetch({ fetch: async () => ({ status: "bad", bodyText: 42 }) });
    const nonStringResult = await nonStringBody("https://fixture.example/usage", {});
    assert.equal(nonStringResult.status, 0);
    assert.equal(await nonStringResult.text(), "");
  });

  it("propagates host egress errors and lets requestCodexUsage classify them", async () => {
    let calls = 0;
    const hostFetch = createHostFetch({
      fetch: async () => {
        calls += 1;
        throw { code: "PERMISSION_DENIED" };
      },
    });

    await assert.rejects(hostFetch("https://fixture.example/usage", {}), (error) => error?.code === "PERMISSION_DENIED");
    assert.equal(calls, 1);

    calls = 0;
    const result = await requestCodexUsage({ accessToken: ACCESS_TOKEN, fetchImpl: hostFetch });
    assert.equal(calls, 1);
    assertFailureWithoutToken(result, null, "egress-blocked");
  });
});

describe("Codex quota status helpers", () => {
  it("recognizes only 2xx statuses as successful", () => {
    assert.equal(isSuccessStatus(199), false);
    assert.equal(isSuccessStatus(200), true);
    assert.equal(isSuccessStatus(299), true);
    assert.equal(isSuccessStatus(300), false);

    assert.equal(reasonForStatus(199), "provider-http-199");
    assert.equal(reasonForStatus(200), "provider-http-200");
    assert.equal(reasonForStatus(299), "provider-http-299");
    assert.equal(reasonForStatus(300), "provider-http-300");
  });
});
