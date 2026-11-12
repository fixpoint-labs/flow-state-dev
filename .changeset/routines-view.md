---
"@flow-state-dev/workforce": minor
"@flow-state-dev/scheduled": minor
"@flow-state-dev/shift-manager": patch
---

Routines are read as a view, with no session, and paused or deleted through the roster flow; an app's declared routines are seeded on a user's first request to any worker (FIX-2624).

- The roster flow serves a `routines` view: the user's routines, answered as `{ routines }` in `listRoutines`'s shape, at user scope with no session. It also lists the app's declared routines (`routines.declared`) that aren't stored for the user yet, so they show before they are seeded. `routinesView` from `@flow-state-dev/workforce/browser` is its handle. `listRoutines` stays as an action and as a worker's tool.
- The schedules (`workforce/schedules/*`) and subscriptions (`workforce/subscriptions/*`) collections now take `runBy: { flow: "workforce-roster" }` and a client read of the user's own entries. A client pauses or deletes a routine by sending `pauseRoutine` or `deleteRoutine` to the collection (`client.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send(...)`), which runs in the user's own write session.
- An app's declared routines are seeded on the user's first request to any flow of the installation: a worker's turn, as well as a roster request. Each is written once per user; a later request writes nothing. Every worker flow now declares the routine collections through `installation.resources`, which carries them beside the worker collections.
- `defineScheduleCollection` takes `client` and `runBy`, passed to the collection as `defineResourceCollection` takes them.
- Shift Manager's Routines reads the view and sends its changes, with no roster session.

Docs: the Workforce docs have no routines page yet; the release adds one under apps/docs/docs/workforce/ (the `routines` view and its handle, pause and delete as a send to the collection, and the declared routines seeded on a user's first request to any worker), apps/docs/docs/shift-manager/overview.md (Routines needs no roster session), packages/workforce/README.md (`routinesView` in the browser API list), packages/scheduled/README.md (`defineScheduleCollection`'s `client` and `runBy`).
