---
"@flow-state-dev/engine": minor
---

Apply flow authentication to the whole `/api/flows` surface, not just action
routes. Session CRUD, session state, resource content, request control
(stream, abort, resume, status, retry, continue), and the debug endpoints
previously reached the stores with no caller identity involved: only
`handleExecuteAction` called `resolvePrincipal`. A flow could configure a real
JWT or bearer verifier, satisfy the loopback-bind guard, bind a network
interface, and still serve every session in the store — userIds, state,
journals, metadata — to anyone who could reach the port, along with session
deletion, metadata writes, resource writes, and request aborts.

The catch-all dispatcher now runs a route-level guard before dispatching. It
resolves a principal through the same `host.resolvePrincipal` the action path
uses, and requires that principal to own the session or request the URL
addresses (`403` otherwise). Listings scope to the caller: `GET /sessions`
returns only the caller's sessions, with the `userId` query param demoted to a
filter that can narrow but never widen the set, and `GET /active-requests`
filters to the caller's entries. `POST /:flowKind/sessions` takes the new
session's `userId` and `orgId` from the principal rather than the body — the
`orgId` half matters because `validateDispatch` reads a stored session's org to
satisfy a flow's `requiresOrg`.

The governing resolver is selected from the stored record's `flowKind`, never
the `:flowKind` path segment, so naming a permissively-configured flow cannot
authenticate a request against a record belonging to a strict one (BP-031). No
request body is parsed at this layer: resolvers see the `Request` (headers,
cookies, URL), which is what every real one reads.

**Apps on the framework default resolver are unaffected.** They already trust a
caller-supplied `body.userId` on the action path, and their GETs carry no body
to authenticate from, so enforcement stays off and every management route
behaves exactly as before. The loopback-bind guard in `@flow-state-dev/node`
remains their protection, and it now means what it says: a flow that satisfies
it has its whole surface covered.

**Breaking for apps that configure `resolvePrincipal`** and read across users.
A caller reaching another user's session through these routes now gets a `403`
where it previously got the data. One case needs a code change: an app that
configures per-flow resolvers but leaves the host-level fallback at the default
gets a `401` from `GET /sessions` and `GET /active-requests`, which span every
flow and have no flow-scoped resolver to identify the caller with. Pass a
host-level `resolvePrincipal` to `createFlowState` / `createFlowApiRouter` to
restore them.
