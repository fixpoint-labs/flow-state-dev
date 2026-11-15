# Facts for Run a block when a resource changes (B-36, recipe)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: the existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, `docs/internal/`, `CLAUDE.md`, PR or commit was read. Paths are from the repo root. Nothing here is from memory: each fact was read at the cited line, and the ones marked **[ran]** were also run in this pass.

Abbreviations:

- `rc` = `packages/core/src/types/resource-change.ts` (payloads, schemas, bindings, `validateReactTo`)
- `rd` = `packages/engine/src/context/reactive-dispatch.ts` (the dispatcher)
- `rr` = `packages/engine/src/context/resource-registry.ts` (where each mutation fires)
- `cec` = `packages/engine/src/context/createExecutionContext.ts`
- `res` = `packages/core/src/types/resource.ts`; `col` = `packages/core/src/types/resource-collection.ts`
- `dwf` = `packages/engine/src/resources/default-write-flow.ts`
- `rdt` = `packages/engine/test/context/reactive-dispatch.test.ts`
- `it751` = `packages/integration-tests/src/scenarios/reactive-blocks-fix751.test.ts`
- `rest` = `packages/core/test/resource.test.ts`
- `ks` = `apps/kitchen-sink/flows/chat-agent/shared/artifacts/resource.ts` (the one example that uses it)
- `rb` = `apps/docs/docs/resources/reactive-blocks.md` (the page this recipe keeps)
- `cold` = `apps/docs/docs/resources/collections.md`; `ov` = `apps/docs/docs/resources/overview.md`; `srch` = `apps/docs/docs/resources/searching.md`; `blk` = `apps/docs/docs/fundamentals/blocks.md`
- `res-page` = `docs/contributing/docs-revamp/pages/concepts/resources.md` (drafted C-08, cited for its example's names only)

Legend: **[page]** the page states it. **[ref]** belongs on the Resources Reference page; the page links and does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[conflict]** two sources disagree; the code wins and the note names the wrong source. **[ran]** run in this pass through `testFlow` with a throwaway test (removed). **[test]** pinned by a committed test. **[answers Qn]** the sitemap question it answers.

The sitemap's two questions are **Q1: What starts the block?** and **Q2: Does the writer wait for it?**

## 0. Read first: corrections the page owner needs

1. **[conflict] `rb:138-140` says "Failure is atomic": a throwing reaction fails the mutating turn.** That is half true and the half that is wrong matters. The write is already stored when the reaction runs: a content write persists before the seam fires (`rr:1360-1365`), and a state write fires after the write lock releases (`rr:1199-1213`, `rr:1887-1898`). A throwing reaction rejects the mutating call (`rd:302-305`; **[test]** `rdt:299-318`) and does not undo the write. **[ran]** a collection with `reactTo.created` bound to a handler that throws: the writer catches the rejection, the turn completes, and `getOptional("k")` still finds the row. Left uncaught, the turn's status is `failed` and its error is the reaction's message. The page says "the call rejects with the reaction's error; the write stays", not "atomic". [page] [answers Q2]
2. **[conflict] `rb:185` gives the trace path as `__reactive__/<resource-ref>/<kind>`.** The real path ends `#<n>`, a counter that makes concurrent dispatches distinct: `rd:172-173`, `rd:285`. **[ran]** the item's `blockInstanceId` was `<requestId>:__reactive__/u/k/created#0:0` and the next `<requestId>:__reactive__/u/k/stateUpdated#1:0`. The existing page's examples (`__reactive__/memos/memo-1/stateUpdated`) omit it. If the page names the path, it names `__reactive__/<ref>/<kind>#<n>`; the reliable thing to say is the nesting (item 22), not the string. [page]
3. **[conflict, small] `rb:153` says `when` "receives the same `ResourceChange`".** For `contentUpdated` it receives a `ResourceContentChange` (`key`, `ref`, `kind` only): `rc:138-149`; **[test]** `rdt:592-618`. A `when` on a content binding cannot read state. [page: one clause]
4. **[plan] The sitemap's step 3 is "what it must not do".** The code gives five concrete things a reaction must not do, all on this sheet: loop on its own writes (section 7), assume it is skipped when its input is wrong (section 6), assume a throw is rolled back (item 1), assume a client write reaches it (section 8), and declare the resource it is bound to (section 9, **[verify]**-flagged). The existing page has the first only, plus a sideChain section.
5. **[plan] The page is a recipe: 650 words, three steps.** `rb` is 192 lines of reference-shaped prose. The kept page keeps the task (watch a collection, run a block, know its limits). The payload table, the `kind` list, the eviction flag and the cascade numbers are Reference rows; the page links to them.

## 1. What a reactive block is, and what starts it (Q1)

- A reactive block is an ordinary block (a handler, a generator or a sequencer) bound to a resource or collection through a `reactTo` field on the resource's definition: `rc:1-9`, `res:333`, `col:231`; `rb:8`. [page]
- `reactTo` is on both `defineResource` and `defineResourceCollection`: `res:333`, `col:231`; both call `validateReactTo` at definition time: `res:654`, `col:508`. [page]
- Four kinds start a block: `created`, `stateUpdated`, `deleted`, `contentUpdated`: `rc:44`, `rc:50`, `rc:152-164`. [page]
  - `created`: a new instance of a collection is made: `rr:1796`. [page]
  - `stateUpdated`: an existing instance's or single resource's structured state changes (`patchState` and the other state writes): `rr:1204-1213`, `rr:2134-2148`; **[test]** `rdt:116-143`, `rdt:176-203`. [page]
  - `deleted`: an instance is deleted, by `delete()` or by a capacity eviction: `rr:1985-1990`, `rr:2360-2415`; **[test]** `rdt:145-173`, `rdt:204-266`. [page]
  - `contentUpdated`: the content body is written with `writeContent`: `rr:1356-1366`; **[test]** `rdt:512-549`. [page]
- State and content are separate axes: `writeContent` fires `contentUpdated` only; `patchState` fires `stateUpdated` only: `rd:205-210`; **[test]** `rdt:551-590`. To react to either, bind the same block to both: `rc:161-163`. [page]
- A collection takes all four kinds. A single resource takes `stateUpdated` and `contentUpdated` only: `defineResource` throws on `created` or `deleted`, with the message `defineResource() does not support reactTo.created — single resources have no create/delete lifecycle and only fire "stateUpdated" / "contentUpdated". Use reactTo.stateUpdated or reactTo.contentUpdated.`: `rc:200-222`, `res:654`; **[test]** `rest:132-146`; **[ran]** (the same text for `created`). [page: the rule; the message is [ref]]
- A write that changes nothing starts nothing. Every write to an instance or a single resource reaches the seam only when the store reports it committed a change; a write whose result equals the stored value is a verified no-op and is skipped: `rr:866-868` (doc comment, "Callers gate change notifications on it"), `rr:1246`, `rr:1281`, `rr:1297`, `rr:1319`, `rr:1892-1894`, `rr:2176`, `rr:2211`. **[ran]** `create("k", {n:1})` then `patchState({n:1})` (same value) then `patchState({n:2})` ran the `created` reaction once and the `stateUpdated` reaction once, for the third call. [page: one sentence, it is what a reader will hit when a `patchState` seems ignored]
- The reaction fires for all three scopes. The dispatcher is built per scope for `session`, `user` and `org`: `cec:2792-2797`, `cec:2860-2873`; `rd:47-52` ("shared across all three scope dispatchers"). **[ran]** a `scope: "user"` collection fired `created` and `stateUpdated`. [page: clause]
- It fires only when a block runs inside a turn. The dispatcher closes over the live execution context and does nothing while it is unset: `rd:215-216`, `cec:5089-5092`. A resource change with no turn to run in starts nothing. [verify] the exact set of paths with no live context; keep to "a write made by a block in a turn". [page]
- The block runs as a block of the same request: `executeBlock` with the request's context: `rd:293-301`. Its emitted items land in the same stream, in order after the mutating block's: **[test]** `it751:33-82`, `rdt:80-113`. [page]
- A resource with no `reactTo` costs nothing: the dispatcher returns when the matched config has none, or the kind has no binding: `rd:191-192`, `rd:212-213`. [ref]
- The binding can be written two ways: a bare block, or `{ block, when }`: `rc:130-136`, `rc:173-186`. `when` is a function returning a boolean; false skips the run: `rd:240`; **[test]** `rdt:268-296`. A `when` that is not a function throws at definition: `rc:229-231`. A `block` that is not a block definition throws: `rc:224-228` (`<definer> reactTo.<kind> must be a block (got ...)`). [page: the shape; the throws are [ref]]
- `when` runs before the cascade check and before input validation: `rd:240` then `rd:244-280`. A `false` skips silently. [ref]
- Skip evictions: `when: (change) => !change.evicted`; the explicit delete still runs: **[test]** `rdt:236-266`. [page: this is the one `when` example worth showing for `deleted`, or the pinned-note one below]
- `evicted` is `true` only for a delete caused by a capacity eviction (`lru` or `oldest`), `false` for an explicit `delete()`: `rc:69-73`, `rr:2408-2414`, `rr:1985-1990`. [ref]

## 2. The block's input (the payload)

- A state reaction receives a `ResourceChange`: `{ key, ref, kind, state, prevState, evicted }`: `rc:58-74`; built at `rd:220-230`. [page: `state`, `prevState`, `key`; the rest is [ref]]
  - `key`: the collection instance key, or the single resource's ref name: `rc:59-60`. For a pattern with parameters (`[topic]/observations`) `key` is the full path and the block reads params from `ref`: `rd:98-104`. [ref]
  - `ref`: the full storage path, such as `"artifacts/memo-1"`: `rc:61-62`. [ref]
  - `kind`: `"created" | "stateUpdated" | "deleted"`: `rc:44`. [ref]
  - `state`: the state after the mutation, `null` on `deleted`: `rc:65-66`. `prevState`: the state before, `null` on `created`: `rc:67-68`; **[test]** `rdt:80-113` (`prevState` is null on create, `state` carries the new row), `rdt:116-143`, `rdt:145-173`. [page]
  - `evicted`: see section 1. [ref]
- A content reaction receives a `ResourceContentChange`: `{ key, ref, kind: "contentUpdated" }`, nothing else. The body is never inlined; the block reads it with `readContent()` on the resource, which returns the new body because the write persisted first: `rc:76-89`, `rd:218-223`; **[test]** `it751:315-380` (asserts `bodies` equals `["the new body"]`), `rdt:512-549`. [page]
- Typing the input: `resourceChangeSchema(stateSchema)` for a state reaction, `resourceContentChangeSchema()` for a content reaction, both from `@flow-state-dev/core`: `rc:101-124`. `resourceChangeSchema` is `state` and `prevState` made nullable: `rc:101-110`. [page]
- A block with no `inputSchema` is run with the raw payload: `rd:264-266`. [ref]
- A block may be any kind. The tests bind handlers and sequencers: `it751:34-47`, `it751:155-165`; `ks:100-103`. [page]
- `ctx.emit.message` takes a string or a content array: `packages/core/src/types/block.ts:473-490`. `rb`'s example calls `ctx.emit.message(\`New memo: ...\`)` with a string, which is valid. [page]

## 3. Reaching the resource from inside the block

- A reaction reaches resources through `ctx.resources`, by the name the flow or a block registered them under, as any block does: `rb:105`, `ks:55-64`. [page]
- **A reaction does not need its own `resources` declaration for the resource it watches, and in a real app should not have one.** The kitchen-sink reaction reads `ctx.resources.artifacts` with no block-level `resources`, and its header says why: declaring it on the block "would form a definition cycle with the collection's own `reactTo` binding": `ks:49-64`. The engine test's mirror handler also declares none and patches the single resource it is bound to: **[test]** `rdt:471-509`. [page: one sentence; this is what a reader hits when they import the collection into its own reaction and get a cycle]
- The collection reached through `ctx.resources` must be installed by the flow. In `ks` a capability installs it (`ks:51-53`); in the engine test a no-op block that declares it does (`rdt:55-70`). A reaction reading a name nothing installed has nothing to read. [verify] the exact error; keep to "the flow must register the collection". [page]
- `getOptional(key)` returns the ref or `undefined`; `get(key)` rejects when missing; `create` throws when the key exists: `col:332`, `res-page:99`. [ref] (resources page owns these)

## 4. Does the writer wait? (Q2)

- By default, yes. The dispatcher is awaited inline inside the mutating call; `create`, `patchState` and `writeContent` do not return until the reaction has finished: `rd:1-12` (header), `cec:2907-2911` ("awaited inline — it runs the bound block as part of the mutating turn"), `rr:1208`, `rr:1365`. [page]
- A mutation, its reaction and everything the reaction emits belong to one turn, in order: `rd:6-12`; **[test]** `it751:33-82`. [page]
- There is no setting to change this. No `mode` or `async` field exists on `ReactiveBinding`: `rc:130-136`, `rc:151-164`. [page: one clause, "there is no flag"]
- To not wait, make the reactive block a sequencer that ends in `.sideChain(block)`. The writer's call returns at once; the work runs in the background and the request finishes only after it is done: `blk:458`, `blk:527`; `packages/core/src/blocks/sequencer.ts:1005-1010` (the request drains the side-chain pool "to quiescence before terminal status"); **[test]** `it751:142-193`, `it751:382-427`; `ks:94-103`. **[ran]** a sideChain reaction that took 100 ms: `create()` returned first, the reaction finished after, and the turn completed (order recorded: `create-returned`, `reaction-done`). [page]
- A sideChain reaction that throws does not fail the turn or the write: **[test]** `it751:142-193` (the worker throws, the turn is `completed`), `it751:382-427` (the same on a content write). [page]
- **Cost of `.sideChain()` that the page must state:** the reaction's failure is also silent to the writer, so a reaction that must succeed for the write to be right (a check, a required copy) should block; a reaction that is a fan-out side effect (index, summary, notification) should side-chain. This is `rb:140-149`'s own rule, it is observable from the two **[ran]** results above. [page]
- A blocking reaction is slow for the writer: its run time is added to the mutating call. That follows from awaiting it (`cec:2907-2911`). [page: one clause]
- Side-chained: the reaction's state writes still reach the store, and a nested reaction they trigger is a second turn-level dispatch under the same cascade budget. [verify] not run; keep off the page.

## 5. What happens when the reaction throws

- Blocking reaction: the throw reaches the mutating call as a rejection with the reaction's own error (`result.error` is rethrown): `rd:302-305`; **[test]** `rdt:299-318` (`.rejects.toThrow("reactive boom")`). **[ran]** uncaught: turn `failed`, error message `nope`; caught by the writer: turn `completed`, row stored. [page] [answers Q2]
- The reaction runs inside a `try` whose `finally` decrements the cascade depth, so a throw does not leave the budget raised: `rd:290-308`. [ref]
- Sidechained reaction: isolated, see section 4. [page]

## 6. A reaction whose input does not match

- The payload is parsed against the block's `inputSchema` before the block runs. A mismatch skips the block and emits an `error` item with code `reactive_input_invalid`; the write is unaffected and the turn is not failed: `rd:261-280`, `rd:140-170`; **[test]** `rdt:362-391` (block not run, diagnostic emitted). [page]
- The item's `message` reads `Reactive block "<name>" input validation failed: <first issue message> at "<path>"` (the ` at "<path>"` is left out when the issue has no path): `rd:269-276`. [ref]
- The common cause: the block's `resourceChangeSchema(...)` was built from a different state schema than the resource's. [page: one sentence] The test builds exactly that mismatch: `rdt:362-391`.
- A state reaction bound to a block that takes `resourceContentChangeSchema()`, or the reverse, fails the same way, since `kind` is a literal in the content schema: `rc:118-124`, `rc:101-110`. [verify] not run; keep off the page.
- If the item stream has no emitter (a reaction run with no client attached) the diagnostic is dropped quietly and the block is still skipped: `rd:140-156`. [ref]

## 7. A reaction that writes (cascades)

- A reaction may write a resource that has its own `reactTo`. That is allowed and nests: `rd:14-17`, `rd:293-301`; **[test]** `it751:195-253` (a bumper reaction raises `n` to 3 and stops: exactly 3 reaction runs), `rdt:471-509` (a reaction patches its own resource; completes, no deadlock). [page]
- A reaction that patches the same resource it is bound to must stop by a condition, or it loops. The engine test stops by a `when` gate: `when: (c) => c.state?.mirror !== c.state?.status`: `rdt:471-509`. [page: this is the "what it must not do" step]
- Two caps per turn: re-entrancy depth 8 and total reactive dispatches 1000: `rd:43-45`. Hard-coded, not configurable: `rd:43` ("Hard-coded — not author-configurable"). On a breach the dispatcher skips the block and emits an `error` item with code `reactive_cascade_exceeded` and a message naming the cap and the block: `Reactive cascade exceeded max depth (8) dispatching "<name>"` or `... max fan-out (1000) dispatching "<name>"`: `rd:244-259`. **[ran]** the message read `Reactive cascade exceeded max depth (8) dispatching "rr"`. [page: the code and the message; the numbers are [ref] but may be named once]
- **A cascade breach does not fail the turn.** The dispatcher returns after emitting the item: `rd:244-251`. **[ran]** the turn's status was `completed` with one `error` item. `rb:179` says "stops and emits a diagnostic"; correct, but a reader will assume failure. [page] [conflict, small: the existing wording does not say the turn completes]
- The depth cap is checked per request, shared by the three scope dispatchers: `rd:47-52`, `cec:2792-2797`. [ref]
- `patchState` from a content reaction does not re-fire the content reaction, because it fires `stateUpdated`: `rd:205-210`; `ks:95-98`, `rb:130`; **[test]** `rdt:551-590`. [page: this is the loop-safe pattern: write derived data to state from a content reaction]
- Breadth: a content reaction that writes content of the same resource (`writeContent`) loops on `contentUpdated`. [verify] not run; by `rd:205-210` it should. Keep to "a reaction that writes the kind it reacts to must have a condition that stops".

## 8. What does not start a reaction

- A client write. A write a browser makes to a user or org resource goes through the write flow, which "writes to the store directly ... publishes the scope's change notice but runs no `reactTo` binding": `dwf:19-27`. [page]
- A client content edit (`client.content.update`) likewise starts nothing yet: `rb:132`, `apps/docs/docs/resources/client-access.md:591`. The resource routes file has no reactive dispatch call: grep of `packages/engine/src/routes/resource-routes.ts` for `reactTo|onResourceChanged|reactive` returns nothing. [page: "A change a browser makes does not start a reaction"] [verify] a session-scoped client write through the routes, which the sheet did not run; the statement stays at "writes made by a block in a turn start reactions, writes a browser makes do not".
- A write the store reports as a no-op (section 1). [page]
- `onInstanceCreated`, `onInstanceUpdated`, `onInstanceDeleted` are the older callbacks on a collection. They still exist, are synchronous, and are for logging or mirroring: `cold:365-367`, `col:228-231`. They fire before the reactive dispatch on the same change: `rr:1203-1213` (the hook is awaited, then `onResourceChanged`). [page: one sentence, the page's choice between the two]
- The faceted collection (`defineFacetedCollection`) binds `reactTo.contentUpdated` itself and throws on yours; `created`, `stateUpdated` and `deleted` stay yours: `packages/core/src/types/faceted-collection.ts:273-276`, `srch:145`. [page: one clause, links to B-34 Search a collection]

## 9. What the reader sees (the trace and the stream)

- Items the reaction emits go to the same turn's stream, in order after the mutating block's: **[test]** `it751:33-82`. [page]
- In the trace, the reactive block is a child of the block that made the mutation, not of the request root. **[test]** `it751:84-140` (the reaction's `parentBlockInstanceId` equals the mutating step's `blockInstanceId`, when the mutation is in a sequencer step); `rd:286-289`, `rd:77`. **[ran]** the reaction's `parentBlockInstanceId` was `...:root:0` when the mutation was in the root action block. [page]
- A reaction that writes again nests its children under itself: `rd:79-83`, `rd:291-293`. [ref]
- The path is `__reactive__/<ref>/<kind>#<n>`: item 2 above. [ref]
- A non-live single resource with a `reactTo` runs the block but emits no `resource_change` item to the client: `cec:2877-2886`; **[test]** `rdt:393-417`. [ref]

## 10. The questions about stored parts

This page defines nothing that stores data. A reaction binding is a field on a resource definition; the resource it watches belongs to C-08 and is not restated. The four questions, answered for the parts the page touches:

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| The binding (`reactTo`) | The resource's definition, in your code; a flow installs the resource | Nobody at run time; it is not stored or sent to the browser (it is a field on the definition, `res:333`, `col:231`) | Nowhere: it lives in the code that defines the resource | One map per resource, one entry per kind (`rc:152-164`); at most four |
| The reactive block's run | The request that made the mutation | The trace and, through `ctx.emit`, the turn's stream (section 9) | With the request's items and trace like any block's run | One per fired change; capped at 8 deep and 1000 per turn (`rd:43-45`) |
| What the reaction writes (a summary, a mirror) | The resource it writes to, under that resource's own scope and rules | As that resource says | As that resource says | As that resource says |
| The `error` item on a bad payload or a cascade breach | The request | The turn's stream | With the request's items | One per skipped dispatch (`rd:261-280`, `rd:244-259`) |

The page states the first two in a clause each. The third is C-08's.

## 11. Example material (the page's one app: the support desk)

The page's app is the support desk, flow `support`, as on the other Build pages. C-08's drafted example already owns `ticketNotes`: a collection at `ticketNotes/**`, `scope: "session"`, state `{ author: string, pinned: boolean (default false) }`, written by `addNote` with `create(key, { author })` and `writeContent(text)`: `res-page:70-95`. The recipe can reuse it so the reader meets the same names. Names below are proposals; the owner decides, and the sources are the real types.

- A state reaction worth showing: bind `stateUpdated` on `ticketNotes`, gated by `when: (change) => change.state?.pinned === true && change.prevState?.pinned !== true`, to a handler that emits one message. This exercises `state`, `prevState`, `when` and `ctx.emit.message`, all on this sheet (`rc:58-74`, `rd:240`, `block.ts:473-490`). A `patchState({ pinned: true })` on an already-pinned note is a no-op write and starts nothing even without the `prevState` check (section 1), so the `prevState` check is not needed for that case. It is needed only if the same value could be written through a path the store does not treat as a no-op. [verify] keep the gate to `change.state?.pinned === true` and say what it does: it runs on every committed change that leaves the note pinned, not only the transition. Use `prevState` for the transition, which `rdt:268-296` and `rb:155-164` both support.
- A content reaction worth showing, which the existing page and the kitchen sink both carry: a sequencer that reads the new body with `readContent()`, summarizes it and writes the summary into state with `patchState`. Wrapped in `.sideChain()` so the writer does not wait: `ks:50-103`; `rb:94-118`. Model string if one is named: `openai/gpt-6-luna` (the standard's choice; `rb:109` already uses it). `utility.summarizer({ name, model })` is the existing call: `rb:109`, `ks:91`. [verify] the exact `utility.summarizer` signature was read only as used in `ks` and `rb`; the page's example is checked by pass 4.
- Registration. A flow must register the collection for a reaction to find it through `ctx.resources`: section 3. The block that writes declares it with `resources: { notes: ticketNotes }`: `res-page:81-93`.
- File layout for the code titles: `src/flows/support/resources/ticket-notes.ts` (the collection and its `reactTo`), `src/flows/support/blocks/<block>.ts` (the reaction, one export per file), per `docs/contributing/user-docs.md` "Code examples". The reaction block imports nothing from the collection file (section 3), and the collection file imports the reaction: that direction is what avoids the cycle. [page]

## 12. Limits and non-claims

- The page does not say a reaction can be bound to a resource defined by a kit or capability you do not own. [verify] not read; the faceted collection owns `contentUpdated` on its collections (section 8), and a task board's resource-backed collection has a comment about `reactTo.stateUpdated` at `packages/orchestration/src/tasks/collection/resource-backed.ts:129`. Keep to your own resources.
- Whether a reaction runs when the mutation is made by a block that is itself inside a `.sideChain()`, a worker, a schedule or a queue job. [verify] not run. The page says "a block in a turn".
- Concurrency: two simultaneous writers to one key. Each write holds a per-key write lock, released before the reaction runs, so a reaction may patch the key it was called for: `rr:1199-1213`, `rr:1871-1880`, `rr:2118-2133`; **[test]** `rdt:465-509`. Nothing is stated about which of two simultaneous reactions runs first. [ref]
- Eviction order and `lru`/`oldest`: Resource Collections (`cold:279`). [ref]

## 13. What the page must link to, and what it must not restate

- C-08, Resources (`concepts/resources`): what a resource and a collection are, their scopes, `create`/`get`/`patchState`/`writeContent`, `readContent`. The page's first sentence uses "resource" and "collection" as C-08 defines them: `res-page:13-15`. [page: link]
- C-16, Background work (`concepts/background-work`): the sitemap links it. The sheet found nothing in `rb` or the dispatcher that connects them beyond `.sideChain()` running work off the writer's path (section 4). A reaction is not a background job: it is a block in the turn, and `.sideChain()` drains before the turn ends (`sequencer.ts:1005-1010`), so work that must outlive the request is C-16's job, not this page's. [page: one sentence, the boundary] [verify] read `background-work.facts.md` for the boundary C-16 itself draws before writing the link text.
- B-34, Search a collection (`build/search-a-collection`): the faceted collection owns a `contentUpdated` reaction. [page: link, one clause]
- Reference (Resources): the payload table, `ResourceChange` and `ResourceContentChange` field rows, `ReactiveBindings`, the `reactTo` kinds per definer, the `reactive_*` error codes, the two cascade caps. [page: link]
- Blocks (`fundamentals/blocks`): `.sideChain()`. [page: link]

## 14. Existing-page claims checked

| Claim on `rb` | Verdict |
| --- | --- |
| Runs "inside the same session", same turn (`rb:8`) | True. `rd:6-12`. |
| "Items it emits land in that turn's stream, ordered" (`rb:10`) | True. **[test]** `it751:33-82`. |
| `onInstance*` callbacks are "synchronous, fire-and-forget" (`rb:14`) | The hooks are awaited by the registry (`rr:1203-1207`, `rr:1976-1978`), so "fire-and-forget" overstates; `cold:365` says "Hooks are synchronous". Say "plain callbacks", or drop the adjective. |
| `reactTo` "supersedes" the callback "when you need anything the callback can't do" (`rb:22`) | Matches `col:228-231`. |
| Three state kinds and one content kind (`rb:26`) | True. `rc:50`. |
| Single resources throw on `created` or `deleted` (`rb:56`) | True, at definition. `rc:218-222`; **[test]** `rest:132-146`. |
| `ResourceChange` field table (`rb:64-71`) | True. `rc:58-74`. |
| `resourceChangeSchema` and `ResourceChange` come from `@flow-state-dev/core` (`rb:88`) | True. `it751:14-22` imports them from there. |
| "Runs after the body is persisted, so a `readContent()` inside the block returns the new body" (`rb:92`) | True. `rr:1360-1365`; **[test]** `it751:315-380`. |
| `ResourceContentChange` table (`rb:122-126`) | True. `rc:82-89`. |
| "Failure is atomic" (`rb:140`) | **Wrong as worded.** Item 1. |
| `.sideChain()` "drains before the turn reaches a terminal status" (`rb:140`) | True. `sequencer.ts:1005-1010`; **[ran]**. |
| `when` "receives the same `ResourceChange`" (`rb:153`) | **Wrong for content.** Item 3. |
| Cascade caps both depth and fan-out; diagnostic is a failed `error` item (`rb:179`) | True. `rd:140-170`, `rd:244-259`. The turn completes normally (section 7). |
| "You don't configure these limits" (`rb:181`) | True. `rd:43`. |
| Trace path `__reactive__/<resource-ref>/<kind>` (`rb:185`) | **Missing `#<n>`.** Item 2. |
| Nesting "under the block that performed the mutation" (`rb:185`) | True when the mutation is in a nested step. The root action block is the parent when it mutates directly: **[ran]**, `it751:84-140`. |
| `client.content.update` "does not fire a reaction yet" (`rb:132`) | Consistent with `dwf:19-27` and `resource-routes.ts` having no dispatch. The word "yet" is a promise; the page does not repeat it. |

## 15. Revise round 1: what the page now states

- The page uses `ticketNotes` with a state of `{ author, pinned, wordCount }`; `wordCount` is added for this recipe (section 11). The state schema sits in a leaf file `note-state.ts` so the reaction does not import the collection (section 3, `ks:49-64`).
- The content-reaction block reaches the collection as `ctx.resources.notes`, cast to `ResourceCollectionRef<NoteState>` from `@flow-state-dev/core/types` as `ks:60` does; `ctx.resources.<name>` is untyped without a block-level declaration. The name `notes` is the one `addNote` declares (`res-page:81-93`). All five files type-check against the kitchen-sink tsconfig.
- A throwing reaction: the call rejects with the reaction's error and the write stays stored; uncaught, the turn fails (section 0 item 1, **[ran]**). The page no longer says "atomic".
- The trace path string is not on the page (item 2); only nesting is stated. The `#<n>` suffix is a Reference row (R-06).
- The page names no payload for a block bound to both `stateUpdated` and `contentUpdated` and says nothing about one block bound to both: a content reaction receives `ResourceContentChange` (`key`, `ref`, `kind`), a state reaction `ResourceChange` (`rc:58-89`). Separate blocks are what the page shows.
- `client.content.update` fires no reaction (`dwf:19-27`); the page states it without "yet".
- Cascade breach and `reactive_input_invalid` both emit an `error` item and the turn completes (section 6, section 7 **[ran]**). The depth (8) and fan-out (1000) numbers are Reference rows; the page says "a fixed depth".
- Links use page-plan slugs: `../concepts/resources.md`, `../concepts/background-work.md`, `../reference/resources.md`, `../reference/items.md`, `./find-by-facets.md`.

## 16. Revise round 2

- `ctx.resources.notes` is untyped without a block-level `resources` declaration, and declaring it makes the definition cycle (`ks:49-64`), so the cast stays. The page now says why. `ResourceCollectionRef` is also exported from the `@flow-state-dev/core` root (`packages/core/src/index.ts:38`); the example imports it from there.
- `addNote` is introduced with its `resources: { notes: ticketNotes }` map (`res-page:86-96`) and linked.
- The cascade bullet says the framework stops the chain at a fixed depth and the turn completes (section 7); "evictions" is gone from the reference pointer.

## After the loop (review)

- **`ctx.resources.notes` resolves in a reaction that declares nothing.** `defineFlow` collects `declaredResources` from every block reachable from the flow's actions into `flow.resources` (`packages/core/src/flow/defineFlow.ts:749-761`). The engine builds one flat `ctx.resources` registry from that map (`packages/engine/src/context/createExecutionContext.ts:703-730`, `:3435-3450`), and "every block's context shares this one registry" (`:3462-3463`). The reaction runs through `executeBlock` with the turn's context (`rd:293-299`). So including `addNote` in the flow makes `notes` reachable from the reaction. [page] section 3, one sentence. Settles the [verify] in the registration fact.
- **The cascade diagnostic is an `error` item.** `emitReactiveError` emits `type: "error"`, `status: "failed"`, with the code (`rd:140-170`); a depth breach (`MAX_CASCADE_DEPTH = 8`, `rd:44`) skips that block and emits `reactive_cascade_exceeded` (`rd:244-257`). [page] the loop limit.
