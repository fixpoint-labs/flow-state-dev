---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
---

A worker session is born with the names a reader calls it by (FIX-2881).

- **A create check can fill in fields.** `session.createCheck` may answer `{ ok: true, state }`: the fields it derived from what it read, written over the session's initial state as it is created, on every path that creates a session. A check that returns them should refuse a create that seeds them.
- **Worker sessions carry `workerName` and `taskTitle`.** The workforce installation's create check writes the worker's display name (a hired worker's roster name, or a standard worker's file `name:`) into readonly `workerName`. A task's session also carries `taskTitle`, the task's title (else its goal), written when the board hands the task over. A create that sets either is refused.
- **The session label uses them**, so the developer tool's flow tree shows "Tess · Audit licenses" for a hired worker's task session instead of its ids. A session created before this falls back as before.

Docs: none beyond the API reference for `session.createCheck` (its result may carry `state`).
