---
"@flow-state-dev/core": patch
---

A gateway key alone is enough: `@flow-state-dev/core` now depends on `@ai-sdk/gateway` and `@openrouter/ai-sdk-provider`, so setting `AI_GATEWAY_API_KEY` or `OPENROUTER_API_KEY` routes models through that gateway without the app installing its package. Before, the key turned the gateway on but every reply failed with `Gateway package "…" is not installed` (FIX-2868). An app that already installs either package keeps working; it can drop the dependency.

Docs: apps/docs/docs/getting-started/setting-up-models.md (the provider table's install column for the two gateways), apps/docs/docs/configuration/environment.md (gateway package column), apps/docs/docs/workforce/overview.md (no package to install for the Vercel AI Gateway), apps/docs/docs/fundamentals/models.md (the OpenRouter peer-support note is stale: 3.x declares `ai@7`)
