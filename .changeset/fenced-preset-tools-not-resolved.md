---
"@flow-state-dev/core": patch
---

A generator no longer calls a capability preset's function-valued `tools` when it would drop the result: behind a declared `tools:` list, or while it assembles context from a capability added through a dynamic `uses` entry (FIX-1459).
