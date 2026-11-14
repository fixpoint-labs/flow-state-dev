# Facts for Composition (C-04, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no `docs/architecture/`.

Paths are from the repo root. Abbreviations:

- `core` = `packages/core/src`
- `seq` = `packages/core/src/blocks/sequencer.ts` (implementation; read to confirm behaviour, not quoted)
- `sm` = `packages/core/src/blocks/sequencer-methods.ts` (the exported `SequencerDefinition` type)
- `rt` = `packages/core/src/blocks/router.ts`
- `bb` = `packages/core/src/blocks/internal/build-block.ts`
- `ct` = `packages/core/test/sequencer.test.ts`
- `rtt` = `packages/core/test/router.test.ts`
- `old-comp` = `apps/docs/docs/sequencers/composing-blocks.md`
- `old-ov` = `apps/docs/docs/sequencers/overview.md`
- `old-cf` = `apps/docs/docs/sequencers/control-flow.md`
- `old-conn` = `apps/docs/docs/sequencers/connectors.md`
- `old-sc` = `apps/docs/docs/advanced/sequencer-side-chains.md`
- `old-blocks` = `apps/docs/docs/fundamentals/blocks.md`
- `items` = `apps/docs/docs/streaming/items.md`
- `hc` = `examples/hello-chat/src/flows/hello-chat/flow.ts`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page (`reference/sequencer-methods` or `reference/blocks`); the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[contradiction]** two sources disagree; the ruling is given.

The page's one scenario is the support desk from the Blocks page (C-02): `handleTicket` runs `cleanMessage` then `draftReply`. Names for further blocks (lookups, a router's routes, a logging block) are the page's own choice; each is an app name, not a framework fact. Names that need no further invention: `cleanMessage` returns `{ text, truncated }`, `draftReply` takes a string (the Blocks page's example, `docs/contributing/docs-revamp/pages/concepts/blocks.md`, which the page repeats by clause, not by listing).

## Read this first: things the page cannot say, and corrections to existing docs

1. **A step's input is not type-checked against the previous output at compile time.** `old-conn:130-145` ("Mismatches surface at compile time"), `old-blocks:739` ("TypeScript knows the connector's return type must match the next block's input schema") and `old-ov:186` say it is. The exported signatures say otherwise: `step(block: BlockDefinition<any, TOutSchema>)` has `any` as the block's input (`sm:163-165`); with a connector, `connector: ConnectorFn<TOutput, TStepIn>` and `block: BlockDefinition<any, TOutSchema>` leave `TStepIn` unrelated to the block's input (`sm:177-180`). Observed: a `tsc --noEmit` run over `sequencer(...).step(a).step(b)` where `a` returns `{ text }` and `b` takes `{ query }`, and over `.step((o) => ({ nope: o.text }), b)`, reported no error (a deliberate unrelated error in the same file was reported, so the file was checked). What the checks do catch is at run time: the block's own `inputSchema` rejects the value, `Block "<name>" input validation failed at "<path>": <message>` (`bb:152-170`, input check `bb:356`; test `packages/core/test/build-block.test.ts:64`, `:85`). **The page says: a step that receives the wrong shape fails when it runs, with an error naming the block and the field; it does not claim a compile-time check.** What types do flow: the output type of each step is inferred from the block's `outputSchema`, so a connector's argument is typed as the previous step's output (`sm:177-180`, `:219-221`). [page]
2. **`.stepIf` takes a condition function only, not a static boolean.** `old-comp:171` says `stepIf` "accepts a static boolean". The signature is `condition: (input, ctx) => boolean | Promise<boolean>` on every overload (`sm:189-217`) and the implementation calls `await condition(value, ctx)` (`seq:1399-1415`). `sideChainIf` does accept `boolean | function` (`sm:307-321`; tests `ct:1391-1432`). [contradiction: the signature wins; the page does not mention a static boolean for `stepIf`.]
3. **Does the sequencer wait for its side chains before it returns?** `old-comp:203` says yes ("waits for outstanding `.sideChain()` tasks to settle before it returns"). `old-sc:72` says the opposite for a sequencer in a request: tasks go on one per-request pool, "Inner sequencers do not block their parent on their own background work", and "The request executor drains the pool before the request's final event". Tests: `packages/engine/test/request-side-chain-pool.test.ts` (pool drains; failed tasks reported, not thrown), `packages/engine/test/request-end-background-failures.test.ts`. **Ruling: the request waits, the chain does not.** The next step runs at once; the request's stream stays open until every queued task settles; `.waitForSideChain()` is how a step later in the chain waits for them. (The `old-comp:203` sentence is the one corrected at cutover. The fallback in `ct:1223-1251`, "per-sequencer fallback auto-awaits when no request pool is present", is a test-harness case.)
4. **The old docs call the DSL "15 methods" (`old-blocks:389`) and "21 methods" (`old-ov:63`).** Count them from `sm:162-420` if the page ever gives a number: it should not. [page: no count]
5. **`.sideChain` and the user's reply.** `old-sc:13`, `old-comp:205`: a failed side chain never aborts the chain; the failure is logged and reaches DevTool on the trace channel; "nothing surfaces in the user-visible stream". One exception, for a request working a dispatched task from a board (`old-sc:46`, `:419`): [ref].

## 1. The opening: what composition is

- A sequencer is a block that runs other blocks. `core/types/block.ts:38-42` (doc comment on kinds: "`sequencer` and `router` compose other blocks"); `sm:148-161`. [page]
- A router is a block that picks one of several blocks to run. `rt:134-141`. [page]
- You build a sequencer with `sequencer({ name, inputSchema })` and chain methods; each method returns a sequencer, so calls chain: `.step(a).stepIf(cond, b).tap(c).step(d)`. `old-ov:87`; `sm:162-420` (every method returns `SequencerDefinition`). [page]
- The chain is read top to bottom; "Read top to bottom: validate, price, ..." is how the old page describes a pipeline. `old-comp:322`. [page, as a reading instruction, not a quote]
- A sequencer is itself a block (`SequencerDefinition extends BlockDefinition`). `sm:156-161`. So it can be a flow action's block, a step in another sequencer, or a generator's tool. `hc:71-73`, `:82-83` (action's block is a sequencer); `old-ov:190-206`; test `packages/core/test/flow-config.test.ts:766-790` (a sequencer listed in `tools`). [page; **answers Q4**]
- What follows from a sequencer being a block: it has a `name`, an `inputSchema` and an output; its inputs and outputs are validated like any block's; whatever takes a block takes a sequencer. A nested sequencer shows the same shape to its parent as a handler does. `bb:152-170`, `:356-364`. [page]
- A sequencer's output type is the last step's output type. test `ct:645-657` (propagates `outputSchema` from the last step); `old-ov:186` ("TypeScript infers the chain's output from the last step's schema"). [page, one clause]
- A sequencer may declare its own `outputSchema`; if it does, the value it returns is checked against it, and a mismatch throws `SequencerOutputSchemaError`. `old-ov:100-130`. [ref]
- Block names are unique within a flow; a router's routes cannot share a name unless they are the same block. `old-blocks:186`; `rt:209-221` (duplicate route name throws `Router "<name>" declares duplicate route name "<route>" across two different blocks`). [ref]
- A sequencer or router declares no model or API work of its own; it contains others. `core/types/block.ts:38-42`. [page, one clause]

## 2. A sequence: `.step()` (Example 1)

- `.step(block)` runs the block; its output becomes the next step's input. `sm:163-165`; `old-comp:13`, `old-ov:186`; test `ct:18-27` (`.step(one).step((v) => v*2, two)` on input 1 returns 6). [page]
- Steps run one after another; a step starts when the one before it has finished. `old-ov:186` ("The pipeline is linear: step 1 output → step 2 input → step 2 output → step 3 input"). [page]
- The sequencer's input is the first step's input. `old-ov:186`; `ct:680-693` (first block's `inputSchema` is used when none is declared; an explicit one wins). [page]
- If a step throws, the chain stops and the sequencer fails; there is no continuing past an error unless a `.rescue()` catches it. `old-comp:211`, `:248` ("By default a thrown error halts the sequencer"; "errors bubble out and the sequencer fails"). [page, one sentence]
- `.rescue([...])` catches by error type and runs a recovery block whose output continues the chain; `.rescue()` is also a method on any block, so one step can recover alone. `old-comp:211-300`. [ref: rescue is not in the page's four ways to join; the page may name it once and link]
- Output after an inline `.map`: the type is whatever the function returns; the schema falls back to `z.any()`. `ct:749-757`. [ref]
- The same block can be a step in any number of sequencers; its declared resources bubble up through every sequencer that contains it. `core/types/block.ts:1218-1230` (`declaredResources`); `old-blocks:766-798`. [ref (Resources)]
- `.step(connector, block)`: the connector is a function over the previous output (and the block context) that returns the block's input. `sm:177-181`; `old-conn:7-22`; test `ct:18-27`. [page; see Example 2]

## 3. What passes between steps (Figure 1; Example 2: `.map()`)

Figure 1 plan: `handleTicket` as a row of steps, each arrow labelled with the type it carries. All types below come from the Blocks page's example and are checked against `sm`.

| From | To | Type on the arrow | Source |
| --- | --- | --- | --- |
| `handleTicket` input | `cleanMessage` | `{ message: string }` | the Blocks page's `handleTicket` `inputSchema` |
| `cleanMessage` | reshaping step | `{ text: string, truncated: boolean }` | `outputSchema` of `cleanMessage` |
| reshaping step | `draftReply` | `string` | `draftReply`'s `inputSchema: z.string()` |
| `draftReply` | `handleTicket` output | `string` (with no `outputSchema` a generator returns a string) | `core/blocks/generator.ts:2865` |

- The producing block declares an `outputSchema`; the consuming block declares an `inputSchema`; both are Zod schemas. The consumer's `inputSchema` validates the value it receives; the producer's `outputSchema` validates what it returns. `bb:152-170`, `:356-364`. [page]
- Each step receives exactly the previous step's output, and nothing else from earlier steps. `old-ov:186`; `old-comp:106-112` ("`priceOrder` gets the original input, not anything from `validateOrder`" for a tap). [page]
- When the shape is different, you reshape in a connector: `.step((cleaned) => cleaned.text, draftReply)`. The connector runs before the block; its return value is the block's input. `old-conn:7-22`, `:28-30`; `sm:177-181`; test `ct:18-27`. [page; **answers Q1: the reshaping goes in the connector argument of the step that needs the new shape**]
- A connector also gets the block context as a second argument, so it can read state. `old-conn:7-14`, `:127-145` (`ctx.user.state...`); `sm:177-181` (`ConnectorFn`). [ref; page says "gets the previous output" only]
- `.map(fn)` reshapes the value between steps without a block: `.step(cleanMessage).map((cleaned) => cleaned.text).step(draftReply)`. `sm:219-221` (`map<TNext>(mapper: (input, ctx) => TNext | Promise<TNext>)`); `seq:1459-1470`; test `ct:39-43` (`.map((v) => \`v:${v}\`)` on 3 returns `"v:3"`). [page, Example 2]
- `.map` is a plain function, not a block: it has no schema, no name, and appears in the trace as no step of its own. `old-comp:125`; `seq:1459-1470` (`name: "map"`, always inline). Use a handler with `.step()` when the transform has side effects, calls the network, or should show in the trace. `old-comp:136`. [page: two sentences; "no step of its own in the trace" is observable in DevTool: `old-comp:125`]
- Choosing between a connector and `.map`: a connector belongs to one step and reshapes for that block (it can be reused by nobody else); `.map` is its own place in the chain. Both give the next step a new shape. [verify: the "when to choose" framing is the page's; the facts are the two lines above]. Keep to: the connector is attached to the step that needs it; `.map` stands on its own line.
- `connectInput` on a block: attaches the reshape to the block itself, so the block always receives the adapted input wherever it is used. `old-conn:62-78`; `old-cf:313-330`; test `ct:759-835`. [ref, one clause with link]
- A step that receives the wrong shape fails when it runs: `Block "<name>" input validation failed at "<path>": <message>`. `bb:152-170`, `:356`; test `packages/core/test/build-block.test.ts:64`. [page: the fact; error text is [ref]]
- Input/Output of each step is recorded: a `block_trace` item per block execution holds the block's input and output. `items:55-60`, `:110`. A block downstream of another stamps its input source as a reference to the upstream trace row. `items:110`. [page, one clause; DevTool shows the trace]
- A `block_trace` output over 256 KiB is recorded as a placeholder. `items:149-155`. [ref]

## 4. A choice: routers (the router section)

- `router({ name, inputSchema, outputSchema, routes, execute })`; `execute(input, ctx)` returns one of the blocks listed in `routes` (sync or async), and the router runs that block. `rt:134-141`, `:266-327` (`execute` result selected, then run); test `rtt:5-24` (`execute: (value) => value < 10 ? low : high` on 3 returns `"low"`, on 20 returns `"high"`). [page]
- Routes are declared statically in `routes`; the choice happens when the router runs. `old-blocks:537`. [page]
- The router's `execute` can read the input and the block context (state, config) to decide: `ctx.session.state.mode` in the existing example. `old-blocks:540-555`. [page]
- The router's output is the chosen block's output. Every route has the router's input and output types (`routes: BlockDefinition<TInputSchema, TOutputSchema>[]`), which is why a router can be one step in a sequencer. `rt:134` (config `routes`), `rtt:5-24`. [page]
- A router returns the block to run, not a name: `execute` returns the block itself (`rt:135-141`, test `rtt:5-24`). [page]
- Returning a block that is not in `routes` throws: `Router "<name>" selected invalid route "<block name>". Route must be one of declared candidates.` `rt:292-294`; test `rtt:26-44` (`.rejects.toThrow("invalid route")`). [ref: the page may say "a router can only choose among its listed routes"]
- Route names must be unique within a router (two different blocks sharing a name throw when the router is built). `rt:209-221`. [ref]
- `validateRoute` overrides the "must be listed" check. `rt:281-290`; test `rtt:46-61`. [ref]
- A route can be any block: a handler, a generator, a sequencer, another router. `old-blocks:694-703` ("a sequencer can contain routers, a router can dispatch to sequencers"). [page]
- A router has no code of its own that does model or API work: `execute` picks; the chosen block does the work. `core/types/block.ts:38-42`. [page, one clause]
- Whether the choice is made by your code or by a model: the router's `execute` is your code. If the choice should come from a model, an evaluator asks a typed question and the router (or a step) reads the answer. `old-blocks:383`; `core/blocks/evaluator.ts:1-8`. [page: one sentence, link to Generators and tools]
- `utility.keyedRouter({ name, inputSchema, blocks, select })` picks a block from a record by a string key; `fallback` takes unknown keys; without one an unknown key throws listing the registered keys. `old-blocks:559-583`; tests `rtt:88-140`. [ref]
- The chosen route is recorded as a `router_decision` item (the route's name) at the point the choice is made; it is a trace-class item: `packages/contracts/src/items/types.ts:444`, `packages/contracts/src/items/resolve-visibility.ts:11-33`. [see stored parts below]
- If the chosen branch pauses for a person, a resumed request keeps the same branch: the selector runs again and its choice is checked against the recorded one. A selector that picks differently on resume throws `RouteUnavailableError`. `old-blocks:557`; `core/errors/route-unavailable-error.ts:1-40`; `rt:300-316`. So a router whose branch can pause must pick the same route given the same input. [page: one clause, "a router whose branch pauses must pick the same route each time it runs"; error is [ref]]
- `.stepIf(condition, block)` and `.branch({...})` are the sequencer's own ways to choose. `.stepIf` runs a block only when the condition holds; when it does not hold the value passes through unchanged, and the step's output type is the union of the incoming value and the block's output. `sm:189-217`; `seq:1399-1440` (`return { value }` when the condition is false); test `ct:29-38`; `old-comp:160`. [page for `stepIf`: one example, one clause on pass-through; `branch` is [ref]]
- `.branch({ name: [connector, condition, block], ... })`: first branch whose condition is true runs; no match throws. `old-blocks:466-486`; `old-cf:241-263`; `sm:356-358`; test `ct:483-509`. [ref]
- When to use which: use `stepIf` for "run this extra step sometimes"; use a router for "one of several different pipelines". `old-cf:261` (branch note: "For runtime-determined dispatch with state types, a router block is often the better fit"); `old-cf:197-199` (conditional variants "when you'd otherwise wrap a step in a wrapper sequencer just to gate it"). [page, one sentence]
- The router's own state (`stateSchema`) and `sequencerStateSchema` requirements of its routes bubble up. `rt:240-247`. [ref]

## 5. Side by side: parallel steps (Example: three lookups)

- `.parallel({ name: block, ... }, { maxConcurrency? })` runs every listed block at once against the same input and returns an object keyed by branch name. `sm:223-226`; `seq:1473-1540`; test `ct:45-59` (`{ left: 3, right: 7 }`). [page; **answers Q2: the next step receives one object, keyed by the names you gave the branches, each value the output of its block**]
- Every branch gets the same incoming value, not the output of a neighbour. `old-cf:24` ("Run multiple blocks against the same input"); `seq:1494-1510` (every branch is given `value`). [page]
- A branch can have its own connector: `{ connector, block }`. Branches without one get the incoming value. `old-conn:30-47`; `sm` `ParallelStep`; test `ct:45-59` (`right: { connector, block }` returns 7). [page: one clause, link to Reference; the example uses a plain block]
- The object's type is `{ [K in keyof branches]: output of that branch }`. `sm:223-226`; schema test `ct:707-731` ("builds composite z.object schema from parallel()"). [page]
- The next step is not run until every branch has finished. The step ends when the slowest branch ends. `seq:1494-1510` (`await mapLimit(...)` over all branches). [page]
- `maxConcurrency` caps how many run at once; unset, every branch starts together. `seq:1475`; `packages/contracts/src/helpers/concurrency.ts:10-27` ("`maxConcurrency` of `undefined` ... runs every item concurrently; values below 1 are clamped to 1"). [ref (option); page may say "all at once by default"]
- A branch that throws fails the whole parallel step: the first rejection rejects the step, and the other branches already in flight run to completion with their results dropped. `packages/contracts/src/helpers/concurrency.ts:10-27`; the `stepAll` test `ct:865-879` (`.rejects.toThrow("boom")`) covers the sibling method. [page: one sentence, "one failing branch fails the step"; in-flight detail is [ref]]
- To let one branch fail on its own and the others continue, put a `.rescue()` on that branch's block. `ct:2104-2123` (`{ a: -1, b: 101 }`); `old-cf:60-80` (forEach version), `old-comp:285-300`. [page: one sentence with link; the example is [ref]]
- Branches share one execution context; two branches writing the same state field or the same collection key, last writer wins. `old-cf:45`. [ref]
- Output order does not depend on which branch finishes first: results are placed by branch name. `seq:1510-1520` (`result[key] = outputs[index]`). [page]
- Other fan-out methods, all [ref]: `stepAll([...])` runs a list and returns an array in the same order (`sm:360-364`; `ct:838-848`); `forEach(connector?, block, options?)` runs one block per array element, returns an array (`sm:229-242`; `ct:61-73`); `race([...])` returns the first success and signals the rest to cancel (`sm:371-375`; `ct:1037-1062`); `stepAny([...])` tries one at a time and returns the first success (`sm:366-369`; `ct:937-948`). Loops (`doUntil`, `doWhile`, `loopBack`), `exitIf`, `waitForCondition` are also [ref]: `old-cf`, `old-ov:75-85`.
- A sequencer inside a parallel branch is allowed: a branch is any block. `seq:1494-1510` (`runChild` takes any `BlockDefinition`). [page: implicit; no sentence needed]

## 6. Work that does not block the answer: `.sideChain()` (Example 3)

- `.sideChain(block)` dispatches a block in the background and the chain goes on at once to the next step. `sm:290-295`; `old-comp:181`; `old-sc:41` ("The analytics call runs in the background and doesn't block"). [page; **answers Q3: `.sideChain`, placed after the step whose output you want to log**]
- The step after a `.sideChain` receives the value the sequencer already had: a side chain does not change it. `sm:290-295` (returns `SequencerDefinition<TInput, TOutput, ...>`, same `TOutput`); `old-sc:41` ("`nextStep` receives the same output as `mainBlock` produced"); test `ct:171-185` (`.sideChain(bg).waitForSideChain(...)` on input 1 returns 1, though the block returns 11). [page]
- The side-chain block's input is the current value; with a connector (`.sideChain(connector, block)`) you reshape it first, and the connector runs in the main chain before the block is dispatched. `sm:290-295`; `old-sc:56-60` ("The connector runs in the main thread. Only the block execution is backgrounded."). [page: one clause]
- A side chain whose block throws does not stop the chain or fail the reply. The failure is logged and recorded as a failed `block_trace` that DevTool shows on the trace channel; the client's stream shows nothing. `old-sc:13`, `:62-68`; test `packages/engine/test/request-side-chain-pool.test.ts` ("reports rejected tasks via failed[]"). [page: one sentence]
- The request does not finish until its side chains do: the stream stays open until every queued task settles, and this holds if the action throws, the user stops it or the client disconnects. `old-sc:72`, `:76-80`; tests `packages/engine/test/terminal-drain.test.ts` (the success path drains the request side-chain pool before the terminal write), `packages/engine/test/request-finalization.test.ts:128`. So the reply is not delayed by a side chain (the next step runs at once), while the turn as a whole ends after it. [page: state this plainly; it is what the reader asks after "without delaying it". The edge cases (stop, disconnect, suspension) are [ref]]
- A request that pauses (suspends) for a person does not wait for side chains in flight; they keep running. `old-sc:86`, `:417`. [ref]
- `.waitForSideChain({ failOnError?, timeoutMs? })` is a barrier: the chain waits for the side chains this sequencer queued, and by default does not throw if one failed; `failOnError: true` throws the first failure after the queue settles. `sm:323-326`; `old-sc:98-136`; tests `ct:171-203`. [page: one sentence with link; the options are [ref]]
- `.sideChainIf(condition, block)`: dispatches only when the condition (boolean or function of value and context) is true; when false it does nothing at all, not even a trace item. `sm:297-321`; tests `ct:1346-1500`. [page: one clause; the condition forms are [ref]]
- `.forEachSideChain(...)` dispatches one side chain per array element. `sm:244-258`; test `ct:249-272`. [ref]
- `.tap(block)` against `.sideChain(block)`: `tap` waits for the block to finish and the chain goes on only then, a failure in it fails the chain; `sideChain` does not wait and a failure in it does not fail the chain. Both leave the value unchanged. `old-sc:145-154` (the table); `sm:328-340`; test `ct:391-416` (`.tap` leaves the value, returns 2). [page: this is the choice the reader makes; state it in two sentences]
- A `.tap` is for a side effect that must finish before the next step, such as a validation or a state update; the chain's value passes through. `old-comp:106-119`; `hc:68-73` (comment: "`.tap()` runs the counter for its state change only — the generator's text stays the pipeline's output"). [page: the `hc` pattern is the example the framework ships]
- A block that only validates or only writes state declares no `outputSchema` and is used with `.tap()`, not `.step()`. `old-comp:119`; `hc:58-66`. [page: one clause]
- A side chain is queued on the request, not on the sequencer: an inner sequencer's side chain does not hold up the outer one, and sibling sequencers' side chains run at the same time. `old-sc:72`, `:98-104`. [ref]
- If the background work must outlive the request or a process restart, a side chain is the wrong tool; use background work (a board, a scheduled action). `old-sc:15` ("A side chain outlives the sequencer that dispatched it, not the request. For work that has to outlive the request or the process, see Work that outlives the turn"). [page, one sentence with link to Background work (C-xx)]
- A side chain is not durable on its own: a failed side chain under a completed request is dropped; there is no retry. `old-sc:417-419`. [ref]

## 7. Checks: the questions the page answers (the answer key)

1. **Step two needs step one's output in a different shape. Where does the reshaping go?** In the connector, the function passed before the block: `.step((cleaned) => cleaned.text, draftReply)`; or on its own line with `.map(...)` between the steps. Not in either block. Sources: section 3. The two blocks keep their own schemas.
2. **Three lookups can run at once. What does the next step receive?** One object with a key per lookup, named in the `.parallel({...})` call, each holding that lookup's output; the step runs when the slowest has finished. Sources: section 5; `ct:45-59`.
3. **You want to log after the reply without delaying it. Which step?** `.sideChain(logBlock)` after `draftReply`; the chain goes on at once and the log's failure does not fail the turn; the turn closes after the log finishes. Sources: section 6; `old-sc:41`, `:72`.
4. **Is a sequencer a block? What follows from that?** Yes. It has a name and an input and output, so it can be a flow action's block, another sequencer's step, a router's route, or a generator's tool. Sources: section 1.

Edge cases for the cold-read questions (written by pass 2 from this sheet):
- One parallel branch throws: the step fails and the whole sequencer fails, unless that branch's block carries a `.rescue()`. `packages/contracts/src/helpers/concurrency.ts:10-27`; `ct:2104-2123`.
- A side chain throws: the chain and the reply continue; the failure appears only in DevTool's trace. `old-sc:13`.
- A router's `execute` returns a block not listed in `routes`: it throws `Router "<name>" selected invalid route "<name>"`. `rt:292-294`; `rtt:26-44`.
- A step gets a value its block's `inputSchema` rejects: `Block "<name>" input validation failed at "<path>"`, thrown when the step runs, not at build time. Section Read-first item 1.
- A `.stepIf` condition is false: the step is skipped, the next step gets the unchanged value. `seq:1399-1415`; `ct:29-38`.

## 8. What it gets you (claims the page may make)

Each point is something a reader can see, tied to `handleTicket`.

- **A step can be swapped without touching its neighbours.** Each block declares its own input and output, and the connector (or `.map`) sits between them. Swapping `draftReply` for another block means changing the connector if the shape differs; the other blocks do not change. `old-conn:150-170` ("Community or shared blocks often have fixed input shapes ... The block stays portable; the pipeline does the adaptation"); `old-conn:62-78`. [page]
- **The whole pipeline is one block.** `handleTicket` is called as an action, nested in another sequencer, or handed to a model as a tool, and callers see a name, an input and an output. Section 1. [page]
- **Each step is recorded.** One `block_trace` per block execution with its input and output, so a failed turn can be read step by step in DevTool. `items:55-60`, `:110`; `old-comp:125` (a `.map` step does not appear as its own item). [page]
- **A run that stops partway can be picked up at the step it stopped on.** On a store that persists, a finished step's recorded output is reused when a run is continued; the step that was running at the time runs again. `docs/contributing/docs-revamp/pages/concepts/blocks.facts.md` section 6 (`memo:7-13`, `goals/continue-interrupted-run/continues-not-restarts/goal.md:4`, `:6`). [page: one sentence, link to Durable execution; this is already told on the Blocks page, so say once and link, or omit]
- **Slow, optional work stays off the reply path.** Section 6. [page]
- **Failures stay where you put them.** A step's failure fails the chain; a side chain's does not; a `.rescue()` on a step or branch changes that for that step only. Sections 2, 5, 6. [page: one sentence]
- **Choices are visible in the code and in the trace.** A router's decision is recorded as an item (`router_decision`) naming the route chosen. `packages/contracts/src/items/types.ts:444`. [page: one clause; DevTool shows it; the item type is [ref]]

## 9. How it fits with the others (candidates for the section)

- A **board** is not a sequencer: a sequencer's steps are fixed when you write the chain (or chosen by a router), and run inside one request; a board's tasks are rows that exist after the request is gone. For work that outlives the request, use a board or background work. `old-sc:15`. [page: one sentence; the neighbouring concept is Tasks and boards / Background work, linked by slug]
- A **generator** that calls tools lets the model choose at run time which blocks run and how many times; in a sequencer or router, your code makes that choice. `old-blocks:124` ("Any block or sequence of blocks can be used as a tool"). [page: one sentence, link to Generators and tools; per "Say a thing once" skip if the Blocks page carries it]
- A **flow** exposes a block as an action; a sequencer is the usual block to expose. `hc:78-91`. [page: one clause, link]
- A **capability** or **kit** is not a way to join steps; a sequencer is. [verify: do not state; no fact sheet source. Drop.]
- Do not write "If you know" for this page unless the page plan calls for it: no existing page or doc comment claims a clash with an industry word here. [Plan note.] (Old overview line `old-ov:7`, "Most frameworks force a choice: Agent or Workflow", is positioning, not a behaviour; leave it.)

## 10. Stored parts: four questions each

A sequencer, a router and the connectors and `.map` functions hold no data of their own between runs. What a run leaves behind about composition:

| Stored part | Who owns it | Who can see it | Where stored | How many |
| --- | --- | --- | --- | --- |
| A step's recorded input and output (`block_trace`) | The request (one run of an action) | The developer in DevTool; the default client filter strips trace items, so the user's screen does not get them | The request's item log in the app's stores; in memory when no store persists | One per execution of a block (a block in a loop or a `forEach` gets one per pass or element). `items:55-60`, `:110`; `packages/core/test/sequencer.test.ts:98-134` (loop passes get distinct instance ids) |
| A router's choice (`router_decision`) | The request | The developer in DevTool (a trace-class item) | The request's item log; read back when a paused request resumes | One per run of a router. `packages/contracts/src/items/types.ts:444`; `packages/contracts/src/items/resolve-visibility.ts:11-33`; `rt:300-316` |
| A sequencer's checkpoint (its state at each step boundary) | The request | Not shown to the user; the engine reads it to continue a run | The `checkpoints` store of the app's stores | One per durable sequencer, overwritten at each step boundary and removed after the run. `docs/contributing/docs-revamp/pages/concepts/blocks.facts.md` section 6 (`dur:9`, `:28`; `seq:274-282`). [ref] |
| Side-chain work in flight | The request (one pool per request) | Nobody directly; its `block_trace` shows in DevTool | In memory in the running request; not saved, so a side chain does not survive a restart | One task per `.sideChain()` call that ran. `old-sc:72`, `:417-419`; `packages/engine/test/request-side-chain-pool.test.ts` |

Rule for the page: the sequencer, router and connectors store nothing between requests; what a request records about them is trace, and is for the developer. The page states this in one sentence under "What it gets you" or not at all, because the Blocks page carries the `block_trace` and checkpoint facts.

## 11. Figures: what each must carry

**Figure 1, "What passes between steps".** `handleTicket` as a row: `cleanMessage` → (highlighter on the one reshaping step: the connector `cleaned.text`) → `draftReply`. Arrow labels, left to right: `{ message: string }`, `{ text: string, truncated: boolean }`, `string`, `string`. Marks: arrow (`PASSES ITS OUTPUT`), highlighter on the reshaping step. Facts: section 3 table.

**Figure 2, "Four ways to join".** Four small drawings on one canvas, each named from `handleTicket`'s world: sequence (`.step`), router (`router` choosing one of two routes), parallel (`.parallel` into one object), side chain (`.sideChain`, dashed arrow, label `ONLY ALONGSIDE; NOTHING WAITS`). Dashed outline in the figure language means "lasts one action run" (`docs/contributing/user-docs.md`, Figures table), and the side-chain's dashed arrow is a different mark (`ONLY ALONGSIDE; NOTHING WAITS`); follow `user-docs-figures.md`. Fact for the label: the next step runs at once (`old-sc:41`); the request still closes after it (`old-sc:72`), so the label must not read "does not affect the end of the turn". [verify the label against the figures guide at draw time]

## 12. Surface listing for the Reference page (not stated on the page)

`sequencer({ name, inputSchema, outputSchema?, container? })`; methods and signatures in `sm:162-420`: `step`, `stepIf`, `map`, `parallel`, `forEach`, `forEachSideChain`, `doUntil`, `doWhile`, `loopBack`, `sideChain`, `sideChainIf`, `waitForSideChain`, `tap`, `tapIf`, `rescue`, `branch`, `stepAll`, `stepAny`, `race`, `waitForCondition`, `exitIf`, and `throwIf` (`sm:429`; tests `ct:1273-1344`) and `connectInput` (`ct:759-835`). `router({ name, inputSchema, outputSchema, routes, execute, validateRoute?, container? })` (`rt:55-150`). `utility.keyedRouter` (`old-blocks:559-583`). Errors: `SequencerOutputSchemaError` and `SequencerSchemaMismatchError` (`old-ov:100-140`), `RouteUnavailableError` (`core/errors/route-unavailable-error.ts`).

## 13. Not on the page (leave out)

- Container wrapping (`container: { component, label }` on a sequencer or router): a rendering hint. `old-ov:208-224`. [ref]
- `outputSchema` declared on a sequencer and `.validate()`: `old-ov:92-182`. [ref]
- Loops and `exitIf`: `old-cf:109-195`. [ref]
- `mapModelOutput` and `.as()`, `.asTool()`: tools, [ref] Generators and tools.
- State inside a sequencer (`ctx.sequencer`), `ctx.wasRescued`: `old-comp:300-322`. [ref]
- The old overview's "21 methods" and "15 methods" counts (see the read-first note).

## Revise round 1 (page changes; facts above stay true)

- "Every join is a block" is scoped: a router and a sequencer are blocks; `.parallel()` and `.sideChain()` are methods of a sequencer, so the block is the sequencer that holds them (`sm:162-420`, `sm:223-226`, `sm:290-295`). [page]
- A rescued parallel branch hands on the recovery block's output as that key's value (`ct:2104-2123`, `{ a: -1, b: 101 }`; `old-comp:211`). [page, one clause]
- Moved to Reference (page links, no longer states): `.map` trace and handler advice; run-time shape checks; a router choosing only among listed routes; `.stepIf` pass-through; side-chain failure surfaces, turn closing after side chains, `.waitForSideChain()`; `.tap()` against `.sideChain()`. Sections 3, 4, 6 mark them [ref].
- The page uses "turn" throughout, and glosses "task board" and "generator" where they first appear.

## Revise round 2 (page changes; facts above stay true)

- The page defines a turn once, at first prose use: the run that answers one message (section 6, request drains side chains). [page]
- Section 6 holds: the next step runs at once and the turn ends after the side chain settles (`old-sc:41`, `:72`); the figure says the turn ends after the log, the prose says the chain moves on without waiting. Both true.
- DevTool is glossed as the local debugger `fsdev dev` opens.
- "A sequencer is a block, so it has a name, an input and an output" is stated once (opening and "What it gets you"), not under "A sequence".
