"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore, pruneFacts } = require("../lib/store");

test("store writes private cache atomically and reloads facts/snapshot", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mud-store-"));
  const store = createStore(root);
  const now = Date.now();
  const facts = [{ id: "hashed", timestamp: now, providerId: "openai", modelId: "gpt-4o", tokens: { input: 1, total: 1 }, sourceFileId: "source" }];
  await store.saveFacts(facts, { version: 1, sources: {} }, now);
  const snapshot = { schemaVersion: 1, generatedAt: now, trends: {}, providers: [], models: [] };
  await store.saveSnapshot(snapshot, { lastGoodAt: now });
  const loaded = await store.load();
  assert.equal(loaded.facts.length, 1);
  assert.equal(loaded.snapshot.generatedAt, now);
  for (const name of ["facts.json", "last-good.json", "state.json", "sources.json"]) assert.equal(fs.existsSync(path.join(root, name)), true);
});

test("fact retention drops old derived facts but does not touch source files", () => {
  const now = Date.now();
  const kept = pruneFacts([{ id: "old", timestamp: now - 100 * 24 * 60 * 60 * 1000 }, { id: "new", timestamp: now }], now);
  assert.deepEqual(kept.map((item) => item.id), ["new"]);
});

test("generic json helpers reject prototype names and keep mapped names", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mud-store-name-"));
  const store = createStore(root);
  await store.writeJson("__proto__", { ok: true });
  assert.equal(fs.existsSync(path.join(root, "__proto__.json")), true);
  assert.deepEqual(await store.readJson("__proto__"), { ok: true });
  await store.writeJson("facts", { version: 1, facts: [] });
  assert.equal(fs.existsSync(path.join(root, "facts.json")), true);
});
