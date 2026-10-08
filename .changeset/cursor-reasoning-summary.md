---
"@flow-state-dev/cursor": patch
---

Cursor reasoning items now carry their text in `summary` as `reasoning_text` parts, the shape the `ReasoningItem` contract declares, so reasoning renderers display them instead of throwing (FIX-1703). Message items are unchanged.
