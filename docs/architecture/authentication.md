# Authentication

Authentication for flows resolves a *principal* — the caller identity the
runtime keys state and resources by — from whatever the inbound transport
hands the host. The framework owns the contract; the host owns credential
verification. The framework stores no secrets.

This is the foundation that lets one runtime accept browser sessions, MCP
clients, webhooks, and scheduled jobs without the flow changing. Wiring
patterns live in
[Authentication](/apps/docs/docs/server/authentication.md).

---

## Contract

A `PrincipalResolver` is `(request: Request) => Promise<string | undefined>`.
It returns a `userId` string, or `undefined` when the request is unauthenticated.
It **never** reads `body.userId`.

`requireUser` is a per-flow boolean. Default `true`: unauthenticated requests
are rejected. Set `false` for public flows.

The resolved `userId` is the sole authority for session ownership and resource
scoping. The framework never writes the request body into the resolved
principal.

---

## Resolution order

1. **Transport-level** — the inbound transport already resolved a principal
   (scheduled, MCP, webhook, chat, voice). The HTTP route skips
   `resolvePrincipal` entirely. This is the only trusted path for those
   transports.
2. **Flow-level** — `defineFlow({ resolvePrincipal })`. Takes precedence over
   the host-level fallback when present.
3. **Host-level** — `createFlowApiRouter({ resolvePrincipal })`. Fallback for
   flows that omit a flow-level resolver.
4. **Anonymous** — no resolver anywhere. Request is treated as unauthenticated.

[BP-031](/docs/contributing/best-practices.md#bp-031-never-make-authrouting-decisions-from-caller-controllable-input)
applies to every path: a resolver that returns `body.userId` is a security
hole. The scheduled-actions adapter is the reference implementation — it
resolves from a server-side resource, never from the request body.

---

## Scope: the whole `/api/flows` surface

`resolvePrincipal` runs on **every** HTTP request that hits `/api/flows`, not
just action invocations. The same principal is the authority for session
listings, session fetch, and `create_session`. This is the contract that
closes the session-enumeration hole: a listing endpoint that skipped the
resolver would leak every session on the host.

### The route-auth guard

`routeSubject` is a per-method contract on every `/api/flows` route. Three
values:

| `routeSubject` | Meaning | Auth requirement |
|---|---|---|
| `"flow"` | The request names a specific flow (`flowName` is present) | That flow's `resolvePrincipal` + `requireUser` |
| `"session"` | The request names a specific session (`sessionId` is present, no flow) | The session's owning flow's resolver (looked up via `flowName` stored on the session record) |
| `"none"` | No flow or session in the request (the listing endpoint) | Host-level `resolvePrincipal` only |

A request that names neither a flow nor a session **cannot** pick a flow-level
resolver. It resolves through the host-level fallback. With one configured,
listings are filtered to sessions owned by the resolved principal. Without
one, listings return empty: there is no trusted identity to filter on, so
the route refuses to enumerate.

`GET /api/flows` (`list_sessions`) is `"none"`. `GET /api/flows/:sessionId`
(`get_session`) is `"session"`. `POST /api/flows` (`create_session`) is
`"flow"` — it names a flow and is guarded by that flow's resolver, same as
`invoke`.

### Mixed-app listing

In a **mixed app** — per-flow resolvers configured, host-level fallback left
at default — `list_sessions` returns empty even for a caller who could invoke
those flows. The listing endpoint has no flow name, so it cannot pick a
per-flow resolver. This is the documented tradeoff: a mixed app that wants
listings to work must also set a host-level `resolvePrincipal`.

`anonymousFlowKinds` on `createFlowApiRouter` is the allow-list of
`FlowKind` values (`"ephemeral"` / `"persisted"`) whose sessions may appear
in an unauthenticated listing. Default is empty: unauthenticated listings
return empty even when anonymous sessions exist. A host that wants
anonymous sessions listed opts in explicitly.

### `create_session` is not a bypass

`POST /api/flows` (`create_session`) names a flow and is guarded by that
flow's resolver, same as `invoke`. A `requireUser: true` flow rejects an
unauthenticated `create_session` the same way it rejects an unauthenticated
invoke. There is no "create first, authenticate later" path.

---

## `requireUser: false` is compile-time

`requireUser: false` is only accepted by `defineFlow` when `FlowKind` is
`"ephemeral"`. A persisted flow with `requireUser: false` is a type error.
The runtime also throws if a persisted flow is constructed with
`requireUser: false` (defense in depth against a JS caller that bypasses
the type check).

This is the same rule as `skipAccountProvision: true` — both are
ephemeral-only because a persisted flow without an owning principal has
no one to attribute stored state to.

---

## Top-level `requireUser` shorthand

`requireUser` can be set at the top level of `defineFlow` as well as inside
`config`. The top-level form is a shorthand: `defineFlow({ requireUser: false, ... })`
is equivalent to `defineFlow({ config: { requireUser: false }, ... })`.
When both are set, the top-level value wins.

---

## Edge cases

- **`body.userId` is ignored.** The request body `userId` field is a leftover
  from an earlier contract and is never consulted. A resolver that reads it
  is a BP-031 violation.
- **Session-user mismatch.** If a request names an existing session whose
  stored `userId` does not match the resolved principal, the engine rejects
  the request. The check runs after resolution, on every path that loads a
  session.

---

## Cross-references

- [Authentication (user guide)](/apps/docs/docs/server/authentication.md) —
  wiring patterns, convenience helpers, and host-level fallback examples.
- [MCP Transport](./mcp.md) — MCP session identity and the
  `FlowMcpServerOptions.auth` slot.
- [Webhook Transport](./webhook-transport.md) — signature verification as
  the resolver.
- [Chat Transport](./chat-transport.md) — platform identity mapping.
- [Scheduled Actions](./scheduled-actions.md) — server-side resource as
  the principal source; the reference BP-031 implementation.
- [Voice Transport](./voice-transport.md) — WebRTC / websocket identity.
- [Server Routes](./server-routes.md) — the HTTP surface `resolvePrincipal`
  guards.
- [BP-031](/docs/contributing/best-practices.md#bp-031-never-make-authrouting-decisions-from-caller-controllable-input)
  — never make auth decisions from caller-controllable input.
