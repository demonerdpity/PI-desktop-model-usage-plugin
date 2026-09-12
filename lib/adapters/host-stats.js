"use strict";

/**
 * Compatibility seam for the future public completed-turn API. The current
 * plugin SDK exposes no stats.getTokenUsageHistory method, so this adapter never
 * probes private IPC, SQLite, or host internals and safely returns UNSUPPORTED.
 */

async function readCompletedTurnHistory(pi, options = {}) {
  const candidate = pi?.stats?.getTokenUsageHistory;
  if (typeof candidate !== "function") {
    return {
      status: "UNSUPPORTED",
      events: [],
      provenance: {
        sourceType: "host-rollup",
        estimated: false,
        note: "The current public PI-Desktop plugin API does not expose stats.getTokenUsageHistory.",
      },
    };
  }
  try {
    const value = await candidate(options);
    return {
      status: "SUPPORTED",
      events: Array.isArray(value?.events) ? value.events : [],
      provenance: { sourceType: "host-rollup", estimated: false, note: "Public completed-turn history." },
    };
  } catch (error) {
    return {
      status: "ERROR",
      events: [],
      error: String(error?.message || error),
      provenance: { sourceType: "host-rollup", estimated: false, note: "Completed-turn history was unavailable." },
    };
  }
}

/**
 * If the API is ever available, callers should subtract transcript totals and
 * add only a positive remainder as a `Subagent` fact. This helper is kept pure
 * and is not used while the API is unsupported.
 */
function positiveRemainder(turnTokens = {}, transcriptTokens = {}) {
  const fields = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
  const remainder = {};
  for (const field of fields) remainder[field] = Math.max(0, Number(turnTokens[field] || 0) - Number(transcriptTokens[field] || 0));
  remainder.total = fields.reduce((sum, field) => sum + remainder[field], 0);
  return remainder.total ? remainder : null;
}

module.exports = {
  positiveRemainder,
  readCompletedTurnHistory,
};
