---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

One read of a collection across every session its owner has, in one query a page, heard on one change topic (FIX-2945).

- **`ctx.resources.acrossSessions().<name>.list({ after, where })`.** A block, a user-scope view's included, reads one session-scoped collection across all of the run's owner's sessions: `const page = await ctx.resources.acrossSessions().notes.list()`. Each entry in `page.entries` is `{ session, key, value }`: the session it belongs to (as `ctx.resources.at({ session })` takes it), its storage path there, and its state. Read-only.
- **Paging.** A page holds up to 50 entries. Pass `page.next` as `after` for the next one, and stop only when `next` is absent: a page can be short, even empty, while `next` is set. `next` is opaque and names no entry; it opens only in the server process that handed it back, and any other `after` is refused.
- **Filters.** `where: { key }` reads the entry at that path in each session; `where: { index, value }` reads a collection's declared index. A field with no declared index is refused, naming it: declare the index in the collection's `indexes` to filter on it.
- **Only the owner's sessions.** A session is answered only when `ctx.resources.at` would reach it: the same user, organization and tenant, and the same admission (an own-resolver flow's sessions, a machine's run). Any other session is left out as though it held nothing. A turn a webhook delivery started is refused with `UntrustedReachError`. A collection whose rows are lineage-shared can't be read this way.
- **Notices.** In a view, the read is heard on one change topic per collection and owner. Every write to any session's copy publishes there, so the view wakes for a row filed in a session made after it ran. A client sees it as the user topic narrowed to `/sessions/<collection root>`; the same user in another organization never hears it, and a notice on it names no session id and no row id.
- **For store and bus adapters.** `ResourceStateStore` gains an optional `listAcrossSessions(query)`, one page joined to the session store on the full owner; without it the read is refused. `createInMemoryResourceStateStore` and `createFilesystemResourceStateStore` take `{ sessions }` for it (the registry factories pass it). A change-bus topic's `scope` can now be `"owner"`, the bus's own scope for these change topics; an adapter that treats the scope as an opaque string needs nothing.
- **Schema.** SQLite adds `idx_sessions_owner`; Postgres adds `idx_sessions_owner` and `idx_sessions_tenant_owner`, built concurrently on start.

Docs: apps/docs resource guides (a "Looking across sessions" section beside "Another session's copy": the call, paging with `next`, the two filters, and that a view using it hears sessions made later).
