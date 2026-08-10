---
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

A session's background jobs are readable over HTTP (FIX-1010): `GET /api/flows/sessions/:sessionId/workstreams`. Each row carries the child session's id, its parent, the `topic` and `coordinate` labels the server stamps when a job starts, timestamps, and a `status`. Use a row's `id` with the existing `/sessions/:id/requests` endpoint to read that job's history.

**The labels are stamped by the server when the job's session is created.** `ctx.requestHost.startDetached` writes `topic` and `coordinate` onto the child session record from the routing seed it derived that session from — `seed.topic` and `seed.key`. A caller's own `record` bag still lands in `metadata` verbatim, so a `topic` key in there is data and never becomes a label. Both are display only: nothing routes, authorizes, or adopts a session on them, and both are optional, so read them with `== null` guards. A job whose seed named no worker has no `coordinate`, and a child session created before this shipped has neither label.

`status` is `active` when the job is unfinished — covering queued, running, and paused for an approval alike, without distinguishing them — or one of `completed` / `failed` / `aborted` / `incomplete` when it is over. A job that has never run carries no `status` at all. A job with several runs reports its most recent outcome, so one that failed and was retried successfully reads `completed`.

The route is session-addressed and inherits session-route authorization: it is authorized like `GET /sessions/:id`, `/state` and the debug endpoints, and the answer is scoped to the stored parent record's owner, tenant, org and flow kind. A conversation in another tenant answers `404`, one with no jobs `200` and an empty list. A conversation belonging to another user answers `403` only where a `resolvePrincipal` is configured; on the framework default resolver the management endpoints stay open, so a caller holding a conversation id can read that conversation's jobs. `limit` accepts 1–100 (default 25) and `offset` 0–10000; a value outside either range is a `400` naming the accepted range rather than a silent clamp. There is no mode that lists background work across conversations.

**`GET /sessions/:sessionId/requests` now filters on the session's flow kind (FIX-1046).** A request recorded inside a session but dispatched under a different flow was returned here in full, item logs included, to a caller authorized only for the session's own flow. Such a request no longer appears in the listing. No shipped code path produces one on the ordinary route, but an application that deliberately dispatched one flow's action into another flow's session will see those requests disappear from this endpoint.

**Four additive store-list options**, on all four adapters. Existing callers omit them and are unchanged.

- `RequestListOptions.status` accepts an array as well as a single status; an array matches set membership, and an empty array matches nothing.
- `RequestListOptions.orderBy` accepts `"none"`, which returns the matching set unordered. `"startedAtMs"` now orders by `(startedAtMs, id)`, so an exact same-millisecond tie resolves deterministically instead of arbitrarily.
- `SessionListOptions.orderBy` accepts `"createdAt"` (ordering by the immutable `(createdAt, id)` pair) alongside the default `"updatedAt"`.
- Both option types accept `orgId`, with the same present-vs-absent NULL-safe matching as `tenantId`.

A custom `StoreRegistry` implementation must honor all four; the fields are optional, so a store that ignores them silently returns the wrong rows for the new endpoint.

The SQLite and Postgres adapters add composite indexes — `sessions(parent_session_id, created_at, id)`, `sessions(parent_session_id, tenant_id, org_id, created_at, id)` and `requests(session_id, created_at, id)` — with no new column and no data migration. The two `sessions` indexes are not substitutes: parent ids are stored bare, so in a multi-tenant deployment the first alone lets one tenant's children be walked and discarded inside another tenant's bounded read, while the second alone costs a single-tenant deployment its ordered scan. On Postgres these are built with `CREATE INDEX CONCURRENTLY`, because they are the only indexes here that can land on an already-populated table and a plain build would hold a lock against writes for its duration. Postgres also emits its NULL-safe `tenant_id` / `org_id` filters as `= $n` or `IS NULL` rather than `IS NOT DISTINCT FROM`; the predicate is identical, but only the former is servable from an index, and the difference decides whether an ordered read stops early or sorts a whole history first.
