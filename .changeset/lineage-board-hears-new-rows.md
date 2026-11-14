---
"@flow-state-dev/engine": patch
---

A view of a session task board shared to its lineage (`sharedToLineage`) now shows a row another session in the lineage files after the view opened (FIX-2733).

- **engine:** on a host with a view, a row added to a lineage-shared session board also publishes a board notice on the session owner's user topic, narrowed to the board and naming no task, where a lineage-shared resource's write already publishes. A view of such a board hears `board` notices on that topic, so its answer's `topics` and `hears` include the user topic. A session board not shared to its lineage publishes on the running session only, as before.

Docs: apps/docs/guides/realtime.md (what a board view hears, by its ledger's scope)
