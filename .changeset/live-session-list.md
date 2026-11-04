---
"@flow-state-dev/engine": minor
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
---

A list of sessions stays current, and each row says whether its session needs you (FIX-2411).

- **engine:** every write to a session, and every request write except items, also publishes a `run` change notice on the owner's user topic, so a screen subscribed to `topic.user()` hears a session it doesn't list yet: created in another tab, by a script, or by `fsdev run`. `GET /sessions?include=status` adds `requestStatus` to each row: the status of the session's latest request, where one still running or waiting wins over a later one that ended. `include` takes a comma-separated list, so `include=dispatch-runs,status` combines both.
- **client:** `sessions.list({ include })` takes `"status"`, or an array of includes. `SessionSummary` gains an optional `requestStatus`.
- **react:** new `useSessionList({ flowKind | flowId, includeDispatchRuns?, includeStatus?, enabled?, client? })` reads a flow's sessions with their state, again on a `run` notice on the user's topic and when the page becomes visible. `FlowNavigator` reads its open leaves through it, so its session rows are live when the client passes `subscribe` (a narrowed client without it reads once per opening, as before), and each row draws a state mark (running, waiting on you, interrupted, failed, incomplete) and how long ago it changed. `sessionLabel`, `sessionRowState` and `sessionAge` are exported for a host that draws its own rows.
