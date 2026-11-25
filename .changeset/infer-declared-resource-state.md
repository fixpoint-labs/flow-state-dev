---
"@flow-state-dev/core": minor
---

Resource and collection handles now infer their state from the schema passed to the definition. A conditionally declared resource remains optional when read by property on `ctx.resources`. The registry’s `get` method returns the typed handle or throws when the resource is absent. TypeScript may surface existing code that relied on a resource state being `any`. (FIX-2023)
