# Changelog

## 0.2.2

- Published the network permission update in the distributable package, including the ChatGPT quota endpoint and mainstream provider API domains.

## 0.2.1

- Split cards into strict subscription quota and API/local usage sections.
- Added provider-isolated rolling 5-hour, rolling 7-day, and retained-total local usage rows with requests, tokens, and exact-match API-equivalent cost estimates.
- Hid subscription-unavailable messaging from ordinary API channels while keeping it on explicitly identified ChatGPT/OAuth subscription channels.
- Added Cockpit-compatible `spend_control.individual_limit` and legacy `credits` total-allowance parsing without retaining raw provider responses.
- Clarified that Cockpit Tools does not expose ChatGPT 5h/Weekly quotas for ordinary API keys; provider totals require provider-specific usage endpoints and credentials.

## 0.2.0

- Replaced the token/trend-led dashboard with compact provider and account cards centered on verified quota windows.
- Added a normalized multi-window quota contract with account, plan, used/remaining percentage, and reset metadata.
- Added a credential-free parser for Cockpit Tools-compatible Codex `wham/usage` responses, while refusing Cockpit's synthetic 100% fallback for missing windows.
- Kept local requests, tokens, and API-equivalent costs as secondary card metadata; unsupported quota sources remain explicitly unavailable.
- Documented why the current PI-Desktop plugin API cannot safely fetch authenticated Codex quota data without a host-owned credential broker.
- Fixed asynchronous changed-file scans so removed session records cannot survive in derived usage totals.

## 0.1.0

- Added the `pi.model-usage-dashboard` PI-Desktop plugin and `modelUsageDashboard.open` command.
- Added privacy-preserving PI-Desktop session scanning, stable de-duplication, provider/model aggregation, 7/30/90-day trends, and exact official API price estimates.
- Added atomic private cache, last-good snapshots, stale diagnostics, debounced source watching, and an accessible v3 panel.
- Hardened the renderer: a cost figure is read only from the selected 7/30/90-day window, and a cost trend falls back to tokens when that window has no priced tokens, so no window inherits another window's amount and no fabricated zero-cost line is drawn.
- Hardened the private cache: the generic `writeJson`/`readJson` helpers no longer resolve names such as `__proto__` or `constructor` through the object prototype.
- Hardened the scanner: a session file whose read fails stores no reuse stamp, so the next scan rebuilds that source instead of trusting a partially reused fact set.
- Hardened startup: an empty host data path no longer resolves the scanner root against the process working directory.
