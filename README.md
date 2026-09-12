# Model Usage Dashboard

`pi.model-usage-dashboard` is a local-first PI-Desktop plugin. Run **Model Usage Dashboard: Open** from the command palette to open a 1120×800 panel. The command opens the panel first and refreshes in the background; repeated invocations share the same refresh promise. Startup warming never opens a panel.

## What is counted

The first release reads only `~/.pi-desktop/sessions/*.jsonl` (the path is derived from `pi.plugin.getDataPath()` when the host provides its normal private-data layout). It accepts assistant records with `meta.usage` scalar token fields and keeps only:

- a hashed stable message id;
- timestamp, provider id, model id;
- non-negative scalar input/output/cache-read/cache-write/reasoning/total token values;
- a hashed source-file id.

Revision files (`*.revisions.jsonl`) are ignored. Duplicate stable ids are de-duplicated across files, and duplicate ids in a file use the last record. A replacement, truncation, deletion, or malformed tail is diagnosed without retaining the source line. Prompts, replies, thinking, tool arguments/results, attachments, project paths, complete session ids, credentials, and cookies are never written to the plugin cache or panel payload.

The cache lives below `pi.plugin.getDataPath()` as compact facts, source stamps, state, and a last-good snapshot. Writes use a temporary file followed by rename. Clearing or rebuilding this derived cache never deletes PI-Desktop sessions. Facts are retained for 90 days and derived daily history for one year.

## Capabilities and limits

| Source/channel | Requests, tokens, models, trends | API-equivalent estimate | Real bill, quota, reset |
|---|---:|---:|---:|
| PI-Desktop local records, every provider id | Yes | Exact aliases in the bundled official price snapshot | Not available in the public plugin API |
| OpenAI / Anthropic / Gemini | Yes when present in local records | Known exact model aliases only | Not queried |
| OpenRouter / New API / Sub2API / 帅 API | Yes when present in local records, kept separate by provider id | Only an exact official alias; no guessed relay price | Remote balance waits for a host credential broker |
| ChatGPT / Claude OAuth or subscription records | Local usage only | Labelled **API-equivalent estimate**, never a subscription bill | Hidden unless a future host adapter returns a real value |

`models.list` is used only for the host's enabled provider/model display catalogue. The SDK validator in the temporary official PI-Desktop checkout accepts `models.list`; no unsupported manifest permission is declared. The current host does not expose a safe quota/billing credential broker or public `stats.getTokenUsageHistory` plugin API, so quota, balance, reset, and real billing fields are omitted rather than guessed. `lib/adapters/host-stats.js` keeps a compatibility seam for that future API and currently returns `UNSUPPORTED`.

Prices are a versioned offline snapshot in `lib/pricing.js`, with source URL and retrieval date. Matching is exact after case normalization; unknown/custom model names do not show `$0`. Coverage is the priced token amount divided by the observed token amount, and all estimates say **API equivalent**.

## Permissions and privacy

The manifest requests only `ui.panel` and `models.list`. The runtime intentionally uses the raw Node file APIs available to current PI-Desktop plugin processes to read the one documented session directory and to use `getDataPath()` for private derived data; this is transparent because the current host does not yet expose the needed home-session read through the plugin SDK. No network request, secret setting, browser cookie, private web endpoint, shell, IPC, SQLite database, provider configuration, or credential is accessed.

The panel has no Node access and reads only `plugin.getSettings` through `window.pluginBridge`. Its refresh button reloads the latest published settings snapshot; it does **not** trigger a scan. Run the command again when an immediate scan is needed.

## Development

This plugin deliberately has no runtime dependencies or build step. Run:

```text
npm test
```

Tests use the built-in `node:test` runner and anonymized fixtures under `fixtures/`. The official PI-Desktop devkit can additionally be used with `pnpm pi-plugin check .` and `pnpm pi-plugin pack .` from the PI-Desktop checkout.
