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
use `context.envelope` and `context.rawBody`. A resolver you write must
**never** treat `body.userId` as the principal — that is BP-031, and it
is the reason the hook exists: identity has to come from something the
caller cannot set.

The framework's own default is the deliberate exception.
`defaultBodyUserIdPrincipalResolver` reads `body.userId` and returns it as
the principal. It does **not** read `body.orgId` — the body is
caller-controlled, so it is not a source an organization may come from
(BP-031). An app on this resolver runs under the reserved `DEFAULT_ORG_ID`
instead, and a body still carrying `orgId` is ignored with a once-per-host
warning. It is there for early development and the framework's tests, not as
a security boundary — an app still on it is unauthenticated, and the
guarantee above does not apply to it. `@flow-state-dev/node` refuses to bind such an app to a
network interface for exactly that reason. Everything below that speaks
of a "configured" or "custom" resolver means one that is not this
default.

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

The resolved principal — not `userId` alone — is what the runtime scopes
by. `userId` is the sole authority for session *ownership*. Resource
scoping is keyed per scope:

| Scope | Key |
|---|---|
| `session` | the session id, namespaced to `${tenantId}:${sessionId}` when the request carries a tenant (`resolveSessionStorageKey`) |
| `user` | `userId` |
| `org` | the session's bound `orgId`, taken from `principal.orgId` at session creation |

User- and org-scoped resources route to a further `${id}:${flow.id}`
bucket when the resource is flow-isolated — the registered **instance**, so
two copies of one collection definition isolate from each other too. The
identity above is still what that bucket is derived from, and an instance id
is a storage coordinate, never an authorization.

A custom resolver therefore owns the org boundary as well as the user one,
and it may not decline it. Returning no `orgId`, a blank one, or the reserved
`DEFAULT_ORG_ID` is refused with `401` — organization is unconditional, so
there is no configuration under which a configured resolver may omit it. Org
binding is fixed at session creation and immutable after: a later request
claiming a different `orgId` is rejected with `OrgBindingMismatchError` rather
than rebinding the session. Derive `orgId` from the same trusted source as
`userId` — BP-031 covers it identically.

---

## Resolution order

1. **Transport-level** — the inbound transport already resolved a
   principal (scheduled, MCP, webhook, voice). Those adapters call
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
| `exempt` | `list_flows`, `capabilities`, `execute_action` | No owner check. `execute_action` resolves its own principal in the action handler. `list_flows` stays exempt: when the registry holds an owner pin it resolves the caller for each pinned instance through that instance's effective resolver (its own `authentication.resolvePrincipal`, otherwise the host's, the same precedence the doors use), and omits the instance when that resolver refuses the caller or the caller does not match its pin. A credential one instance's resolver accepts never lists another instance. Instances that share a resolver are resolved once per request. An anonymous caller sees unpinned flows only. The route does not answer 401. |
| `session` | session CRUD, state, resources, debug-on-session | Owner is the stored session's `userId`. Flow comes from `session.flowKind`. A missing session is not an auth error — the handler 404s. |
| `request` | stream, abort, retry, continue, status, resume | Owner is the request record's `userId` (or the in-flight `activeRequests` entry when the record is not persisted yet). |
| `flow` | `create_session` | No record yet. The authenticated caller becomes the owner. Flow comes from the URL. |
| `user` | `user_stream`, `check_interrupted_requests` | Owner is the `userId` in the path. |
| `host` | `list_sessions`, `active_requests`, `transcribe` | No single owner. The handler scopes rows to the caller. A listed row owned by an instance with its own `authentication.resolvePrincipal` is judged by that resolver, the one its doors use: shown only when it accepts the caller, the row's `userId` and `orgId` are the principal it returns, and a pinned instance's pin admits that principal. A credential one instance's resolver accepts never lists another instance's rows. Instances that share a resolver are resolved once per request. |

A hired instance is registered with `register(flow, { pin })`. The pin is `{ orgId, userId? }` from the hire row, not from the address. `create_session` and a session-less `execute_action` compare the caller to that pin before the acknowledgement and answer a mismatch with `404 Unknown flow`, the same sentence an address this process does not hold gets. An internal dispatch to a pinned instance is refused at the dispatch seam, before a child session is written: a sending principal outside the pin gets `flow-not-found`, the same refusal an unregistered address gets (see [Dispatched Work](./dispatched-work.md)). Execution admission is the backstop. Every run, including resume and retry, compares the bound session to the pin before any block and throws `InstancePinMismatchError` on a mismatch. An instance registered without a pin stays shared. A hire writer does not get that path: `registerHiredSeat` refuses a hired seat that arrives with no pin. The comparison uses the principal the host resolved. On the framework default resolver that principal does not name an organization, so opening a pinned seat — including for the user who hired it — answers `404 Unknown flow`. Install the resolver that verified the hire where the seat is resolved: at the host when every flow authenticates, or on the seat instance itself (its `authentication.resolvePrincipal`) in a mixed app whose other flows stay on the development default. A host resolver that merely delegates to the default does not work, because the engine recognises the development default by the resolver it runs (`isDefaultBodyUserIdPrincipalResolver`), not by the principal it returns: a tokenless caller then gets 401 on actions (no verified organization) and on the management routes and listings (enforcement switches on). With the resolver on the seat, the flow catalog lists the seat to a caller that resolver admits and the pin matches, because the catalog resolves each pinned instance through its own resolver, as the doors do. The host listings (`list_sessions`, `active_requests`) show the seat's sessions and in-flight requests to the same caller, because they judge each of its rows through the seat's resolver too. The pin also picks where the seat stores a person's shared user data: one cell per (pin org, person), never the person's cross-org cell (FIX-1538, [State and Scopes](./state-and-scopes.md#the-hired-seat-cell)).

Enforcement is off when the host resolver is the framework default **and**
no registered flow configures its own resolver. A flow-scoped route whose
effective resolver is still the default is treated as open.

When a `host` or `user` route has no governing resolver in a **mixed
app** (some flows authenticate, the host-level fallback is the default),
the guard does not refuse the route. It returns `anonymousFlowIds` —
the set of flow **instance ids** that do **not** configure their own
resolver — and the handler withholds rows whose recorded owner
(`flowId`, or the singleton its `flowKind` implies for a legacy row) is not
in that set. The two listings then judge a row owned by an instance that
does configure its own resolver through that resolver, as the `host` row of
the table above describes, so a caller that instance accepts sees its rows;
`check_interrupted_requests` does not, and leaves those rows alone. Instance ids, not kinds: two instances of one collection can
authenticate differently, and an anonymous member must not expose its
authenticating sibling's rows. `anonymousFlowIds` is that computed set, not
a `createFlowApiRouter` option.

A mixed app that wants listings scoped to a real caller must set a
host-level `resolvePrincipal`. Without one, the listing stays up for the
open flows, and shows an authenticated instance's rows only to a caller
that instance's resolver accepts.

With a host-level resolver, `list_sessions` scopes its store query to the
host's principal. When an instance with its own resolver names the caller
as someone else, the query runs unscoped and every row is judged in the
handler instead, so a page can come back shorter than `limit`, as the
anonymous listing's can. A caller the host resolver refuses still gets 401
on the listings, whatever an instance's own resolver would say.

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

**Opting out of user identity does not opt out of needing a `userId`.**
The runtime still stamps one onto `RequestRecord.userId`,
`ActiveRequestEntry.userId`, and the rest of its request bookkeeping, so
a `requireUser: false` flow must still name a technical principal: either
return a `userId` from `resolvePrincipal`, or set
`authentication.defaultUserId`. Configuring neither is a configuration
mistake, and `host.resolvePrincipal` rejects every request to that flow
with a **500** naming it — not a 401, because the caller did nothing
wrong.

```ts
defineFlow({
  kind: "stripe-webhook",
  authentication: {
    requireUser: false,
    defaultUserId: "system",       // required — nothing else supplies one
    resolvePrincipal: ({ rawBody, request }) => {
      verifySignature(rawBody, request);
      return null;                 // defaultUserId ("system") fills in
    },
  },
  actions: { /* ... */ },
});
```

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
- **No `userId` resolved.** With `requireUser: true` (the default) the
  host rejects with **401**. With `requireUser: false` and no
  `defaultUserId`, it rejects with **500** — the flow is misconfigured,
  not the caller.
- **`resolvePrincipal` returns `{ orgId }` with no `userId`.** Treated as
  no `userId`; falls through to `defaultUserId` and then to the rule
  above.
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
- [Scheduled Actions](./scheduled-actions.md) — server-side resource as
  the principal source; the reference BP-031 implementation.
- [Voice Transport](./voice.md) — WebRTC / websocket identity.
- [Server Routes](./server-and-client.md) — the HTTP surface
  `resolvePrincipal` guards.
- [BP-031](../contributing/best-practices.md#bp-031-never-make-authorization-or-control-flow-decisions-from-caller-controllable-input)
  — never make auth decisions from caller-controllable input.
