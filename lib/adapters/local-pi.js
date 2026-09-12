"use strict";

const path = require("node:path");
const { scanSessionDirectoryAsync, listSessionFiles } = require("../scanner");

const CAPABILITIES = Object.freeze({
  requests: true,
  tokens: true,
  history: true,
  cost: "estimate-only",
  quota: false,
  reset: false,
});

function sessionRootFromHostRoot(hostRoot) {
  return path.join(path.resolve(String(hostRoot || "")), "sessions");
}

function createLocalPiAdapter({ root, hostRoot, clock = () => Date.now() } = {}) {
  const sessionRoot = root || sessionRootFromHostRoot(hostRoot);
  return {
    id: "pi-desktop",
    label: "PI-Desktop local sessions",
    async discover() {
      return {
        id: "pi-desktop",
        root: sessionRoot,
        files: listSessionFiles(sessionRoot).length,
        capabilities: { ...CAPABILITIES },
      };
    },
    async scan({ previous, onProgress } = {}) {
      const result = await scanSessionDirectoryAsync(sessionRoot, { previous, onProgress });
      return {
        ...result,
        sourceId: "pi-desktop",
        collectedAt: clock(),
      };
    },
    getCapabilities() {
      return { ...CAPABILITIES };
    },
    getProvenance() {
      return {
        sourceType: "pi-desktop-local-session-usage",
        estimated: false,
        note: "Assistant meta.usage scalar fields from ~/.pi-desktop/sessions/*.jsonl; revision files excluded.",
      };
    },
  };
}

module.exports = {
  CAPABILITIES,
  createLocalPiAdapter,
  sessionRootFromHostRoot,
};
