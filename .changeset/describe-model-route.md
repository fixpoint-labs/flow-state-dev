---
"@flow-state-dev/core": patch
"@flow-state-dev/workforce": patch
---

A picker can show where a model's calls would go, and save one setting of a worker without seeing the rest (FIX-2865).

- **core:** `describeModelRoute(modelString, env?)`, from `@flow-state-dev/core/models`, says where a model string would go with no resolver configuration: `{ available: true, via }` naming a provider's own key, Vercel AI Gateway or OpenRouter, or `{ available: false, reason }` (for example "no key or gateway for xai", or "OPENROUTER_API_KEY is not set" for an `openrouter:` route). It reads env names only and never returns a key. An intent, or a named route that isn't a known gateway, reports its name, since the app's resolver decides it.
- **workforce:** the roster's `edit` (and `WorkforceClient.edit`) takes `settingsPatch`: the settings it names are set over the stored ones and the rest are kept. Use it when an app sees only its `showSettings` and changes one, such as a worker's `model`; `settings` still replaces them whole. Giving both is refused.

Docs: packages/core/README.md (models: `describeModelRoute`), packages/workforce/README.md (editing a worker: `settingsPatch`)
