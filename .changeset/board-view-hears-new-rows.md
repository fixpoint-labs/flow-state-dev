---
"@flow-state-dev/engine": patch
"@flow-state-dev/orchestration": patch
---

A task board's view now shows a row filed from a session it hadn't seen yet, and an org board's view no longer names other members' sessions (FIX-2625).

- **orchestration:** every row added to a resource-backed task board publishes a board notice on the board's own scope topic (the session's, the user's or the org's). A board view hears it, so a row filed from another session or by another member shows without a reload. On the user topic the notice names no task.
- **engine:** a view that reads an org-scope task board hears the org topic only: the board's notices for added rows, and its ledger's own change notices. Its answer's `topics` and `hears` no longer name the sessions rows were filed from. A session- or user-scope board still hears the sessions its rows were filed from, and now also the board's notices for added rows on its scope topic.

Docs: apps/docs/guides/realtime.md (what a board view hears, by its ledger's scope)
