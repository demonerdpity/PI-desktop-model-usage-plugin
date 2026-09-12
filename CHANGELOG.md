# Changelog

## 0.1.0

- Added the `pi.model-usage-dashboard` PI-Desktop plugin and `modelUsageDashboard.open` command.
- Added privacy-preserving PI-Desktop session scanning, stable de-duplication, provider/model aggregation, 7/30/90-day trends, and exact official API price estimates.
- Added atomic private cache, last-good snapshots, stale diagnostics, debounced source watching, and an accessible v3 panel.
- Hardened the renderer: a cost figure is read only from the selected 7/30/90-day window, and a cost trend falls back to tokens when that window has no priced tokens, so no window inherits another window's amount and no fabricated zero-cost line is drawn.
- Hardened the private cache: the generic `writeJson`/`readJson` helpers no longer resolve names such as `__proto__` or `constructor` through the object prototype.
- Hardened the scanner: a session file whose read fails stores no reuse stamp, so the next scan rebuilds that source instead of trusting a partially reused fact set.
- Hardened startup: an empty host data path no longer resolves the scanner root against the process working directory.
