---
"@flow-state-dev/memory": minor
---

Add `createMemoryCapability(options)` — a standalone factory for the composed memory capability, extracted from `system()`. Reach for it when a flow only consumes memory (context injection, the recall tool, typed helpers) and doesn't need the write-side capture, consolidation, prune, and hygiene pipeline. It returns the capability with `sessionResources`, `userResources`, `tiers`, and `recallToolBlock` attached, so the same resource references register at the flow level. `system()` now builds this capability internally and is unchanged for existing callers.
