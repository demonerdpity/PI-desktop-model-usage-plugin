"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("manifest has the independent command, panel size, and only supported permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  assert.equal(manifest.id, "pi.model-usage-dashboard");
  assert.equal(manifest.ui.width, 1120);
  assert.equal(manifest.ui.height, 800);
  assert.equal(manifest.contributes.commands[0].id, "modelUsageDashboard.open");
  assert.deepEqual(manifest.permissions, ["ui.panel", "models.list", "net.fetch"]);
  assert.deepEqual(manifest.net.domains, ["chatgpt.com"]);
  assert.ok(manifest.activationEvents.includes("onStartup"));
});
