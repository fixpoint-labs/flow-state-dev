---
"@flow-state-dev/cursor": patch
---

A Cursor run's handle `usage.inputTokens` now counts the prompt tokens the cache read and wrote, so it matches the run's reported spend and cost. `cursorUsage` still carries the raw counters (FIX-2940).
