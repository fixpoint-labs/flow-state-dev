---
"@flow-state-dev/memory": minor
---

Install memory as a kit with `memory(config)` from `@flow-state-dev/memory/kit` (FIX-2816). Fill `memory.slots.flows` with plain-flow builders; each receives the one built memory system, including its scoped resources, capability, capture pipeline, digest, and hygiene blocks. Existing `system()` and `createMemoryCapability()` entry points are unchanged.

Docs: `packages/memory/README.md` and the Memory guide should show the kit install and the `memory.slots.flows` builder pattern.
