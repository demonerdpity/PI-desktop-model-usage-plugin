# Model Usage Dashboard

`pi.model-usage-dashboard` is a local-first PI-Desktop plugin. Run **Model Usage Dashboard: Open** from the command palette to open a 1120×800 panel. The command opens the panel immediately with the last-good snapshot and refreshes local usage in the background; repeated invocations share one refresh promise. Startup warming never opens a panel.

## Channel-first cards

Each card has two deliberately separate sections:

- **Subscription quota** accepts only verified provider windows such as `5h` and `Weekly`, with remaining percentage and reset time. Incomplete windows never render. Explicitly identified ChatGPT/OAuth subscription channels explain when secure quota authorization is not connected; ordinary API channels do not show this warning.
- **API / local usage** reports provider-isolated usage observed in PI-Desktop sessions for a rolling 5-hour window, rolling 7-day `Weekly` window, and the retained total (currently 90 days). It shows requests, tokens, and exact-match API-equivalent cost estimates, but never labels this local subset as provider quota or account billing.

## Cockpit Tools compatibility

The implementation follows Cockpit Tools' actual distinction rather than treating every channel alike:

- ChatGPT Plus/Pro/Codex OAuth subscription quota comes from authenticated `GET https://chatgpt.com/backend-api/wham/usage`. `rate_limit.primary_window` and `secondary_window` provide `used_percent`, duration, and reset fields. The card displays the derived remaining percentage.
- Optional total allowance comes from `spend_control.individual_limit` or legacy `credits` in the same sanitized response. Only total, used, remaining, remaining percentage, and reset metadata are retained.
- Ordinary OpenAI-compatible API keys do **not** receive ChatGPT `5h/Weekly` quota rows in Cockpit Tools. Cockpit instead queries provider-specific usage/balance endpoints for New-API, Sub2API, DeepSeek, MiniMax, Zhipu/BigModel/Z.AI, and its own Cockpit API service. Those calls require the corresponding API key.
- The request/token/cost badges beside Cockpit quota windows are local window statistics, not values returned by ChatGPT's subscription quota endpoint.

`lib/adapters/codex-quota.js` implements the credential-free normalization for the successful Codex usage response. It does not perform authentication, retain the raw response, or convert missing windows to 100% remaining.

PI-Desktop exposes authenticated model display information through `models.list`, but does not expose provider keys or OAuth tokens through the plugin API. When a local Codex credential file is available, the plugin reads only the access token needed for the read-only `chatgpt.com/backend-api/wham/usage` request; the token is never written to snapshots, settings, logs, or error text. The request uses the host-audited `pi.net.fetch` path and is limited by the manifest allowlist. If the credential or host network API is unavailable, the card remains visible and reports the reason instead of blocking local usage.

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
| Codex `wham/usage` response | Read-only subscription windows when Codex credentials and host network access are available | Yes, when present locally | Exact bundled aliases only |
| OpenAI-compatible relays | Adapter-specific response required | Yes, kept separate by provider id | Never guesses relay pricing |

Prices are a versioned offline snapshot in `lib/pricing.js`, with source URL and retrieval date. Matching is exact after case normalization; unknown/custom model names do not show `$0`. All displayed costs are marked as API-equivalent estimates.

## Permissions and privacy

The manifest requests `ui.panel`, `models.list`, and `net.fetch`. Network access is restricted to the declared provider domains, including ChatGPT, OpenAI, Anthropic, Gemini, Groq, OpenRouter, DeepSeek, Mistral, xAI, Together, Fireworks, Cohere, and Perplexity. The plugin does not read browser cookies, PI-Desktop private storage, API keys, or provider configuration. The renderer has no Node access and uses only supported `window.pluginBridge` methods; missing bridge methods do not crash the page.

The refresh button reloads the latest published settings snapshot; it does not trigger a scan. Run the command again when an immediate scan is needed.

## Development

This plugin has no runtime dependencies or build step. Run:

```text
npm test
```

Tests use Node's built-in test runner and anonymized fixtures. Validate locally with `npm test`, `node --check main.js`, `node --check renderer/app.js`, and `git diff --check`. For marketplace submission, copy this plugin under `plugins/pi.model-usage-dashboard` in the official `vastsa/pi-desktop-plugins` repository, run `python3 scripts/pack_plugin.py plugins/pi.model-usage-dashboard`, run `python3 scripts/security_audit.py --check-packages`, then run `python3 scripts/rebuild_catalog.py` and submit the resulting source, package, and catalog changes as a pull request.
