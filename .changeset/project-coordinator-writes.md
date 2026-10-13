---
"@flow-state-dev/workforce": patch
---

A project's coordinator can now manage its own project: `defineProjectBlocks()` adds `setBrief`, and `setBrief` and `setRepository` take an optional `project` that defaults to the conversation's linked project (FIX-1900).
