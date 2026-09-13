"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { discoverProviderCatalog } = require("../lib/provider-catalog");

const model = (providerId, providerName) => ({ providerId, providerName, modelId: "gpt-5-codex", label: "GPT-5 Codex" });
const fact = { providerId: "openai-codex", modelId: "gpt-5-codex" };

test("a unique current ChatGPT account owns legacy Codex ids", () => {
  const catalog = discoverProviderCatalog({ modelsList: [model("account-uuid", "OpenAI (ChatGPT Plus/Pro)")], facts: [fact] });
  assert.equal(catalog.codexProviderId, "account-uuid");
  assert.equal(catalog.providerAliases["openai-codex"], "account-uuid");
  assert.equal(catalog.providerAliases.openai, undefined);
  assert.deepEqual(catalog.providers.map((provider) => provider.id), ["account-uuid"]);
});

test("multiple ChatGPT accounts keep ambiguous legacy ids separate", () => {
  const catalog = discoverProviderCatalog({
    modelsList: [model("account-a", "OpenAI (ChatGPT Plus/Pro)"), model("account-b", "OpenAI Codex")],
    facts: [fact],
  });
  assert.equal(catalog.codexProviderId, null);
  assert.deepEqual(catalog.providerAliases, {});
  assert.deepEqual(catalog.providers.map((provider) => provider.id), ["account-a", "account-b", "openai-codex"]);
});

test("a similarly named gateway is not treated as an official account", () => {
  const catalog = discoverProviderCatalog({ modelsList: [model("relay", "My ChatGPT Relay")], facts: [fact] });
  assert.equal(catalog.codexProviderId, null);
  assert.deepEqual(new Set(catalog.providers.map((provider) => provider.id)), new Set(["openai-codex", "relay"]));
});
