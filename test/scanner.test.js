"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listSessionFiles, parseAssistantRecord, scanSessionDirectory, scanSessionDirectoryAsync } = require("../lib/scanner");

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "mud-scan-")); }
function line(record) { return `${JSON.stringify(record)}\n`; }
function assistant(id, input, createdAt = "2026-01-02T10:00:00.000Z") {
  return { type: "message", id, role: "assistant", createdAt, meta: { providerId: "openai", modelId: "gpt-4o-mini", usage: { input, output: 2, total: input + 2 } }, text: "PRIVATE_FIXTURE_TEXT" };
}

test("scanner filters revisions, keeps last in file, and de-duplicates forks", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "a.jsonl"), line(assistant("same", 1)) + line(assistant("same", 9)) + line({ type: "message", id: "user", role: "user", meta: { usage: { input: 50 } } }));
  fs.writeFileSync(path.join(root, "b.jsonl"), line(assistant("same", 12)) + line(assistant("other", 4)));
  fs.writeFileSync(path.join(root, "fork.revisions.jsonl"), line(assistant("revision", 100)));
  fs.writeFileSync(path.join(root, "tail.jsonl"), "{\"type\":\"message\"");
  assert.equal(listSessionFiles(root).some((file) => file.includes("revisions")), false);
  const result = scanSessionDirectory(root);
  assert.equal(result.facts.length, 2);
  assert.equal(result.facts.some((fact) => fact.tokens.input === 12), true);
  assert.equal(result.facts.some((fact) => fact.tokens.input === 9), false);
  assert.equal(result.diagnostics.truncatedLines, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE_FIXTURE_TEXT"), false);
});

test("parseAssistantRecord returns only whitelisted data", () => {
  const fact = parseAssistantRecord({ role: "assistant", createdAt: "2026-01-01T00:00:00Z", meta: { providerId: "p", modelId: "m", usage: { input: 1 }, prompt: "secret" }, content: "secret" }, "C:\\private\\session.jsonl");
  assert.equal(fact.tokens.input, 1);
  assert.equal(Object.hasOwn(fact, "content"), false);
  assert.equal(fact.sourceFileId.includes("private"), false);
});

test("changed and deleted sources rebuild without old facts", () => {
  const root = tempDir();
  const file = path.join(root, "one.jsonl");
  fs.writeFileSync(file, line(assistant("first", 1)));
  const first = scanSessionDirectory(root);
  assert.equal(first.facts.length, 1);
  fs.writeFileSync(file, line(assistant("second", 2)));
  const second = scanSessionDirectory(root, { previous: first.sourceState });
  assert.equal(second.facts.length, 1);
  assert.equal(second.facts[0].tokens.input, 2);
  fs.rmSync(file);
  const third = scanSessionDirectory(root, { previous: second.sourceState });
  assert.equal(third.facts.length, 0);
});

test("async runtime scanner streams lines and preserves privacy diagnostics", async () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "stream.jsonl"), line(assistant("one", 3)) + line(assistant("two", 5)) + "{\"role\":\"assistant\"");
  const result = await scanSessionDirectoryAsync(root);
  assert.equal(result.facts.length, 2);
  assert.equal(result.diagnostics.truncatedLines, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE_FIXTURE_TEXT"), false);
});

test("async changed sources rebuild from scratch without deleted facts", async () => {
  const root = tempDir();
  const file = path.join(root, "async.jsonl");
  fs.writeFileSync(file, line(assistant("kept-before", 1)) + line(assistant("removed", 2)));
  const first = await scanSessionDirectoryAsync(root);
  assert.equal(first.facts.length, 2);

  fs.writeFileSync(file, line(assistant("kept-after", 3)));
  const second = await scanSessionDirectoryAsync(root, { previous: first.sourceState });
  assert.equal(second.facts.length, 1);
  assert.equal(second.facts[0].tokens.input, 3);
  assert.equal(second.facts.some((fact) => fact.tokens.input === 1 || fact.tokens.input === 2), false);
});
