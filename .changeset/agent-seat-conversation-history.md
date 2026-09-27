---
"@flow-state-dev/workforce": patch
---

A seat on the built-in `agent` kind now hands its model the earlier turns of its own conversation, up to the session's history window (the last 50 turns by default) and never another conversation's, so a follow-up keeps its subject (FIX-1612).
