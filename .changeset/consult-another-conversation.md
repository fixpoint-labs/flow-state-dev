---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
---

A worker can answer a question from another of the user's conversations without waking it (FIX-2173).

- `requestHost.sessions.history(sessionId, { limit })` reads a session's finished turns, oldest first, with `asOf` and `running`. Like `sessions.read`, it answers only for the caller's own sessions; anything else reads as `undefined`.
- `utility.consultSessionHistoryTool()` (core) reads that history under a hard token budget (default 24,000) and answers on one tool-less generator, `intent/utility` by default. It returns a reading as of a time, and writes nothing to the other session.
- `consultSessionsCapability(installation)` (workforce) puts it on a worker's turns as `consultSessionHistory`, with `of` naming a worker, `{ task }` or `{ session }`. Its `consult` preset is off until a worker's `WORKER.md` names `consultSessions: [consult]`. Set `models: { default, intents: { utility: [...] } }` in `createFlowState` to pick the cheaper model.
