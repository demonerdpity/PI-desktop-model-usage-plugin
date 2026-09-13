"use strict";

const { scalarText } = require("./domain");
const { CODEX_PROVIDER_ALIASES } = require("./adapters/codex-quota");

// `openai` may be an API-key provider; only subscription-specific legacy ids
// are safe to move onto a ChatGPT account.
const LEGACY_CODEX_IDS = new Set(CODEX_PROVIDER_ALIASES.map((value) => value.toLowerCase()).filter((value) => value !== "openai"));

function isCodexSubscriptionProvider(provider) {
  const label = String(provider?.label || "").toLowerCase();
  return label.startsWith("openai (chatgpt") || label.startsWith("openai codex");
}

function normalizeModelInfo(input) {
  if (!input || typeof input !== "object") return null;
  const providerId = scalarText(input.providerId, 160);
  const modelId = scalarText(input.modelId, 240);
  if (!providerId || !modelId) return null;
  return {
    providerId,
    providerName: scalarText(input.providerName, 160, providerId),
    modelId,
    label: scalarText(input.label, 240, modelId),
  };
}

/**
 * Merge the host's safe models.list display information with historical ids in
 * local facts. No auth kind, endpoint, credential, account, or quota is inferred.
 */
function discoverProviderCatalog({ modelsList = [], facts = [] } = {}) {
  const providers = new Map();
  const models = new Map();
  const ensureProvider = (id, label = id) => {
    if (!providers.has(id)) providers.set(id, { id, label: label || id, models: new Map(), current: false });
    const entry = providers.get(id);
    if (label && (entry.label === id || !entry.label)) entry.label = label;
    return entry;
  };
  const ensureModel = (providerId, modelId, label = modelId) => {
    const key = `${providerId}\u0000${modelId}`;
    if (!models.has(key)) models.set(key, { providerId, modelId, label, current: false });
    const entry = models.get(key);
    if (label && (entry.label === modelId || !entry.label)) entry.label = label;
    ensureProvider(providerId).models.set(modelId, entry);
    return entry;
  };

  for (const raw of Array.isArray(modelsList) ? modelsList : []) {
    const item = normalizeModelInfo(raw);
    if (!item) continue;
    const provider = ensureProvider(item.providerId, item.providerName);
    provider.current = true;
    const model = ensureModel(item.providerId, item.modelId, item.label);
    model.current = true;
  }
  const codexProviders = [...providers.values()].filter(isCodexSubscriptionProvider);
  const codexProviderId = codexProviders.length === 1 ? codexProviders[0].id : null;
  const providerAliases = codexProviderId
    ? Object.fromEntries([...LEGACY_CODEX_IDS].map((id) => [id, codexProviderId]))
    : {};
  for (const fact of Array.isArray(facts) ? facts : []) {
    const rawProviderId = scalarText(fact?.providerId, 160, "unknown");
    const providerId = providerAliases[rawProviderId.toLowerCase()] || rawProviderId;
    const modelId = scalarText(fact?.modelId, 240, "unknown");
    ensureProvider(providerId);
    ensureModel(providerId, modelId);
  }

  const providerList = [...providers.values()]
    .map((entry) => ({
      id: entry.id,
      label: entry.label || entry.id,
      current: entry.current,
      models: [...entry.models.values()]
        .sort((left, right) => left.label.localeCompare(right.label) || left.modelId.localeCompare(right.modelId))
        .map((model) => ({
          id: model.modelId,
          label: model.label || model.modelId,
          current: model.current,
        })),
    }))
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  return {
    providers: providerList,
    modelLabels: Object.fromEntries(
      [...models.values()].map((entry) => [`${entry.providerId}\u0000${entry.modelId}`, entry.label || entry.modelId]),
    ),
    providerLabels: Object.fromEntries(providerList.map((entry) => [entry.id, entry.label])),
    providerAliases,
    codexProviderId,
  };
}

async function discoverFromHost(pi, facts = []) {
  let modelsList = [];
  let supported = true;
  try {
    if (!pi?.models?.list) throw new Error("models.list unavailable");
    modelsList = await pi.models.list();
  } catch {
    supported = false;
  }
  return { ...discoverProviderCatalog({ modelsList, facts }), supported };
}

module.exports = {
  discoverFromHost,
  discoverProviderCatalog,
  isCodexSubscriptionProvider,
  normalizeModelInfo,
};
