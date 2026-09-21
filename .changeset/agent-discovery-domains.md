---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

Skills, seats and channels now answer the agent discovery door and a seat narrows what it sees with its worker file's `discover:` key (FIX-817) — **breaking:** `createWorkforceCapability` no longer accepts `agents` (pass `roster` and `inventory`) or `catalog` (pass it to `defineAgentWorkerFlow({ catalog })` instead), each now a type error naming its replacement.
