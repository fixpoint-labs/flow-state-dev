# Facts for state-and-scopes.md

Paths are from the repo root. `core` = `packages/core/src`; `eng` = `packages/engine`; `ed` = `apps/docs/docs/fundamentals/state-and-scopes.md` (the existing page); `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`.
Where the existing page and the code disagree, the code wins and the row says so.

## The four scopes
- There are four scopes: request, session, user, org. | core/types/scope.ts:7 (`ScopeType`)
- A flow declares each scope's state shape in `defineFlow({ request, session, user, org })`, each with a `stateSchema`. | core/types/flow.ts:415-416 (`RequestConfig`), 358/368 (`SessionConfig.stateSchema`), 480-481 (`UserConfig`), 487-488 (`OrgConfig`); core/types/flow.ts:626-629
- A block can also declare the fields it touches: `requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema` on handler, generator, router. | core/blocks/handler.ts:84-87; core/blocks/generator.ts:549-552; core/blocks/router.ts:114-117
- Inside a block, `ctx.request`, `ctx.session`, `ctx.user` are always present; `ctx.org` is typed optional. | core/types/block.ts:338-341
- (Reference row, not on the page; the example guards `ctx.org?.`) `ctx.org` is present on every execution: every execution runs in an organization. | eng/test/context.test.ts:82-83; ed:503; apps/docs/docs/server/authentication.md:52-56
- Each handle has `identity` and a read-only `state`. | core/types/scope.ts:220-221, 246 (request), 298, 305 (session), 329-330 (user), 336-337 (org)
- All four handles carry the same write verbs: `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`. | core/types/state.ts:34-47; core/types/scope.ts:249, 324, 331, 338
- Every verb resolves `true` if state changed and `false` if the update equalled the current state. | core/types/state.ts:25-33
- Full verb behaviour (concurrent writes, versions) is Reference; the page links to `reference/state-operations`. | ed:12, 76

## Session
- A session is one conversation. A request names a session by `sessionId`; the next request with the same id sees what the last left. | ed:35; eng/test/binding-immutability.test.ts (session reuse across requests)
- Session state is declared in `defineFlow({ session: { stateSchema } })`; `ctx.session.state.<field>` is typed from it. | core/types/flow.ts:358-368; hc:84-90; hc:60-66 (handler reads `ctx.session.state.messageCount`, writes with `patchState`)
- Smallest working example in the repo: a flow with `session.stateSchema = z.object({ messageCount: z.number().default(0) })` and a handler that does `ctx.session.patchState({ messageCount: count + 1 })`. | hc:25-27, 58-66, 84-90
- A block's `sessionStateSchema` types `ctx.session.state` in that block; defaults come from the flow's merged schema (its own `stateSchema` plus every block-declared scope schema); writes validate against the flow's own. Reference row; the page only links. | hc:20-26, 54-57 (comments); ed:100-102; core/types/flow.ts:840-849 (flow's merged schemas the defaults come from)
- Defaults apply when a record loads: a field the stored record lacks reads as its schema default; stored values read as stored; keys the schema does not declare are kept. This holds for session, user and org. | eng/test/scope-state-defaults.test.ts:93-102, 104-129 (keeps another flow's keys), 131-
- Defaults also apply to `incState` on a defaulted counter and `pushState` on a defaulted array. | eng/test/scope-state-defaults.test.ts:206, 219
- A session is bound to one user and one organization at creation. A later request that names another org is rejected with `OrgBindingMismatchError`; one for another user with `UserBindingMismatchError`. A session created with no org cannot be bound to one later. | eng/test/binding-immutability.test.ts:128-135, 150-164 (late bind), 33-34
- A session record carries the user and org it names; it does not hold their state (those are separate records). | eng/src/stores/types.ts:1888-1891 (`session`, `request`, `user`, `org` are four separate stores); ed:27
- A flow can mark a session field `.readonly()`: set at create, never changes; a client sees it without `expose`. | core/types/flow.ts:358-366; eng/test/session-read-projection.test.ts:158-179
- Session also holds items, metadata, journal, session resources; the page names them and links on. | core/types/scope.ts:299-312; ed:143-180
- Creating a session is `fsd.flow(address).createSession({...})`, returns `sess_<id>`. | ed:184 (client package; Reference for the call)

## Request
- Request state belongs to one action run. `RequestConfig.stateSchema` declares it. | core/types/flow.ts:415-416; eng/test/execution.test.ts:1338
- It is stored on that request's own record, keyed by the request id, and starts as `{}` (or the seed the host passes). A second request has its own id and its own record, so it cannot read what the first wrote. | eng/src/context/initial-request-record.ts:49, 66-67, 92; eng/src/stores/types.ts:1889 (`request: RequestStore`)
- Request writes publish no change notice to other views; session, user and org writes do. | eng/src/context/createExecutionContext.ts:3168-3171
- A request-state write emits a `state_change` item with `scope: "request"` on the same response as other scopes. | eng/test/execution.test.ts:1376-1393 (`requestItems[0].delta` `{ phase: "running" }`)
- Request state cannot be sent to the browser: `RequestConfig` has no `client` field. | core/types/flow.ts:415-479 (no `client`); client is on 375, 484, 491 only
- `ctx.request` also carries `identity`, `incarnation`, `attachments`, `tokenUsage`, `costEstimate`; not for this page. | core/types/scope.ts:220-248
- Request state is separate from block-instance state (`ctx.self`), which is Reference (`reference/blocks`). | core/types/block.ts:344-352

## User
- User state follows one user across all their sessions and flows in one organization. | eng/src/stores/scope-keys.ts:156-164, 82-95
- Declared with `defineFlow({ user: { stateSchema } })`; read as `ctx.user.state`. | core/types/flow.ts:480-481, 628; eng/test/scope-state-defaults.test.ts:70
- The record is keyed by user and org: `<user>:~org:<org>`. Alice in `acme` and Alice in `globex` have two records, and each keeps its own. | eng/test/user-cell-keys.test.ts:47-52 ("gives one user a different cell in each org"); eng/src/stores/scope-keys.ts:156-164
- In a second org the user's field reads its schema default until written there; nothing carries over from the first org. | eng/test/user-cell-keys.test.ts:47-52; eng/test/scope-state-defaults.test.ts:93-102
- A request on a session that names another org than the one it was created with is rejected with `OrgBindingMismatchError`. | eng/test/binding-immutability.test.ts:128-164
- With a missing or malformed org id the key builder throws `OrgRequiredError` instead of building a key every org would read. | eng/src/stores/scope-keys.ts:103-107 (`userCellKey`), eng/test/user-cell-keys.test.ts:6-8
- Inside one organization every flow on the server shares the user's one record. Two flows with incompatible user `stateSchema` fail at registration with `CrossFlowSchemaConflictError`; the message names `isolateUserState`. Reference row; the page says only that flows share the record unless one opts out. | eng/test/flow-isolation.test.ts:298-309; eng/src/registry/flow-registry.ts:33, 73; apps/docs/docs/advanced/flow-isolation.md:20-33
- `isolateUserState: true` gives that flow copy its own record: `<user>:~org:<org>:<flow id>`. | core/types/flow.ts:697; eng/test/user-cell-keys.test.ts:40-45; eng/src/stores/scope-keys.ts:156-164; apps/docs/docs/advanced/flow-isolation.md:53
- The isolation namespace is the registered instance id, not the kind. | core/types/flow.ts:686-691
- Flipping isolation on an existing flow does not move data. Reference (`reference/flows`). | apps/docs/docs/advanced/flow-isolation.md:117
- `ctx.user.state` reads a field's default on a brand-new user. | eng/test/scope-state-defaults.test.ts:93-98

## Org
- Org state is shared by every user and every session in the organization. | eng/src/stores/scope-keys.ts:196-203 (`resolveOrgStorageKey`: key is the org id alone)
- Declared with `defineFlow({ org: { stateSchema } })`; read as `ctx.org?.state.<field>`. | core/types/flow.ts:487-488, 629; eng/test/scope-state-defaults.test.ts:101
- Org records are keyed by the bare org id; `isolateOrgState: true` makes it `<org>:<flow id>`. | eng/src/stores/scope-keys.ts:196-203; core/types/flow.ts:700; eng/test/flow-isolation.test.ts:149-165
- `isolateUserState` and `isolateOrgState` are independent flags. | core/types/flow.ts:697-700; apps/docs/docs/advanced/flow-isolation.md:53
- Two flows with incompatible org schemas fail at registration the same way. | eng/test/flow-isolation.test.ts:333-343
- Where the org comes from (never the caller): the authentication page. Link to C-17 / `server/authentication`. | apps/docs/docs/server/authentication.md:52-58

## Who sees what (second figure: Alice and Bob in one org)
- Alice and Bob in `acme`: each has two sessions (each its own record), one user record each (`alice:~org:acme`, `bob:~org:acme`), one org record (`acme`). | eng/src/stores/scope-keys.ts:156-164, 196-203 (key forms); eng/test/user-cell-keys.test.ts:47-62 (resourceScopeIds `alice:~org:acme`, org `["acme"]`)
- A user's state is never read by another user; the org's state is read and written by both. | same keys as above (the user key contains the user id; the org key does not)
- Org state is therefore the shared one: two writes from two users land on one record. | eng/src/stores/scope-keys.ts:196-203
- A tenant id (header `x-tenant-id`) splits sessions only; user and org records do not key on it. | core/types/scope.ts:14-27; eng/src/stores/scope-keys.ts:211-219 (`resolveSessionStorageKey`); eng/test/tenant-id-context.test.ts. Detail is C-17; the page may mention it in one sentence or link.

## What the browser may see
- A scope's state is private unless the flow lists fields in that scope's `client.expose`. A flow with no `client` sends an empty `state`. | core/types/flow.ts:54-63, 372-375; eng/test/session-read-projection.test.ts:128-136
- `client: { expose: ["messageCount"] }` is the whole config: the only key of `ScopeClientConfig` is `expose`. | core/types/flow.ts:65-67; hc:89
- `client` exists on `session`, `user` and `org`; not on `request`. | core/types/flow.ts:375, 484, 491
- `expose` names must be top-level keys of that scope's `stateSchema`; an unknown name makes `defineFlow` throw `Flow "<kind>" <scope>.client.expose names key(s) not on <scope>.stateSchema: ... Valid keys: ...`. | core/flow/defineFlow.ts:105-120
- Exposed values arrive as `clientData.<scope>.<name>` on the session snapshot, copied verbatim. | core/types/flow.ts:59-61; eng/src/routes/route-utils.ts:394-410
- A defaulted field the stored record never held is exposed with its default. | eng/test/scope-state-defaults.test.ts:258-289, 388-389
- A readonly session field is visible to the client even when not exposed. | eng/test/session-read-projection.test.ts:158-179
- In React, `useClientData(session, { session: ["messageCount"], user: [...], org: [...] })` returns `{ session: { messageCount }, ... }`; each scope key is optional. | react/src/hooks/useClientData.ts:20-30, 89-96, 104-122
- Code contradicts the existing page: `client.derived` was removed. `defineFlow` throws `Flow "<kind>" <scope>.client declares "derived", which was removed. Declare a view instead: views: { name: defineView({ scope: "<scope>", block }) } in defineFlow, read with useView or client.view.` A value computed for a screen is a view. The page must not show `derived`. | core/flow/defineFlow.ts:97-104; core/types/flow.ts:61-63
- Views are the way to send a computed value: a view has a scope and writes nothing. Link, do not explain. | core/types/flow.ts:612-620
- `useClientData` with a name list types each value `unknown` (a schema map types it from the schema), so the page wraps `user.plan` in `String`. | react/src/hooks/useClientData.ts:32-64
- `ctx.org` is typed optional but every execution runs in an organization; the page says the type allows it missing and guards with `?.`. `ctx.request`/`session`/`user` always set. | core/types/block.ts:338-341; eng/test/context.test.ts:82-83
- Secret fields: to keep an internal score from the browser, leave it out of `expose`. | core/types/flow.ts:372-374; eng/test/session-read-projection.test.ts:128-136

## Who owns, who sees, where stored, how many (per stored part)

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| Request state | The one request that created it; the flow's `request.stateSchema` shapes it | Blocks of that request (`ctx.request`); never the browser (no `client` on request) | The request's own record in the request store, `state` slice, keyed by request id | One per request. eng/src/context/initial-request-record.ts:66-92; core/types/flow.ts:415-479 |
| Session state | The session, bound to one user and one org at creation | Blocks running in that session; the browser only for `expose`d fields and readonly fields | The session store, key `<sessionId>` (or `<tenant>:<sessionId>` when a tenant id is sent) | One per session. eng/src/stores/scope-keys.ts:211-219; eng/test/binding-immutability.test.ts:128-164 |
| User state | One user inside one organization | Blocks in any session that user runs in that org, in any flow that shares the record; the browser for `expose`d fields, to that user's views | The user store, key `<user>:~org:<org>`, plus `:<flow id>` with `isolateUserState` | One per (user, org); one more per flow instance that isolates. eng/src/stores/scope-keys.ts:156-164; eng/test/user-cell-keys.test.ts:40-52 |
| Org state | The organization | Blocks of every user and session in the org; the browser for `expose`d fields | The org store, key `<org>`, plus `:<flow id>` with `isolateOrgState` | One per org; one more per flow instance that isolates. eng/src/stores/scope-keys.ts:196-203 |

Default store: in memory, gone on restart; file, SQLite and Postgres persist. | apps/docs/docs/persistence/overview.md:5, 25-30 (link, do not list)
User-scoped and org-scoped data are held by stores only if the record is written; a record with no writes reads as defaults. | eng/test/scope-state-defaults.test.ts:93-102

## What it gets you (observable, tied to one example)
- A field stays across requests in a session without the caller sending it again. | ed:35; hc:60-66
- A user's field is there in a brand-new conversation. | eng/test/scope-state-defaults.test.ts:93-98 (new user reads defaults); eng/src/stores/scope-keys.ts:156-164
- Changing org state is seen by the next request of every user in that org. | same key for every user (scope-keys.ts:196-203)
- Types: `ctx.session.state.mode` is typed from the Zod schema; a typo is a compile error. | core/types/scope.ts:305; hc:62-64
- Default privacy: adding a field to a schema does not send it to the browser. | eng/test/session-read-projection.test.ts:128-136
- Live updates: session, user and org writes publish a change notice; a view opened with `useSession(id, { live: true })` hears user and org changes from other sessions. | eng/src/context/createExecutionContext.ts:3168-3171; ed:465 (existing page, React detail is `reference`)

## How it fits with the others (neighbours, one clause each, no explanation)
- Resources are typed stored data a flow declares, with a `scope` of their own; state is a flow's fields on the scope record. | core/types/flow.ts:633-641 (`resources`, "intrinsic `scope`"); ed:180
- Block state (`ctx.self`, `ctx.parent`) lives and dies with one run and is addressed by block, not identity. | core/types/block.ts:344-352; ed:525-527 (Reference: `reference/blocks`)
- Views read scoped state for a screen. | core/types/flow.ts:612-620
- `ctx.settings` is read-only instance config, not state. | ed:31

## Limits stated flat (Reference rows link; not explained on the page)
- Request state has no `client` block. | core/types/flow.ts:415-479
- `expose` accepts top-level field names only. | core/types/flow.ts:66; core/flow/defineFlow.ts:106-120
- A session cannot change org or user after it is created. | eng/test/binding-immutability.test.ts:128-164
- A user's records in two orgs are separate; there is no cross-org user state. | eng/test/user-cell-keys.test.ts:47-52

## Needs a decision from the writer or flagged for the page
- Example cast: the plan asks for the "support cast"; none of the code above uses it. Field names (a plan, a score) are the page's to invent. The example must declare its schemas, so every name used is made up in the page and not a fact here.
- `request` row: no repo example sets `requestStateSchema` outside tests (eng/test/execution.test.ts:1338). The page's request example is hypothetical and typed against `RequestConfig`.
- Unverified: whether a request to a new session id on a flow with no `sessionId` creates an `ephemeral_` session; left out. ed:186 states it; not checked.
- Dropped from the old page, no observable surface: nothing on `derived`, `CAS`, schema bubbling beyond the type remark above.
