---
"@flow-state-dev/core": patch
---

A text generator that runs without streaming (its model implements `generateStep` but not `streamStep`) now keeps the text it wrote before a tool call. A turn that writes text, calls a tool, then writes more returns every step's text joined with a blank line, the same text the turn returns when it streams. Before, it returned only the text written after the last tool call. Structured-output generators still answer from the final step (FIX-1628).
