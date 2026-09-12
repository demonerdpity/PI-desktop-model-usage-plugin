(function () {
  "use strict";
  var key = "modelUsageDashboard.appearance.v1";
  var root = document.documentElement;
  root.dataset.booting = "true";

  function prefersLight() {
    try { return window.matchMedia("(prefers-color-scheme: light)").matches; } catch (_) { return false; }
  }
  function read() {
    try { var value = localStorage.getItem(key); return value ? JSON.parse(value) : null; } catch (_) { return null; }
  }
  function normalize(value) {
    var item = value || {};
    var base = item.base === "light" || item.base === "dark" ? item.base : prefersLight() ? "light" : "dark";
    var locale = String(item.locale || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
    root.dataset.theme = base;
    root.dataset.lang = locale;
    root.lang = locale === "zh" ? "zh-CN" : "en";
    if (item.pluginThemeCss) {
      var style = document.getElementById("pluginThemeCss") || document.createElement("style");
      style.id = "pluginThemeCss";
      style.textContent = String(item.pluginThemeCss).slice(0, 262144);
      if (!style.parentNode) document.head.appendChild(style);
    }
    return { base: base, locale: locale };
  }
  var cached = read();
  normalize(cached || {});
  window.__modelUsageBoot = { cacheKey: key, cached: cached, apply: normalize, prefersLight: prefersLight, themeTrail: [root.dataset.theme] };
})();
