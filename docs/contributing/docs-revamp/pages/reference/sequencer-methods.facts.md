# Fact sheet: Sequencer methods (R-03, reference, `reference/sequencer-methods`)

Pass 1. Cites only what a fact sheet may cite: existing user docs (`apps/docs/**`), the exported surface and
its doc comments, tests, `goals/`. No spec, no `docs/internal/`, no PR or commit text was read. Implementation
was read to confirm what a call returns; those facts are marked **[read]** and the page states only what a
caller can observe.

Page shape from the sitemap: tables, no narrative. Tables: every method with input, output and conditional
variant; connectors; waiting on a condition; side chains (what they may and may not do). Lookups: "What does
`.parallel()` hand the next step?", "Does a side chain's failure fail the request?", "What does a wait resume on?"
(answer key in section 9).

Marks: **[run]** I ran it in this pass with a throwaway vitest file (core unit, or `testFlow` in
`integration-tests`), read the output, and deleted the file. **[test]** a committed test asserts it.
**[read]** I read the code and no test pins it; pass 5 should run it before the page states it. **[doc]** only an
existing user page says it, and I did not verify it.

Abbreviations (all paths from the repo root):

| Abbr | File |
|---|---|
| `sqm` | `packages/core/src/blocks/sequencer-methods.ts` (the public types) |
| `sq` | `packages/core/src/blocks/sequencer.ts` |
| `kern` | `packages/core/src/blocks/internal/sequencer-kernel.ts` |
| `args` | `packages/core/src/blocks/internal/arg-shapes.ts` |
| `bb` | `packages/core/src/blocks/internal/build-block.ts` |
| `blk` | `packages/core/src/types/block.ts` |
| `util` | `packages/core/src/blocks/internal/utils.ts` |
| `pred` | `packages/contracts/src/items/predicates.ts` (re-exported by `packages/core/src/items/predicates.ts`) |
| `conc` | `packages/contracts/src/helpers/concurrency.ts` (`mapLimit`) |
| `wt` | `packages/core/src/helpers/with-timeout.ts` |
| `pool` | `packages/engine/src/execution/request-side-chain-pool.ts` |
| `ra` | `packages/engine/src/execution/runAction.ts` |
| `eb` | `packages/engine/src/execution/executeBlock.ts` |
| `rem` | `packages/core/src/types/request-end.ts` |
| `t` | `packages/core/test/sequencer.test.ts` |
| `twc` | `packages/core/test/sequencer-wait-for-condition.test.ts` |
| `tso` | `packages/core/test/step-abort-signal.test.ts` |
| `br` | `packages/engine/test/block-rescue.test.ts` |
| `reb` | `packages/engine/test/request-end-background-failures.test.ts` |
| `f554` | `packages/integration-tests/src/scenarios/side-chain-pool-fix554.test.ts` |
| `cn` | `apps/docs/docs/sequencers/control-flow.md` |
| `cx` | `apps/docs/docs/sequencers/connectors.md` |
| `wfc` | `apps/docs/docs/sequencers/wait-for-condition.md` |
| `sc` | `apps/docs/docs/advanced/sequencer-side-chains.md` |
| `cb` | `apps/docs/docs/sequencers/composing-blocks.md` |

Neighbouring reference page that already carries side-chain lifetime, failure, durability and signal rules:
`docs/contributing/docs-revamp/pages/reference/background-work.md` (R-19, "Side chains" section). The R-03 side-chain
section should hold the method rows and the may/may-not table and link there for the rest, not restate it.

---

## 1. The 13 moved rows: carried or dropped

Rows are quoted by their opening words. Each says where its facts are below.

| # | Row (from) | Verdict | Where |
|---|---|---|---|
| 1 | `.tap()` runs a block for its side effect and passes the value through; `.step()` forwards the block's output, so a block with no output hands `undefined` to the next step | **Carried.** Run: a handler with no `outputSchema` returning nothing leaves `undefined` for the next step; `.tap` keeps `1` even when the tapped block returns `101`. | A (`step`, `tap`) |
| 2 | `.rescue()` method row: handler list, optional `when`, first match wins, a handler with no `when` matches anything, the block's input is the error and its output replaces the failed value | **Carried, with three additions the row lacks**: the sequencer-level call ends the chain at the failure and its output is the sequencer's output; calling it twice replaces the first list; an empty `when` array also matches anything. The per-step form (`block.rescue`) is the one where the chain continues. | A (`rescue`), E |
| 3 | `.map()`: input, output, no schema or name, not recorded as a trace step; use a handler with `.step()` when the reshaping has side effects or must be traced | **Carried, with one correction**: "no name" is wrong for the chain (the op is named `map`, which `loopBack` cannot target usefully), but it writes no `block_trace` item. The tracked output schema is dropped after a `map`; the output type is the mapper's return type. Run: no `block_trace` item for `map`. | A (`map`) |
| 4 | Connectors and shape checking: shapes checked at run time, not compile time; the failure names the block and the field | **Carried.** Run twice (a throwaway runtime test and `tsc`). Only the connector's **parameter** is typed (the previous output). The connector's return is not checked against the next block's input, and `.step(block)` does not check the block's input against the previous output. The failure reads `Block "needs-query" input validation failed at "query": Required`. `cx:158-174` says the opposite and is wrong. | B, section 8 item 3 |
| 5 | `.stepIf(condition, block)`: a false condition passes the value through unchanged | **Carried.** Run: `5` in, `5` out. Not traced. The step's name in the chain is `if:<block name>`. | A (`stepIf`) |
| 6 | `.parallel()` failure: one failing branch fails the whole step; `.rescue()` on a branch's block contains it | **Carried, with one addition**: the other branches are not cancelled when one fails; they run to the end and their results are dropped. Run: `{ a: 2, b: -1 }` with a per-branch rescue, and `boom` thrown without one. | A (`parallel`) |
| 7 | Side chains: failure does not reach the chain or the user's stream; DevTool trace; logged on the server; request-end hooks get `backgroundFailures`; turn closes after all side chains finish; `.waitForSideChain()`; `failOnError: true` re-throws (corrected by pass 5) | **Carried, split.** Request-status, trace and log facts: D3. `backgroundFailures` is a field of a request-end hook, which is a framework seam exported from `@flow-state-dev/core/internal` (`rem:1-17`: "Framework-facing, not a flow-author hook"). It stays as one pointer row that links to R-19, which states it. `failOnError`: A (`waitForSideChain`). | D, A |
| 8 | `.tap()` against `.sideChain()`: waits or not, whether a failure fails the chain, both leave the value unchanged | **Carried** as a three-line comparison (D2). | D2 |
| 9 | Sequencer methods: one row per method with input, output and conditional variant | **Carried**: section 2. | A |
| 10 | Connectors: the three forms and what each receives and returns | **Carried**: section 3. The "three forms" are the inline function (a leading argument), the `{ connector, block }` object, and the block-level `connectInput` / `connectOutput`. | B |
| 11 | Side chains: what they may and may not do; whether a failure fails the request; how their items are marked | **Carried**: section 5. Items are marked `provenance.phase: "sideChain"` (run). | D |
| 12 | Janitor schedule: ordering of janitor and prune is not guaranteed (links to side chain rules on R-03) | **Carried as one row** (D5): side chains queued by one sequencer start in call order, run at the same time, and nothing orders their finishes. The memory page (`reference/memory.md:275`) already links here for it. | D5 |
| 13 | Retry timing and ordering with `.rescue()`: rescue runs after the last attempt, or at once for a non-retryable error | **Carried with a limit it lacks**: this holds only for the action's root block. Run: a `retry: { maxAttempts: 3 }` handler used as a **step** inside a sequencer ran once, with and without `.rescue()`. The `retry` setting is applied by the engine only to the block an action runs. | E3 |

Nothing is dropped outright. One narrower drop is stated in section 10.

---

## 2. The method table (A)

Every method on `SequencerDefinition` (`sqm:156-454`). All of them return the sequencer, so the chain continues;
the output column is the type of the value the **next** step receives. `ctx` in a condition, connector or mapper is the
step's block context, typed from the sequencer's `stateSchema` (`ctx.sequencer.state`, and `ctx.self` as its alias)
(`sqm:15-28`). A sequencer is never a thenable: its sequential-step method is `.step()`, not `.then()` (`packages/core/test/sequencer-thenable.test.ts:1-35`, [test]).

### Sequential

| Method | Forms (input) | Output | Conditional variant | Facts |
|---|---|---|---|---|
| `step` | `(block)`, `(block, options)`, `(connector, block)`, `(connector, block, options)`, `(factory, inlineConfig)` | The block's output | `stepIf` | The connector `(prevOutput, ctx)` runs first and its return is the block's input (`sqm:163-186`; `t:18-27` [test]). `options` is `StepOptions` (below). The inline form builds the block from a factory (`handler`, `generator`, `router`): `name` optional (auto `inline-N`), `outputSchema` required, `execute(input, ctx)`; the block's `inputSchema` is the previous step's output schema, `z.any()` when there is none (`sq:48-62`, `sqm:95-106`; `t:511-642` [test]). A first-step block that the sequencer has no `inputSchema` for lends its own as the sequencer's (`sq:1326-1331`; `t:680-705` [test]). A block that returns nothing gives the next step `undefined` [run]. |
| `stepIf` | `(condition, block)`, `(condition, block, options)`, `(condition, connector, block)`, `(condition, connector, block, options)`, `(condition, factory, inlineConfig)` | `previous output \| block output` | itself | `condition(value, ctx)` may be async. False: the value passes through unchanged, nothing is dispatched, no `block_trace` item [run], and the connector is not called (`sq:1417-1424`; `t:29-37` [test]). Chain-op name is `if:<block name>` (`sq:1417`). |
| `map` | `(mapper)` | `mapper`'s return | none | `mapper(value, ctx)` may be async (`sqm:219-221`; `t:39-43` [test]). Not a block: no `block_trace` item [run], no tracked output schema (the new output schema is `undefined`; the chain's output type is the mapper's return type, `sqm` `map<TNext>`; `sq:1459-1471`; `t:749-757` [test]). Use `.step(handler)` when the reshaping has side effects or must show in the trace (`cb:133` [doc]). |
| `tap` | `(fn)`, `(block)`, `(connector, block)`, `(factory, inlineConfig)` | Unchanged | `tapIf` | Waits for the tap to finish, then passes the **previous** value on, whatever the tapped block returned [run: `.tap(num("t", 100))` on `1` leaves `1`]. `fn(value, ctx)` may be async. A throw fails the chain (`sq:2004-2068`; `t:391-416` [test]). The inline form's `outputSchema` is optional (`sqm:108-120`). |
| `tapIf` | `(condition, fn)`, `(condition, block)`, `(condition, connector, block)` | Unchanged | itself | `tap` that runs only when `condition(value, ctx)` is true. No inline-factory form (`sqm:342-352`; `sq:2070-2111`; `t:391-416` [test]). |
| `exitIf` | `(condition)` | Unchanged | itself | `condition(value, ctx)` may be async. True: later steps are skipped and the current value is the sequencer's output; several are allowed, first true wins (`sq:2485-2501`, `sq:991-993`; `t:1176-1271` [test]). Exits only the sequencer it is written on: an inner sequencer's `exitIf` hands its value to the outer chain, which continues [run: `2`]. The declared `outputSchema` still validates the exit value (`t:1663` [test]). |
| `throwIf` | `(condition, error)` where `error` is an `Error` or `(value, ctx) => Error \| Promise<Error>` | Unchanged | itself | Throws the supplied error when `condition(value, ctx)` is true; pairs with `.rescue([{ when: [...] }])` (`sqm:422-432`; `sq:2503-2520`; `t:1273-1344` [test]). |
| `branch` | `({ name: [connector, condition, block], ... })` | Output of the matching arm's block | none (it is the conditional) | Arms are tried in key order. For each arm tried, the connector runs on the value, then `condition(connectorOutput, ctx)`; the first true arm runs its block on the connector output and the rest are not tried [run: connectors `cx`, `cy` ran, `cz` did not]. No arm true: throws `Error("branch had no matching route")` (`sq:2126-2169`; `t:483-509` [test]). |
| `doUntil` | `(condition, block)`, `(condition, connector, block)` | The block's last output | `doWhile` is its opposite | Runs the block, then checks `condition(blockOutput, ctx)`; true ends the loop. The block always runs at least once. The connector applies once, to the first input; each later pass takes the previous pass's output. More than 250 passes without the condition: throws `Error("doUntil exceeded max loop guard (250)")` after the 251st pass [run: 251 runs]. (`sq:1740-1787`, `sq:52`; `t:75-83` [test]) |
| `doWhile` | `(condition, block)`, `(condition, connector, block)` | The block's last output | `doUntil` is its opposite | Same as `doUntil` with the test reversed: runs the block, then repeats **while** `condition(blockOutput, ctx)` is true. **The block runs at least once** [run: `doWhile(() => false, ...)` ran once]. Same 250 guard (`doWhile exceeded max loop guard (250)`, 251 runs [run]) (`sq:1789-1832`). `cn:132-143` says the block "may not run at all": wrong. |
| `loopBack` | `(stepName, { when?, maxIterations })` | Unchanged | `when` is its condition | Jumps back to the first earlier step whose chain name is `stepName`, up to `maxIterations` times, then carries on past it (does not throw). Without `when` it always jumps until `maxIterations`. The step jumped to receives the value `loopBack` saw, not the value that first fed it, and every step from there to the `loopBack` runs again [run: `step(dbl).step(add10).loopBack("dbl", {maxIterations: 2})` on `1` ran `dbl` with `1`, `12`, `34` and returned `78`]. The name must match; none matching throws at run time `loopBack target "<name>" was not found in sequencer ...` [run]. A `.step(block)` is named after the block (`t:85-96` [test]); other ops are `if:<name>`, `doUntil:<name>`, `doWhile:<name>`, `sideChain:<name>` (or the `name` option), `sideChainIf:<name>`, `tap`, `tapIf`, `map`, `parallel`, `stepAll`, `forEach`, `forEachSideChain`, `branch`, `stepAny`, `race`, `waitForCondition`, `exitIf`, `throwIf` (`sq:1417, 1750, 1799, 1843, 1890, 1921, 2017, 2046, 2087`) [read]. Each pass gets its own block instance ids, so a loop's traces are distinct (`t:98-169` [test]). `cn:145-159` ("the named step's output position becomes the next iteration's input") is wrong. |

### Fan-out

| Method | Forms (input) | Output | Conditional variant | Facts |
|---|---|---|---|---|
| `parallel` | `({ key: block \| { connector, block } }, { maxConcurrency? })` | `{ key: that branch's output }`, one key per branch, in the order written | none | Every branch gets the same input (or its own connector's output); branches without a connector get the previous value (`sqm:48-53, 223-226`; `sq:1473-1550`; `t:45-59` [test]). One branch throws: the step throws that error; the other branches are **not** cancelled and finish in the background, their results dropped (`conc:11-20`) [run]. A per-branch `block.rescue([...])` turns that branch's failure into its recovery value and the step succeeds (`t:2104-2126` [test], `{ a: -1, b: 101 }`). Result schema is an object of the branches' schemas (`t:707-731` [test]). `maxConcurrency` caps in-flight branches; unset runs all. |
| `stepAll` | `([block \| { connector, block }, ...], { maxConcurrency? })` | An array, one entry per block, **in the order given** | none | Same dispatch as `parallel` with array indexing. First rejection rejects the step (`t:837-934` [test]: ordered result, connector form, `propagates first error`, `maxConcurrency`, `[]` for an empty list). |
| `forEach` | `(block \| factory, options?)`, `(connector, block \| factory, options?)` | An array of the block's outputs, in element order | none | The input (or the connector's return) must be an array; `null`/`undefined` is treated as `[]`; anything else throws `forEach expected an array input` [run; `sq:1584-1590`]. A factory is `(item, index, ctx) => block`. `options`: `maxConcurrency` (unset: all at once) and `blocks` (the blocks a factory can produce, so `defineFlow` can see them: `sqm:125-140`). One element throwing rejects the step; give the element block its own `.rescue()` to isolate it (`t:2009-2033` [test]). The step waits for every element (`t:61-73` [test]). |
| `forEachSideChain` | `(block \| factory, options?)`, `(connector, block \| factory, options?)` | Unchanged: the original input (not the connector's array) | none | Queues the whole array as **one** side-chain task named `forEachSideChain[<n>]` and returns at once. Each element's block runs as `<block name>[<index>]`. `options.concurrency` (default **16**, minimum 1) caps elements running at once; `blocks` as for `forEach`. The option key differs from `forEach`'s: a `concurrency` key on `forEach` is ignored at run time [run: peak 4 with `{ concurrency: 1 }` cast through]. One element failing does not stop the rest; the batch task then fails with the first failure (`sq:1634-1738`, `sqm:142-146`; `t:249-389` [test]). A non-array throws `forEachSideChain expected an array input`. |

### Selection and fallback

| Method | Forms (input) | Output | Conditional variant | Facts |
|---|---|---|---|---|
| `stepAny` | `([block, ...])` | `unknown` | none | Tries blocks in order and returns the first success; later blocks never run. All fail: throws `AggregateError` ("All blocks in stepAny failed") whose `errors` holds each failure [run]. Empty list: `AggregateError("stepAny called with no blocks")` (`sq:2226-2264`; `t:936-1035` [test]). |
| `race` | `([block, ...], { maxConcurrency? })` | `unknown` | none | Starts the blocks together; the first success is the output and the others get an abort signal. **The step still waits for every block to settle**: a loser that ignores the signal holds the step up [run: a 300 ms loser made a result of `"fast"` take 304 ms] (`sq:2333-2358`). All fail: `AggregateError("All blocks in race failed")`. Empty list: `Error("race called with no blocks")`. One block runs directly. `maxConcurrency` runs a worker pool (`sq:2266-2382`; `t:1037-1174` [test]). |

### Failure and guards

| Method | Forms (input) | Output | Conditional variant | Facts |
|---|---|---|---|---|
| `rescue` | `([{ when?, block }, ...])` | The chosen handler's output replaces the sequencer's output | none (`when` filters by error class) | Chain-level: when **any** step throws, the chain stops there and the first handler whose `when` matches (`error instanceof` any listed class) runs with the **error** as its input; its output is the sequencer's output [run: `"recovered:broken"`]. A handler with no `when`, or `when: []`, matches every error (`util:11-23` [read]). No match: the original error is thrown. A thrown non-`Error` is wrapped first. A second `.rescue()` call **replaces** the first list [run: `"B"`]. The recovered value is validated against the sequencer's declared `outputSchema` (`t:1678-1707` [test]). A `SuspensionError` is never rescued (`sq:1041`; `t:2055-2075` [test]). `ctx.wasRescued(...)` reports it afterward (`blk:473`). The per-step form is `block.rescue([...])` (a method on every block, `blk:1352`): the chain continues with the handler's output as that step's output (`t:1951-2000` [test], `br:163-215` [test]). See E for the shapes and the retry limit. |
| `validate` | `()` | `void` (not chainable) | none | A build-time check, called last: throws `SequencerSchemaMismatchError` when the declared `outputSchema` and the last step's tracked schema differ in top-level kind, object keys, array element kind, or one level of object-value kinds. Does nothing when either is missing, or when the chain ends in `stepAny`, `race` or `stepAll` (they pass `undefined`). After `branch` the tracked schema is the first arm's block `outputSchema` (`sq:2126-2166`, `firstBranchSchema`), so it compares against that arm when it has one; corrected in pass 8 (pass 5 finding). Steps added after it are not covered (`sqm:434-448`; `t:1804-1934` [test]). |

### Waiting and side chains

| Method | Forms (input) | Output | Conditional variant | Facts |
|---|---|---|---|---|
| `sideChain` | `(block, { name? })`, `(connector, block, { name? })` | Unchanged | `sideChainIf` | Section 5. |
| `sideChainIf` | `(condition, block, { name? })`, `(condition, connector, block, { name? })` | Unchanged | itself | `condition` is a boolean or `(value, ctx) => boolean \| Promise<boolean>` (value first, then ctx, as `stepIf` and `tapIf`). False: nothing is dispatched and no items are emitted; the connector is not called (`sqm:297-321`; `sq:1905-1941`; `t:1346-1631` [test]). |
| `waitForSideChain` | `({ failOnError?, timeoutMs? })` | Unchanged | none | Section 5. |
| `waitForCondition` | `(predicate, { timeoutMs, wakeOn? })` | `{ timedOut: boolean }` | none | Section 4. |

### Block-shaping

| Method | Forms (input) | Output | Facts |
|---|---|---|---|
| `connectInput` (on a sequencer) | `(mapper: (input, ctx) => value)` | A **sequencer** (not a wrapper block) taking the mapper's input type | Puts `<name>/connect-input` before the first step; the mapper's return is the first step's input. The sequencer's own `inputSchema` is cleared (it becomes `z.any()`), so the first block's schema is what validates (`sq:2522-2546`; `t:759-835` [test]; probe [run]). Block-level `connectInput` / `connectOutput`: section 3. |

`StepOptions` (third argument of `step` / `stepIf`; both members optional; exported from `@flow-state-dev/core`,
`packages/core/src/index.ts:280-281`; `args:104-170`; tests `tso`):

| Member | Type | Does |
|---|---|---|
| `abortSignal` | `(ctx) => AbortSignal \| undefined` | An **extra** signal the step runs under, composed with the request's (the step stops on either), resolved at each dispatch, so it can read what an earlier step wrote. `undefined` is a no-op. Reaches the step's connector, its subtree and its subtree's side chains (`tso:43-135, 630-660` [test]). |
| `onSettled` | `(ctx, outcome: "returned" \| "threw" \| "suspended") => void` | Called once when the step's dispatch ends, by every path, including a suspension (a block calling `ctx.suspend` to pause the run for an answer; `reference/durable-execution.md` defines suspend, resume and replay, and the page links it) that no `.rescue()` can see. Must be synchronous. A throw from it is logged and cannot change the step's outcome. **Not called** when a `stepIf` condition was false, or when the step's output was replayed on a resume (`tso:167-290, 415-630` [test]). |

Both options also resolve when written as `{}` or with `undefined` values (`tso:289-415` [test]).

Type notes a table row may need:
- `ParallelStep` is `block | { connector, block }` (`sqm:48-53`); `BranchStep` is `[connector, condition, block]` (`sqm:61-69`).
- The tracked output type: `stepAny` and `race` give `unknown`; `branch` gives the union of the arms' outputs; `stepIf` gives `previous | block` (`sqm:188-217, 356-375`).
- `exitIf`, `tap`, `sideChain` and `loopBack` keep the previous output type.

---

## 3. Connectors (B)

A connector is a function `(input, ctx) => value | Promise<value>` (`blk:1032-1035`), where `input` is the
**previous step's output** (typed) and `ctx` the block context. `cx:11-22`, `t:18-27` [test].

| Form | Where it is accepted | Receives | Returns | Facts |
|---|---|---|---|---|
| Leading function argument | `step`, `stepIf` (after the condition), `tap`, `tapIf`, `sideChain`, `sideChainIf`, `doUntil`, `doWhile`, `forEach`, `forEachSideChain` | The running value and `ctx` | The block's input (for `forEach` / `forEachSideChain`: the **array** of items) | Runs before the block, in the main chain. For `sideChain` the connector runs in the chain and only the block is backgrounded: a throw in it fails the chain (`kern:148`, `sq:1923-1926` [read]). In a loop it runs once, on the first input (`sq:1752-1754`). `args:250-287` fixes how overloads are told apart: a block in the second slot means a connector leads. |
| `{ connector, block }` object | `parallel` values, `stepAll` entries | The shared input value | The input for that branch's block | Branches without it get the previous value (`sqm:48-53`; `t:45-59`, `t:850-863` [test]). |
| Arm tuple | `branch`: `[connector, condition, block]` | The running value | What the arm's condition and block both receive | `sq:2126-2169`. |
| Block-level `block.connectInput(fn)` | Any block, then used as a step | The raw input the block would have received, and `ctx` | The input the block validates and runs on | Returns a new block with input schema typed `ZodTypeAny`; the connector runs **before** the block's input schema validates, so the schema applies to the connector's output (`bb:336-356, 416-423`; `blk:1263`; `t:89-102` [test]). When the connector changes the value, the trace's input records both the source and the connected value (`bb:342-352`). |
| Block-level `block.connectOutput(fn)` | Any block | The block's output and `ctx` | What the next step sees | Returns a new block whose output schema is `z.any()` (no output validation) and whose model-output mapper is dropped (`bb:535-552`; `blk:1272`; `packages/core/test/build-block.test.ts:203` [test]). Observed: the original block's `onCompleted` does not run on the `connectOutput` copy [run: `onCompleted` ran once for the plain step and not again for the copy; `bb:546-549` sets `onCompleted: undefined`]. See section 10. |

Shape checking:
- Run time only. The next block validates the connector's return against its `inputSchema` and the failure is `Block "<name>" input validation failed at "<path>": <first issue message>` (`bb:152-172`, `bb:356`) [run: `Block "needs-query" input validation failed at "query": Required`]. Output failures read the same with `output`. Only the first issue is reported.
- Compile time: the connector's `input` parameter is typed from the previous step. Its return type is not compared with the next block's input, and a block passed with no connector is not compared with the previous output [run: `tsc` accepted `step((v) => ({ limit: v }), search)` and `step(search)` after a number; it rejected `o.nope` on a typed output]. `cx:158-174` claims otherwise.
- `sequencer-connectors.type-test.ts` (`packages/core/test/sequencer-connectors.type-test.ts:12-22`) types `connectInput` / `connectOutput` chains only.

`mapModelOutput` (in `cx:89-123`; not a connector, it is on every block): `block.mapModelOutput((output, ctx) => string | Promise<string>)`
(`blk:1294-1297`). Changes only the string a generator's model reads as the tool result when the block is installed as a tool.
Schemas are unchanged, `tool_output` items, later steps and the recorded value keep the full output; inert as a plain step.
`connectInput` keeps an installed mapper; `connectOutput` drops it (`packages/core/test/build-block.test.ts:158-215` [test]). History replay re-runs
the mapper on the stored output, so it must be deterministic (`blk:1294` comment [read]). Placement: it belongs with
tools or generators; pass 3 should decide whether R-03 keeps one row and links.

---

## 4. Waiting on a condition (C)

`.waitForCondition(predicate, { timeoutMs, wakeOn? })` (`sqm:377-415`, `sq:2384-2483`).

| Item | Fact |
|---|---|
| Input | `predicate: (items: readonly OutputItem[]) => boolean`, synchronous. `timeoutMs` is required. `wakeOn?: (item: OutputItem, kind: "added" \| "updated" \| "done") => boolean`. |
| Output | `{ timedOut: boolean }`. Never throws on timeout. The previous step's value is not passed on: a step after it gets `{ timedOut }` (`sq:2385-2394`, output schema `sq:85`). |
| What it resumes on | The first of: the predicate returns true; `timeoutMs` elapses (`timedOut: true`); the request's signal aborts (`timedOut: false`, so a caller that needs to tell "condition met" from "cancelled" checks `ctx.signal.aborted` on the next step) (`sqm:377-398`; `twc:149-186` [test]; [run: abort gave `{ timedOut: false }`]). |
| Evaluation | Once, synchronously, on entry, over the items already on the request: true means no subscription and no timer (`twc:74-92` [test]). Otherwise the predicate re-runs on **every** item event (`added`, `updated`, `done`) the filter lets through, exactly once per event (`twc:93-137, 228-257` [test]). |
| What the entry check sees | Every non-transient item, and only the most recent `maxBufferSize` (default 10,000) already-done transient ones such as `resource_change` (`sqm:383-386`, `pred:49-54`). |
| `wakeOn` | A cheap per-event pre-filter: the predicate re-runs only for items it accepts. It does not apply to the entry evaluation. A filter that throws is caught and the event still wakes the predicate. A filter that rejects everything leaves the wait to resolve at `timeoutMs` (`twc:258-360` [test]; `packages/engine/src/streaming/response-emitter.ts:301-306`). Both halves need the item test: an entry check with a looser predicate than `wakeOn` can be satisfied by an earlier item `wakeOn` would have refused (`wfc:165` [doc]; follows from the entry rule). |
| Errors | A predicate that throws, on entry or on an event, ends the wait and the error propagates out of the step after unsubscribing (`twc:188-227` [test]; [run]). No response emitter on the context: `Error("waitForCondition requires a response emitter on the context")` (`sq:2399-2401`). |
| Scope | The wait sees one request's items. A durable cross-request wait is not this method (`wfc:196-199` [doc]). |

Predicate helpers, exported from `@flow-state-dev/core` and `@flow-state-dev/core/items` (`packages/core/src/index.ts:24-28`, `packages/core/src/items/index.ts:6`):

| Helper | Returns true when | Facts |
|---|---|---|
| `whenResourceChanged({ scope, path, changeType? })` | Some `resource_change` item has that `scope` and exactly that `resourcePath`; `changeType` is `"created" \| "updated" \| "deleted"` and narrows it | `pred:55-71` |
| `whenResourceMatching({ scope, pattern })` | Some `resource_change` item in `scope` has a path matching `pattern`; `*` is any run of characters except `/`, `**` is any run including `/`; every other character is literal | `pred:20-38, 95-109` |
| `whenAnyItem(predicate)` | Any item satisfies the closure | `pred:77-86` |

`onTaskChangeFor(collectionId)` (`@flow-state-dev/orchestration/tasks` subpath, not the root entry; `packages/orchestration/src/tasks/collection/predicates.ts:36-45`): a `(item) => boolean` that is true for `type: "data"` items with `dataType: "task-change"` whose `value.collectionId` matches. It works as `wakeOn` and as the body of `whenAnyItem(...)`.
`wfc:50-61` builds the same test as `item.type === "component" && item.component === "task-change"`, which never matches: task-change items are `data` items (`packages/contracts/src/items/types.ts:506-511`; `packages/orchestration/src/tasks/collection/get-or-create.ts:36`). Do not carry that example.

Custom predicate rules that follow from the above (state them as rules, not as design): synchronous, no mutation of items, cheap (it runs on every wake), truthy means wake and the step still yields `{ timedOut: false }`, a throw ends the wait.

`waitForSideChain` is the other wait: section 5. It waits on the calling sequencer's side-chain tasks, not on items.

---

## 5. Side chains (D)

### D1. The methods

| Method | Does | Facts |
|---|---|---|
| `.sideChain(block, { name? })` / `.sideChain(connector, block, { name? })` | Starts the block now and moves on. The value the next step gets is the one `sideChain` was given, whatever the block returns | The block runs in the `"sideChain"` phase; its task is named `options.name ?? block.name`, and chain op `options.name ?? "sideChain:" + block.name` (`kern:140-157`; `sq:1876-1903`) [run: the pipeline value stayed `7 + 1`]. |
| `.sideChainIf(condition, ...)` | The same when the condition is true | D6 and A. |
| `.forEachSideChain(...)` | One task for the whole array | A. |
| `.waitForSideChain({ failOnError?, timeoutMs? })` | A barrier: continues once every side-chain task **this sequencer** has queued has settled | Drains only the calling sequencer's tasks (`f554:130-186` [test]). Output unchanged: the value, not the tasks' results. Default: a failure is logged and the chain continues. `failOnError: true`: waits for all of them first, then throws the **first** failure (drain-then-throw, not fail-fast); it applies to every queued task, not to chosen ones (`sq:1943-2002`; `t:187-203`, `t:1580-1596`, `t:324-338` [test]). `timeoutMs`: the wait rejects with `Error("waitForSideChain timed out after <n>ms")` and the tasks keep running (`wt:15, 34-75`; `sq:1957-1964`; `reb:120-150` [test]); it bounds the wait, not the request. Needed only to order a later step after a task's side effects, or to turn a failure into a step error. |

### D2. `tap` against `sideChain`

| | `tap` | `sideChain` |
|---|---|---|
| Next step starts | After the tap finishes | At once |
| A throw | Fails the chain | Does not fail the chain or the request, except in the D4 exceptions (`failOnError: true`; a task-board task), which the page cell points to |
| Value passed on | The previous value | The previous value |

(`sq:2004-2068, 1876-1903`; `sc:145-154` [doc]; [run].)

### D3. What a side chain may and may not do

| May | Fact |
|---|---|
| Run any block, and take a connector's output as its input | `block: BlockDefinition<any, any>` (`sqm:290-295`). |
| Emit items to the stream | A `ctx.emit.message` from a side chain appears in the request's items [run]. |
| Run beside its siblings | Side chains run at the same time whether one sequencer queued them or several did (`f554:25-85` [test]). |
| Queue more side chains | Waited on too; the request drains until the pool is empty (`pool:137-159`; `packages/engine/test/request-side-chain-pool.test.ts:190-226` [test]). |
| Outlive its sequencer | It can keep running after its sequencer returns, but not after the request: the request does not finish until every side chain has settled. `drainRequestSideChainPool` runs before the terminal status write and before `onCompleted` on the success path, and on the catch paths (`ra:2763-2827`, the drain at `ra:2774` [read]; `f554:87-128` [test]; R-19). |

| May not | Fact |
|---|---|
| Change the pipeline value | Output discarded (`kern:156`) [run]. |
| Fail the request | By default the request stays `completed` [run, test `reb:67-96`]; there is no retry (R-19 row "The request does not fail"). Nothing reaches the user's stream: no `error` item [run]. The page cell points to the D4 exceptions: `failOnError: true` rethrows into the chain (`packages/engine/src/execution/request-side-chain-pool.ts:111-114` [read]), and a task-board task's attempt fails (`task-request.ts:472-485` [read]); in that case the request itself still ends `completed`. |
| Be waited on implicitly by the next step | Only `.waitForSideChain()` (or the request's end) waits. An inner sequencer does not wait for its own side chains (`f554:25-85`). |
| Stop on a dropped connection | Only an explicit abort cancels it (R-19). |

How its items are marked: every item a side chain emits, including its `block_trace` items, carries `provenance.phase: "sideChain"`; items from the main chain carry `"main"` (`packages/contracts/src/items/types.ts:23`; `kern:152`) [run: `bg-msg` message and `block_trace` items read `sideChain`, main-chain items read `main`]. The DevTool trace shows a side-chain badge on them (`packages/devtool/src/react/components/workspace/trace-view.tsx:487` [read]; `packages/devtool/test/trace-view.test.tsx` [test]).

### D4. How it fails (the three-line version; R-19 has the full table)

| Lookup | Fact |
|---|---|
| Does the failure fail the request? | No. [run] Status `completed`, a failed `block_trace` item (`status: "failed"`, `error.message`), and `[runAction] Background work "<name>" failed: <message>` on the server log (`ra:164-190`). `t:1598-1631` [test] asserts the user stream carries no public item. |
| Exception | A request working a dispatched task: the first failed background step fails the task's attempt with `Background work "<step>" failed: <message>` (`packages/orchestration/src/task-board/task-request.ts:472-485`; `sc:68`, `cn:297` [doc]; R-19 "Inside a dispatched task"). |
| What can hear it | `waitForSideChain({ failOnError: true })`, which throws into the chain (so a `.rescue()` can catch it); request-end hooks get `backgroundFailures: [{ step, message }]` (`rem:57-72`; `reb:67-96` [test]); `onRequestEnded` is exported from `@flow-state-dev/core/internal` only. State it as a link to R-19, not as a flow-author hook. |

### D5. Order among side chains

Side chains one sequencer queues start in call order and run at the same time (`kern:148-157` does not await the task; `sc:158-178` [doc]). Nothing orders their finishes. This is why the memory page says the order of its background cleanup is not fixed. The page names the behavior (Memory's background cleanup), not the internal side chains.

### D6. `sideChainIf`

Condition is evaluated once, before dispatch, and may be async. A `boolean` is accepted: `true` equals `.sideChain()`, `false` is a permanent no-op. Falsy: no block, no items, no trace, connector not called (`sq:1923-1930`; `t:1346-1560` [test]). A condition that throws fails the chain (it is awaited in the op [read]).

---

## 6. Names and message texts a lookup may quote (E)

| Case | Text or shape | Source |
|---|---|---|
| `forEach` / `forEachSideChain` given a non-array | `forEach expected an array input` / `forEachSideChain expected an array input` | `sq:1588-1590, 1667-1669` [run for forEach] |
| `branch`, nothing matched | `branch had no matching route` | `sq:2162` [run] |
| `loopBack` target missing | `loopBack target "<name>" was not found in sequencer "<x>"`; do not quote `<x>`, it prints the first step's name, not the sequencer's | `sq:998` [run] |
| Loop guard | `doUntil exceeded max loop guard (250)` / `doWhile exceeded max loop guard (250)` | `sq:1774, 1813` [run] |
| `stepAny` all failed / empty | `AggregateError`: `All blocks in stepAny failed` / `stepAny called with no blocks`; `.errors` lists them | `sq:2234, 2257` [run] |
| `race` all failed / empty | `AggregateError`: `All blocks in race failed` / `Error`: `race called with no blocks` | `sq:2275, 2366` |
| Input shape refused | `Block "<name>" input validation failed at "<path>": <message>` | `bb:152-172` [run] |
| Sequencer output refused | `SequencerOutputSchemaError` (`Sequencer "<name>" output validation failed at "<path>": <message>`), exported from `@flow-state-dev/core` | `sq:1138-1167`; `t:1647-1661` [test] |
| `waitForSideChain` timeout | `waitForSideChain timed out after <n>ms` | `wt:15`; `sq:1957-1964` |
| `.validate()` | `SequencerSchemaMismatchError`: `Sequencer "<name>" .validate() failed: <reason>` | `sq:2559-2568` |
| `waitForCondition` no emitter | `waitForCondition requires a response emitter on the context` | `sq:2399-2401` |

### E3. Retry and `.rescue()`

- `retry` on a block is applied by the engine's `executeBlock` to the block an **action** runs (`eb:423-446`).
  A step inside a sequencer is dispatched by core's `executeBlock`, which has no retry loop. [run: a handler with
  `retry: { maxAttempts: 3 }` used as a `.step` ran once, whether or not it carried `.rescue()`.] Tell the reader that
  a step's `retry` setting does nothing; only the sequencer or block an action points at retries as a whole.
- On an action's root block with `.rescue()`: rescue runs after the last attempt (3 attempts, then the handler), and at once, without
  further attempts, for an error the retry policy calls non-retryable (`retryableErrors` not matching) (`eb:339-366`; `br:60-160` [test]).
- Inside a sequencer, a step's `.rescue()` runs on its first failure.
- A sequencer's own `.rescue()` is not deferred to the last attempt: the engine skips root rescue for a sequencer (`eb:336-337`), and the sequencer runs its handlers on the first failure of a matching step and returns the recovery output (`sq:1078-1089`), so the run's retry policy sees no error and does not retry. Only an error no handler matches, or one a handler throws, reaches the retry loop.
- Chain names for `.tap`: `.tap(block)` and `.tap(fn)` are named `tap` (`sq:2046`); `.tap(factory, inlineConfig)` is named `tap:<inline block name>` (`sq:2017`).

---

## 7. Stored data: the four questions

The page is about method behaviour, not about data a user keeps. The only held thing is the per-request side-chain pool.

| Part | Owns it | Who sees it | Where stored | How many |
|---|---|---|---|---|
| Side-chain pool | The request that queued the tasks | Nobody; the runtime drains it, a failure shows as a failed `block_trace` item and a log line | Memory of the process running the request | One per request, any number of tasks (`pool:20-63`, `ra:164-190`) |
| Checkpoint of a durable sequencer | The sequencer instance | The engine | `stores.checkpoints`, latest only | One per sequencer instance |

The checkpoint row is about `durable` and belongs on the durability pages; carry one pointer only if the page mentions `durable`.
(`sqm:474-484` doc comment: "latest-only semantics: storage is constant per sequencer regardless of step count".)

---

## 8. Corrections to the existing pages (for the page's writer and pass 5)

1. `cn:132-143` `doWhile`: "Checked before each iteration, so the block may not run at all": **wrong**. The block runs once, then the condition is checked on its output. [run]
2. `cn:145-159` `loopBack`: "The named step's output position becomes the next iteration's input": **wrong**. The target is re-run with the value `loopBack` saw. [run] "Three patterns in the standard library use it" is not a fact about the method: dropped.
3. `cx:158-174` "Mismatches surface at compile time": **wrong** for the connector's return and for a plain `.step(block)`. [run]
4. `wfc:50-61` task-change example: matches nothing; task-change items are `type: "data"`. (section 4)
5. `cn:214`, `cn:297`: "Outstanding `.sideChain()` tasks are still awaited before the sequencer returns" / "the sequencer auto-awaits work tasks before it returns": **stale**. On a running host the request waits at its end, and an inner sequencer does not wait for its own tasks (`f554:25-85` [test]). Only the unit-test context (a mock `ctx` with no pool) falls back to awaiting per sequencer: do not state it.
6. `cn:11-18` groups `stepIf`, `map`, `tap`, `rescue` under "day one" and leaves them out of the table: the new table covers all 24.
7. `cn:26-56` `parallel`: "Branches writing the same instance key... are last-writer-wins": **[doc], not verified**, and not carried unless pass 5 runs it.
8. `sc:106` ("Before this change, every sequencer auto-awaited ...") is history: delete (the sitemap says delete the changelog). `sc:384` points maintainers at `docs/architecture/...`: drop.
9. `cb:79`, `cb:119`: a block with no output "pollutes the items log with an echo" only if it returns its input; no change needed on R-03.

---

## 9. Answers to the three lookups

- **What does `.parallel()` hand the next step?** An object with one key per branch, in the order written, each the output of that branch's block (`undefined` where the block returns nothing). It is not an array: use `.stepAll()` for an ordered array. The next step's input type is `{ [key]: branch output }`. If one branch fails the step fails. (A, `sq:1473-1550`, `t:45-59`, `t:2104-2126`.)
- **Does a side chain's failure fail the request?** No. The request ends `completed`; the failure is a failed `block_trace` item, a server log line, and (for flows that read them) `backgroundFailures`. Nothing reaches the user's stream. Answer opens with the exceptions, then the default. Exceptions: `waitForSideChain({ failOnError: true })` throws into the chain; a request that works a dispatched task fails that task's attempt. (D4.)
- **What does a wait resume on?** `waitForCondition`: the predicate returning true on entry or on an item event (`added`, `updated`, `done`, narrowed by `wakeOn`), else the timeout (`{ timedOut: true }`), else the request's abort (`{ timedOut: false }`). `waitForSideChain`: every side-chain task this sequencer queued settling (or its `timeoutMs`). (Section 4, D1.)

---

## 10. Left out, flagged

- `backgroundFailures` as a typed field: it is on a framework seam in `@flow-state-dev/core/internal`. Kept as a link to R-19, which already states it.
- Side-chain durability (replay of completed side chains, at-least-once re-runs, `ctx.runOnce`, trace precondition), the two abort signals, the `onFinished` / `onErrored` timing, suspension not waiting: all in R-19 `reference/background-work.md:73-88`; verified there by `packages/engine/test/background-work-recovery.test.ts` and `packages/integration-tests/src/scenarios/side-chain-pool-signal-isolation.test.ts`. Not repeated here.
- `onCompleted` not running on a `connectOutput` copy (section 3): observed, read as intentional in code (`bb:546-549`), but no test or doc states it. **Decision for pass 3:** state it or leave it; I recommend leaving it off the page until an owner confirms it is intended.
- `.asTool()` (used in `cn:47-56` beside `parallel`): a method on every block (`blk:1298-1313`), documented with blocks. One pointer at most.
- `ctx.wasRescued(...)`: a pointer to the errors page (R-22), not restated.
- Whether a side chain may itself suspend (`ctx.suspend`): not verified; not stated.
- The code comment at `sq:1701` ("sideChain → 'trace'" default role) names a role the generator code no longer has; not stated.

---

## 11. Pass 3 decisions

- All 13 moved rows carried. Row 7's `backgroundFailures` is a pointer to `background-work.md`, as section 1 said.
- Dropped: `onCompleted` not running on a `connectOutput` copy (unconfirmed as intended, section 10); `mapModelOutput` (belongs with tools and generators); `ctx.wasRescued` and `.asTool()` (other pages); the `parallel` last-writer-wins claim (`cn:26-56`, unverified); `durable` checkpoint row (durability page).
- Words are over what a concept page would carry because a reference has no budget; tables hold at six rows or fewer, by grouping methods.
- No figure: the sitemap entry briefs none.
