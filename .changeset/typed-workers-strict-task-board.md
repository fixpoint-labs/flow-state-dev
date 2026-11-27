---
"@flow-state-dev/orchestration": patch
---

A worker block with a typed payload or output now goes into `taskBoard({ workers })`, and into `defaultWorker`, in an app compiled with `strict: true` (FIX-2732). Before, every such worker was refused with TS2322 and needed a cast. Types only; the board behaves the same. A value that is not a block is still refused.

Docs: apps/docs/docs/build/research-team.md (drop the `as TaskAssigneeRegistry` cast on `workers` and the sentence explaining it; the example now compiles under `strict` without it)
