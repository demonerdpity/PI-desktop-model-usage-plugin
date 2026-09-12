# Model Usage Dashboard

`pi.model-usage-dashboard` is a local-first PI-Desktop plugin. Run **Model Usage Dashboard: Open** from the command palette to open a 1120×800 panel. The command opens the panel immediately with the last-good snapshot and refreshes local usage in the background; repeated invocations share one refresh promise. Startup warming never opens a panel.

## Channel-first cards

The primary interface is a compact provider/channel card list inspired by the Codex page in Cockpit Tools. A card can show an account label, plan, verified quota windows such as `5h` and `Weekly`, used/remaining percentages, and reset time. Requests, tokens, and API-equivalent cost estimates are secondary card metadata.

Quota fields are never inferred from token history. A channel without a verified provider response says that its quota interface is unavailable; it never receives a synthetic `0%`, `100%`, `5h`, `Weekly`, or reset value.

## Codex quota compatibility

`lib/adapters/codex-quota.js` implements a credential-free parser for the successful response shape used by Cockpit Tools at `GET https://chatgpt.com/backend-api/wham/usage`:

- `rate_limit.primary_window` becomes the short/session window;
- `rate_limit.secondary_window` becomes the weekly window;
- `used_percent` is retained and the corresponding remaining percentage is derived;
- `reset_at` or `reset_after_seconds` becomes the reset time;
- `plan_type` becomes the card plan.

The parser deliberately does not perform authentication, retain the raw response, or accept missing windows as 100% remaining. Cockpit Tools can call this private web endpoint because it manages Codex OAuth access and refresh tokens. PI-Desktop currently exposes authenticated model names to plugins through `models.list`, but explicitly does not expose keys, credentials, or an authenticated provider-request proxy. Its own data directory is also protected from plugin file access.

For that reason this marketplace-safe build does not read Codex `auth.json`, browser cookies, PI-Desktop provider storage, OAuth tokens, or API keys, and it does not request `net.fetch`. Real Codex quota cards can be activated when PI-Desktop provides a host-owned quota API or credential-handle proxy that returns only normalized quota data to the plugin.

## Local usage source

The plugin reads only `~/.pi-desktop/sessions/*.jsonl` (derived from `pi.plugin.getDataPath()` when the host provides its normal private-data layout). It accepts assistant records with `meta.usage` scalar token fields and keeps only:

- a hashed stable message id;
- timestamp, provider id, model id;
- non-negative scalar input/output/cache-read/cache-write/reasoning/total token values;
- a hashed source-file id.

Revision files (`*.revisions.jsonl`) are ignored. Duplicate stable ids are de-duplicated across files, and duplicate ids in a file use the last record. A replacement, truncation, deletion, or malformed tail is diagnosed without retaining the source line. Prompts, replies, thinking, tool arguments/results, attachments, project paths, complete session ids, credentials, and cookies are never written to the plugin cache or panel payload.

The cache lives below `pi.plugin.getDataPath()` as compact facts, source stamps, state, and a last-good snapshot. Writes use a temporary file followed by rename. Clearing or rebuilding this derived cache never deletes PI-Desktop sessions. Facts are retained for 90 days and derived daily history for one year.

## Capability matrix

| Source/channel | Verified quota windows | Secondary local usage | API-equivalent estimate |
|---|---:|---:|---:|
| PI-Desktop provider ids | Unavailable in the current public plugin API | Yes, when present in local session records | Exact bundled aliases only |
| Codex `wham/usage` response | Parser implemented; transport awaits a host credential broker | Yes, when present locally | Exact bundled aliases only |
| OpenAI-compatible relays | Adapter-specific response required | Yes, kept separate by provider id | Never guesses relay pricing |

Prices are a versioned offline snapshot in `lib/pricing.js`, with source URL and retrieval date. Matching is exact after case normalization; unknown/custom model names do not show `$0`. All displayed costs are marked as API-equivalent estimates.

## Permissions and privacy

The manifest requests only `ui.panel` and `models.list`. No network request, secret setting, browser cookie, private web endpoint, shell, arbitrary IPC, provider configuration, or credential is accessed. The renderer has no Node access and uses only supported `window.pluginBridge` methods; missing bridge methods do not crash the page.

The refresh button reloads the latest published settings snapshot; it does not trigger a scan. Run the command again when an immediate scan is needed.

## Development

This plugin has no runtime dependencies or build step. Run:

```text
npm test
```

Tests use Node's built-in test runner and anonymized fixtures. Validate and package with the official PI-Desktop `PluginCheck` and `PluginPack` tools.
