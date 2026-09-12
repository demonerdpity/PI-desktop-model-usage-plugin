"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  aggregate,
} = require("./lib/aggregate");
const { createLocalPiAdapter } = require("./lib/adapters/local-pi");
const { discoverFromHost } = require("./lib/provider-catalog");
const { createStore, pruneFacts, DERIVED_RETENTION_MS } = require("./lib/store");

const COMMAND_ID = "modelUsageDashboard.open";
const WATCH_DEBOUNCE_MS = 30_000;
const WATCH_MIN_GAP_MS = 5 * 60_000;
const WATCH_MAX_STALE_MS = 15 * 60_000;
const PROGRESS_PUBLISH_MS = 400;
const APPEARANCE_POLL_MS = 2_000;

let disposed = false;
let dataPath = null;
let hostRoot = null;
let sessionsRoot = null;
let store = null;
let sourceState = { version: 1, sources: {} };
let facts = [];
let currentSnapshot = null;
let refreshPromise = null;
let watchers = [];
let watchTimer = null;
let appearanceTimer = null;
let appearanceHandler = null;
let lastScanFinishedAt = 0;
let progressWrite = null;
let testSessionRoot = null;

function hostRootFromDataPath(value) {
  const base = String(value || "").trim();
  // With no host-provided private path, resolving ".." would resolve against
  // the process cwd and point the scanner at an unrelated directory.
  if (!base) return null;
  return path.resolve(base, "..", "..", "..");
}

function resolveSessionRoot(root) {
  if (root) return path.resolve(root);
  if (hostRoot) return path.join(hostRoot, "sessions");
  return path.join(os.homedir(), ".pi-desktop", "sessions");
}

function safeError(error) {
  const code = String(error?.code || "").replace(/[^A-Z0-9_-]/gi, "").slice(0, 32);
  return code || "SCAN_FAILED";
}

function safeAppearance(value) {
  const appearance = value && typeof value === "object" ? value : {};
  const base = appearance.base === "light" || appearance.base === "dark" ? appearance.base : "system";
  const locale = String(appearance.locale || "en").slice(0, 16);
  const theme = String(appearance.theme || "system").slice(0, 160);
  const pluginTheme = appearance.pluginTheme && typeof appearance.pluginTheme === "object"
    ? {
        id: String(appearance.pluginTheme.id || "").slice(0, 160),
        base: appearance.pluginTheme.base === "light" ? "light" : "dark",
        css: typeof appearance.pluginTheme.css === "string" ? appearance.pluginTheme.css.slice(0, 256 * 1024) : "",
      }
    : null;
  return {
    ok: Boolean(appearance.ok ?? true),
    base,
    locale,
    theme,
    pluginTheme,
    readAt: Date.now(),
  };
}

async function publish(partial) {
  if (disposed || !globalThis.pi?.plugin?.setSettings) return;
  await pi.plugin.setSettings(partial);
}

async function publishAppearance() {
  if (disposed) return null;
  try {
    if (globalThis.pi?.app?.getAppearance) {
      const appearance = safeAppearance(await pi.app.getAppearance());
      await publish({ hostAppearance: appearance });
      return appearance;
    }
    const locale = globalThis.pi?.app?.getLocale ? await pi.app.getLocale() : "en";
    const fallback = { ok: false, base: "system", locale: String(locale || "en"), theme: "system", pluginTheme: null, readAt: Date.now() };
    await publish({ hostAppearance: fallback });
    return fallback;
  } catch {
    const fallback = { ok: false, base: "system", locale: "en", theme: "system", pluginTheme: null, readAt: Date.now() };
    await publish({ hostAppearance: fallback }).catch(() => undefined);
    return fallback;
  }
}

function buildProgressPublisher(reason, startedAt) {
  const counts = { filesTotal: 0, filesScanned: 0 };
  let lastAt = 0;
  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastAt < PROGRESS_PUBLISH_MS) return;
    lastAt = now;
    const state = {
      status: "scanning",
      stale: Boolean(currentSnapshot),
      reason,
      startedAt,
      updatedAt: now,
      filesTotal: counts.filesTotal,
      filesScanned: counts.filesScanned,
    };
    if (progressWrite) progressWrite.queued = state;
    else {
      progressWrite = { queued: null };
      void publish({ scanState: state })
        .catch(() => undefined)
        .finally(() => {
          const next = progressWrite?.queued;
          progressWrite = null;
          if (next && !disposed) void publish({ scanState: next });
        });
    }
  };
  return {
    onProgress(kind, value) {
      if (kind === "total") counts.filesTotal = Math.max(0, Number(value) || 0);
      if (kind === "file") counts.filesScanned += 1;
      emit(kind === "total" || (counts.filesTotal > 0 && counts.filesScanned >= counts.filesTotal));
    },
    counts,
    flush() {
      emit(true);
      return { ...counts };
    },
  };
}

function sourceStateForFacts(value, retained) {
  const allowed = new Set(retained.map((fact) => fact.id));
  const output = { version: 1, sources: {} };
  for (const [id, entry] of Object.entries(value?.sources || {})) {
    if (!entry || typeof entry !== "object") continue;
    output.sources[id] = {
      stamp: entry.stamp || null,
      facts: Array.isArray(entry.facts) ? entry.facts.filter((fact) => allowed.has(fact?.id)) : [],
    };
  }
  return output;
}

async function initialize() {
  if (store) return;
  dataPath = await pi.plugin.getDataPath();
  hostRoot = hostRootFromDataPath(dataPath);
  sessionsRoot = resolveSessionRoot(testSessionRoot);
  store = createStore(dataPath);
  await store.init();
  const loaded = await store.load();
  sourceState = loaded.sources || sourceState;
  facts = Array.isArray(loaded.facts?.facts) ? loaded.facts.facts : Array.isArray(loaded.facts) ? loaded.facts : [];
  currentSnapshot = loaded.snapshot || null;
  await publish({
    dashboardSnapshot: currentSnapshot,
    scanState: currentSnapshot
      ? { status: "stale", stale: true, finishedAt: loaded.state?.lastGoodAt || 0, reason: "startup-cache" }
      : { status: "idle", stale: false, reason: "startup" },
  });
  await publishAppearance();
}

function refreshFacts(reason = "manual") {
  if (refreshPromise) return refreshPromise;
  if (disposed) return currentSnapshot;
  refreshPromise = (async () => {
    const startedAt = Date.now();
    const progress = buildProgressPublisher(reason, startedAt);
    await publish({
      scanState: {
        status: "scanning",
        stale: Boolean(currentSnapshot),
        reason,
        startedAt,
        updatedAt: startedAt,
        filesTotal: 0,
        filesScanned: 0,
      },
    });
    try {
      const adapter = createLocalPiAdapter({ root: sessionsRoot });
      const result = await adapter.scan({ previous: sourceState, onProgress: progress.onProgress });
      if (disposed) return currentSnapshot;
      const now = Date.now();
      const retained = pruneFacts(result.facts, now);
      const retainedSources = sourceStateForFacts(result.sourceState, pruneFacts(result.facts, now, DERIVED_RETENTION_MS));
      const catalog = await discoverFromHost(pi, retained);
      const snapshot = aggregate(retained, {
        catalog,
        generatedAt: startedAt,
        asOf: now,
        diagnostics: {
          ...result.diagnostics,
          filesTotal: progress.counts.filesTotal,
          filesScanned: progress.counts.filesScanned,
          retentionDays: 90,
        },
        modelsListSupported: catalog.supported,
      });
      progress.flush();
      await store.saveFacts(retained, retainedSources, now);
      await store.saveDaily(result.facts, now);
      if (disposed) return currentSnapshot;
      await store.saveSnapshot(snapshot, { lastGoodAt: now });
      if (disposed) return currentSnapshot;
      sourceState = retainedSources;
      if (disposed) return currentSnapshot;
      facts = retained;
      currentSnapshot = snapshot;
      lastScanFinishedAt = now;
      await publish({
        dashboardSnapshot: snapshot,
        scanState: {
          status: "ready",
          stale: false,
          reason,
          startedAt,
          finishedAt: now,
          scanMs: now - startedAt,
          filesTotal: progress.counts.filesTotal,
          filesScanned: progress.counts.filesScanned,
          malformedLines: Number(result.diagnostics.malformedLines) || 0,
          truncatedLines: Number(result.diagnostics.truncatedLines) || 0,
        },
      });
      return snapshot;
    } catch (error) {
      const finishedAt = Date.now();
      await store?.saveState({ stale: Boolean(currentSnapshot), lastError: safeError(error), lastAttemptAt: finishedAt }).catch(() => undefined);
      await publish({
        // Deliberately omit dashboardSnapshot: a failed scan must leave the
        // last-good settings value untouched instead of replacing it with null.
        scanState: {
          status: "failed",
          stale: Boolean(currentSnapshot),
          reason,
          finishedAt,
          error: safeError(error),
        },
      }).catch(() => undefined);
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function startSourceWatch() {
  stopSourceWatch();
  let watcher;
  try {
    if (!fs.existsSync(sessionsRoot)) return;
    watcher = fs.watch(sessionsRoot, { persistent: false }, () => {
      const now = Date.now();
      if (refreshPromise) return;
      const stale = !lastScanFinishedAt || now - lastScanFinishedAt > WATCH_MAX_STALE_MS;
      if (stale) {
        void refreshFacts("watch").catch(() => undefined);
        return;
      }
      if (watchTimer) clearTimeout(watchTimer);
      const remainingGap = Math.max(0, WATCH_MIN_GAP_MS - (Date.now() - lastScanFinishedAt));
      watchTimer = setTimeout(() => {
        watchTimer = null;
        if (!refreshPromise && Date.now() - lastScanFinishedAt >= WATCH_MIN_GAP_MS) {
          void refreshFacts("watch").catch(() => undefined);
        }
      }, Math.max(WATCH_DEBOUNCE_MS, remainingGap));
      watchTimer.unref?.();
    });
    watcher.on?.("error", () => undefined);
    watchers.push(watcher);
  } catch {
    // A missing sessions directory is a valid empty state; it can be scanned
    // when the command runs and does not make plugin activation fail.
  }
}

function stopSourceWatch() {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = null;
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // already closed
    }
  }
  watchers = [];
}

function startAppearanceWatch() {
  if (pi?.events?.on) {
    appearanceHandler = () => void publishAppearance();
    pi.events.on("appearance:changed", appearanceHandler);
  }
  appearanceTimer = setInterval(() => void publishAppearance(), APPEARANCE_POLL_MS);
  appearanceTimer.unref?.();
}

function stopAppearanceWatch() {
  if (appearanceTimer) clearInterval(appearanceTimer);
  appearanceTimer = null;
  if (appearanceHandler && pi?.events?.off) pi.events.off("appearance:changed", appearanceHandler);
  appearanceHandler = null;
}

async function onLoad() {
  disposed = false;
  await initialize();
  await pi.commands.register({
    id: COMMAND_ID,
    title: "Model Usage Dashboard: Open",
    keywords: ["model usage", "usage", "tokens", "cost", "quota", "stats", "模型用量", "用量", "统计", "费用", "额度"],
    category: "Productivity",
    run: async () => {
      // Keep this order: an open panel can immediately render its last-good
      // snapshot while the scan runs behind it.
      await pi.ui.openPanel();
      void refreshFacts("command").catch(() =>
        pi.ui.showToast?.("Model Usage Dashboard could not refresh local usage.", "warn"),
      );
    },
  });
  startSourceWatch();
  startAppearanceWatch();
  // Startup warming never calls openPanel and intentionally has no toast.
  void refreshFacts("startup").catch(() => undefined);
}

async function onUnload() {
  disposed = true;
  stopSourceWatch();
  stopAppearanceWatch();
  await pi.commands.unregister(COMMAND_ID).catch(() => undefined);
  // Do not sever the in-flight reference: refreshFacts observes `disposed` and
  // stops before later cache commits or panel publications.
}

module.exports = {
  onLoad,
  onUnload,
  __test: {
    aggregate,
    buildProgressPublisher,
    hostRootFromDataPath,
    refreshFacts,
    resolveSessionRoot,
    setSessionRoot(root) {
      testSessionRoot = root;
      sessionsRoot = resolveSessionRoot(root);
    },
    reset() {
      disposed = false;
      dataPath = null;
      hostRoot = null;
      sessionsRoot = null;
      store = null;
      sourceState = { version: 1, sources: {} };
      facts = [];
      currentSnapshot = null;
      refreshPromise = null;
      lastScanFinishedAt = 0;
      testSessionRoot = null;
      stopSourceWatch();
      stopAppearanceWatch();
    },
    getState() {
      return { dataPath, hostRoot, sessionsRoot, facts, currentSnapshot, refreshPromise };
    },
  },
};
