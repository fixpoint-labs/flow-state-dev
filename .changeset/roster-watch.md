---
"@flow-state-dev/workforce": minor
"@flow-state-dev/shift-manager": patch
---

A screen that lists workers can follow the roster instead of reading it once (FIX-2412).

- **workforce:** `WorkforceClient.watchRoster(onRoster, { onError })`, on `@flow-state-dev/workforce/browser`, hands the user's roster to `onRoster`, and again each time a hire, fork, edit or fire changes it, from any tab or any worker's turn. It listens on the client's `subscribe` (the user's topic) and reads every 3 s only where push can miss a change; it reports only a changed roster and returns its stop function. **Breaking for a hand-built source:** `WorkforceClientSource` now includes `subscribe`. A client from `createClient` works as before.
- **shift-manager:** Roster, TEAMS, a project's lead picker, worker settings and DELEGATES follow the roster through one watch per connection, so a worker hired elsewhere shows without a reload.
