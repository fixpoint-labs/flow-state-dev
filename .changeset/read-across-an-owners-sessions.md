---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

One read of a collection across every session its owner has, in one query a page, heard on one change topic (FIX-2945).

- **`ctx.resources.acrossSessions().<name>.list({ after, where })`.** A block, a user-scope view's included, reads one session-scoped collection across all of the run's owner's sessions: `const page = await ctx.resources.acrossSessions().notes.list()`. Each entry in `page.entries` is `{ session, key, value }`: the session it belongs to (as `ctx.resources.at({ session })` takes it), its storage path there, and its state. Read-only.
- **Paging.** A page holds up to 50 entries. Pass `page.next` as `after` for the next one, and stop only when `next` is absent: a page can be short, even empty, while `next` is set. `next` is opaque and names no entry; it opens only in the server process that handed it back. Any other `after` is refused with `AcrossSessionsCursorError`, which a view call answers as `400 invalid_cursor`: start the listing again.
- **Filters.** `where: { key }` reads the entry at that path in each session; `where: { index, value }` reads a collection's declared index. A field with no declared index is refused, naming it: declare the index in the collection's `indexes` to filter on it. A session's declared indexes are now built at its first write that carries them; a session written before this release is built once, by the first filtered read that meets it.
- **Only the owner's sessions.** A session is answered only when `ctx.resources.at` would reach it: the same user, organization and tenant, and the same admission (an own-resolver flow's sessions, a machine's run). Any other session is left out as though it held nothing. A turn a webhook delivery started is refused with `UntrustedReachError`. A collection whose entries are lineage-shared can't be read this way.
- **Notices.** In a view, the read is heard on one change topic per collection pattern and owner. Every write to any session's resources at a key the pattern covers wakes it, whatever the writing flow declares, so the view wakes for an entry filed in a session made after it ran. A client sees it as the user topic narrowed to `/sessions/<collection pattern>`; the same user in another organization never hears it, a write in a session the read would leave out (a flow whose own sign-in refuses the caller's credentials, or a pin they fail) wakes nothing, and a notice on it names no session id, no entry key and no request.
- **Reserved accessor.** `acrossSessions`, like `at`, is a reserved resource accessor: a flow that declares a resource under that key is refused at definition. The registry `ctx.resources.at({ session })` returns has no `acrossSessions`.
- **For store and bus adapters.** `ResourceStateStore` gains an optional `listAcrossSessions(query)`, one page joined to the session store on the full owner; without it the read is refused. `createInMemoryResourceStateStore` and `createFilesystemResourceStateStore` take `{ sessions }` for it (the registry factories pass it). A change-bus topic's `scope` can now be `"owner"`, the bus's own scope for these change topics; an adapter that treats the scope as an opaque string needs nothing.
- **Schema.** SQLite adds `idx_sessions_owner`; Postgres adds `idx_sessions_owner` and `idx_sessions_tenant_owner`, built concurrently on start.

- **The error, for `packages/engine/README.md`.** `AcrossSessionsCursorError`: an `after` that isn't a cursor this read handed back in this process.

Docs: packages/engine/README.md (`AcrossSessionsCursorError`), apps/docs resource guides (a "Looking across sessions" section beside the one on reaching another session's resources: the call, paging with `next` and restarting on `invalid_cursor`, the two filters, the reserved accessor, and that a view using it hears sessions made later).
