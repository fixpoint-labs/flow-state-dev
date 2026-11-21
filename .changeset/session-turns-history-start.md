---
"@flow-state-dev/core": patch
"@flow-state-dev/engine": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/react": patch
---

A screen that follows a conversation with `useSessionFeed` can draw where the worker's word-for-word reading begins, and whether the turns before it were summarized, without a `useSession` view (FIX-2772).

- **workforce:** each row of the session turns view (`sessionTurnsViewRef()`) carries `historyStart: { requestId } | null`: the first turn that turn's history window held, once earlier turns had left it; `null` while none had.
- **core / engine:** a session turn read in a view (`sessions.turns(...)`, `SessionTurn`) carries the request's optional `historyStart`, the mark the engine already records on each request.
- **core / workforce:** the history summary's session resource has one exported definition, `historySummaryResource`: from `@flow-state-dev/workforce/browser`, the one a screen on workforce imports, and from `@flow-state-dev/core/types`, where workforce takes it from (core's root is not browser-safe). It is the resource every `historySummary(...)` at its default name installs, worker answers included; its public face is the mark (`throughRequestId`), `complete` and `folds`.
- **react:** `useResource(def, { sessionId })` reads a session resource by the session's id, for a screen with no `useSession` view: it reads the session's state without its items, again on that session's notice for the resource, and on the client's timer wherever push can miss a change. Pass `client` and `pollIntervalMs` as for a user or org resource. It has no setters. `useResource(def, { session })` reads the `useSession` snapshot as before.

Docs: packages/react/README.md (`useResource` by `sessionId`), packages/workforce/README.md (the session turns view's `historyStart`; `historySummaryResource`)
