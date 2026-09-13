"use strict";

/**
 * Performs the single authenticated read that returns a ChatGPT subscription's
 * real quota windows.
 *
 * Contract:
 * - One GET request. No request body, no retries, no credential refresh, and no
 *   mutating call of any kind is issued from this module.
 * - The access token is only ever placed in the Authorization header. It is not
 *   echoed into the returned object, and no error string may contain it.
 * - Transport is injectable so tests never touch the network and so the host can
 *   supply its own metered `pi.net.fetch`.
 */

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_PATH = "/backend-api/wham/usage";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

// The public ChatGPT web client identity, matching what the Codex CLI-style
// clients send. Without it the endpoint rejects the request.
const CHATGPT_WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

/** Reason codes shared with the renderer, which localizes them. */
const QUOTA_REASONS = Object.freeze({
  ready: "ready",
  noRuntime: "network-runtime-missing",
  credentialMissing: "credential-file-missing",
  credentialUnreadable: "credential-file-unreadable",
  credentialTokenMissing: "credential-token-missing",
  credentialExpired: "credential-expired",
  unauthorized: "provider-unauthorized",
  forbidden: "provider-forbidden",
  rateLimited: "provider-rate-limited",
  timeout: "network-timeout",
  network: "network-error",
  badStatus: (status) => `provider-http-${status}`,
  malformed: "provider-response-malformed",
  noWindow: "provider-response-without-window",
  // The host refused the request before it left the machine because the URL is
  // outside `manifest.net.domains`. Distinct from a network failure: the fix is
  // a manifest change, not connectivity.
  egressBlocked: "egress-blocked",
});

/**
 * Adapts the host's metered `pi.net.fetch` to the `(url, init)` shape this
 * module expects, so the request travels PI-Desktop's audited egress path.
 *
 * Returns null when the host exposes no such API, which the caller reports as
 * `network-runtime-missing` rather than silently reaching the provider over an
 * unaudited path.
 */
function createHostFetch(net) {
  if (!net || typeof net.fetch !== "function") return null;
  return async (url, init = {}) => {
    const result = await net.fetch({
      url,
      method: init.method || "GET",
      ...(init.headers ? { headers: init.headers } : {}),
      ...(typeof init.body === "string" ? { body: init.body } : {}),
      timeoutMs: Number(init.timeoutMs) || DEFAULT_TIMEOUT_MS,
    });
    const status = Number(result?.status);
    const text = typeof result?.bodyText === "string" ? result.bodyText : "";
    return {
      status: Number.isFinite(status) ? status : 0,
      text: async () => text,
    };
  };
}

function buildUsageRequest({ accessToken, accountId }) {
  // A token that is only whitespace is as useless as a missing one, and it must
  // never produce a request: the header would leak the blank value to the wire.
  if (typeof accessToken !== "string" || !accessToken.trim()) return null;
  const token = accessToken.trim();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Referer: "https://chatgpt.com/",
    "User-Agent": CHATGPT_WEB_USER_AGENT,
    "OpenAI-Beta": "codex-1",
    originator: "Codex Desktop",
  };
  if (typeof accountId === "string" && accountId) headers["ChatGPT-Account-Id"] = accountId;
  return { url: USAGE_ENDPOINT, method: "GET", headers };
}

function reasonForStatus(status) {
  if (status === 401) return QUOTA_REASONS.unauthorized;
  if (status === 403) return QUOTA_REASONS.forbidden;
  if (status === 429) return QUOTA_REASONS.rateLimited;
  return QUOTA_REASONS.badStatus(status);
}

function isSuccessStatus(status) {
  return typeof status === "number" && status >= 200 && status < 300;
}

/**
 * @returns {Promise<{ok: true, status: number, payload: object}
 *   | {ok: false, status: number|null, reason: string}>}
 */
async function requestCodexUsage({
  accessToken,
  accountId = null,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const request = buildUsageRequest({ accessToken, accountId });
  if (!request) return { ok: false, status: null, reason: QUOTA_REASONS.credentialTokenMissing };
  if (typeof fetchImpl !== "function") return { ok: false, status: null, reason: QUOTA_REASONS.noRuntime };

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS))
    : null;

  let response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: "follow",
      timeoutMs: Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    // `pi.net.fetch` refuses a URL outside `manifest.net.domains` by throwing a
    // code-tagged host error. That is a configuration problem the user can act
    // on, so it must not be reported as generic connectivity trouble.
    if (error?.code === "PERMISSION_DENIED") {
      return { ok: false, status: null, reason: QUOTA_REASONS.egressBlocked };
    }
    const aborted = error?.name === "AbortError" || error?.name === "TimeoutError";
    return { ok: false, status: null, reason: aborted ? QUOTA_REASONS.timeout : QUOTA_REASONS.network };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const status = Number(response?.status);
  if (!Number.isFinite(status)) return { ok: false, status: null, reason: QUOTA_REASONS.malformed };
  if (!isSuccessStatus(status)) return { ok: false, status, reason: reasonForStatus(status) };

  let text;
  try {
    text = await response.text();
  } catch {
    return { ok: false, status, reason: QUOTA_REASONS.malformed };
  }
  if (typeof text !== "string" || text.length > MAX_RESPONSE_BYTES) {
    return { ok: false, status, reason: QUOTA_REASONS.malformed };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, status, reason: QUOTA_REASONS.malformed };
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, status, reason: QUOTA_REASONS.malformed };
  }
  return { ok: true, status, payload };
}

module.exports = {
  CHATGPT_WEB_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  QUOTA_REASONS,
  USAGE_ENDPOINT,
  USAGE_PATH,
  buildUsageRequest,
  createHostFetch,
  isSuccessStatus,
  reasonForStatus,
  requestCodexUsage,
};
