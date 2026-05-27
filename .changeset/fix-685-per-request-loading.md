---
"@flow-state-dev/core": minor
"@flow-state-dev/server": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Add a flow-level `session.historyWindow` option (`{ turns: 50 }` by default) that bounds how much cross-turn history each request loads.

Per-request loading now matches what a flow declares: cross-turn history is windowed at the store query instead of loading the whole session, resource content loads only for declared resources, the session-requests list endpoint no longer fetches full item logs, and SSE resume reads events from the resume cursor rather than re-reading the whole log. **Behavior change:** a generator's default `history` (and a no-arg `ctx.session.items.history()`) now sees at most `historyWindow.turns` turns rather than the entire session; the full session stays retrievable through the state endpoint. Adds `ContentStore.getByPrefix` and `RequestListOptions.orderBy` to the store contract.

Honor `RequestListOptions.orderBy` and implement `ContentStore.getByPrefix` so windowed history and declaration-scoped content loading work against these adapters.
