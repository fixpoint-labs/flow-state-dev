---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
"@flow-state-dev/workspace": patch
"@flow-state-dev/tools": patch
---

A request now carries an incarnation, readable on the block context as `ctx.request.incarnation` (FIX-1286). It is a random token stamped once when the request is first recorded; a retry, a resume, or a queued run adopting its enqueue-time record reads the same value. Once retention deletes a request's record its id can name a new request, and the new one gets a new incarnation. If you key your own state on a request id and that state outlives the request, key it on `incarnation` as well.

The engine stamps it on every new request record (`RequestRecord.incarnation`) and `isSameRequest` compares it. Records written before this release carry none and answer to a stable value derived from their `createdAt`, so a resume across the upgrade keeps its identity. `@flow-state-dev/workspace`'s request scope identity now includes the incarnation (`ScopePrincipal.requestIncarnation`); session, user and org keys are unchanged.

**Upgrade note (`@flow-state-dev/tools`):** a local `scope: "run"` bash workspace now lives at `.fsdev/workspaces/run/<tenant>/<id>/<incarnation>/`, so a request reusing an id after its record was deleted, from any user, starts in an empty directory instead of the earlier request's. Every run directory moves once on upgrade: a run-scoped request in flight at deploy continues in a new, empty directory. The old directories stay on disk and are never read again; delete them when convenient.
