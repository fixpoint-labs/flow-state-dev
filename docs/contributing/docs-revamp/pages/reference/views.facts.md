# Facts for Views (R-09, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: the exported surface and its doc comments, tests, `goals/`, existing user docs, one example. Reference has no word budget; it is tables and signatures.

Paths are from the repo root. Abbreviations:

- `dv` = `packages/core/src/flow/defineView.ts`
- `vt` = `packages/core/src/types/view.ts`
- `ft` = `packages/core/src/types/flow.ts`
- `df` = `packages/core/src/flow/defineFlow.ts`
- `dvt` = `packages/core/test/define-view.test.ts`
- `cv` = `packages/client/src/view/view.ts`
- `cc` = `packages/client/src/client.ts`
- `lr` = `packages/client/src/live/live-read.ts`
- `bo` = `packages/client/src/internal/backoff.ts`
- `uv` = `packages/react/src/hooks/useView.ts`
- `rf` = `packages/react/src/internal/readFailure.ts`
- `uvt` = `packages/react/test/useView.test.ts`
- `vr` = `packages/engine/src/routes/view-routes.ts`
- `rv` = `packages/engine/src/execution/runView.ts`
- `ev` = `packages/engine/test/views.test.ts`
- `er` = `packages/engine/test/views-route-refusals.test.ts`
- `ep` = `packages/engine/test/views-read-paths.test.ts`
- `eh` = `packages/engine/test/views-hears.test.ts`
- `epa` = `packages/engine/test/views-partial.test.ts`
- `em` = `packages/engine/test/views-dependency-matrix.test.ts`
- `es` = `packages/engine/test/session-views-store-nothing.test.ts`
- `vh` = `packages/contracts/src/types/view-hearing.ts`
- `rr` = `packages/workforce/src/workers/roster-view.ts`
- `rrr` = `packages/workforce/src/workers/roster-view-ref.ts`
- `goal` = `goals/views/a-screen-watches-a-view/goal.md`

Legend: **[row]** a table row on the page. **[lookup]** the answer to one of the page's two lookups.

There is no existing user-docs page on views: `apps/docs/` has no `defineView` or `useView` (grep). The concept page C-09 (`docs/contributing/docs-revamp/pages/concepts/views.md`) is a neighbour, not a source of truth; every claim below was checked against the code.

The page's two lookups (sitemap R-09): **Which scopes may a view have?** and **What is refused when a view is declared?**

## 1. `defineView` fields [row each]

Signature: `defineView(config: ViewConfig<TBlock, TScope>): ViewDefinition<TBlock, TScope>`, exported from `@flow-state-dev/core`. `dv:33-35`, `packages/core/src/index.ts:53`.

| Field | Required | Type and meaning | Cite |
| --- | --- | --- | --- |
| `scope` | yes | `"session" \| "user" \| "org"`. Where the view runs. | `vt:19`, `vt:30-35` |
| `block` | yes | The block that computes the answer. It must declare an `outputSchema`. A sequencer works when its last step is typed. | `vt:36-37`, `dvt:39-42` |
| `inputSchema` | no | "Overrides `block.inputSchema` for the view's input, as on an action." | `vt:38-39` |
| `key` | no | A function of one row returning a string, "for a view whose answer is a list". With it the answer must be an array whose rows have distinct string keys, and a screen keeps rows by key. | `vt:40-49` |
| `description` | no | Human-readable, for tooling. Defaults to `block.description`. | `vt:50-51`, `dv:55` |

- `defineView` returns a frozen object with `kind: "view"` plus `scope`, `block`, and `inputSchema`, `key`, `description` when set. `dv:56-63`; test `dvt:20-25` (`Object.isFrozen`).
- The answer type is the block's output type: `ViewOutput<TView>`; the input type is the block's input type: `ViewInput<TView>`. Both exported from `@flow-state-dev/core`. `vt:60-64`, `packages/core/src/index.ts:54`; test `dvt:27-30`.
- `ViewElement<TBlock>` is the element type of a block whose output is a list, else `never`; it types `key`'s argument. `vt:21-23`, `vt:49`.
- Install a view in a flow's `views` map: `defineFlow({ kind, actions, views: { name: view } })`. The map key is the view's name. `ft:618-624`; `dvt:51-56` (`flow.views` equals the map). `actions` is a required field of `defineFlow` (`dvt:54` passes `actions: {}`).
- A view takes no `description`-less requirement; `description` is optional. `vt:50`.
- Smallest declaration, from the doc comment: `defineView({ scope: "user", key: (row) => row.id, block: rosterBlock })`, then `defineFlow({ kind: "workforce-roster", views: { roster } })`. `dv:25-31`.

## 2. Scopes [row each; lookup 1]

**Which scopes may a view have?** Exactly three: `"session"`, `"user"`, `"org"`. `vt:19`, `dv:12`, `dv:39-41`.

| Scope | Runs | Needs a session | Called with | Cite |
| --- | --- | --- | --- | --- |
| `session` | On one session. The session must already exist; a view cannot create one. | Yes | `sessionId` | `vt:5-6`, `vr:128-135`, `cv:68-72` (`ViewCallOptions.sessionId`) |
| `user` | At the caller's user scope, with no session. | No | no session id | `vt:30-35`, `vr:121-126` |
| `org` | At the caller's org scope, with no session. | No | no session id | `vt:30-35`, `vr:121-126` |

- "The caller's user and org are the principal the flow's resolver returns." `vt:31-33`. The route calls `ctx.host.resolvePrincipal` with the parsed body in the envelope, `vr:81-93`; with no `authentication.resolvePrincipal` the default resolver reads `body.userId` (`packages/engine/src/transports/auth/defaultBodyUserIdPrincipalResolver.ts:31-43`). Precedence: the flow's own resolver over the host fallback (`packages/engine/src/transports/auth/pickPrincipalResolver.ts:21-28`). (Test setup: a verified header pair names user and org, `er:21-27`.)
- A user or org view answers a user who never had a session, without making one, and never calls the session store. Alice has no session; she reads the org note Bob wrote and the session store is untouched (`calls` is `[]`, the session list is unchanged). `ev:237-262` (`expect(calls).toEqual([])` at `:260`). Goal signal `a:no-session` says the same for the roster. `goal:12`.
- A user view answers each user their own rows: with Alice's and Bob's pins in one flow, each gets only their own. `ev:264-278`.
- A second organization reads none of the first org's user or org rows: the same user id in another org gets `{ labels: [] }`; a second user in the other org gets `{ texts: [] }` from the org view. `er:173-182`.
- A session view of another user's session answers exactly as a session id never used: 404, same body modulo the id. `er:162-171`; `es:244-251`.
- Address mismatch: a session view called without a session id is `400 view_needs_session`; a user or org view called with one is `400 view_takes_no_session`. `vr:113-126`; `ev:287-291` (asserts only 400).
- A block in a user or org view that reaches for `ctx.session` is refused: HTTP 422, error `view_no_session`, and `NoSessionError` from `runView`. `vt:31-33`, `vr:256`; `ev:280-285`.
- A user view may read the caller's sessions through the request host (`sessions.read`, and per the session-read tests `sessions.list`, `sessions.turns`, `sessions.history`, `sessions.userSuspensions`); an org view that does is refused with `NoSessionError`. A session view that reads another session records it. `ep:147-167`; `packages/engine/test/views-session-reads.test.ts:213-217` (`sessions.list` refused in an org view). Detail of those request-host reads is out of this page's scope; state only that an org view cannot read sessions. [lookup 1 may carry one clause]
- Roster as an instance: `scope: "user"`, `key: (entry) => entry.id`, answers "a user's workers, their own and the standard ones, ... with no session". `rr:2-4`, `rr:49-60`.

Rows on a view's scope from the sibling's moved row (pass-5 record): "`user` (answered from the user's own rows, needs no session, changes by other users do not refresh it), `org` (needs no session), `session` (runs on one session, called with `sessionId`)". Checked: `user` own rows `ev:264-278`; no session `ev:237-262`; other users' changes do not refresh it: goal signal `b:within-1s` "A second user's hire wakes none of the first user's view calls" `goal:13`. Carried.

## 3. Row keys [row]

- `key` is optional. Without it the answer is any value the block's schema allows. `vt:40`.
- With `key`, the answer must be an array. If it is not: error `view_answer_not_keyed`, "View "<name>" declares a `key`, so its answer must be a list". `rv:248-255`.
- Every row's key must be a distinct string. A repeated key, or a key that is not a string: `view_answer_not_keyed`, `View "<name>"'s rows must have distinct string keys; "<id>" repeats` (or `a key is not a string`). A keyed view whose answer is not an array: ``View "<name>" declares a `key`, so its answer must be a list`` (literal backticks around `key`). `rv:251`, `rv:256-266`. Over the route: HTTP 422 (not a `validation_error`, not `read_only`, not retryable) `{ error: "view_answer_not_keyed" }`. `rv:260-263` (`retryable: false`), `vr:258-260`; `ev:355-362`.
- A keyed answer carries its keys, in row order, as `keys` on the wire answer. `rv:409-411`; `ev:264-278` (`answer.keys` is `["a","b"]`). An empty list has `keys: []` (`ev:259`).
- A screen "keeps rows by key": a row that did not change is the same object across answers; rows are matched by key and compared by their JSON. `uv:10-11`; `cv:137-151` (`keepUnchangedEntries`).
- `key` method syntax: its parameter is typed by `ViewElement`; a view with no list is still a `ViewDefinition`. `vt:45-49`.
- A key must be a function: `defineView` throws otherwise (section 5).
- Keys decide partial answers: a view with no `key` is never handed a change and cannot answer partially (section 7). `rv:419-424`, `rv:429-434`.

## 4. Where a view is installed and addressed [row]

- `views?: Record<string, ViewDefinition>` on `defineFlow`: "The flow's views: blocks a screen watches, each with a scope ... and, for a list, a row key. Declared with `defineView`. A view writes nothing and calls no model." `ft:618-624`.
- An entry that is not what `defineView` returned fails when the flow is defined, naming it: `Flow "<kind>" view "<name>" is not a view. Declare it with \`defineView({ scope, block })\`.` Also `Flow "<kind>" declares "views" that is not a map of name to a view.` `df:862-885`; test `dvt:58-62`.
- Routes: `POST /api/flows/<flow>/views/<view>` for a user or org view; `POST /api/flows/<flow>/<sessionId>/views/<view>` for a session view. `vr:3-6`; paths as exercised `ev:233-234`.
- A view the flow does not declare is 404, even if an action carries that name. `vr:110-111`; `es:253-257`.
- Client address: `viewRef<TView>(flow, view)`. `cv:38-42`.

## 5. Definition-time refusals [lookup 2]

**What is refused when a view is declared?** `defineView` throws an `Error` (plain `Error`, not a typed class) at the call, before any screen asks. Checked in this order. `dv:36-54`.

| Order | Refused | Message (what the error names) | Test | Cite |
| --- | --- | --- | --- | --- |
| 1 | A config that is not an object (`null`, a string) | `defineView takes \`{ scope, block }\`.` | none found | `dv:36-38` |
| 2 | A `scope` that is not `"session"`, `"user"` or `"org"` | `defineView: scope "<value as JSON>" is not "session", "user" or "org".` | `dvt:44-48` (matches `/not "session", "user" or "org"/`) | `dv:39-41` |
| 3 | A `block` that is not a block (missing, `{}`) | `defineView: \`block\` is not a block. A view computes its answer with one block.` | `dvt:47` (`/not a block/`) | `dv:42-44` |
| 4 | A block with no `outputSchema`, or one that is `z.any()` / `z.unknown()` | `defineView: block "<name>" declares no output schema. A view's answer is typed by its block's \`outputSchema\`; declare one.` | `dvt:32-37` (`/declares no output schema/`, both the missing and the `z.unknown()` case) | `dv:45-51` |
| 5 | A `key` that is not a function | `defineView: block "<name>"'s \`key\` is not a function of a row.` | `dvt:46` (`/not a function/`) | `dv:52-54` |

- The scope refusal comes before the block refusals; so a bad scope with a bad block names the scope. `dv:39-44`.
- The doc comment's own list: "a scope that isn't `"session"`, `"user"` or `"org"`, a missing block, a block with no output schema (its answer would be untyped on the client), and a `key` that isn't a function." `dv:20-23`.
- `inputSchema` is not validated at definition time (no check in `dv`). `dv:36-54`.
- Whether `key` returns distinct strings is not checked at definition time; it is checked on each answer (section 3). `rv:248-268`.
- A schema that is `z.object({})`/`z.array(...)` etc. passes. Test of a sequencer whose last step is typed: `dvt:39-42` passes `not.toThrow()`.
- At flow definition: an entry in `views` that is not a view is refused (section 4). `df:874-880`.

Not definition-time (the page must keep these apart): refusing a write, a model call, or a missing session happens when the view runs (section 6).

## 6. What a view refuses when it runs [row each; belongs with lookup 2's neighbour, not in it]

A view's context "refuses every write and every model call, so watching a view never changes what it reads and never pays for a model." `vt:6-8`.

| What the view's block does | HTTP | `error` | Cite |
| --- | --- | --- | --- |
| Writes a resource | 409 | `read_only` | `ev:330-336` (store unchanged) |
| Writes session state, user state, or dispatches an action | 409 | `read_only` | `es:259-271` (store snapshot unchanged) |
| Runs a generator (session or user scope), resolves a model from a handler, or runs an evaluator | 422 | `view_model_call` | `ev:338-352`; evaluator `ep:176-179` |
| Reaches for `ctx.session` in a user or org view | 422 | `view_no_session` | `ev:280-285` |
| Reads liveness (`livenessOf`): no topic covers it | 422 | `view_unrecorded_read` | `ep:169-174`, `vr:257` |
| Answers a keyed view with repeated or non-string keys, or a non-list | 422 | `view_answer_not_keyed` | `ev:355-362`, `rv:248-268` |
| Answers partially with no change, or from a view with no `key` | error code `view_partial_refused` (a non-retryable `FlowError`, so 422 on the route) | `view_partial_refused` | `rv:429-440`, `epa:139-143`; route mapping `vr:258-260` |

- A view's input is parsed against the block's schema, as an action's is: invalid input is HTTP 400. `rv:236-246` (`ValidationError`), `vr:259` (`validation_error` → 400); `es:236-242` (`input: { prefix: 3 }` is 400).
- Nothing is stored. A session view "answers in the response and stores nothing": a snapshot of every store is identical after ten calls; also on a session no action has run in. `es:186-211`.
- A view's block may still call blocks; reads made one block down, in a sequencer step, are recorded as the view's reads. `ev:313-320`.

## 7. The wire answer and the route's failure map [row each; moved by pass 5]

Success: `200 { output, topics, hears, keys?, partial? }`. `vr:8-12`, `vr:153-159`.

- `output`: the block's output (`null` when absent). `vr:154`.
- `topics`: the change topics what the run read falls under, deduped and sorted. A view that read nothing: `topics: []`, `hears: []`. `vr:9-10`; `ev:308-311`.
- `hears`: per topic, which kinds of notice may change what the run read (section 8). `vr:8-11`, `vr:156`.
- `keys`: a keyed view's row keys, in order. `vr:11`.
- `partial: { removed }`: set when the answer is for just the rows a change touched. `vr:11-12`; `epa:125-130`, `epa:164-176`.

Failure map (`vr:234-264`):

| Status | `error` | When | Cite |
| --- | --- | --- | --- |
| 400 | `view_needs_session` | A session view called without a session id. Message names the path to call. | `vr:115-120` |
| 400 | `view_takes_no_session` | A user or org view called with a session id. | `vr:121-126` |
| 400 | `validation_error` (the error's `code`) | The input fails the block's input schema. | `vr:259`; `es:236-242` |
| 400 | (principal refusal's message) | A request with no `userId` body field when the host reads it from the body: a 401 whose message mentions `userId` is answered 400; other principal refusals keep their status. | `vr:94-99` |
| 404 | the unknown-flow message | Flow not registered, or the caller is outside the flow instance's owner pin. A pinned flow answers a caller outside the pin exactly as an unregistered address, for any view name, scope or session path, and names nothing. | `vr:74-75`, `vr:103-108`; `er:127-153` |
| 404 | `UnknownViewError` message | The flow declares no view of that name (even if an action has the name). | `vr:110-111`; `es:253-257` |
| 404 | the unknown-session answer | A session view on a session that does not exist, or one the caller may not run in (another user, another org, another tenant). Same body as an unused id. | `vr:128-135`, `vr:241-247`; `er:162-171`; `es:244-251` |
| 409 | `read_only` | A write or a dispatch from a view. | `vr:259`; `es:259-271` |
| 409 | `migration-required` or `wrong-instance-session` | The record is not owned by the flow instance addressed. Message: `Record "<id>" is not owned by flow instance "<id>"`. | `vr:248-253` |
| 422 | `view_model_call` | Model call. | `vr:255` |
| 422 | `view_no_session` | `ctx.session` in a sessionless view. | `vr:256` |
| 422 | `view_unrecorded_read` | A read no topic can cover. | `vr:257` |
| 422 | the error's own `code` | Any other non-retryable `FlowError`, for example `view_answer_not_keyed`, `view_partial_refused`. | `vr:258-260` |
| 503 | the error's own `code` | A `FlowError` marked retryable. | `vr:259` |
| 500 | `view_failed` | Any other error; `message` is the error's message. | `vr:262-263` |

- `FlowError` code → status: `validation_error` 400, `read_only` 409, retryable 503, else 422. A `FlowError` with no `code` answers `view_failed`. `vr:258-260`.
- Caller resolution: the principal comes from the flow's own resolver (`pickPrincipalResolver` through `host.resolvePrincipal`), as an action and a read do. With no flow resolver set, the default reads `body.userId`. A session view is fenced as the session's action route is. `vr:17-23`, `vr:81-101`.
- The `changed` hint: a call may carry `changed: { topic, kind, ids }` in its body. It is honoured only when `topic` is a wire topic, `kind` is one of `items`, `request`, `run`, `state`, `resource`, `board`, `suspension`, `resync`, and `ids` is 1 to 100 strings (`NOTICE_MAX_IDS = 100`). Anything else is no change and the view runs whole. It decides only which rows the view reads again, never who may read them. `vr:216-231`; `packages/contracts/src/types/push-delivery.ts:57`; test `epa:178-191` (no ids, non-string ids, empty ids, 101 ids, unknown topic all run whole).
- A view with no `key` is never handed a change. `rv:419-424`. An action's blocks get no view context. `epa:193-197`.

## 8. When a view is read again [row each; moved by pass 5]

The screen names no topic. Each answer carries the change topics of what the view's run read; the client's live read listens to those, reads again on a change, and listens to new topics when they change. `uv:5-9`, `vt:7-9`, `lr:18-21`.

| Event | What happens | Cite |
| --- | --- | --- |
| A write to anything the last run read | The view is read again. The answer's `hears` limits which notices count (below). Goal outcome: "a change to anything the view read reaches its watchers", "without the app naming a topic". | `goal:3`; `em:314-326` |
| A write from another request, session, flow or client | Reaches the view the same way: another flow's user write publishes on the user's topic. A browser's write through the resource routes reaches the same view. | `ev:392-398`, `em:501-538`, `rr:10-11`; roster watch "follows hires, forks, edits and fires made anywhere" `packages/workforce/test/watch-roster.test.ts:3-5` |
| A hire, an edit, a fork or a fire (the `roster` view) | The roster view is read again. | `rr:10-12` |
| A connect, a reconnect, a timer tick, a `resync` notice | Always read again (never filtered by `hears`). | `lr:6-11` |
| A notice the answer's `hears` rules out | Not read. | `vh:19-39`, `vh:82-98` |
| A notice with ids, on a keyed view whose answer the screen holds | The view is asked for just the rows it touches (`ctx.view.changed`); a partial answer is placed by key. | `cv:9-19`, `cv:246-249` |
| A partial answer that brings a key the screen does not hold | The screen reads the view whole. | `vt:99-100`, `cv:178-184`, `cv:287-290` |
| A read in flight and more notices arrive | One more read, not one each: "one read in flight and at most one waiting". | `cc:570-577`, `lr:12`; `packages/workforce/test/watch-roster.test.ts:98` |
| A failed read | The watch is `stale` and tries again on its own: 1 s, doubling, to 30 s. A read that lands clears `stale`. | `lr:14-16`, `bo:8-15`, `uv:13-15`; `uvt:122-136` |
| The poll timer | Reads again every 3 s by default, "where push can miss a change". `pollIntervalMs: null` for none. | `lr:38`, `lr:113`, `uv:27-28`, `cv:90-93` |
| Nothing changes, push is up, poll is off | No view calls: 0 in 10 s idle. | `goal:14` (`b:idle-0-reads`) |
| An answer equal to the last | Reports no new value ("reports the value only when it changed, compared by value"). | `lr:13`, `cc:572-573` |
| A new input, session, client, or `enabled` turned off then on | A new watch: starts from nothing, not its old `value` and not its old `stale`. | `uv:49-55`, `uv:121-127`; `uvt:79-107`, `uvt:138-176` |

**What a view's answer hears (`hears`)** [row each]. `ViewHearing = { topic, kinds, paths?, partitions? }`. A watcher reads again on a notice its topic covers whose `kind` is listed and, for a `resource` notice that names a path, whose path falls at or under one of `paths`. A `resource` notice naming no path always reads. `vh:19-39`, `vh:82-98`.

| What the run read | What it hears | Cite |
| --- | --- | --- |
| A collection (`workers/*`) | `resource` notices under the collection's root (`workers`), nothing else on its scope. | `eh:79-85` (test at 80-84) |
| A single resource | Its own key; `state` kind is added when the run also read the scope's state. | `eh:86-90` |
| A session's items, metadata or history | `items`, `request`, `run`, `state` on the session topic. | `eh:91-94` |
| A session's state alone | `state` on the session topic: not a reply streaming in, not a request stamping the session. | `eh:95-104` |
| A user board (a task board) through its task collection | `board` notices on each session it names and on the user topic's board resource; not the ledger's `resource` notices. | `eh:105-121` |
| An org board | The org topic's ledger notices and the board's insert notices; no session. | `eh:122-130` |
| A board read that names no session | Keeps its ledger's `resource` notices. | `eh:131-139` |
| Nothing | `hears: []`; nothing wakes it. | `ev:308-311` |

- A change at an ancestor path may touch anything beneath it: a write through a broader collection (`notes/**`) names its root, an ancestor of the narrower root a view hears (`notes/shared`), so it still reaches the view. `vh:65-80`; `eh:140-195`.
- A view hears a change through every read path (direct and template reads, a template in another scope, session handle, session state, request-host reads, lineage-shared resources) at every scope. A template in another scope is recorded even when it is missing, since creating it changes the answer. `em:314-326`; `ep:129-145`. Call this out as one sentence; do not list the matrix.
- Reads made by a child block one level down (sequencer step) are recorded. `ev:313-320`, `ev:322-326`.
- A host with a view publishes every resource write, including another flow's; a host with no view publishes nothing for a user write. `ev:364-419`, `ev:400-405`. Observable by the reader only as "a write from any flow reaches the view"; keep to that.
- Reads over a lineage: a session view over a lineage-shared resource is woken by a sibling's write. `packages/engine/test/views-lineage.test.ts:81-118`. [one clause at most]
- Measured on a real host (not to quote as a guarantee): hire 42 ms, filed task 31 ms, probe write 36 ms; a second user's hire reached none of the first user's watches. `goal` verdict row 3. Page may say "well under a second" at most.

## 9. Client and React surface [row each; moved by pass 5]

- `viewRef<TView>(flow, view)`: the handle. Both strings required and non-empty; else it throws `viewRef: a flow address is required` / `viewRef: a view name is required`. Returns a frozen `{ flow, view }` that "holds no block: safe in a browser bundle". Typed by a type import: `viewRef<typeof roster>("workforce-roster", "roster")`. `cv:26-42`; exported from `@flow-state-dev/client` (`packages/client/src/index.ts:45-49`).
- `ViewValueOf<TRef>` is the view's answer type; `ViewInputOf<TRef>` its input type. `cv:44-48`.
- The roster's handle: `rosterView = viewRef<RosterView>(ROSTER_FLOW, ROSTER_VIEW)`, exported from `@flow-state-dev/workforce/browser`. `rrr:14`, `packages/workforce/src/browser.ts:29`; subpath `packages/workforce/package.json:33`.
- `client.view(ref, input?, options?)`: runs a view once as the client's user and resolves `{ value, topics, keys?, partial?, hears? }`; "Nothing is stored." A user or org view needs no session; a session view takes `sessionId`. Rejects with `ClientHttpError`: 404 unknown view or a session the user can't run in; 400 input its schema refuses or a view called at the wrong scope; 422 a view that called a model or reached for a session it doesn't have. `cc:581-590`; result type `cv:50-65`.
- `ViewCallOptions = { sessionId?: string; changed?: WireNotice | null }`. A notice with no ids is not sent: the view answers whole. `cv:67-72`.
- An omitted `input` is sent as `{}`; any other value, `null` included, as given. `cv:110-113`; test `uvt:109-120` ("watches a null input as null, apart from an omitted one").
- `useView(ref, input?, options?)` from `@flow-state-dev/react`. `packages/react/src/index.ts:177`. Returns:

| Field | Meaning | Cite |
| --- | --- | --- |
| `value` | The answer, typed by the view; `undefined` until the first answer lands. | `uv:36-39` |
| `stale` | `true` while the last read failed. | `uv:40-41` |
| `failure` | Why the last read failed, while `stale`: `{ message, httpStatus? }`, the server's own `error`/`message` words and HTTP status when it answered one; absent otherwise. | `uv:42-44`, `rf:8-22`; `uvt:223-238` |
| `refresh()` | Read the view again now, for every screen sharing the read. Does nothing while disabled. | `uv:45-46`; `uvt:205-221`, `uvt:240-248` |

- `useView` options: `sessionId` (session view), `changed` (typed through `ViewCallOptions` but never forwarded: the `watchView` call passes only `sessionId` and `pollIntervalMs`, so it does nothing; only `client.view(ref, input, { changed })` honours it, `uv:103-106`, `cv:277,286`), `enabled` (`false` watches nothing, default `true`), `pollIntervalMs` (default 3 s, `null` for none), `client` (a host that holds its own; pass a stable reference). `uv:23-31`.
- A disabled watch answers `{ value: undefined, stale: false }`, never the last value. `uv:121-127`; `uvt:79-90`.
- `failure` is also tolerated by a screen that joins a failed read: it hears the same reason. `uvt:250-262`.
- Sharing: watches of one view with the same input (as sent), in one client, share a single read. "Every screen in the app watching the same view with the same input shares one read." The identity is view, session and the input as the request sends it, with object keys sorted. `uv:9-10`, `cv:115-135`; `uvt:55-77` (two screens, one read; the read stops with the last watcher, `fake.open()` goes 1 then 0 at `:73-76`).
- Row identity: a keyed view's rows keep their identity across answers while they don't change; rows matched by key and compared by their JSON. `uv:10-11`, `cv:137-151`.
- `watchView(client, ref, input, watcher, options)` is the non-React watch; it returns a stop function with `refresh()`. It is exported from `@flow-state-dev/client/internal`, not the package root (`uv:19` imports it from there). `cv:251-263`. Not for the page unless the page lists an internal path; leave off.

## 10. `ctx.view` inside a view's block [row each]

`ViewRunContext`, set on every block of a view's run, child blocks included, and absent anywhere else. `vt:86-89`; `epa:132-137`, `epa:193-197`.

| Member | Meaning | Cite |
| --- | --- | --- |
| `changed?: ViewChange` | The change this run may answer for: `{ topic, kind, ids }`. Ids are the publisher's (a task on a `board` notice, an entry's storage key on a `resource` notice), never row keys. `undefined` on a whole run (a first read, a connect, a notice with no ids, a view with no `key`). | `vt:66-77`, `vt:90-95` |
| `partial(entries, options?)` | Answer for just some rows: `entries` are placed by key over the rows the screen holds, `options.removed` keys are dropped. A key the screen doesn't hold makes it read whole. Return what `partial` returns. Opt in: a view that never calls it answers whole. Answer whole whenever a change could move a row: a partial answer never reorders rows. | `vt:96-106`; `epa:125-131` |

- `partial` throws `view_partial_refused` when the run has no `changed`, or the view declares no `key`. `vt:104`, `rv:428-440`; `epa:139-143`.
- A partial answer reaches the client flagged `partial: { removed }`, with only the touched rows in `output` and in `keys`. `epa:125-130`, `epa:164-176`.
- In development and tests (`NODE_ENV` `development` or `test`) the client checks each partial answer against a whole run; a difference logs `[flow-state-dev] "<flow>" view "<view>" answered partially for [...] and differs from a whole run` and the screen shows the whole run. `cv:236-244`, `cv:291-307`.
- Page placement: sitemap names only the five tables; this is a sixth row group. Include it only if the page's table budget allows (no table over six rows); otherwise omit it and the `ViewChange`/`ViewHearing` types are left to the generated API.

## 11. The four questions for what a view stores

A view stores nothing. The data it reads belongs to the flow's resources.

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A view's answer | Nobody; computed on each ask | The asking user. A user view answers each user their own rows (`ev:264-278`); a session view only the session's own user (`es:244-251`); another org reads none (`er:173-182`) | Nowhere. "Answers in the response and stores nothing"; every store unchanged after ten calls (`es:186-196`); a user or org view never calls the session store (`ev:260`) | One per ask. One shared live read per view, session and input in a client (`cv:131-135`, `uv:9-10`) |
| A view's definition | The flow that lists it in `views` | Callers of that flow; a pinned flow's views answer only callers inside the pin (`er:127-160`) | In code, on the flow instance (`dvt:51-56`) | A map by name per flow (`ft:624`) |

The roster example's stored data is covered by the C-09 sheet's section 8 (workers collections, per user); this page does not need it.

## 12. Passed-in rows (`→ R-09`): each checked

Found with the grep from the brief, in `docs/contributing/docs-revamp/pages/**/*.record.md` (nine rows). Verdict on each:

1. **`useView` result fields: `value` (undefined until the first answer), `stale` (true while a failed read is being retried).** Carried, with a correction. `useView` returns four fields: `value`, `stale`, `failure?` and `refresh()`. `uv:36-47`. The row names two. `stale` is true while the last read failed; the live read retries on its own. `uv:40-41`, `lr:14-16`. Section 9.
2. **When a view is read again: the roster view re-reads on hire, edit, fork and fire, from any tab or a worker's turn; screens on the same view share one read.** Carried, with a correction. Hire, edit, fork and fire: `rr:10-12`. "From any tab": a write by another client or request reaches the view (`em:501-538`, `ev:392-398`, `watch-roster.test.ts:3-5` "made anywhere"). "Or a worker's turn" has no test or doc comment that names a worker's turn as a trigger; dropped. Sharing: `uv:9-10`, `uvt:55-77`. Section 8.
3. **Watch sharing and row identity: equal input shares one read; an unchanged row keeps its identity (matched by row key).** Carried. `uv:9-11`, `cv:115-151`. Section 9.
4. **`useView` result fields: `value` is `undefined` before the first answer, then the typed rows; `stale` is `true` while the last read failed; a failed read is retried automatically; `viewRef` signature stays in the generated react API.** Carried with the same correction as row 1 (also `failure`, `refresh()`). The sheet states the `viewRef` signature in section 9 as well, since `viewRef` is exported from `@flow-state-dev/client` (`packages/client/src/index.ts:45`), not React: the note's "generated react API" does not match where it lives. Flagged for the page's author; the page may link the generated client API instead.
5. **Scopes table: `user` (own rows, no session, other users' changes do not refresh it), `org` (no session), `session` (one session, called with `sessionId`). The Alice/Bob example and the privacy guarantee stay on the concept page.** Carried. Section 2.
6. **`defineView` fields: `scope`, `key`, `block`. Row keys get their own row.** Carried, and extended: the config also has `inputSchema` and `description`; the row names three of five. `vt:26-52`. Sections 1 and 3.
7. **What triggers a re-read: anything its last run read changes; roster: hire, edit, fork, fire. The recording of what a run read stays on the concept page; the list of triggering writes is a table row.** Carried. Section 8.
8. **What a view refuses: its block may not write state or call a model, and a view cannot dispatch an action. Definition-time refusals become a table.** Carried, with a split. A write, a dispatch and a model call are refused when the view runs (409 `read_only`, 422 `view_model_call`), not at definition time. `ev:330-352`, `es:259-271`. The definition-time refusals are a different list (scope, block, output schema, key). Sections 5 and 6 keep them apart so the lookup "What is refused when a view is declared?" answers only section 5.
9. **View route refusals: `view_needs_session`, `view_takes_no_session`, the 400/409/422/503/500 failure map, the `changed` hint, caller resolution.** Carried. Section 7. Corrections: 503 is a `FlowError` marked retryable and 500 is `view_failed` for any other error (`vr:259`, `vr:262-263`); the failure map also has 404 and a second 409 (`migration-required`/`wrong-instance-session`, `vr:248-253`).

Dropped: only the "or a worker's turn" clause of row 2 (no observable source). Nothing else dropped.

## 13. Corrections to the concept sheet (C-09) found on the way

- C-09 sheet section 5 says `useView` returns `{ value, stale }`. It also returns `failure` and `refresh()` (`uv:36-47`).
- C-09 sheet section 2 says a view is "called with no session ... a block that reaches for `ctx.session` is refused" and implies no session reads at all. A user view may read the caller's sessions through the request host (`ep:147-157`); an org view may not.
- C-09 sheet section 4 says "A flow's view not declared on the flow is a 404"; the route is `UnknownViewError` message, not the unknown-flow message (`vr:111`).

## 14. Left out (no observable surface, or not Reference)

- The dependency matrix's cells and recorder internals (`em:540-566` asserts source structure, not behaviour).
- Which store methods a view's run is handed as read-only (`rv:225-233`): mechanism.
- How hearings are partitioned and keyed with the push secret (`vr:156`, `keyHearingPartitions`); `partitions` on `ViewHearing` is a wire detail of boards.
- Session admission rules for a view's request-host reads (`vr:165-214`); only "a view's session reads answer only the caller's own sessions in their org" is observable, and it belongs with the request-host reads, not here.
- Goal verdict-log status (FAIL on a removal leg) and the measured millisecond numbers.
- `isViewDefinition` (`dv:15-17`): exported from the file but not from `packages/core/src/index.ts`; not public.

## 15. Revise round 1: wording changes the page made (facts unchanged)

- Owner pin: the page says "the flow instance is pinned to an owner (its `ownerPin`)" and links `./flows.md`; the `ownerPin` field is documented on that page's instance options. `vr:103-108`, `packages/core/src/types/flow.ts:713-721`.
- `wrong-instance-session` (session held by a different instance than the one addressed) and `migration-required` (record with no recorded owner, kind with several instances) now have separate rows, linked to `./authentication.md`. `vr:248-253`.
- Board rows reworded: "ledger" is the board's own resource (`eh:105-139`). A user board hears `board` notices on each session it names and on the user's board; an org board hears writes to its own resource at the org and `board` notices there.
- The Workforce `roster` event row is cut from the events table (it collided with the page's `roster` example). The Workforce handle (`rrr:14`) is one separate sentence, marked unrelated to the example.
- Lineage: the page names the `sharedToLineage` resource option and links `./resources.md#scopes-and-sharing`; "template in another scope" is dropped from the page (still true, `em:314-326`).
- Dropped from the page: "a request stamping the session does not wake a session-state read" (internal write); `eh:95-104` still holds.

## 16. Revise round 2: wording changes the page made (facts unchanged)

- `topic` and `notice` are defined once, in the `hears` row of the success table.
- "A view's block may call other blocks" now reads "may be a sequencer"; its steps' reads are recorded (`ev:313-320`). No handler-calls-block claim.
- Board rows: the user-board row says "where tasks name sessions"; the no-session sentence says a user board read in which no task names a session keeps its ledger's `resource` notices (`eh:105-139`).
- Workforce handle sentence cut from the page (`rrr:14` still true, not needed here).

## 17. Revise round 3: corrections

- Request `changed` hint: honoured when `topic` passes `isWireTopic` (session with non-empty string id, or user/org; optional string `resource`), `kind` is one of the eight, `ids` 1 to 100 strings. Not checked against the topics this view returns. `vr:223-229`, `ss:228-240`.
- `useView` `changed` is ignored (see section 11 option list).
- `view_answer_not_keyed` has three messages: not a list (backticked `key`), repeated key, non-string key. `rv:251,261`.
