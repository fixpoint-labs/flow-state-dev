---
"@flow-state-dev/workforce": minor
---

The roster and the conversation board are views (FIX-2623).

- **workforce:** the roster flow declares a `roster` view at user scope, keyed by worker id. `rosterView` is the client's handle: `useView(rosterView)` in React, or `client.view(rosterView)`, answers the user's roster with no session. `createWorkforceClient`'s `roster()` and `watchRoster` read it, so reading the roster no longer finds or creates a roster session; hiring, forking, editing and firing still run on one. `watchRoster` follows the topics the view's answer names.
- **workforce, breaking for a custom host:** `WorkforceClientSource` no longer takes `live`; it takes the client's `view` and `subscribe`. It is now `Pick<Client, "userId" | "flow" | "sessions" | "resources" | "view" | "subscribe">`. A host that passes `createWorkforceClient` a whole `Client` changes nothing. A host that builds the source by hand fails to compile until it passes `view` (runs a view: `client.view`) and `subscribe` (the push subscription: `client.subscribe`), and it can drop `live`.
- **workforce:** a coordinator's and an agent worker's flow declare the conversation board as a session view, `listTasks_tasks`, beside the read of the same name: `useView(viewRef(flow, "listTasks_tasks"), {}, { sessionId })` watches a conversation's tasks with no topic named.

Docs: packages/workforce/README.md (`rosterView`, `RosterView`, `roster()` and `watchRoster` read with no session, `WorkforceClientSource` taking `view` and `subscribe`, the board's `listTasks_tasks` view), apps/docs/docs/workforce/overview.md (the roster and a conversation's tasks watched as views), the new apps/docs "Views" page (workforce's roster as the worked example).
