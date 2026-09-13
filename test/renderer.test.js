"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("renderer combines quota and local metrics in one optional usage block", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer", "app.js"), "utf8");
  assert.doesNotMatch(source, /makeElement\("section", "quota-block"\)/);
  assert.match(source, /renderQuotaWindow\(quotaWindow, index, usageWindow\)/);
  assert.match(source, /usageWindowsFor\(channel\).*filter\(hasUsageWindowData\)/s);
  assert.match(source, /rootWindow\.pluginBridge\?\.invoke\?\.\("codex\.login"\)/);
  assert.match(source, /return block\.childNodes\.length > 1 \? block : null/);
  assert.match(source, /function renderResetCredits\(value\)[\s\S]*return badges\.childNodes\.length/);
  assert.doesNotMatch(source, /function renderResetCredits\(value\)[\s\S]*quotaResetCreditsNote/);
});
