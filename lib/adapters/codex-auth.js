"use strict";

/**
 * Reads the local Codex CLI / PI-Desktop ChatGPT login so the plugin can ask the
 * provider for the signed-in account's real subscription quota.
 *
 * This is the same source and the same request Cockpit Tools uses, but with a
 * stricter contract:
 *
 * - The access token is handed to the main process only. It is never placed in
 *   the snapshot, the store, the renderer payload, or a log line, and this
 *   module never returns it inside a message or error string.
 * - The credential file is opened read-only. Nothing here refreshes, rotates,
 *   rewrites, or deletes it, so a plugin failure can never damage the user's
 *   Codex CLI login.
 * - Only non-secret metadata (expiry instant) leaves this module alongside the
 *   token that the quota client needs.
 *
 * Nothing in this file performs network I/O.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AUTH_FILE_NAME = "auth.json";
const MAX_TOKEN_LENGTH = 8192;

/** Reason codes are shared with the renderer, which localizes them. */
const CREDENTIAL_REASONS = Object.freeze({
  ready: "ready",
  fileMissing: "credential-file-missing",
  fileUnreadable: "credential-file-unreadable",
  tokenMissing: "credential-token-missing",
});

function codexHomeDirectories(env = process.env) {
  const directories = [];
  const configured = typeof env?.CODEX_HOME === "string" ? env.CODEX_HOME.trim() : "";
  if (configured) directories.push(path.resolve(configured));
  const home = typeof os.homedir === "function" ? os.homedir() : "";
  if (home) directories.push(path.join(home, ".codex"));
  return [...new Set(directories)];
}

function decodeJwtPayload(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 3) return null;
  try {
    const decoded = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(decoded);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** ChatGPT account id claimed by the access token, used for the account header. */
function chatgptAccountIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  const claim = payload?.["https://api.openai.com/auth"];
  const value = claim && typeof claim === "object" ? claim.chatgpt_account_id : null;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : null;
}

/** Plan name claimed by the token, used only as a fallback display hint. */
function planHintFromToken(token) {
  const payload = decodeJwtPayload(token);
  const claim = payload?.["https://api.openai.com/auth"];
  const value = claim && typeof claim === "object" ? claim.chatgpt_plan_type : null;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : null;
}

/** Absolute epoch milliseconds at which the access token expires, or null. */
function tokenExpiresAt(token) {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) return null;
  return Math.round(exp * 1000);
}

function credentialFileCandidates(env) {
  return codexHomeDirectories(env).map((directory) => path.join(directory, AUTH_FILE_NAME));
}

function readAuthDocument(readFileSync, candidates) {
  for (const candidate of candidates) {
    let text;
    try {
      text = readFileSync(candidate, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
      return { reason: CREDENTIAL_REASONS.fileUnreadable };
    }
    if (typeof text !== "string" || !text.trim()) continue;
    try {
      const document = JSON.parse(text);
      if (document && typeof document === "object" && !Array.isArray(document)) return { document };
    } catch {
      // A malformed document is treated as "not signed in" rather than crashing
      // the dashboard; the user fixes it by signing in again.
      continue;
    }
  }
  return { reason: CREDENTIAL_REASONS.fileMissing };
}

/**
 * @returns {{ok: true, accessToken: string, accountId: string|null, expiresAt: number|null,
 *            planHint: string|null}}
 *        | {{ok: false, reason: string}}
 */
function readCodexCredentials({ env = process.env, readFileSync = fs.readFileSync } = {}) {
  const candidates = credentialFileCandidates(env);
  if (!candidates.length) return { ok: false, reason: CREDENTIAL_REASONS.fileMissing };

  const loaded = readAuthDocument(readFileSync, candidates);
  if (!loaded.document) return { ok: false, reason: loaded.reason || CREDENTIAL_REASONS.fileMissing };

  const tokens = loaded.document.tokens;
  const raw = tokens && typeof tokens === "object" ? tokens.access_token : null;
  const accessToken = typeof raw === "string" ? raw.trim() : "";
  if (!accessToken || accessToken.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: CREDENTIAL_REASONS.tokenMissing };
  }

  const declared = tokens && typeof tokens === "object" ? tokens.account_id : null;
  const fromFile = typeof declared === "string" && declared.trim() ? declared.trim().slice(0, 128) : null;

  return {
    ok: true,
    accessToken,
    accountId: fromFile || chatgptAccountIdFromToken(accessToken),
    expiresAt: tokenExpiresAt(accessToken),
    planHint: planHintFromToken(accessToken),
  };
}

module.exports = {
  AUTH_FILE_NAME,
  CREDENTIAL_REASONS,
  chatgptAccountIdFromToken,
  codexHomeDirectories,
  credentialFileCandidates,
  decodeJwtPayload,
  planHintFromToken,
  readCodexCredentials,
  tokenExpiresAt,
};
