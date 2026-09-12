"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const STORE_VERSION = 1;
const FACT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DERIVED_RETENTION_MS = 366 * 24 * 60 * 60 * 1000;

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}
function storeFile(files, root, name) {
  const key = safeName(name);
  // `files` is a plain object, so a hostile name such as "__proto__" or
  // "constructor" would otherwise resolve through the prototype chain and hand
  // a non-path value to the atomic writer.
  return Object.prototype.hasOwnProperty.call(files, key) ? files[key] : path.join(root, `${key}.json`);
}


function compactFact(fact) {
  if (!fact || typeof fact !== "object") return null;
  return {
    id: String(fact.id || "").slice(0, 256),
    timestamp: Number(fact.timestamp),
    providerId: String(fact.providerId || "unknown").slice(0, 160),
    modelId: String(fact.modelId || "unknown").slice(0, 240),
    tokens: Object.fromEntries(
      ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"].flatMap((field) => {
        const value = Number(fact.tokens?.[field]);
        return Number.isSafeInteger(value) && value >= 0 ? [[field, value]] : [];
      }),
    ),
    requestCount: 1,
    sourceFileId: String(fact.sourceFileId || "unknown").slice(0, 64),
  };
}

function compactSourceState(sourceState) {
  if (!sourceState || typeof sourceState !== "object") return { version: 1, sources: {} };
  const sources = {};
  for (const [id, entry] of Object.entries(sourceState.sources || {})) {
    if (!entry || typeof entry !== "object") continue;
    const facts = Array.isArray(entry.facts) ? entry.facts.map(compactFact).filter(Boolean) : [];
    const stamp = entry.stamp && typeof entry.stamp === "object" ? {
      size: Math.max(0, Number(entry.stamp.size) || 0),
      mtimeMs: Math.max(0, Number(entry.stamp.mtimeMs) || 0),
      ino: Number.isSafeInteger(entry.stamp.ino) ? entry.stamp.ino : 0,
      dev: Number.isSafeInteger(entry.stamp.dev) ? entry.stamp.dev : 0,
    } : null;
    sources[String(id).slice(0, 64)] = { stamp, facts };
  }
  return { version: 1, sources };
}

function pruneFacts(facts, now = Date.now(), retentionMs = FACT_RETENTION_MS) {
  const cutoff = now - Math.max(0, Number(retentionMs) || FACT_RETENTION_MS);
  return (Array.isArray(facts) ? facts : []).map(compactFact).filter((fact) => fact && fact.timestamp >= cutoff && fact.timestamp <= now + 86_400_000);
}

function localDayKey(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function compactDaily(facts, now = Date.now()) {
  const rows = new Map();
  for (const fact of pruneFacts(facts, now, DERIVED_RETENTION_MS)) {
    const date = localDayKey(fact.timestamp);
    if (!date) continue;
    const row = rows.get(date) || { date, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
    row.requests += 1;
    for (const field of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"]) row[field] += Number(fact.tokens?.[field]) || 0;
    rows.set(date, row);
  }
  return { version: STORE_VERSION, retainedAt: now, days: [...rows.values()].sort((left, right) => left.date.localeCompare(right.date)) };
}

function pruneDerived(value, now = Date.now()) {
  if (!value || typeof value !== "object") return value;
  // Snapshots contain bounded trends rather than an unbounded event log. This
  // conservative check removes malformed ancient snapshots while preserving a
  // valid last-good snapshot for offline startup.
  if (Number(value.generatedAt) && value.generatedAt < now - DERIVED_RETENTION_MS) return null;
  return value;
}

async function atomicWrite(file, value) {
  const directory = path.dirname(file);
  await fsp.mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const content = typeof value === "string" ? value : JSON.stringify(value);
  await fsp.writeFile(temporary, content, "utf8");
  try {
    await fsp.rename(temporary, file);
  } catch (error) {
    // Windows cannot replace an existing target with rename. The normal path is
    // atomic; this narrow fallback still guarantees readers see a full JSON file.
    if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
    await fsp.rm(file, { force: true });
    await fsp.rename(temporary, file);
  }
}

async function readJson(file, fallback = null) {
  try {
    const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
    return parsed;
  } catch {
    return fallback;
  }
}

function createStore(dataPath) {
  const root = path.resolve(String(dataPath || "."));
  const files = {
    state: path.join(root, "state.json"),
    facts: path.join(root, "facts.json"),
    sources: path.join(root, "sources.json"),
    daily: path.join(root, "daily.json"),
    snapshot: path.join(root, "last-good.json"),
  };
  return {
    root,
    files,
    async init() {
      await fsp.mkdir(root, { recursive: true });
    },
    async load() {
      const [state, facts, sources, daily, snapshot] = await Promise.all([
        readJson(files.state, {}),
        readJson(files.facts, []),
        readJson(files.sources, { version: 1, sources: {} }),
        readJson(files.daily, { version: 1, days: [] }),
        readJson(files.snapshot, null),
      ]);
      const factList = Array.isArray(facts) ? facts : Array.isArray(facts?.facts) ? facts.facts : [];
      return {
        state: state && typeof state === "object" ? state : {},
        facts: factList,
        sources: sources && typeof sources === "object" ? sources : { version: 1, sources: {} },
        daily: daily && typeof daily === "object" ? daily : { version: 1, days: [] },
        snapshot: pruneDerived(snapshot),
      };
    },
    async saveFacts(facts, sourceState, now = Date.now()) {
      await this.init();
      const compacted = pruneFacts(facts, now);
      await atomicWrite(files.facts, { version: STORE_VERSION, retainedAt: now, facts: compacted });
      await atomicWrite(files.sources, compactSourceState(sourceState));
      // Keep the external shape simple for older cache readers: facts.json can
      // be either a list or a versioned object, and load() handles both.
      return compacted;
    },
    async saveDaily(facts, now = Date.now()) {
      await this.init();
      const daily = compactDaily(facts, now);
      await atomicWrite(files.daily, daily);
      return daily;
    },
    async saveSnapshot(snapshot, state = {}) {
      await this.init();
      await atomicWrite(files.snapshot, snapshot);
      await atomicWrite(files.state, {
        version: STORE_VERSION,
        lastGoodAt: Number(state.lastGoodAt) || Date.now(),
        sourceRoot: "~/.pi-desktop/sessions",
        stale: false,
      });
    },
    async saveState(state) {
      await this.init();
      await atomicWrite(files.state, { version: STORE_VERSION, ...(state || {}) });
    },
    async clear() {
      for (const file of Object.values(files)) await fsp.rm(file, { force: true });
    },
    async writeJson(name, value) {
      await atomicWrite(storeFile(files, root, name), value);
    },
    async readJson(name, fallback = null) {
      return readJson(storeFile(files, root, name), fallback);
    },
  };
}

module.exports = {
  DERIVED_RETENTION_MS,
  FACT_RETENTION_MS,
  atomicWrite,
  compactDaily,
  compactFact,
  compactSourceState,
  createStore,
  localDayKey,
  pruneFacts,
  readJson,
};
