# Facts for State and scopes (C-07, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. Where a line is in `packages/engine/src` it is a doc comment or a route's behaviour that a test or a run also shows; the page states the behaviour, never the mechanism.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`
- `eng` = `packages/engine`
- `rx` = `packages/react/src`
- `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`
- `old` = `apps/docs/docs/fundamentals/state-and-scopes.md`
- `ops` = `apps/docs/docs/fundamentals/state-operations.md`
- `mm` = `apps/docs/docs/state/mutation-model.md`
- `iso` = `apps/docs/docs/advanced/flow-isolation.md`
- `pe` = `apps/docs/docs/persistence/overview.md`
- `au` = `apps/docs/docs/server/authentication.md`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/state-operations`, `reference/blocks`, `reference/flows` or another Reference page; the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[ran]** observed by running code in this pass (section 9). **[conflict]** two sources disagree; the code wins and the note says which source is wrong.

The page's one app is the support desk used by the Blocks page (flow `support`, sequencer `handleTicket`, generator `draftReply`, tool block `lookUpOrder`). Its customer's plan is the page's running state field (`plan`). Fields and names in the examples below are the page's, not the code's.

## 1. Opening: what state is for, and the four places

- State is typed data a flow keeps between steps and between requests. It is declared with a Zod schema and read and written through `ctx`. `core/types/block.ts:338-341` (`ctx.request`, `ctx.session`, `ctx.user`, `ctx.org?`); `core/types/scope.ts:220-338` (the four handles each carry `state` and the write operations). [page]
- Exactly four scopes: `"request" | "session" | "user" | "org"`. `core/types/scope.ts:7`. [page]
- Each scope is its own record with its own key; none sits inside another. `old:16`, `old:24` (the figure's description: "four separate records, none inside another"). [page; figure 1 claim]
- A session names the user and the organization it belongs to. It does not hold their state: each scope is read and written on its own record. `old:27`. [page]
- What each scope is for, and how long it lasts, as the old page's table states it: request, "one action execution"; session, "across requests in a conversation"; user, "across sessions for a user, per organization"; org, "across sessions in an org". `old:18-23`. [page]
- Not everything on `ctx` is state: read-only instance config arrives as `ctx.settings`. `old:31`. [ref: reference/flows; the page does not mention it unless a reader would confuse the two]
- Resources (named typed containers) are a separate thing from state. A resource's own `scope` decides where it persists. `core/types/flow.ts:352-356` (doc comment: per-scope configs "carry only state and client-data hooks. Resources live in the flow-level `resources` field"). [page, one clause, link to Resources]

## 2. The four scopes, by how long each lasts and who shares it (figure 1)

Each stored part, with the four questions the standard asks (who owns it, who can see it, where it is stored, how many exist).

| Part | Owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| Request state | the one request that created it | blocks running in that request; the browser never (no `client` config exists for it) | on that request's record, in the store, written on every mutation | one per request |
| Session state | the session, which belongs to one user in one organization | blocks in any request of that session; the browser only for `expose`d fields | on the session record, in the store | one per session |
| User state | the user, in one organization | blocks in any session of that user in that organization, from any flow that does not isolate it | on a user record keyed by user and organization | one per (user, organization); one per flow copy more if `isolateUserState` |
| Org state | the organization | blocks in any session of any user in that organization, from any flow that does not isolate it | on an org record keyed by the organization | one per organization; one per flow copy more if `isolateOrgState` |

Facts behind each cell:

### Request

- Request state is scratch space for one run: intermediate results, retry counters, temporary flags. `old:473-476`. [page]
- A second request does not see what the first put in request state. Observed: after request `r1` patched `tries: 3`, request `r2` in the same session read `{}`. Each request has its own record. [ran, section 9]; `eng/test/context.test.ts:60-91` (the state sits on the record for the request's id: `stores.request.get("req_1")` holds `{ count: 2 }`). [page; answers Q2]
- Request state is written to the store on every mutation, so a paused request can restore it when it continues. `mm:51`. [ref: reference/state-operations; the page may say "it is stored with the request"]
- **[conflict]** `pe:109-117` says request state "lives for one action execution, then discarded" and that the request scope is "ephemeral". `mm:51` and `eng/test/context.test.ts:86-91` show it is written to the request record. The page does not say "ephemeral" or "discarded"; it says request state belongs to one request and no other request reads it. Flag `pe:109-117` for the persistence page's editor.
- Declared on the flow as `request: { stateSchema }`, or on a block as `requestStateSchema`. `core/types/flow.ts:415-416`; `core/blocks/handler.ts:84`. [page: one line]
- `RequestConfig` has no `client` field: request state cannot be exposed to the browser. `core/types/flow.ts:415-436` (the fields: `stateSchema`, hooks, `mutationTimeoutMs`, `concurrency`). [page; part of Q4's answer]
- Request state does **not** read a schema default: with `request: { stateSchema: z.object({ tries: z.number().default(0) }) }`, a fresh request read `{}`, not `{ tries: 0 }`. [ran, section 9]. A block that reads it should not rely on a default. [verify the reason; the page may say "start with `?? 0`" in no example; keep off the page unless an example reads request state before writing it]
- `ctx.request` also carries `identity`, `incarnation`, `attachments`, `tokenUsage` and `costEstimate` beside `state`. `core/types/scope.ts:220-250`. [ref: reference/blocks]

### Session

- A session is one conversation. A request sent with a `sessionId` loads that session's state, runs the action and persists changes. The next request with the same id picks up where the last left off. `old:35`. [page]
- Session state persists across requests. Observed: `s: 1` written by `r1` read back as `{ s: 1 }` in `r2` of the same session. [ran, section 9]. [page]
- A new session starts with the schema's defaults: a second session of the same user read `{ s: 0 }`. [ran, section 9]. [page]
- Most state lives at the session level; session is where to start. `old:29`. [page: "Session first"]
- A block declares the session fields it touches with `sessionStateSchema`; `ctx.session.state` is typed from the schema. `core/blocks/handler.ts:85`; `hc:60-67` (a counter block with `sessionStateSchema: z.object({ messageCount: z.number().default(0) })`); `old:37-61`. [page; example 2]
- The flow declares session state with `session: { stateSchema }`; `hc:28-30`, `hc:88-91`. `core/types/flow.ts:358-368`. [page; example 1]
- Block declarations bubble up and merge into the flow's combined session schema, so a block declares what it needs and the flow need not repeat it. `old:78-135`. [ref: reference/blocks; one sentence on the page, because it explains why `sessionStateSchema` sits on a block]
- Block declarations shape the types; they do not fill defaults on read. Only the flow's own `stateSchema` fills defaults. `old:102`. [ref: reference/flows; the page's example declares the field on the flow]
- A session belongs to one user and one organization, set when it is created. It cannot be moved to another organization: a request that resolves to a different one fails with `OrgBindingMismatchError`. Observed: session `s1` created under `acme`, then opened with organization `globex`, threw `OrgBindingMismatchError`. [ran, section 9]; `old:505`; `eng/src/context/binding-errors.ts:46-51` (doc: "Org binding is immutable for the lifetime of a session"); exported from `eng/src/host.ts:218`. [page: the guarantee only, no error name; the refusal and `OrgBindingMismatchError` go to the Reference session-consistency row]
- A tenant id (header `x-tenant-id` by default) splits **sessions only**: two tenants using one session id get two session records, session state and session-scoped resources. User and org state are shared across tenants. `core/types/scope.ts:11-26`; `old:511-521`; `pe:256-268`; `eng/test/user-cell-keys.test.ts:91-95` (session key `t1:s1` for tenant `t1`, bare `s1` otherwise). [ref: C-17 tenancy; the page names the limit "a tenant id splits sessions only" in one clause and links]
- Beyond state, a session also holds items, metadata, a journal and resources. `core/types/scope.ts:295-323` (`items`, `metadata`, `appendJournal`, `getJournal`, `setMetadata`). `old:141-180`. [ref: reference/blocks and C-06; the page says "a session holds more than state" in one clause and links]
- Initial state can be supplied when a session is created; it is parsed through the flow's session `stateSchema`, so missing fields take defaults. `old:188`. [ref: reference/flows]
- `session.serverOwned` lists fields only the flow's code writes; a create that sets one is refused with a 400 naming the field. `core/types/flow.ts:401-406`; `old:196-205`. [ref: reference/flows]
- A `.readonly()` field is set at creation and never changes. `core/types/flow.ts:361-367`. [ref: reference/flows]
- `session.createCheck` runs on every path that creates a session and accepts or refuses the create. `core/types/flow.ts:392-399`. [ref: reference/flows]
- Other users cannot list your sessions: a listing narrows to the caller's own sessions. `old:396-398` (the old page's listing example: "another user's sessions on the same project never show up"). [verify as a general claim: the old page says it of a state-filtered listing; do not state it on the page]

### User

- User state follows a person from conversation to conversation: preferences, accumulated knowledge, personal collections. `old:481-491`. [page]
- User state belongs to a user inside one organization: the same user in two organizations has two user records, and nothing she saves in one shows up in the other. `old:491`; `eng/test/user-cell-keys.test.ts:36-62` ("gives one user a different cell in each org"); `goals/user-scope/keeps-a-users-data-in-the-org-it-was-saved-in/goal.md:4` (Alice saves in Acme and reads it back there; in Globex, and for Bob in Acme, the same flow reads none). [ran, section 9: alice in `globex` read `plan: "free"`, not `"pro"`]. [page; answers Q1's neighbour]
- It crosses sessions: after `r1` set `plan: "pro"`, a new session `s2` of the same user in the same organization read `{ plan: "pro" }`. [ran, section 9]. [page; answers Q1: the customer's plan follows them into every conversation, so **user** scope]
- A different user in the same organization read the schema default (`plan: "free"`), not Alice's value. [ran, section 9]. [page]
- Every flow on the server shares one user record per (user, organization), so a field declared by two flows is one field. `iso:7-17`. [ref: reference/flows; the page links in one sentence and does not state the same-type rule]
- Each flow's user state schema is compared at registration; incompatible declarations throw `CrossFlowSchemaConflictError` from `FlowRegistry.register`, before any data is corrupted. `old:491`; `eng/test/flow-isolation.test.ts:298-310` (rejects two flows with incompatible `user.stateSchema`). `iso:22-34`. [ref: reference/flows; the page may say "two flows that declare the same field differently are refused at startup" in one clause]
- `isolateUserState: true` gives that flow its own user record, still inside the organization; `isolateOrgState: true` does the same for org state; the flags are independent. `core/types/flow.ts:685-700`; `iso:36-56`; `eng/test/flow-isolation.test.ts:149-198` (shared cell when off, instance-keyed when on, user and org independent). [ref: reference/flows; the page names the setting once and links]
- A copy of a collection flow keeps its isolated state per copy (`review-east`, `review-west`), not per definition. `iso:58-77`; `goals/flow-instances/keeps-private-data-with-the-copy/goal.md:4`. [ref: reference/flows and C-02/C-03's flow-copy story; keep off the page]
- Declared as `user: { stateSchema }` on the flow, or `userStateSchema` on a block. `core/types/flow.ts:480-485`; `core/blocks/handler.ts:86`. [page]
- The user's state is read as `ctx.user.state`; written with the same operations as every scope (`patchState`, `incState`, ...). `core/types/scope.ts:326-331`. [page; example 3]

### Org

- Org state is shared by everyone in the organization: configuration, knowledge bases, settings an admin controls for everyone. `old:493-503`. [page]
- Two users in one organization share one org record. Observed: Alice set `licenses: 9`; Bob, a different user in the same organization, read `licenses: 9`; Alice in `globex` read the default `5`. [ran, section 9]; `goals/realtime/scope-changes-reach-other-sessions/goal.md:4` (alice and bob in one org: B's view shows A's org change). [page; answers Q3: what two users in one organization share is the org record; each keeps their own user record and sessions]
- Two users in one organization do not share user state: Bob read `plan: "free"` after Alice set `"pro"`. [ran, section 9]. [page]
- `ctx.org` is typed optional but present on every execution: every request runs in an organization. Read it as `ctx.org?.state.config` in TypeScript. `core/types/block.ts:341` (`org?: OrgScopeHandle`); `old:503`; `au:52-56` ("There is no such thing as a request without one"); `eng/test/context.test.ts:76-78` (comment: org scope "always present"). [ref: the typing note goes beside the `ctx.org` rows of State operations; the page keeps only what org state is for. Documented guarantee: every request runs in an organization]
- Where the organization comes from: from a configured resolver, or `DEFAULT_ORG_ID` in development, and never from the caller. `au:58-66`. [ref: C-17 tenancy and Authentication; the page links]
- Declared as `org: { stateSchema }`, or `orgStateSchema` on a block. `core/types/flow.ts:487-492`; `core/blocks/handler.ts:87`. [page]
- Org state gets the same startup compatibility check across flows as user state, and the same isolation flag. `old:503`. [ref: reference/flows]

### Defaults on read (all three stored scopes)

- When a session, user or org record loads, each field of the flow's `stateSchema` that the record does not hold reads as its default. So `ctx.user.state.count` is `0` on a brand-new user and on one stored before the field was added. `old:190`; `eng/test/scope-state-defaults.test.ts:93-102`. [ran, section 9: a fresh session/user/org read `s: 0`, `plan: "free"`, `licenses: 5`]. [page: one sentence]
- Only missing values are filled. A stored value is read as stored. `eng/test/scope-state-defaults.test.ts:128-136` (`fills only what is missing and keeps present values as stored`). [ref: reference/flows]
- A flow-level default applies on read; a block's `sessionStateSchema` types the field but does not default it. `old:102-104`. [ref]
- A default that is a function (a factory such as `() => Date.now()`) is refused or left as stored in several places; user and org state accept only static defaults. `eng/test/scope-state-defaults.test.ts:590-615`, `:692-702`. [ref: reference/flows; keep off the page]

## 3. Session first (the smallest working example)

The example (the page's app; see section 8 for the code shape):

- Declare a session field on the flow; a block reads `ctx.session.state` and writes with `patchState` or `incState`. `hc:28-30`, `hc:60-67`, `hc:88-91`; `old:37-57`. [page; examples 1 and 2]
- `ctx.session.state` is typed from the schema: a read of `ctx.session.state.mode` is `"chat" | "agent"`, a write of a wrong type is a compile error. `old:59`; `core/types/state.ts:34-47` (`ScopeStateOps<TState>`). [page, one sentence]
- The operations on every scope: `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`. `core/types/state.ts:34-47`; `ops:13-100`. [ref: reference/state-operations; the page shows `patchState` and `incState` and links]
- `patchState` merges fields into existing state; `incState` is an atomic numeric increment. `old:42-57`; `ops:19-58`. [page: "adds to a number" and "merges fields" only; atomicity and concurrency go to the State operations row]
- Each operation's resolved boolean: `true` when the write changed state, `false` when the proposed state equalled the current one. `core/types/state.ts:25-33` (doc comment); `ops:145-160`. [ref: reference/state-operations]
- Two runs writing different keys both land; two runs writing the same key: the second replaces the first and both report success. `old:76`; `ops:246-294`. [ref: reference/state-operations; the page links "what happens when two requests write at once"]
- The write is not committed until the call resolves; a write that was given up on may still land. `mm:282`. [ref]
- `ctx.session.state` is `Readonly` in its type: write through the operations, not by assigning. `core/types/scope.ts:305` (`state: Readonly<TState>`). [page, one clause]
- In the example app, `hello-chat` shows the whole path: the flow declares `session: { stateSchema, client: { expose: ["messageCount"] } }`, a block `incrementMessageCount` reads `ctx.session.state.messageCount ?? 0` and patches it, and the pipeline runs it with `.tap(...)`. `hc:28-30`, `hc:58-67`, `hc:68-73`, `hc:88-91`. [page: model for examples 1, 2, 4]
- The `?? 0` there is unneeded when the flow declares the default, as the flow does. `hc:28-30` with `eng/test/scope-state-defaults.test.ts:93-102`. [page: write the example without `?? 0`]

## 4. State a user carries between conversations; state an organization shares

- Reading and writing are the same operations as session state, on `ctx.user` and `ctx.org`. `core/types/scope.ts:326-338`. [page; example 3]
- The scope decides who shares a field, not the operation. Q1's answer: the customer's plan follows them into every conversation, so it is user state. [page]
- The choice rule on the old page, for request vs session: "if the next request might care, use session." `old:478`. [page: the whole-page rule of thumb, extended to user and org]
- A user's state reaches only that user's views; org state reaches every view in that organization. `old:465`; `goals/realtime/scope-changes-reach-other-sessions/goal.md:4-12` (legs b and a). [page: the second figure's claim]
- Live views: a view created with `useSession(id, { live: true })` hears another session's user or org changes, and a run's with no browser attached. `old:465`; `goals/realtime/scope-changes-reach-other-sessions/goal.md:4-12`. [ref: C-06 and `reference/react`; one clause at most]
- The same user in two organizations, and flows that share or isolate state, are what the second figure shows: Alice and Bob in one organization have two sessions each, one user record each, one org record. [page; figure 2; the counts are from the table in section 2 and [ran]]

## 5. What the browser may see

- Raw state never reaches the client. Session, user and org each take a `client` config; only fields it exposes cross. A scope with no `client` exposes nothing. `old:419-420`, `old:457-459`; `core/types/flow.ts:53-67` (doc comment: "Absent or empty means the scope's state is private to the server"). [page; answers Q4]
- `client: { expose: ["messageCount"] }` passes the named top-level fields through verbatim. `core/types/flow.ts:65-67`; `hc:88-91`. [page; example 4]
- `expose` names must be top-level keys on that scope's `stateSchema`; one that is not throws at `defineFlow`, naming the valid keys. `core/flow/defineFlow.ts:106-118`; `old:459`. [ref: reference/flows; one clause on the page is fine]
- The other half of the old page is wrong: `client.derived` no longer exists. A flow that declares `derived` throws at `defineFlow` with a message naming the replacement, a view. `core/flow/defineFlow.ts:97-104`; `core/test/flow.test.ts:999-1010`. **[conflict]** `old:424-455` and `old:535` document `derived`, `client.expose` + `derived` sharing a namespace, and a `derived` compute function on the flow config. The code wins. The page teaches `expose` for a field as it is, and **a view** for a value computed from it, linking to C-12 (Views) and not explaining views. [page]
- A view is declared `defineView({ scope: "session" | "user" | "org", block, key? })` and installed in the flow's `views` map; read with `useView`. `core/flow/defineView.ts:12-30`, `:33-62`; `rx/hooks/useView.ts:49`. [ref: the Views concept page; the page links in one clause]
- The state route is "strictly client-shaped": it returns `clientData` per scope, built from the exposed fields only, with defaults applied. `eng/src/routes/state-routes.ts:84-87`, `:107-114` (comment), `:150-170`; `eng/test/registry-routes.test.ts:48-62`, `:397-440` (a flow with `client: { expose: [...] }` on session, user and org answers `clientData.session.sessionInfo`, `.user.userInfo`, `.org.orgInfo`). [page: "what the browser may see is what you expose"]
- A field not in `expose` stays on the server. Q4's answer: leave it out of `expose`; adding a field to the schema does not leak it, because exposure is by name. `old:457`; `core/types/flow.ts:53-64`. [page]
- On the client, `useClientData(session, { session: ["messageCount"], user: ["preferences"], org: [...] })` returns the values grouped by scope. It takes a session view from `useSession` and one list of names per scope. `rx/hooks/useClientData.ts:15-40` (the option types), `:89-130`. [page: example 4, one hook line]
- The values live at `snapshot.clientData.<scope>.<name>` on the session view. `rx/hooks/useClientData.ts:102-120`; `old:449`. [ref: reference/react]
- `useClientData` reads only the names asked for; a name the flow did not expose reads `undefined`. `rx/hooks/useClientData.ts:78-84` (`source[name]` over a missing name gives `undefined`). `eng/src/routes/session-routes.ts:453` (comment: unexposed `clientData[scope]` keys are `undefined`). [verify: the second source is a comment in a route, not seen running; keep off the page]
- During a run, a state change signals the client over the stream as a `state_change` item. A `state_change` item reaches only the view that sent the request; user and org changes reach other views through live views. `old:461-465`. [ref: C-06 and `reference/streaming`; the page may mention "the browser sees changes as they happen" in no more than a clause, or not at all]
- Request state has no `client` and no view scope: views are `session`, `user` or `org`. `core/flow/defineView.ts:14` (`VIEW_SCOPES`); `core/types/flow.ts:415-436`. [page; consistent with the Q4 answer for request scratch]
- Q4 end to end (internal score): leave `score` off the scope's `expose` list. A browser asking for `score` through `useClientData` gets nothing; a block on the server still reads and writes it. [page; each half is above]

## 6. What it gets you (the "what it buys" section; each point something observable)

- Typed state: a block reads `ctx.session.state.plan` typed from its Zod schema; a wrong-typed read or write is a compile error. `old:59`; `core/types/block.ts:338-341`. [page]
- Lifetime chosen by where you put the field: request for one run, session for one conversation, user for one person across conversations, org for everyone in the organization. [ran, section 9: the same field read `{}` / `1` / `"pro"` / `9` across the three boundaries]. [page]
- No filtering code: a user in two organizations has two user records, so a block never writes `where orgId = ...`. `goals/user-scope/keeps-a-users-data-in-the-org-it-was-saved-in/goal.md:4`; `eng/test/user-cell-keys.test.ts:36-62`. [page]
- Defaults on read: a field added later reads its default on every existing record, so no migration is needed for a new field with a static default. `old:190`; `eng/test/scope-state-defaults.test.ts:93-102`, `:350-368` (fills a stored record that lacks the field, keeps what it holds). [page]
- Nothing leaks by accident: the browser sees what `expose` names and nothing else. `old:457`. [page]
- Concurrent writes to different fields of one scope do not overwrite each other. `old:76`; `ops:246-269`. [ref; one clause on the page, linking]

## 7. How it fits with the others

- State is typed data on a scope. Resources are named typed containers of structured data and rich content, with their own scope. `old:174-176`; `core/types/flow.ts:352-356`. [page: one sentence; link Resources]
- Items (what a run streams, and a session's timeline) are not state: a session's items live beside its state on the session. `core/types/scope.ts:295-323`; `old:143-153`. [page: one sentence; link C-06]
- Block state and sequencer state are state tied to one execution, not to an identity: a generator remembering what it has loaded, a sequencer counting its own loop passes. They live and die with one run. `old:525`; `apps/docs/docs/advanced/block-state.md`; `apps/docs/docs/advanced/sequencer-state.md`. `core/blocks/sequencer-methods.ts` is not read here. [ref: reference/blocks; the page names them once and links]
- The 'in-memory only, never persisted' claim for sequencer state is on `pe:109-117`; this pass did not confirm it by running. [verify; keep off the page]
- Memory (the cross-turn memory system) is a package that stores into these scopes; not read in this pass. [verify; keep off the page]
- Tenancy and where `userId`/`orgId` come from are C-17's. `old:511-523`, `au:52-66`, `pe:198-268`. [ref: C-17]
- Where state is kept: in memory by default (gone when the process exits), or in a store adapter (file, SQLite, Postgres). `pe:30-45`. Session, user and org state are persisted; the choice of store is the app's. `pe:109-117`. [ref: Persistence; the page says "stored in the store you configure" in one clause]

## 8. Examples (page's app, each one idea)

The page's app has flow `support`. State fields below are the page's; types and calls are the code's. Every call named here exists as written.

1. **Declare session state, a schema on the flow** (`src/flows/support/flow.ts`). `defineFlow({ kind: "support", actions: { ... }, session: { stateSchema: z.object({ ticketCount: z.number().default(0) }) } })`. Shape as in `hc:88-91` and `core/types/flow.ts:368`. The default makes a fresh session read `0` ([ran, section 9]).
2. **Read and write it** (`src/flows/support/blocks/count-ticket.ts`). A `handler` with `sessionStateSchema: z.object({ ticketCount: z.number().default(0) })`, `execute` reads `ctx.session.state.ticketCount` and calls `await ctx.session.incState({ ticketCount: 1 })`. `core/blocks/handler.ts:85`; `hc:60-67` (the same block, with `patchState`); `core/types/state.ts:34-47` (`incState(increments: Record<string, number>)`). `incState` returns `Promise<boolean>`.
3. **User and org state** (`src/flows/support/blocks/greet-customer.ts` or the flow). Flow declares `user: { stateSchema: z.object({ plan: z.string().default("free") }) }` and `org: { stateSchema: z.object({ licenses: z.number().default(5) }) }`; a block reads `ctx.user.state.plan` and `ctx.org?.state.licenses`, writes with `await ctx.user.patchState({ plan: "pro" })`. `core/types/flow.ts:480-492`; `core/types/block.ts:340-341`; [ran, section 9, the same schemas and calls].
4. **Expose a field to the browser, the `client` block** (`src/flows/support/flow.ts` and `app/page.tsx`). `user: { stateSchema, client: { expose: ["plan"] } }`; browser: `const data = useClientData(session, { user: ["plan"] }); data.user.plan`. `core/types/flow.ts:65-67`; `rx/hooks/useClientData.ts:89-130`. A field with no entry, such as `score`, is not in `data`. Do not reprint the flow to add one line: say "add `client: { expose: ["plan"] }` to `user`".
- Type-check note for pass 4: `useClientData` options accept `string[]` or a record of Zod schemas per scope, `rx/hooks/useClientData.ts:15-26`; `SessionView` comes from `useSession`, `rx/hooks/useSession`. `ctx.org` is optional in the type, so `ctx.org?.state.licenses` (the old page writes it that way, `old:503`).

## 9. Observed by running (pass 1)

A scratch test, run under `packages/engine` with `createExecutionContext` over `createInMemoryStores()`, then deleted (no file left in the tree). Flow `scratch` declared `request.stateSchema { tries: number.default(0) }`, `session { s: number.default(0) }`, `user { plan: string.default("free") }`, `org { licenses: number.default(5) }`. Requests `r1..r6`, sessions `s1..s4`.

| Step | Observed |
| --- | --- |
| `r1` (alice, `acme`, `s1`) reads request state | `{}` (the default `tries: 0` is not read) |
| `r1` patches `tries: 3`, `s: 1`, `plan: "pro"`, `licenses: 9` | all four writes land |
| `r2` (alice, `acme`, same session `s1`) | request `{}`, session `{ s: 1 }`, user `{ plan: "pro" }`, org `{ licenses: 9 }` |
| `r3` (alice, `acme`, new session `s2`) | request `{}`, session `{ s: 0 }`, user `{ plan: "pro" }`, org `{ licenses: 9 }` |
| `r4` (bob, `acme`, `s3`) | session `{ s: 0 }`, user `{ plan: "free" }`, org `{ licenses: 9 }` |
| `r5` (alice, `globex`, `s4`) | session `{ s: 0 }`, user `{ plan: "free" }`, org `{ licenses: 5 }` |
| stored request records | `r1` holds `{ tries: 3 }`; `r2` holds `{}` |
| `r6` opens `s1` (created under `acme`) with organization `globex` | throws `OrgBindingMismatchError` |

These answer the page's four questions: Q1 user scope (`plan` survives into `s2`, and `s2` reads `{ s: 0 }` for session state); Q2 no (`r2` read `{}`); Q3 the org record (`licenses: 9` in both, `plan` and sessions separate); Q4 section 5.

## 10. Limits and cautions (state flat, no argument)

- User and org state are shared by every flow on a server unless it opts out, so two flows must agree on a field's type. `iso:7-34`. [page: one sentence, link to Reference]
- Concurrent writes to the same field: the second replaces the first and both calls report success. `old:76`. [ref]
- Initial state a caller supplies is not trustworthy for anything that grants access; a `createCheck` or `serverOwned` guards it. `old:200-203`. [ref: reference/flows; keep off the page]
- Request state cannot be exposed to the browser. `core/types/flow.ts:415-436`. [page]
- A tenant id splits sessions only; user and org state are shared across tenants. `core/types/scope.ts:11-26`. [page, one clause; link C-17]

## 11. Contradictions the page must not copy

1. **`client.derived`** is documented at `old:424-455` and `old:535`; the code refuses it (`core/flow/defineFlow.ts:97-104`; `core/test/flow.test.ts:999-1010`). Teach `expose` and views.
2. **Request state "ephemeral"/"discarded"** at `pe:109-117`; the code and `mm:51` store it on the request record. The page says no other request reads it.
3. **`state_change` / `useClientData` mid-stream claim at `old:461-465`** says `derived` values update with a patch; with `derived` gone this is stale. Keep off the page.
4. **`ctx.org?.state.config`** at `old:503` is correct as a TypeScript call (`org?` is optional); the sentence that follows, "it is there on every execution", is true (`au:52-56`; `eng/test/context.test.ts:76-78`).
5. **Request state defaults.** `old:473-476` shows `requestStateSchema: z.object({ retryCount: z.number().default(0) })` as if the default applied; a fresh request read `{}` ([ran], section 9). The page must not show a request-state field read before it is written.

## 12. Cold-read answer key (for pass 2, from this sheet)

1. Customer's plan follows them into every conversation: **user** scope (section 2, User; [ran]).
2. Second request reads the first's request state: **no**; each request has its own record, so `r2` read `{}` (section 2, Request; [ran]).
3. Two users in one organization share: **the org record** (org state, and the org's shared resources); they do not share user state or sessions (section 2, Org; [ran]).
4. An internal score kept from the browser: **leave it out of the scope's `client.expose`**; nothing outside `expose` crosses, and request state cannot be exposed at all (section 5).
5. Edge: Alice opens a session made in Acme while signed in to Globex: refused with `OrgBindingMismatchError` (section 2, Session; [ran]).
6. Edge: a field added to `user.stateSchema` with a default, after a user already has a stored record: that user reads the default; no migration (section 2, Defaults; `eng/test/scope-state-defaults.test.ts:350-368`).
7. Edge: Alice in Globex after saving a plan in Acme reads the default, not her Acme plan (section 2, User; [ran]).

## 13. Where the word budget goes (1,100 words, sitemap C-07)

- Opening, figure 1, the smallest example: about 220 words.
- Session first, user and org, what the browser may see: about 480 words with four code examples (about 40 lines of code).
- What it gets you, how it fits with the others, Next: about 300 words.
- Every table row marked **[ref]** above goes to `reference/state-operations`, `reference/blocks` or `reference/flows`: operations and return values, concurrent writes, schema bubbling, defaults rules, `serverOwned`, `readonly`, `createCheck`, isolation flags, cross-flow conflicts, block/sequencer/target state, `ctx.settings`.
