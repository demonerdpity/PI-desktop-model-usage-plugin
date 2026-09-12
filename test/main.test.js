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
