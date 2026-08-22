# Authentication

Authentication for flows resolves a *principal* — the caller identity the
runtime keys state and resources by — from whatever the inbound transport
hands the host. The framework owns the contract; the host owns credential
verification. The framework stores no secrets.

This is the foundation that lets one runtime accept browser sessions, MCP
clients, webhooks, and scheduled jobs without the flow changing. Wiring
patterns live in
[Authentication](../../apps/docs/docs/server/authentication.md).

---

## Contract

A `ResolvePrincipalFn` is `(context: PrincipalResolutionContext) =>
ResolvedPrincipal | { userId?: string; orgId?: string } | null` (or a
Promise of the same). `PrincipalResolver` is an alias of that function
on the engine side.

`context.request` is set for HTTP-shaped transports. Non-HTTP transports
use `context.envelope` and `context.rawBody`. The resolver **never**
treats `body.userId` as the principal.

`defineFlow` accepts the hook on `authentication`:

```ts
defineFlow({
  kind: "billing",
  authentication: {
    resolvePrincipal: async (ctx) => readSession(ctx.request),
    requireUser: true,
  },
});
```

`requireUser` defaults to `true`: after the resolver and `defaultUserId`
fallback, a missing `userId` is rejected. Set `false` to opt the flow out
of user-scope identity.

The resolved `userId` is the sole authority for session ownership and
resource scoping.

---

## Resolution order

1. **Transport-level** — the inbound transport already resolved a
   principal (scheduled, MCP, webhook, chat, voice). Those adapters call
   `host.resolvePrincipal` with their own context; they do not implement
   a second auth path.
2. **Flow-level** — `defineFlow({ authentication: { resolvePrincipal } })`.
   Takes precedence over the host-level fallback when present
   (`pickPrincipalResolver`).
3. **Host-level** — `createFlowApiRouter({ resolvePrincipal })` /
   `createFlowState({ resolvePrincipal })`. Fallback for flows that omit
   a flow-level resolver.
4. **`defaultUserId`** — if the chosen resolver returns no `userId` and
   the flow sets `authentication.defaultUserId`, that value is used.
5. **`requireUser`** — still no `userId` and `requireUser !== false` →
   401.

[BP-031](../contributing/best-practices.md#bp-031-never-make-authorization-or-control-flow-decisions-from-caller-controllable-input)
applies to every path: a resolver that returns `body.userId` is a
security hole. The scheduled-actions adapter is the reference
implementation — it resolves from a server-side resource, never from the
request body.

---

## Scope: the whole `/api/flows` surface

`resolvePrincipal` runs on **every** HTTP request that hits `/api/flows`
except the exempt routes below, not just action invocations. The same
principal is the authority for session listings, session fetch, and
`create_session`. This is the contract that closes the session-enumeration
hole: a listing endpoint that skipped the resolver would leak every
session on the host.

`packages/engine/src/routes/route-auth.ts` implements this section.
The route/subject/owner table here is the contract that file follows.

### The route-auth subject

`routeSubject` maps every `/api/flows` route to the thing it addresses.
The switch is exhaustive over `ParsedFlowRoute["kind"]`.

| Subject | Routes | Owner / resolver |
|---|---|---|
| `exempt` | `list_flows`, `capabilities`, `execute_action` | No owner check. `execute_action` resolves its own principal in the action handler. |
| `session` | session CRUD, state, resources, debug-on-session | Owner is the stored session's `userId`. Flow comes from `session.flowKind`. A missing session is not an auth error — the handler 404s. |
| `request` | stream, abort, retry, continue, status, resume | Owner is the request record's `userId` (or the in-flight `activeRequests` entry when the record is not persisted yet). |
| `flow` | `create_session` | No record yet. The authenticated caller becomes the owner. Flow comes from the URL. |
| `user` | `user_stream`, `check_interrupted_requests` | Owner is the `userId` in the path. |
| `host` | `list_sessions`, `active_requests`, `transcribe` | No single owner. The handler scopes rows to the caller. |

Enforcement is off when the host resolver is the framework default **and**
no registered flow configures its own resolver. A flow-scoped route whose
effective resolver is still the default is treated as open.

When a `host` or `user` route has no governing resolver in a **mixed
app** (some flows authenticate, the host-level fallback is the default),
the guard does not refuse the route. It returns `anonymousFlowKinds` —
the set of flow kinds that do **not** configure their own resolver — and
the handler withholds rows that belong to an authenticating flow.
`anonymousFlowKinds` is that computed set, not a `createFlowApiRouter`
option.

A mixed app that wants listings scoped to a real caller must set a
host-level `resolvePrincipal`. Without one, the listing stays up for the
open flows and stays closed for the authenticated ones.

### `create_session` is not a bypass

`POST /api/flows` (`create_session`) is a `flow` subject. It is guarded
by that flow's resolver, same as an invoke. A flow with a configured
resolver rejects an unauthenticated `create_session` the same way it
rejects an unauthenticated invoke.

When a principal exists, the new session's `userId` comes from that
principal, never from `body.userId`. `body.userId` is only the identity
on apps still using the framework default resolver.

---

## `requireUser: false`

`requireUser: false` opts the flow out of user-scope identity.
`defineFlow` throws at registration if the flow also declares
`user.stateSchema`, a `user.client` projection, or any user-scoped
resource. The runtime has nowhere to route those reads and writes
without a principal.

It is not restricted by `FlowKind`. Webhooks and scheduled jobs that
legitimately have no end user are the usual callers.

---

## Top-level `requireUser` shorthand

`requireUser` can be set at the top level of `defineFlow` as well as
inside `authentication`. The top-level form is the older entry point.
When both are set, `authentication.requireUser` wins.

---

## Edge cases

- **`body.userId` is not the principal.** Action identity comes from the
  resolver. On `create_session`, `body.userId` is used only when no
  principal exists (default-resolver apps). A resolver that reads
  `body.userId` is a BP-031 violation.
- **Session-user mismatch.** If a request names an existing session
  whose stored `userId` does not match the resolved principal, the
  engine rejects the request (`UserBindingMismatchError`). The check
  runs after resolution, on every path that loads a session. A
  management-route owner mismatch is 403 from the route-auth guard.

---

## Cross-references

- [Authentication (user guide)](../../apps/docs/docs/server/authentication.md) —
  wiring patterns, convenience helpers, and host-level fallback examples.
- [MCP Transport](./mcp-server.md) — MCP session identity and the
  `FlowMcpServerOptions.auth` slot.
- [Webhook Transport](./webhook-transport.md) — signature verification as
  the resolver.
- [Chat Transport](./chat-transport.md) — platform identity mapping.
- [Scheduled Actions](./scheduled-actions.md) — server-side resource as
  the principal source; the reference BP-031 implementation.
- [Voice Transport](./voice.md) — WebRTC / websocket identity.
- [Server Routes](./server-and-client.md) — the HTTP surface
  `resolvePrincipal` guards.
- [BP-031](../contributing/best-practices.md#bp-031-never-make-authorization-or-control-flow-decisions-from-caller-controllable-input)
  — never make auth decisions from caller-controllable input.
