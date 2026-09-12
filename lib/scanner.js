"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const {
  normalizeTimestamp,
  normalizeUsage,
  scalarText,
} = require("./domain");

const SOURCE_ID_LENGTH = 16;

function hash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, SOURCE_ID_LENGTH);
}

function sourceFileId(file) {
  return hash(path.resolve(String(file)));
}

function stableMessageId(record, meta, usage, timestamp, providerId, modelId) {
  const explicit = record?.id ?? record?.messageId ?? record?.message?.id ?? meta?.id;
  if (typeof explicit === "string" || typeof explicit === "number") {
    return hash(`message:${String(explicit).trim()}`);
  }
  // A deterministic, path-free fallback allows a fork with the same scalar
  // message to de-duplicate without persisting a session or file identifier.
  return hash(
    JSON.stringify({
      timestamp,
      providerId,
      modelId,
      usage,
    }),
  );
}

function recordRole(record) {
  if (record?.role === "assistant") return true;
  if (record?.message?.role === "assistant" && record?.meta) return true;
  return false;
}

/**
 * Parse one JSONL record and return only a compact UsageFact. The source record
 * is not returned on any path, which makes accidental privacy regressions hard.
 */
function parseAssistantRecord(record, file) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  if (!recordRole(record)) return null;
  const meta = record.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const usage = normalizeUsage(meta.usage);
  if (!usage) return null;
  const timestamp = normalizeTimestamp(record.createdAt ?? record.timestamp ?? meta.createdAt);
  if (timestamp === null) return null;
  const providerId = scalarText(meta.providerId, 160, "unknown");
  const modelId = scalarText(meta.modelId, 240, "unknown");
  return {
    id: stableMessageId(record, meta, usage, timestamp, providerId, modelId),
    timestamp,
    providerId,
    modelId,
    tokens: usage,
    requestCount: 1,
    sourceFileId: sourceFileId(file),
  };
}

function listSessionFiles(root) {
  const directory = path.resolve(String(root || ""));
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /\.jsonl$/i.test(entry.name) && !/\.revisions\.jsonl$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function fileStamp(file) {
  try {
    const stat = fs.statSync(file);
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ino: Number.isSafeInteger(stat.ino) ? stat.ino : 0,
      dev: Number.isSafeInteger(stat.dev) ? stat.dev : 0,
    };
  } catch {
    return null;
  }
}

function sameStamp(left, right) {
  return Boolean(
    left &&
      right &&
      left.size === right.size &&
      left.mtimeMs === right.mtimeMs &&
      left.ino === right.ino &&
      left.dev === right.dev,
  );
}

function compactStamp(stamp) {
  if (!stamp) return null;
  return {
    size: Math.max(0, Number(stamp.size) || 0),
    mtimeMs: Math.max(0, Number(stamp.mtimeMs) || 0),
    ino: Number.isSafeInteger(stamp.ino) ? stamp.ino : 0,
    dev: Number.isSafeInteger(stamp.dev) ? stamp.dev : 0,
  };
}

function previousSourceMap(previous) {
  if (!previous) return new Map();
  const entries = previous instanceof Map ? [...previous.entries()] : Object.entries(previous.sources || previous);
  const result = new Map();
  for (const [key, value] of entries) {
    if (!value || typeof value !== "object") continue;
    result.set(String(key), value);
  }
  return result;
}

function parseFile(file, diagnostics, { previousFacts = [], startOffset = 0 } = {}) {
  const factsById = new Map((Array.isArray(previousFacts) ? previousFacts : []).map((fact) => [fact.id, fact]));
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    diagnostics.filesSkipped += 1;
    return { facts: [...factsById.values()], stamp: fileStamp(file), offset: startOffset, complete: false, malformedLines: 0, truncatedLines: 0 };
  }
  const boundedStart = Math.max(0, Math.min(Number(startOffset) || 0, buffer.length));
  const text = buffer.subarray(boundedStart).toString("utf8");
  const lines = text.split(/\r?\n/);
  let malformedLines = 0;
  let truncatedLines = 0;
  const hasFinalNewline = /(?:\r?\n)$/.test(text);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      malformedLines += 1;
      if (index === lines.length - 1 && !hasFinalNewline) truncatedLines += 1;
      return;
    }
    const fact = parseAssistantRecord(record, file);
    if (fact) factsById.set(fact.id, fact); // keep-last within one file
  });
  const lastNewline = buffer.lastIndexOf(0x0a);
  const lastLineComplete = hasFinalNewline || lines.length === 0 || !lines[lines.length - 1].trim() || (() => {
    try { JSON.parse(lines[lines.length - 1]); return true; } catch { return false; }
  })();
  const offset = lastLineComplete ? buffer.length : Math.max(boundedStart, lastNewline + 1);
  diagnostics.malformedLines += malformedLines;
  diagnostics.truncatedLines += truncatedLines;
  diagnostics.usageMessages += factsById.size;
  diagnostics.filesScanned += 1;
  return {
    facts: [...factsById.values()],
    stamp: fileStamp(file),
    offset,
    complete: offset === buffer.length,
    malformedLines,
    truncatedLines,
  };
}
function fileEndsWithNewline(file) {
  let descriptor;
  try {
    const size = fs.statSync(file).size;
    if (!size) return true;
    descriptor = fs.openSync(file, "r");
    const byte = Buffer.allocUnsafe(1);
    fs.readSync(descriptor, byte, 0, 1, size - 1);
    return byte[0] === 10;
  } catch {
    return true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

/** Runtime parser: reads one line at a time and immediately discards content. */
async function parseFileStream(file, diagnostics, { previousFacts = [] } = {}) {
  const factsById = new Map((Array.isArray(previousFacts) ? previousFacts : []).map((fact) => [fact.id, fact]));
  let malformedLines = 0;
  let truncatedLines = 0;
  const endsWithNewline = fileEndsWithNewline(file);
  try {
    const input = fs.createReadStream(file, { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let pending = null;
    const consume = (line, final) => {
      if (!line.trim()) return;
      try {
        const fact = parseAssistantRecord(JSON.parse(line), file);
        if (fact) factsById.set(fact.id, fact);
      } catch {
        malformedLines += 1;
        if (final && !endsWithNewline) truncatedLines += 1;
      }
    };
    for await (const line of lines) {
      if (pending !== null) consume(pending, false);
      pending = line;
    }
    if (pending !== null) consume(pending, true);
  } catch {
    diagnostics.filesSkipped += 1;
    return { facts: [...factsById.values()], stamp: fileStamp(file), malformedLines: 0, truncatedLines: 0, readFailed: true };
  }
  diagnostics.malformedLines += malformedLines;
  diagnostics.truncatedLines += truncatedLines;
  diagnostics.usageMessages += factsById.size;
  diagnostics.filesScanned += 1;
  return { facts: [...factsById.values()], stamp: fileStamp(file), malformedLines, truncatedLines };
}

/**
 * Scan all direct `sessions/*.jsonl` files. The previous source map is optional;
 * unchanged files reuse their compact facts, while changed/replaced/deleted
 * files are rebuilt from scratch. A full changed-file parse is intentionally
 * preferred over guessing at a partial JSON line.
 */
function scanSessionDirectory(root, { previous = null, onProgress = null } = {}) {
  const files = listSessionFiles(root);
  const previousMap = previousSourceMap(previous);
  const sourceEntries = new Map();
  const diagnostics = {
    sourceId: "pi-desktop",
    filesTotal: files.length,
    filesScanned: 0,
    filesReused: 0,
    filesSkipped: 0,
    malformedLines: 0,
    truncatedLines: 0,
    usageMessages: 0,
    revisionsExcluded: 0,
  };
  const progress = (kind, value) => {
    if (typeof onProgress === "function") onProgress(kind, value);
  };
  progress("total", files.length);

  for (const file of files) {
    const id = sourceFileId(file);
    const stamp = fileStamp(file);
    const prior = previousMap.get(id);
    let parsed;
    if (prior && sameStamp(stamp, prior.stamp) && Array.isArray(prior.facts)) {
      parsed = { facts: prior.facts, stamp, reused: true };
      diagnostics.filesReused += 1;
      diagnostics.usageMessages += prior.facts.length;
    } else {
      parsed = parseFile(file, diagnostics);
    }
    sourceEntries.set(id, {
      stamp: compactStamp(stamp),
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    });
    progress("file", { fileId: id, reused: Boolean(parsed.reused) });
  }

  const factsById = new Map();
  // Files are sorted, so a duplicate stable id in a later fork file wins. This
  // gives deterministic cross-file keep-last behavior without retaining paths.
  for (const entry of sourceEntries.values()) {
    for (const fact of entry.facts) {
      if (fact && typeof fact.id === "string") factsById.set(fact.id, fact);
    }
  }
  const facts = [...factsById.values()].sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  diagnostics.usageMessages = facts.length;
  return {
    facts,
    diagnostics,
    sourceState: { version: 1, sources: Object.fromEntries(sourceEntries) },
  };
}

async function scanSessionDirectoryAsync(root, { previous = null, onProgress = null } = {}) {
  const files = listSessionFiles(root);
  const previousMap = previousSourceMap(previous);
  const sourceEntries = new Map();
  const diagnostics = {
    sourceId: "pi-desktop", filesTotal: files.length, filesScanned: 0,
    filesReused: 0, filesSkipped: 0, malformedLines: 0,
    truncatedLines: 0, usageMessages: 0, revisionsExcluded: 0,
  };
  const progress = (kind, value) => { if (typeof onProgress === "function") onProgress(kind, value); };
  progress("total", files.length);
  for (const file of files) {
    const id = sourceFileId(file);
    const stamp = fileStamp(file);
    const prior = previousMap.get(id);
    let parsed;
    if (prior && sameStamp(stamp, prior.stamp) && Array.isArray(prior.facts)) {
      parsed = { facts: prior.facts, stamp, reused: true };
      diagnostics.filesReused += 1;
      diagnostics.usageMessages += prior.facts.length;
    } else {
      parsed = await parseFileStream(file, diagnostics, { previousFacts: prior?.facts });
    }
    // A failed read stores no stamp, so the next scan rebuilds this source
    // from scratch instead of trusting a partially reused fact set.
    sourceEntries.set(id, {
      stamp: parsed.readFailed ? null : compactStamp(stamp),
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
    });
  }
  const factsById = new Map();
  for (const entry of sourceEntries.values()) {
    for (const fact of entry.facts) if (fact && typeof fact.id === "string") factsById.set(fact.id, fact);
  }
  const facts = [...factsById.values()].sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  diagnostics.usageMessages = facts.length;
  return { facts, diagnostics, sourceState: { version: 1, sources: Object.fromEntries(sourceEntries) } };
}

module.exports = {
  fileStamp,
  hash,
  listSessionFiles,
  fileEndsWithNewline,
  parseFileStream,
  parseAssistantRecord,
  sameStamp,
  scanSessionDirectory,
  scanSessionDirectoryAsync,
  sourceFileId,
  stableMessageId,
};
