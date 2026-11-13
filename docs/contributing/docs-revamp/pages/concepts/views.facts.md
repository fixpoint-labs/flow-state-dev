# Facts for Views (C-09, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example.

Paths are from the repo root. Abbreviations:

- `dv` = `packages/core/src/flow/defineView.ts`
- `vt` = `packages/core/src/types/view.ts`
- `ft` = `packages/core/src/types/flow.ts`
- `df` = `packages/core/src/flow/defineFlow.ts`
- `cv` = `packages/client/src/view/view.ts`
- `uv` = `packages/react/src/hooks/useView.ts`
- `rv` = `packages/workforce/src/workers/roster-view.ts`
- `rr` = `packages/workforce/src/workers/roster-view-ref.ts`
- `ev` = `packages/engine/test/views.test.ts`
- `es` = `packages/engine/test/session-views-store-nothing.test.ts`
- `er` = `packages/engine/test/views-route-refusals.test.ts`
- `em` = `packages/engine/test/views-dependency-matrix.test.ts`
- `dvt` = `packages/core/test/define-view.test.ts`
- `goal` = `goals/views/a-screen-watches-a-view/goal.md`
- `ks` = `apps/kitchen-sink/flows/chat-agent/views.ts` (a second example)

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/views`; the page links, does not state it. **[verify]** not confirmed or contradicts the page plan; keep off the page until settled.

There is no existing user-docs page about views. `apps/docs` has no `defineView` or `useView` mention (grep of `apps/docs`).

## Flags against the page plan (read first)

1. **Question 2 has no roster answer.** "A worker starts waiting for you. What makes the badge appear?" The `roster` view's row has no waiting or status field: `id, flow, standard, description, name, teamName, forkedFrom, edited, settings` (`rv:22-31`). The shift-manager sidebar badge that goes highlighted while something waits is driven by the inbox read count, not a view: `waiting = loaded.inbox.ok && loaded.inbox.value.length > 0` (`packages/shift-manager/src/surfaces/Sidebar.tsx:420`), drawn at `:456-461`. The sidebar does use the roster for team lists, through `workforce.watchRoster`, not `useView` (`packages/shift-manager/src/lib/roster.ts:41`, `:62-66`). So the page cannot say the roster view makes a "waiting" badge appear. What the roster does show: a hire, edit, fork or fire changes the rows (`rv:11-13`, `roster.ts:62-66`). Page options: change question 2 to a hire ("A worker is hired. What makes the new row appear?"), or invent no waiting field. Needs the page plan's owner.
2. **The roster is not read through `useView` in the shift-manager.** `useView` has two app callers: kitchen-sink's `useView(MODE_STATUS, ...)` and `useView(PREFERENCES)` (`apps/kitchen-sink/app/flow-state/page.tsx:353,361`) and shift-manager's task list (`packages/shift-manager/src/lib/conversation-tasks.ts:44`). The roster has a ref made for `useView(rosterView)` (`rr:13-14`) and the goal watches it with a real client (`goal`, Input line). A page example `useView(rosterView)` type-checks against the ref; it is not what the sidebar calls.
3. **Plan says "defineFlow({ views })" and "the roster flow".** Confirmed: the roster flow installs `views: { [ROSTER_VIEW]: defineRosterView(installation), ... }` (`packages/workforce/src/workers/roster-flow.ts:69-71`). `ROSTER_FLOW = "workforce-roster"`, `ROSTER_VIEW = "roster"` (`packages/workforce/src/workers/keys.ts:141,145`; values from `dv` example `workforce-roster` and the route `shift-manager/test/reads.test.ts:28`).
4. **Plan says the figure shows a `roster` view "reading stored data".** True: the view's block lists two collections, the user's own workers and the standard workers (`rv:56-70`). Stored where: see the four questions.

## 1. What a view is (opening, model figure)

- A view is the one hook a screen uses to watch an answer the server computes. `vt:2-3`
- A view is a block with a scope. `vt:5`. It computes the answer by running one block. `dv:43` error text: "A view computes its answer with one block."
- Its answer is computed when asked: a client calls the view and the server runs the block. `client.view(ref, input)` "Run a view once, as the client's user, and resolve to its value, the change topics of what its run read, and a keyed view's row keys." `packages/client/src/client.ts:573-575`. [page]
- A view stores nothing: a session view "answers in the response and stores nothing", checked as an unchanged snapshot of every store after ten calls. `es:187-196`. A session view on a session no action has run in stores nothing and seeds no user or org record. `es:198-213`. A user or org view calls the session store zero times. `ev:237-258` (`expect(calls).toEqual([])` at `:256`). [page]
- The answer is typed by the block's output schema: `ViewOutput<TView>` is the block's output type, "Never `unknown`". `vt:70-71`; test `dvt:27-30`. [page]
- A view that reads nothing names no topics: answer `{ output: { ok: true }, topics: [] }`. `ev:299-302`. [ref]

## 2. Where it runs: scopes

- Three scopes: `"session" | "user" | "org"`. `vt:19`, `dv:12`. [page, in one clause; options table is [ref]]
- A session view runs on a session and is called with a `sessionId`. `vt:5-6`, `cv:54`. [page]
- A user or org view runs "with no session": "the caller's user and org come from the verified principal". `vt:33-36`. [page]
- A user view answers each user their own rows: with Alice's and Bob's pins in the same flow, each gets only their own. `ev:260-274`. [page]
- A user or org view answers a user who never had a session. Alice has none; she reads the org notes Bob wrote. `ev:237-258`; roster equivalent: `goal` signal `a:no-session` ("the roster view answers a user who never had a session, equal ... to the roster read through a roster session"; session store lists the same before and after). [page]
- A block that reaches for `ctx.session` in a user or org view is refused: HTTP 422, error `view_no_session`. `ev:276-281`, `vt:35-36` (`NoSessionError`). [ref]
- Address: a user or org view is called without a session id, a session view with one; the wrong one is 400. `ev:283-288`. [ref]
- Another user's session view answers exactly as a session id never used (404). `er:162-171`, `es:244-251`. [ref]
- A second organization reads none of the first org's user or org rows. `er:173-182`. [ref]
- A view's own user row example: `preferencesView` is `scope: "user"` and reads `ctx.user.state` (`ks:67-80`); `modeStatusView` is `scope: "session"` and reads `ctx.session.state` (`ks:37-63`). Second example, kitchen-sink; the page's cast is the roster.

## 3. Declaring a view (code example 1)

- `defineView({ scope, key, block })`; `description` and `inputSchema` are optional. `vt:27-53` (`ViewConfig`)
- Smallest working declaration, from its doc comment: `defineView({ scope: "user", key: (row) => row.id, block: rosterBlock })` then `defineFlow({ kind: "workforce-roster", views: { roster } })`. `dv:24-33`
- The roster, real: `defineView({ scope: "user", key: (entry) => entry.id, block: handler({ name: "workforce-roster", inputSchema: z.object({}), outputSchema: rosterSchema, resources: {...}, execute: async (_input, ctx) => ... }) })`. `rv:49-61`
- A view takes a handler or a sequencer, as long as the last step is typed. `dvt:39-42` (sequencer), `packages/orchestration/src/skills/views/task-list-view.ts:20-36` (a sequencer made a view). [page, optional]
- `key`: "The row's key, for a view whose answer is a list. With it the answer must be an array whose rows have distinct string keys, and a screen keeps rows by key." `vt:40-47`. [page, one sentence; refusal detail is [ref]]
- Repeated keys: refused, HTTP 422. `ev:346-353` [ref]
- `inputSchema` "Overrides `block.inputSchema` for the view's input, as on an action." `vt:38`. [ref]
- Refusals at definition time: a scope that is not session, user or org; a missing or non-block `block`; a block with no output schema (or `z.unknown()`/`z.any()`); a `key` that is not a function. Messages: `dv:37-54`. Test: `dvt:32-37,44-49`. [ref]
- The block "must declare an output schema". `vt:12-13`. [page, one clause]

## 4. Installing it

- Install in `defineFlow({ views: { name: view } })`: "The flow's views: blocks a screen watches, each with a scope ... and, for a list, a row key. Declared with `defineView`." `ft:618-624`. The map key is the view's name. [page]
- An entry that is not what `defineView` returned fails when the flow is defined, naming it: `Flow "<kind>" view "<name>" is not a view. Declare it with defineView({ scope, block }).` `df:869-885`; test `dvt:58-62`. [ref]
- The defined flow carries its views: `flow.views` equals the map. `dvt:51-56`. [ref]
- A view is addressed by flow and view name. Route shape `/api/flows/<flow>/views/<name>`; a session view adds the session id: `["desk", sessionId, "views", name]` vs `["desk", "views", name]`. `packages/shift-manager/test/reads.test.ts:28`, `ev:232-233`. [ref]
- A flow's view not declared on the flow is a 404, even if an action carries that name. `es:253-257`. [ref]

## 5. Reading it

- The client handle is `viewRef<TView>(flow, view)`: "the flow's address and the view's name, typed by the view (`viewRef<typeof roster>(...)`, a type import), so client code never imports a view's block." `cv:6-8,22-38`. [page]
- The roster's handle: `rosterView = viewRef<RosterView>(ROSTER_FLOW, ROSTER_VIEW)`, exported from `@flow-state-dev/workforce/browser` (`packages/shift-manager/test/reads.test.ts:21`); "Holds no block, so it is safe in a browser bundle." `rr:2-14`. [page]
- `useView(ref, input, options)`: "a view's answer, typed by the view, and kept current." `uv:2-3`. Returns `{ value, stale }`. `uv:38-43`. [page]
- `value` is `undefined` until the first answer lands. `stale` is `true` while the last read failed; "the live read tries again on its own." `uv:16-17`, `uv:41-44`. [page]
- Input: an omitted input is sent as `{}`. `cv:88-91`; `uv` tests `packages/react/test/useView.test.ts:110-111`. [ref]
- Options: `sessionId` (a session view), `enabled` (`false` watches nothing, default `true`), `pollIntervalMs` (default 3 s, `null` for none), `client`. `uv:28-35`, `packages/client/src/live/live-read.ts:34`; `cv:53-54,71-75`. [ref]
- `client.view(ref, input, { sessionId })` runs the view once without watching: returns `{ value, topics, keys? }`. `cv:46-51`, `packages/client/src/client.ts:573-582`. [page, one sentence; error codes ref]
- Error answers from `client.view`: 404 unknown view or a session the user can't run in; 400 input its schema refuses or a view called at the wrong scope; 422 a view that called a model or reached for a session it hasn't. `packages/client/src/client.ts:577-579` (text cuts off at "reached for"; the 422 session case is `ev:276-281`). [ref]
- Another example call: `useView(PREFERENCES)` with no input and `useView(MODE_STATUS, {}, {...})`. `apps/kitchen-sink/app/flow-state/page.tsx:353,361`. Real names for the page's cast are the roster's: `useView(rosterView)`. [page]

## 6. When it updates

- The screen names no topic. "Each answer carries the change topics of what the view's run read, and the client's live read listens to those, reading again on a change and listening to new topics when they change." `uv:5-9`, `vt:7-9`. [page]
- So: a write to anything the view read reaches its watchers and the view is asked again. Goal outcome: "a change to anything the view read reaches its watchers", "current without the app naming a topic". `goal` Outcome. [page]
- Measured on a real host: a hire, a filed task and a write from another client each reach the watching client in under 1000 ms (measured 42, 31, 36 ms); `goal` signal `b:within-1s` and verdict log row 3. [page may say "well under a second"; exact numbers are [ref]; do not quote the numbers]
- A second user's hire wakes none of the first user's view calls. `goal` signal `b:within-1s`. [page: it answers "whose rows"]
- An idle watching client makes no view calls: 0 calls in 10 s with the poll off. `goal` signal `b:idle-0-reads`. With the poll on, the client also re-reads every 3 s by default "where push can miss a change". `uv:30-31`, `live-read.ts:34`. [ref]
- The view records what each run read, at whatever depth: a read made one block down in a sequencer step is recorded. `ev:304-311`. A view that read nothing hears nothing. `ev:299-302`.
- It hears a change through every read path: direct and template reads, at every scope (session, user, org, lineage). `em:228-238`. [ref; page says "anything the view read"]
- A write a browser makes through the resource routes reaches the same view. `em:260-296`. [ref]
- A write another flow makes to the same user's data reaches a view that read it: the write publishes on the user's topic. `ev:383-389`. [ref]
- A row's identity: "A keyed view's rows keep their identity across answers while they don't change." `uv:11-12`; implementation compares each row by JSON, `cv:115-129`. [page: the guarantee only, "a row that did not change is the same object, so React does not redraw it"; verify the redraw consequence is a React behaviour, state only the identity guarantee]
- Sharing: "Every screen in the app watching the same view with the same input shares one read." `uv:9-11`; `cv:131-134`; test `packages/react/test/useView.test.ts:56-57`. [page]
- A watch that is disabled and enabled again, or one on a new client, view, session or input, starts from nothing: not its old `value` and not its old `stale`. `uv:41-47`. [ref]
- Update path, in three steps for the figure: a write lands in the data; the view is asked again; the row changes. Matches `uv:5-9` and the roster doc comment: "so a hire, an edit, a fork or a fire reaches its watchers with no topic named by the app." `rv:11-13`. [page]

## 7. What a view will not do (flat limits; the page links to the Reference rows)

- A view writes nothing: a resource write, a session state write, a user state write and a dispatch are each refused with HTTP 409 `read_only`, and every store is unchanged afterwards. `ev:320-327`, `es:260-271`. "Its context refuses every write and every model call, so watching a view never changes what it reads and never pays for a model." `vt:6-8`. [page: this sentence; codes ref]
- A view calls no model: a generator (at session and user scope) and a model resolved from a handler are refused with HTTP 422 `view_model_call`. `ev:329-344`. An evaluator is refused too. `packages/engine/test/views-read-paths.test.ts:171-174`. [page: one clause; codes ref]
- A view cannot read liveness; no topic covers it. `views-read-paths.test.ts:164-169`. [ref]
- A pinned flow's view answers a caller outside the pin as an unregistered address (404), naming nothing. `er:127-160`. [ref]

## 8. The four questions, for what a view stores

A view stores nothing itself (`es:187-196`, `ev:256`). The data it reads is stored by the flow's resources; it owns none. For the figure's hatched data on the right, and for the roster:

| Part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| The view's answer | Nobody: computed on each ask, never stored | The asking user; a user view answers each user their own rows (`ev:260-274`) | Nowhere; "answers in the response and stores nothing" (`es:187`) | One answer per ask; one shared live read per client per view and input (`cv:131-134`) |
| The view's definition | The flow that lists it in `views` (`ft:618-624`) | The flow's callers: a user/org view answers the verified principal's own user and org (`vt:33-36`) | In code, on the flow instance (`dvt:51-56`) | Many per flow, a map by name (`ft:624`); the roster flow has three: `roster`, a usage view and a workstream-report view (`packages/workforce/src/workers/roster-flow.ts:69-73`) |
| The roster's own-worker rows (what the `roster` view reads) | The user: "a row in its owner's user scope" (`packages/workforce/src/workers/installation.ts:6`); declared `WORKERS_PATTERN = "workforce/workers/*"`, "one row per worker, at user scope (per organization)" (`packages/workforce/src/workers/keys.ts:11-17`) | The user alone; another user's row is not read (`rv:49-52` shape; `er:173-182` for another org) | The flow's user-scope resource store, the host's store (`keys.ts:11-17`) | One per worker the user hired or forked |
| The roster's standard workers | The installation, from its files: "Where the standard workers are projected from the installation's files" (`keys.ts:23-24`) | Every user's roster (the view reads them for any user, `rv:56-61`) | Projected from `WORKER.md` files; not a per-user store (`keys.ts:23-24`) | One per standard worker file |
| A standard worker the user edited | The user: it is their copy, listed once with `edited: true`, `standard: true`, on the file's team (`rv:92-99`) | The user | The user's own collection (`rv:92-99`) | At most one per standard worker per user |

Rows in the table not marked with a source are read straight from the cited lines; the `Who can see it` for standard workers is read from `rv:56-61` (the view lists every standard worker for whoever asks) and is [verify] for any access limit beyond that.

## 9. The roster view as the worked example

- `roster` is a user-scope view, keyed by worker id, answering "a user's workers, their own and the standard ones, ... with no session". `rv:2-4,49-56`
- Row: `{ id, flow, standard, description, name, teamName, forkedFrom, edited, settings }`. `rv:22-31`
- It "joins the two worker collections on the server": a standard worker the user edited is listed once, as their copy, still standard and on its file's team. `rv:6-10`, `rv:92-99`. [page]
- Each row "shows what a browser may read of it" (the own collection's client projection, the standard projection as it is). `rv:9-10`, `rv:51-53`. [ref]
- Order: the user's own rows first, then standard ones. Code: `[...ownEntries.filter(...), ...standardEntries]` `rv:101`. [ref]
- The goal's real-host check: with a real client watching, a hire reaches the watcher; "the roster view answers a user who never had a session ... the session store lists the same before and after"; a second user's hire reaches none of the first user's watches; 0 view calls in 10 s idle. `goal` signals `a`, `b`. [page, as the cast's behaviour]
- Verdict log rows for the goal are FAIL (expected: leg `c`, removal of old names) at the last run; legs `a` and `b` passed. `goal` verdict log. [do not state a goal status on the page]

## 10. Views against queries (the "If you know queries" section)

Same: a screen asks, the server computes an answer from stored data, the answer is typed, and the client holds it in a hook. Differences the code supports:

- Nothing is named by the app to refresh it: the answer carries the topics of what it read. `uv:5-9`. [page]
- A view reads, never writes, and never calls a model (`vt:6-8`). [page]
- A view's answer is computed on the server by a block and never stored. `es:187`. [page]
- A user or org view needs no session. `vt:33-36`. [page]
- No comparison to a named product: do not name one. `user-docs.md` "Say where we differ" rule.

## 11. What it gets you (the points the page may make, each observable)

1. No refresh code: the screen calls `useView(rosterView)` and a hire, edit, fork or fire redraws it. `rv:11-13`; `goal` `b:within-1s`.
2. The answer is typed from the block's `outputSchema`; the screen never holds an untyped answer. `vt:12-13,70-71`; `dvt:27-30`.
3. Watching costs nothing to the data and nothing to the model bill: it can write nothing and call no model. `vt:6-8`; `ev:320-344`.
4. Each user sees their own rows, and a user who never opened a session still has an answer. `ev:237-274`.
5. Screens that watch the same view with the same input share one read. `uv:9-11`.
6. A list keeps its rows by key, and a row that did not change stays the same object. `vt:40-47`, `uv:11-12`.

## 12. How it fits with the others (neighbours, each one clause)

- A view is what a screen reads; an **action** is what a screen asks the server to do (`ft:` actions are flow-level). A view cannot dispatch: refused with 409 `read_only`. `es:260-271`. [page]
- A view vs a **resource**: the resource stores the data a view reads; the view stores nothing. `es:187`, `rv:56-70`. [page: answers question 4. The plan's example "a list of open tickets with a count": a resource holds the tickets (stored); a view computes the list and count when asked. The fact sheet cites no ticket code; the page's example uses the roster, not tickets, so write the answer to question 4 with a made-up scenario only if the page's cast allows, otherwise reword the question.]
- Resources can be read by a client directly (`packages/client/src/resource-client`), a view is the way to ask for a computed or joined answer; the roster view joins two collections on the server. `rv:6-10`. [page]
- A view over a board: orchestration's `taskToolViews` is a session view answering a board's task rows, keyed by task id. `packages/orchestration/src/skills/views/task-list-view.ts:43-58`. [ref or K-05; the plan says views a kit serves go to K-05]
- Views a flow's kits serve: the workforce roster flow's other two views are the user's spend per worker and a workstream report (`packages/workforce/src/workers/roster-flow.ts:69-73`). [K-05]

## 13. Next links

- `reference/views`: options table (`scope`, `key`, `inputSchema`, `description`), `useView` options, `client.view`, refusal codes (`view_no_session` 422, `view_model_call` 422, `read_only` 409, 400/404 as above), the wire answer `{ output, topics, keys? }`. `ev:237-258`, `packages/client/src/client.ts:573-582`.

## Revision 1 notes

- The flow example passes `actions: {}`: `actions` is required on a flow definition. `ft:592`.
- Moved to the reference and now only linked from the page: retry on a failed read (`uv:41-44`), watch sharing and row identity (`uv:9-12`, section 6), the list of writes that refresh the roster (`rv:11-13`), the scopes detail, the `defineView` field table. Section 6 facts on these stay [ref].
- The page no longer states how the answer records what a run read; it states only that a change to data the view read refreshes the screen.

## Revision 3 notes

- The page's "Whose rows" section now states the join and the edited-worker case: listed once as the user's copy, `standard: true`, on the file's team, `edited: true` (`rv:6-10`, `rv:92-99`); the copy is stored in the user's own collection (section 8, last row), so another user's roster still lists the unedited standard worker (section 8, standard workers row).

## Revision 2 notes

- The page's example flow is `kind: "team"` (view `roster`), so `viewRef<typeof roster>("team", "roster")` shows flow first, view second. `cv:6-8`. The Workforce roster itself is `workforce-roster` / `roster` (section 3 of the flags).
- `stale` wording follows the hook's doc comment: true while the last read failed, the live read tries again on its own. `uv:16-17`, `uv:41-44`.
- The page no longer mentions sessions; the no-session facts in section 2 stay [ref].
