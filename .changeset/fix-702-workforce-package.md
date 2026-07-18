---
"@flow-state-dev/workforce": minor
"@flow-state-dev/core": patch
"@flow-state-dev/orchestration": patch
---

Add `@flow-state-dev/workforce` package: agent registry, persona resolution, and materialization. Agents are named, reusable participants composed of a persona, model, and tools — register them once, reference from pattern skills via `agent-ref`, or compose as standalone blocks. Core gains `resolveResourceByPath` and updated agent type contracts; skills gains the `materializeAgent` injection seam to resolve `agent-ref` workers.
