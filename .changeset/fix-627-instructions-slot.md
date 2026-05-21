---
"@flow-state-dev/core": minor
"@flow-state-dev/patterns": patch
---

Export `InstructionsSlot<TInput>` from `@flow-state-dev/core` alongside `ToolsSlot` and `UsesSlot`. Pattern factories (`supervisor`, `planAndExecute`, `routedSpecialists`, `roundRobin`, `debate`, default judge) now share this single type instead of six near-identical local redeclarations, and parameterizing it lets the `instructions` callback see the pattern's typed input rather than `any`.
