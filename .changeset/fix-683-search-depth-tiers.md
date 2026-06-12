---
"@flow-state-dev/tools": patch
---

`tools.search` gains a normalized `tier` option (`fast` | `balanced` | `deep`) that maps to each provider's native depth knob, plus `includeDomains` / `excludeDomains` filters. Auto-selection now prefers a provider that meaningfully supports the requested tier, and the existing `searchMode` field acts as a provider-native override for behaviors the tier does not cover (such as Exa's `neural` or `deep-reasoning` types). Set `agentControlsTier: true` to expose `tier` as a tool parameter so the model picks the depth per query. The `balanced` default leaves existing behavior unchanged.
