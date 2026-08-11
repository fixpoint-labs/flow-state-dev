---
"@flow-state-dev/engine": patch
"@flow-state-dev/cli": patch
---

`fsdev run` and `fsdev chat` can now start background work, so a flow that hands a task to a workstream can be exercised from the terminal instead of only over HTTP (FIX-1077).

A command that starts background work without a queue stays open until that work finishes, up to a configurable limit.
