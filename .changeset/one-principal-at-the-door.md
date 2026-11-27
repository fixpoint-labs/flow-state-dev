---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
"@flow-state-dev/testing": patch
---

A run carries one principal, set at the door (FIX-2942). `host.resolvePrincipal` now returns a `Principal` (exported from `@flow-state-dev/engine/host`): the user and organization as before, plus `kind` (`"person"` or `"machine"`) and `resolvedBy`, the identity of the resolver that answered with the settings the host applied. Dispatch, sub-flows, owner runs, wakes, schedules and webhooks carry it unchanged. A schedule that names a real person runs as that person; one that runs as the gateway or the system user, a webhook delivery, an owner run and a service's routing run as a machine. A direct `host.dispatch` or `runAction` can pass `principal.kind` / `principalKind`; one that passes none runs as its session's kind, and a session it creates is a machine's.

A session records its creator's kind (`SessionRecord.principalKind`), and a child the dispatch seam creates records its parent's incarnation (`parentIncarnation`). Every session store's `set` keeps a stored `principalKind` whatever a later write carries. A store adapter outside this repo must do the same: the memory and filesystem stores use `withStoredPrincipalKind`, the SQL stores keep it inside the write statement. A session from before the field is classified from its first request record, so existing conversations keep working.

The owner check that request-control routes, request listings and a view's session reads apply is now exact on user, organization and tenant. A request record from before organizations is no one's there; retrying its id as its owner still reuses it.

`testFlow` and `createTestContext` give their sessions the kind an HTTP caller's session gets.

Docs: the authentication reference (the principal's `kind` and `resolvedBy`, and who is a machine), and the store adapter guide (a session store keeps `principalKind` on `set`).
