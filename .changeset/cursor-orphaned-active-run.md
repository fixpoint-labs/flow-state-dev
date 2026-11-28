---
"@flow-state-dev/cursor": patch
---

A Cursor turn no longer fails with "already has active run" after the server restarts mid-run (FIX-2987). A run cut off by a restart used to stay recorded as running in Cursor's local store, so every later turn on that agent was refused. The block now cancels that leftover run and sends the turn once more, and a second turn on an agent this server is already running waits for that run to end. A client you supply through `resolveCursorClient` can offer the same recovery with the new optional `releaseActiveRun()` on `CursorAgentLike`; without it, the turn fails once, saying the agent still has a run in progress.

Docs: packages/cursor/README.md (wherever `resolveCursorClient` and the client seam are described)
