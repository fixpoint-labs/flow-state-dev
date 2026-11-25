---
"@flow-state-dev/core": minor
---

Resource and collection handles now infer their state from the schema passed to the definition. A conditionally declared resource remains optional on `ctx.resources`. TypeScript may surface existing code that relied on a resource state being `any`. (FIX-2023)
