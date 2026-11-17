---
"@flow-state-dev/client": minor
"@flow-state-dev/react": minor
"@flow-state-dev/workforce": minor
"@flow-state-dev/harness-manager": minor
"@flow-state-dev/workspace": minor
"@flow-state-dev/store-sqlite": minor
---

An app can follow and drive its users' worker sessions through package hooks and calls, with no stream, subscription or flow address of its own (FIX-2757).

- **client:** a session feed's snapshot has `historyLoaded`, `true` once the history read has landed, so an empty session can be told from one still being read.
- **react:** `useSessionFeed(sessionId, { itemTypes, client })` follows one session live (its items once the history lands, `[]` for an empty session even while its stream is still connecting; its unfinished runs and connection state, `loadEarlier`, and `followResponse` for a streamed send). `useRequestStream` takes `reconnect: true` (a dropped stream opens again after 1 s, doubling to 30 s, resuming after the last event; 401, 403 and 404 end it, and `close()` stops it, a reconnect waiting on its backoff included), a `client` of the host's own, and asks for no flow while `enabled: false`. `useResource` takes `client` and `pollIntervalMs` at user and org scope.
- **workforce:** the workforce client opens a new session with a worker (`startSession(worker, { fields })`, writing the app's session fields at open), sends to it (`send`, or `send(..., { stream: true })` for the streamed `Response`), each on the flow instance that owns the session, stops its running turns (`stopTurns`, resolving to the ids it stopped) and runs a failed turn again (`retryTurn`). `operatorGitHub({ operator, token })` and `operatorGitHubToken()` give a single-user host GitHub routines on the operator's own token, for the operator alone.
- **harness-manager:** each coding board row names `runFlow`, the flow its run's session runs on, so a screen reads that run's own stream without looking the session up.
- **workspace:** `sessionRepositorySource({ field, repositories, check })` is the run source for a host whose sessions each work in one repository a session field names; `listedRepository` maps a path or `file://` remote to the listed repository it is. `setupCommandFrom(value, setting)` reads a setup command from a setting, beside `checkCommandsFrom`.
- **store-sqlite:** `sqliteScheduleIndex({ filename })` is a schedule index on a SQLite file of its own.

Docs: packages/client/README.md (the session feed snapshot's `historyLoaded`), packages/react/README.md (`useSessionFeed`; `useRequestStream`'s `reconnect` and `client`; `useResource`'s `client` and `pollIntervalMs`), packages/workforce/README.md (the client's `startSession`, `send`, `stopTurns`, `retryTurn`; `operatorGitHub`), packages/harness-manager/README.md (the coding board row's `runFlow`), packages/workspace/README.md (`sessionRepositorySource`, `listedRepository`, `setupCommandFrom`), packages/store-sqlite/README.md (`sqliteScheduleIndex`)
