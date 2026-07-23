---
"@flow-state-dev/orchestration": patch
---

Delegation surface now materializes its board once per generator turn instead of once per tool-loop step: an unchanged agent roster reuses the built task tools, board workers, and roster text across steps, rebuilding only when the resolved source list actually changes. A skill disabled mid-turn is still dropped from both the tools and the roster on every activation path (including bundled runtime activations).
