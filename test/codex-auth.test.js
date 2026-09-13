"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  chatgptAccountIdFromToken,
  codexHomeDirectories,
  credentialFileCandidates,
  decodeJwtPayload,
  planHintFromToken,
  readCodexCredentials,
  tokenExpiresAt,
} = require("../lib/adapters/codex-auth");

const FIXTURE_HOME = "codex-home-fixture";
const SENTINEL_TOKEN = "sentinel-access-token-for-tests";

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeToken(payload, header = { alg: "none", typ: "JWT" }) {
  return `${encodeJson(header)}.${encodeJson(payload)}.signature`;
}

function documentWithToken(accessToken, extraTokens = {}) {
  return JSON.stringify({ tokens: { access_token: accessToken, ...extraTokens } });
}

describe("Codex authentication helpers", () => {
  it("honors CODEX_HOME first, ignores blanks, and deduplicates the default directory", () => {
    const defaultDirectories = codexHomeDirectories({ CODEX_HOME: "" });
    assert.equal(defaultDirectories.length, 1);
    assert.equal(path.basename(defaultDirectories[0]), ".codex");

    const configuredDirectories = codexHomeDirectories({ CODEX_HOME: `  ${FIXTURE_HOME}  ` });
    assert.equal(configuredDirectories[0], path.resolve(FIXTURE_HOME));
    assert.equal(configuredDirectories[1], defaultDirectories[0]);

    const duplicateDirectories = codexHomeDirectories({ CODEX_HOME: defaultDirectories[0] });
    assert.deepEqual(duplicateDirectories, defaultDirectories);
    assert.deepEqual(codexHomeDirectories({ CODEX_HOME: "   " }), defaultDirectories);
  });

  it("builds auth.json candidates for each Codex home directory", () => {
    const candidates = credentialFileCandidates({ CODEX_HOME: FIXTURE_HOME });
    assert.equal(candidates[0], path.join(path.resolve(FIXTURE_HOME), "auth.json"));
    assert.equal(candidates.every((candidate) => path.basename(candidate) === "auth.json"), true);
    assert.equal(candidates.length, 2);
  });

  it("decodes only valid three-part JWT object payloads", () => {
    const payload = { exp: 123, nested: { enabled: true } };
    const token = makeToken(payload);
    assert.deepEqual(decodeJwtPayload(token), payload);

    assert.equal(decodeJwtPayload(`header.${encodeJson("not-json")}.signature`), null);
    assert.equal(decodeJwtPayload("header.%%%%.signature"), null);
    assert.equal(decodeJwtPayload(`header.${encodeJson(["array"])}.signature`), null);
    assert.equal(decodeJwtPayload(`header.${encodeJson(null)}.signature`), null);
    assert.equal(decodeJwtPayload("header.payload"), null);
    assert.equal(decodeJwtPayload(42), null);
    assert.equal(decodeJwtPayload(null), null);
  });

  it("reports a missing credential file without exposing a token", () => {
    const calls = [];
    const result = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync(candidate, encoding) {
        calls.push([candidate, encoding]);
        const error = new Error("missing fixture");
        error.code = "ENOENT";
        throw error;
      },
    });

    assert.deepEqual(result, { ok: false, reason: "credential-file-missing" });
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(result).includes(SENTINEL_TOKEN), false);
  });

  it("stops on an unreadable first credential candidate", () => {
    const calls = [];
    const result = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync(candidate) {
        calls.push(candidate);
        const error = new Error("permission fixture");
        error.code = "EACCES";
        throw error;
      },
    });

    assert.deepEqual(result, { ok: false, reason: "credential-file-unreadable" });
    assert.equal(calls.length, 1);
  });

  it("skips a malformed first document and succeeds with the next candidate", () => {
    const calls = [];
    const result = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync(candidate) {
        calls.push(candidate);
        return calls.length === 1 ? "{malformed" : documentWithToken("fallback-token-fixture");
      },
    });

    assert.equal(calls.length, 2);
    assert.equal(result.ok, true);
    assert.equal(result.accessToken, "fallback-token-fixture");
    assert.equal(result.accountId, null);
    assert.equal(result.expiresAt, null);
    assert.equal(result.planHint, null);
  });

  it("rejects missing and oversized access tokens", () => {
    const read = (document) => readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync: () => JSON.stringify(document),
    });

    assert.deepEqual(read({ tokens: {} }), { ok: false, reason: "credential-token-missing" });
    assert.deepEqual(read({ tokens: { access_token: "x".repeat(8193) } }), {
      ok: false,
      reason: "credential-token-missing",
    });
  });

  it("returns only the documented success keys and preserves file account metadata", () => {
    const result = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync: () => documentWithToken(SENTINEL_TOKEN, { account_id: "fixture-account-id" }),
    });

    assert.deepEqual(Object.keys(result).sort(), ["accessToken", "accountId", "expiresAt", "ok", "planHint"].sort());
    assert.equal(result.ok, true);
    assert.equal(result.accessToken, SENTINEL_TOKEN);
    assert.equal(result.accountId, "fixture-account-id");
    assert.equal(JSON.stringify(result).includes(SENTINEL_TOKEN), true);

    const failed = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync: () => JSON.stringify({ tokens: { account_id: "fixture-account-id" } }),
    });
    assert.deepEqual(failed, { ok: false, reason: "credential-token-missing" });
    assert.equal(JSON.stringify(failed).includes(SENTINEL_TOKEN), false);
  });

  it("derives account, plan, and expiry metadata from JWT claims when needed", () => {
    const token = makeToken({
      exp: 1_789_218_810,
      "https://api.openai.com/auth": {
        chatgpt_account_id: "claimed-account-fixture",
        chatgpt_plan_type: "pro",
      },
    });
    const result = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync: () => documentWithToken(token),
    });

    assert.equal(result.accountId, "claimed-account-fixture");
    assert.equal(result.planHint, "pro");
    assert.equal(result.expiresAt, 1_789_218_810_000);

    const nonJwt = readCodexCredentials({
      env: { CODEX_HOME: FIXTURE_HOME },
      readFileSync: () => documentWithToken("plain-token-fixture"),
    });
    assert.equal(nonJwt.expiresAt, null);
    assert.equal(nonJwt.planHint, null);
  });

  it("handles expiry and claim helper edge cases without inventing metadata", () => {
    for (const payload of [{}, { exp: 0 }, { exp: -1 }, { exp: "123" }]) {
      const token = makeToken(payload);
      assert.equal(tokenExpiresAt(token), null);
    }

    assert.equal(tokenExpiresAt("not-a-jwt-fixture"), null);
    assert.equal(planHintFromToken(makeToken({})), null);
    assert.equal(chatgptAccountIdFromToken(makeToken({})), null);
    assert.equal(planHintFromToken(makeToken({ "https://api.openai.com/auth": { chatgpt_plan_type: "  " } })), null);
    assert.equal(chatgptAccountIdFromToken(makeToken({ "https://api.openai.com/auth": { chatgpt_account_id: 42 } })), null);
  });
});
