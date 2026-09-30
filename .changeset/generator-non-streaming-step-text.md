---
"@flow-state-dev/core": patch
---

A text generator that runs without streaming now keeps the text it wrote before a tool call, returning the same text as the streamed turn (FIX-1628).
