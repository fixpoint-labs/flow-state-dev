---
"@flow-state-dev/devtool": patch
---

The DevTool reads a status item's side-chain count from `sideChainTasks` only and no longer falls back to the old `backgroundTasks` field, so a count-only status row stored under the old name no longer appears in the trace (FIX-2707).

Docs: none. The old shape is removed outright.
