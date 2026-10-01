# Authentication

A resolver turns whatever the transport hands the host into a *principal*, the identity the runtime keys state and resources by. The framework owns the contract; the host owns credential verification; the framework stores no secrets. Wiring patterns and helpers are user-facing: [Authentication](../../apps/docs/docs/server/authentication.md). Route guard: `packages/engine/src/routes/route-auth.ts`, which follows the table below.

## Contract

- `ResolvePrincipalFn(ctx) → ResolvedPrincipal | { userId?, orgId? } | null`. `ctx.request` is set for HTTP-shaped transports; others use `ctx.envelope` / `ctx.rawBody`.
- **A resolver must never take identity from `body.userId`** ([BP-031](../contributing/best-practices.md#bp-031-never-make-authorization-or-control-flow-decisions-from-caller-controllable-input)); identity must come from something the caller can't set.
- **The framework default is the deliberate exception.** `defaultBodyUserIdPrincipalResolver` reads `body.userId` and is for development and tests only: an app on it is unauthenticated. It never reads `body.orgId` (a body `orgId` is ignored with a once-per-host warning) and runs under reserved `DEFAULT_ORG_ID`. `@flow-state-dev/node` refuses to bind such an app to a network interface. The engine recognises the default **by the resolver function it runs** (`isDefaultBodyUserIdPrincipalResolver`), not by the principal it returns. "Configured resolver" below means anything else.
- **A configured resolver owns the org boundary and may not decline it.** No `orgId`, a blank one, or `DEFAULT_ORG_ID` → 401. Org binds at session creation and is immutable: a later different `orgId` → `OrgBindingMismatchError`.

### What the runtime keys by

| Scope | Key |
|---|---|
| `session` | session id, as `${tenantId}:${sessionId}` when a tenant is present (`resolveSessionStorageKey`) |
| `user` | `userId` |
| `org` | the session's bound `orgId` |

Flow-isolated user/org resources add a `${id}:${flow.id}` bucket (the **instance** id). An instance id is a storage coordinate, **never an authorization**. `userId` alone is the authority for session ownership.

## Resolution order

1. Transport adapters call `host.resolvePrincipal` with their own context; none implements a second auth path.
2. Flow-level `authentication.resolvePrincipal` wins (`pickPrincipalResolver`) over
3. the host-level `resolvePrincipal` (`createFlowApiRouter` / `createFlowState`).
4. `authentication.defaultUserId` fills a missing `userId` (an `{ orgId }` with no `userId` counts as missing).
5. Still none and `requireUser !== false` → 401.

`authentication.requireUser` wins over the older top-level `requireUser`.

### `requireUser: false`

Opts out of user-scope identity: `defineFlow` throws if the flow also declares `user.stateSchema`, a `user.client` projection or any user-scoped resource. **It doesn't remove the need for a `userId`**: request bookkeeping still stamps one. With neither a returned `userId` nor `defaultUserId`, every request gets a **500** naming the misconfiguration (not 401; the caller did nothing wrong).

## The whole `/api/flows` surface is guarded

`resolvePrincipal` runs on **every** `/api/flows` request except exempt routes, not just actions. A listing that skipped it would enumerate every session on the host.

`routeSubject` maps each route exhaustively over `ParsedFlowRoute["kind"]`:

| Subject | Routes | Rule |
|---|---|---|
| `exempt` | `list_flows`, `capabilities`, `execute_action` | No owner check (`execute_action` resolves in its handler). `list_flows` resolves the caller **per pinned instance through that instance's effective resolver** and omits instances that refuse or whose pin doesn't match; one instance's resolver accepting a credential never lists another. Instances sharing a resolver and its `requireUser`/`defaultUserId` resolve once per request. Anonymous callers see unpinned flows only. Never 401. |
| `session` | session CRUD, state, resources, debug-on-session | Owner = stored `session.userId`; flow from `session.flowKind`. **Another user's session gets the same 404 as a missing one** (`sessionHidden`), so the answer never reveals an id is in use. Org mismatch for the session's own user → 403. The guard returns the record it checked; the snapshot, stream and metadata edit 404 if their own read isn't that record (deleted and recreated since). Request reads in a session stay within its flow kind and owning instance (`sessionRequestScope`), and so does the history `createExecutionContext` loads for a model, so a legacy session holding another flow's, instance's or user's run never hands it to a model. The session stream's child runs are scoped by owner, org and tenant, not flow (`parentIdentity`), so cross-flow work still shows. |
| `request` | stream, abort, retry, continue, status, resume | Owner = record `userId` (or the in-flight `activeRequests` entry before persistence). **Another user's or tenant's request gets the unused-id answer** (`unknownRequestResponse`; `unknownRequestStreamResponse`, an empty 200 with a resume cursor; `callerReachesRequest`). This hiding happens before any held `migration-required` refusal, which stays the owner's to hear. Retry/continue/resume give the same answer for a source not open to public re-entry. With no record and no entry, an authenticating app's stream answers every caller as unused rather than replay an orphaned event log. |
| `flow` | `create_session` | Caller becomes owner; flow from the URL. **An id already in use → 409, whoever holds it**: the one route where an id reveals it's taken. Not a bypass: guarded by the flow's resolver like an invoke, and `userId` comes from the principal, never `body.userId` (except on default-resolver apps). |
| `user` | `user_stream`, `check_interrupted_requests` | Owner = path `userId`. No record to read org/tenant from, so each handler scopes its own rows (`check_interrupted_requests`: caller's tenant via `tenantMatches`, and org when a principal exists; `user_stream` is 501). `packages/engine/test/user-route-scoping.test.ts` requires every `user`-classified route and every `/users/:userId/...` path to have a scoping-table entry and runs it as owner, other org, other tenant and (mixed app) anonymous; a route not built yet must answer 501. |
| `host` | `list_sessions`, `active_requests`, `transcribe` | Handler scopes rows to the caller. A row owned by an instance with its own resolver is **judged by that resolver**: shown only if it accepts the caller, the row's `userId`/`orgId` equal its principal, and any pin admits it. |

### Owner-pinned instances

`register(flow, { pin: { orgId, userId? } })`. The registering code supplies the pin; it never comes from the address. Workforce pins every hire (`registerHiredSeat` refuses one without).

- `create_session` and session-less `execute_action` compare the caller to the pin before acknowledging; a mismatch is `404 Unknown flow`, identical to an unknown address.
- An internal dispatch to a pinned instance from a principal outside the pin is refused at the seam as `flow-not-found`, before any child session is written.
- **Execution admission is the backstop**: every run (resume and retry included) compares the bound session to the pin before any block, throwing `InstancePinMismatchError` with `reason` `"owning-org"` (checked first) or `"owning-user"`.
- On the default resolver the principal names no org, so a pinned instance is `404 Unknown flow` even to its owner. Install an org-verifying resolver at the host, or on the instance in a mixed app. A host resolver that merely delegates to the default doesn't work (the default is recognised by function), so tokenless callers get 401 on actions and management routes.
- The pin also chooses where the instance stores a person's shared user data: one cell per (pin org, person), never the person's cross-org cell ([State and Scopes](./state-and-scopes.md#the-owner-pinned-cell)).

### When enforcement is off, and mixed apps

- Enforcement is off when the host resolver is the default **and** no flow configures its own. A flow-scoped route whose effective resolver is the default is open.
- **Mixed app** (some flows authenticate, host fallback is the default): `host`/`user` routes aren't refused. The guard computes `anonymousFlowIds`, the **instance ids** (not kinds, since collection members can authenticate differently) without their own resolver, and handlers withhold rows whose owner (`flowId`, or the singleton a legacy row's `flowKind` implies) isn't in it. The two listings instead judge authenticated instances' rows through those instances' resolvers; `check_interrupted_requests` leaves them alone.
- With a host resolver, `list_sessions` scopes the store query to that principal. If an instance's resolver names the caller as someone else, the query runs unscoped and every row is judged in the handler (pages may come back short; the `userId` query param becomes the store filter, still judged after). A caller the host resolver refuses gets 401 on listings regardless of instance resolvers.

### Binding mismatches

A request naming an existing session whose stored `userId` differs from the principal is rejected (`UserBindingMismatchError`) at admission, before acknowledgement, and again on every path that loads a session. Over HTTP it's `404 Unknown session`. See [State and Scopes](./state-and-scopes.md#a-session-id-is-an-address-not-an-ownership).
