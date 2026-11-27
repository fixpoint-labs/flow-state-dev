---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

A scope is how many copies exist; the owner decides who may look; name a session to reach its copy (FIX-2942).

- **`ctx.resources.at({ session }).<name>`.** A block reads, lists and writes another session's copy of a session-scoped collection, with its own flow's definition at that session's address: `ctx.resources.at({ session: launchChatId }).notes.list()`. Every verb acts on that one copy. Writes are versioned like a local write; two sessions writing one copy conflict the way two local writers do, with no cross-session lock.
- **Only the owner's sessions.** The session is reached only when the HTTP routes would admit the run's principal to it. A session of another user, org or tenant, one with no org, one an own-resolver flow refuses, and an id no one holds all answer every verb the same way: rejected with `SessionNotFoundError`. A schedule's or a webhook's machine principal reaches no other session.
- **The session written hears it.** A write publishes on that session's change-bus topics, as its own write would, never on the caller's. It starts a turn there only when the collection declares `wakeEntry: "<internal entry>"`: the write owes a wake on that session and entry before it is written, and writes that land before it runs fold into one turn. That entry reads what changed and settles its wake like any wake entry. If the wake can't be owed, nothing is written and the write rejects; a write that fails after its wake was owed leaves one turn that finds nothing new. A turn that runs before the writing request's lease is up and finds nothing new holds its wake to the lease, so expect one more, empty turn then. A write into a session whose flow doesn't declare the entry is refused, naming the entry. The session's `reactTo` blocks don't run inside the writer's turn.
- **Webhook turns are fenced.** A turn a webhook delivery started, or a run it fired, can name no session but its own: every verb is refused with `UntrustedReachError`. Both errors are exported from `@flow-state-dev/engine`, so a block can catch them by type.
- **Single resources and projected collections** can't be reached this way yet; naming one throws, and with declared resources it doesn't compile: `at()` is typed to the session-scoped collections (a collection ref now carries its declared scope, `ResourceCollectionRef<State, "session">`).
- **Flow construction checks.** `at` is a reserved resource accessor, and two session collections whose patterns overlap can't name different `wakeEntry`s.
- **Use `ctx.sessions`** for what isn't a resource: another session's flow, readable state, history and turns.
- **Wakes carry `resolvedBy`.** A woken run reaches the own-resolver sessions its writer's resolver admits. SQLite and Postgres add a nullable `resolved_by` column to `wakes` on start (no backfill); a wake stored before reaches no own-resolver session.

Docs: apps/docs resource guides (a "Another session's copy" section beside `ctx.sessions`, with `wakeEntry` and the webhook fence), and the store adapters' schema notes for the `wakes.resolved_by` column.
