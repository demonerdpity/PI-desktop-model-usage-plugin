"use strict";
// Preview-only stub. It stands in for the PI-Desktop host bridge so the real
// renderer can be measured outside the app. Never shipped: deleted before commit.
window.pluginBridge = {
  invoke: async (method) => {
    if (method === "plugin.getSettings") return window.__PREVIEW_PAYLOAD;
    if (method === "plugin.setSettings") return { ok: true };
    return null;
  },
};
