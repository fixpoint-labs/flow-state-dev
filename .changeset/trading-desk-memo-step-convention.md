---
---

Internal-only refactor of the private `@flow-state-dev/trading-desk` example.
Collapse the three memo-lifecycle idioms (inline `stages.ts` assembly,
`defineAnalyst`, `defineLensStep`) into one key-driven `defineMemoStep(body,
{ key, commit })` apparatus, with the two recipes as thin wrappers and memo
identity (`agentTeam` / `phaseId` / `errorMessageFallback` / `errorPlaceholder`)
consolidated onto the registry entries. Behavior-preserving — the block graph,
prompts, schemas, commit projections, and runtime output are byte-identical.
No publishable package surface changes.
