---
"@flow-state-dev/core": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/orchestration": patch
---

agent-ref delegation workers carrying `taskTools` now fan out onto the active drain board instead of failing with `no_delegation_board`.

A delegation skill can staff a fan-out worker either inline (its prompt written directly in the `agents:` block) or by pointing at a registered agent by name (`agent-ref`). Only the inline path handed the worker the board-scoped `taskTools` bound to the active drain board; the `agent-ref` path dropped it and the worker resolved the process-wide singleton, so mid-drain `addTask(...)` calls failed with `no_delegation_board`. The board-bound capability now threads through `MaterializeAgentOptions.boardTaskTools` (core) → `materializeAgent` (workforce, preferring it over the singleton) → the `agent-ref` branch of `materializeWorker` (orchestration), so both declaration styles resolve `taskTools` identically. No authoring surface changes.
