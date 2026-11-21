---
title: Sequencer methods
type: reference
description: "Every method on a sequencer: its input, its output and its conditional variant, plus connectors, waiting on a condition, and what a side chain may and may not do."
---

# Sequencer methods

A sequencer is a block made of other blocks, run in order. Each step receives the previous step's output, so a chain reads top to bottom and the data between steps is visible in one place. The methods below are the ways to add a step: run a block, skip it, loop it, fan it out, wait on something, or start it in the background and move on. This page lists them with what each takes and what the next step receives. For how to choose between them, read [Composition](../concepts/composition.md).

The examples belong to one app, a support desk. Its `support` flow handles a ticket with `handleTicket`.

```ts title="src/flows/support/blocks/handle-ticket.ts"
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const ticket = z.object({ message: z.string(), urgent: z.boolean() });

const classify = handler({
  name: "classify",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: ticket,
  execute: async (input) => ({ message: input.message, urgent: /refund|down/i.test(input.message) }),
});

const escalate = handler({
  name: "escalate",
  inputSchema: ticket,
  outputSchema: ticket,
  execute: async (input) => ({ ...input, urgent: true }),
});

const summarizeTicket = handler({
  name: "summarize-ticket",
  inputSchema: z.object({ message: z.string() }),
  execute: async () => {},
});

const apologize = handler({
  name: "apologize",
  inputSchema: z.any(),
  outputSchema: ticket,
  execute: async () => ({ message: "Sorry, something went wrong.", urgent: false }),
});

export const handleTicket = sequencer({
  name: "handle-ticket",
  inputSchema: z.object({ message: z.string() }),
})
  .step(classify)
  .stepIf((t) => t.urgent, escalate)
  .sideChain((t) => ({ message: t.message }), summarizeTicket)
  .rescue([{ block: apologize }]);
```

In every table, "Output" is the value the next step receives. Each method returns the sequencer, so the chain continues. A condition, connector or mapper is called with `(value, ctx)`, where `ctx` is the step's block context. The sequencer has no `.then()`.

## Steps

| Method | Input | Output | Conditional variant |
|---|---|---|---|
| `.step(block)`, `.step(block, options)`, `.step(connector, block)`, `.step(factory, inlineConfig)` | A block, optionally with a [connector](#connectors) before it and [`StepOptions`](#step-options). The inline form builds a block from `handler`, `generator` or `router`: `outputSchema` and `execute` are required, `name` defaults to `inline-<n>`. | The block's output. A block that returns nothing hands `undefined` to the next step. | `.stepIf()` |
| `.stepIf(condition, block)`, also with a connector and options | `condition(value, ctx)`, sync or async | The block's output when true. When false the value passes through unchanged, the connector is not called and no `block_trace` item, the per-step record the trace shows, is written. | itself |
| `.map(mapper)` | `mapper(value, ctx)`, sync or async | The mapper's return. Not a block: no `block_trace` item and no tracked output schema (the output type is the mapper's return type). Use `.step(handler)` when the reshaping has side effects or must show in the trace. | none |
| `.tap(fn)`, `.tap(block)`, `.tap(connector, block)` | A function or block run for its side effect | The previous value, whatever the tapped block returned. The chain waits for the tap, and a throw fails the chain. | `.tapIf(condition, ...)` |
| `.connectInput(mapper)` | `mapper(input, ctx)` | A sequencer that takes the mapper's input. The mapper's return is the first step's input, and the first block's schema validates it. | none |

`.connectInput()` here reshapes the whole sequencer's input. The same-named method on a block is in [Connectors](#connectors).

### Step options

The third argument of `.step()` and `.stepIf()`. Both members are optional.

| Member | Type | Does |
|---|---|---|
| `abortSignal` | `(ctx) => AbortSignal \| undefined` | An extra signal the step runs under, combined with the request's: the step stops on either. Resolved each time the step is dispatched, so it can read what an earlier step wrote. Reaches the step's connector, its blocks and their side chains. `undefined` adds nothing. |
| `onSettled` | `(ctx, outcome: "returned" \| "threw" \| "suspended") => void` | Called once when the step ends, by any path, including a suspension that no `.rescue()` sees. A step suspends when a block calls `ctx.suspend` to pause the run for an answer. Synchronous. A throw from it is logged and does not change the step's outcome. Not called when a `.stepIf()` condition was false, or when the step's output was replayed on a resume: when an answer continues the run, a step that finished before the pause reuses its saved output and does not run again. See [Pause, resume and replay](./durable-execution.md). |

## Ending, choosing and looping

| Method | Input | Output | Conditional variant |
|---|---|---|---|
| `.exitIf(condition)` | `condition(value, ctx)` | The value unchanged. When true, later steps are skipped and the current value is the sequencer's output. Several are allowed, and the first true one wins. It exits only its own sequencer: an inner sequencer's `.exitIf()` hands its value to the outer chain, which continues. The declared `outputSchema` validates an exit value too. | itself |
| `.throwIf(condition, error)` | `error` is an `Error` or `(value, ctx) => Error \| Promise<Error>` | The value unchanged. Throws `error` when the condition is true. Pair it with `.rescue([{ when: [...] }])`. | itself |
| `.branch({ name: [connector, condition, block], ... })` | One tuple per arm | The matching arm's block output. Arms are tried in key order: the connector runs on the value, then `condition(connectorOutput, ctx)`. The first true arm runs its block on the connector output and the rest are not tried. No arm true throws `branch had no matching route`. | itself |
| `.doUntil(condition, block)`, also with a connector | `condition(blockOutput, ctx)` | The block's last output. The block runs, then the condition is checked, and true ends the loop, so the block runs at least once. The connector applies once, to the first input; later passes take the previous pass's output. | `.doWhile()` is the reverse test |
| `.doWhile(condition, block)`, also with a connector | `condition(blockOutput, ctx)` | The block's last output. The block runs, then repeats while the condition is true, so it also runs at least once. | `.doUntil()` is the reverse test |
| `.loopBack(stepName, { when?, maxIterations })` | The chain name of an earlier step | The value unchanged. Jumps back to the first earlier step with that name, up to `maxIterations` times, then continues past it without throwing. Without `when` it always jumps. The step jumped to receives the value `.loopBack()` saw, and every step from there to the `.loopBack()` runs again. No step with that name throws `loopBack target "<name>" was not found in sequencer ...` when it runs. | `when` |

`.doUntil()` and `.doWhile()` throw `doUntil exceeded max loop guard (250)` or `doWhile exceeded max loop guard (250)` when the condition has not ended the loop by the time the block has run 251 times (the first pass plus 250 repeats). The guard is not configurable.

Chain names, for `.loopBack()`: a `.step(block)` is named after the block, and `.stepIf()` adds `if:<name>`, `.doUntil()` and `.doWhile()` add `doUntil:<name>` and `doWhile:<name>`, and `.sideChain()` adds `sideChain:<name>` (or its `name` option). `.tap`, `.tapIf`, `.map`, `.parallel`, `.stepAll`, `.forEach`, `.branch`, `.stepAny`, `.race`, `.exitIf`, `.throwIf` and `.waitForCondition` use their own method name. Each loop pass writes its own `block_trace` items.

## Running several blocks at once

| Method | Input | Output | Conditional variant |
|---|---|---|---|
| `.parallel({ key: block \| { connector, block } }, { maxConcurrency? })` | One entry per branch. Each branch gets the previous value, or the output of its own connector. | An object with one key per branch, in the order written, each the output of that branch's block. It is not an array. `maxConcurrency` caps the branches in flight, and unset runs them all. | none |
| `.stepAll([block \| { connector, block }, ...], { maxConcurrency? })` | A list of blocks | An array with one entry per block, in the order given. `[]` gives `[]`. | none |
| `.forEach(block \| factory, options?)`, also with a connector | The previous value (or the connector's return) must be an array. `null` and `undefined` count as `[]`. | An array of the block's outputs, in element order. The step waits for every element. A factory is `(item, index, ctx) => block`. `options` takes `maxConcurrency` (unset runs all at once) and `blocks`, the blocks a factory can produce, so the flow can see them. A non-array throws `forEach expected an array input`. | none |
| `.forEachSideChain(block \| factory, options?)`, also with a connector | An array, as for `.forEach()` | The original input, not the connector's array. See [Side chains](#side-chains). | none |

**What does `.parallel()` hand the next step?** The object above. If one branch throws, the step throws that error. The other branches are not cancelled: they run to the end and their results are dropped. `.stepAll()` and `.forEach()` fail the same way. To contain a failure, put `.rescue([...])` on the branch's block: that branch's value becomes the handler's output and the step succeeds.

```ts title="src/flows/support/blocks/gather-context.ts"
import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const lookUpOrder = handler({
  name: "look-up-order",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ status: z.string() }),
  execute: async () => ({ status: "shipped" }),
});

const lookUpPlan = handler({
  name: "look-up-plan",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ tier: z.string() }),
  execute: async () => ({ tier: "pro" }),
});

export const gatherContext = sequencer({
  name: "gather-context",
  inputSchema: z.object({ message: z.string() }),
}).parallel({ order: lookUpOrder, plan: lookUpPlan });
// next step receives { order: { status }, plan: { tier } }
```

## Picking one and recovering

| Method | Input | Output | Conditional variant |
|---|---|---|---|
| `.stepAny([block, ...])` | Blocks tried in order | The first success. Later blocks never run. All failing throws an `AggregateError` ("All blocks in stepAny failed") whose `errors` lists each failure. An empty list throws `AggregateError("stepAny called with no blocks")`. The output type is `unknown`. | none |
| `.race([block, ...], { maxConcurrency? })` | Blocks started together | The first success, typed `unknown`. The others get an abort signal, but the step waits for every block to settle, so a loser that ignores the signal holds the step up. All failing throws an `AggregateError` ("All blocks in race failed"). An empty list throws `Error("race called with no blocks")`. | none |
| `.rescue([{ when?, block }, ...])` | `when` is a list of error classes. The handler's input is the error. | When any step throws, the chain stops there and the first handler whose `when` matches runs. Its output is the sequencer's output, validated against the declared `outputSchema`. A handler with no `when`, or `when: []`, matches every error. No match rethrows the original error. A second `.rescue()` call replaces the first list. A suspension is never rescued. | none |
| `.validate()` | none | Not chainable. Call it last. Throws `SequencerSchemaMismatchError` when the declared `outputSchema` and the last step's schema differ in top-level kind, object keys, array element kind, or one level of object-value kinds. It checks nothing when either schema is missing or the chain ends in `.stepAny()`, `.race()` or `.stepAll()`. After `.branch()` it compares against the first arm's output schema, when that arm has one. Steps added after it are not checked. | none |

`.rescue()` on the sequencer ends the chain at the failure. `block.rescue([...])`, a method on every block, is the per-step form: the chain continues with the handler's output as that step's output. A sequencer's own failed output validation throws `SequencerOutputSchemaError`.

### Retry and rescue

`retry` on a block is applied only to the block an action runs. A step inside a sequencer runs once whatever its `retry` setting says. On an action's root block, a `.rescue()` handler runs after the last retry attempt. For an error the retry policy treats as non-retryable, it runs at once. Inside a sequencer, a step's `.rescue()` runs on its first failure. See [Errors](./errors.md).

## Connectors

A connector is a function `(input, ctx) => value | Promise<value>`. It runs before a block and turns the previous step's output into the block's input.

| Form | Accepted by | Receives | Returns |
|---|---|---|---|
| Leading function | `.step`, `.stepIf` (after the condition), `.tap`, `.tapIf`, `.sideChain`, `.sideChainIf`, `.doUntil`, `.doWhile`, `.forEach`, `.forEachSideChain` | The running value and `ctx` | The block's input. For `.forEach()` and `.forEachSideChain()`, the array. It runs in the main chain, once on the first input in a loop. |
| `{ connector, block }` | `.parallel` values, `.stepAll` entries | The shared input value | That branch's input |
| Arm tuple `[connector, condition, block]` | `.branch` | The running value | What both the arm's condition and its block receive |
| `block.connectInput(fn)` | Any block | The raw input the block would have received, and `ctx` | The input the block validates. The block's schema applies to the connector's output. |
| `block.connectOutput(fn)` | Any block | The block's output and `ctx` | What the next step sees. The returned block has no output validation. |

In `handleTicket`, `.sideChain((t) => ({ message: t.message }), summarizeTicket)` hands the side chain only the text.

### Shape checking

Shapes are checked when the flow runs, not when it compiles. Only the connector's `input` parameter is typed, from the previous step's output. TypeScript does not compare a connector's return with the next block's input, and does not compare a block given without a connector with the previous output. A mismatch fails at run time:

```text
Block "needs-query" input validation failed at "query": Required
```

The message names the block and the path of the first failing field. Output failures read the same, with `output`.

## Waiting on a condition

`.waitForCondition(predicate, { timeoutMs, wakeOn? })` pauses the chain until the request's items satisfy a test. It waits on one request's items. It is not a durable wait across requests.

| Part | Behavior |
|---|---|
| `predicate` | `(items: readonly OutputItem[]) => boolean`, synchronous. Keep it cheap and free of side effects: it runs on every wake, and a throw ends the wait. |
| `timeoutMs` | Required. |
| `wakeOn` | `(item, kind: "added" \| "updated" \| "done") => boolean`. A pre-filter: the predicate re-runs only for items it accepts. It does not apply to the check on entry. When a filter throws, the event wakes the predicate anyway. A filter that rejects everything leaves the wait to end at `timeoutMs`. |
| Output | `{ timedOut: boolean }`. The previous value is not passed on. It never throws on timeout. |

**What does a wait resume on?** Whichever of these comes first:

| Resumes on | `timedOut` |
|---|---|
| The predicate returns true, on entry or after an item event (`added`, `updated`, `done`) | `false` |
| `timeoutMs` elapses | `true` |
| The request's signal aborts | `false`. Check `ctx.signal.aborted` in the next step to tell it from success. |

On entry the predicate runs once over the items already on the request, and true there returns `{ timedOut: false }` at once. That check sees every non-transient item and the most recent 10,000 finished transient ones such as `resource_change`. After that the predicate runs once per item event the filter lets through. A predicate that throws, on entry or on an event, ends the wait and the error leaves the step. Outside a request run by the framework, such as a block called directly in a unit test, the step throws `waitForCondition requires a response emitter on the context`.

Predicate helpers, exported from `@flow-state-dev/core`:

| Helper | True when |
|---|---|
| `whenResourceChanged({ scope, path, changeType? })` | Some `resource_change` item has that `scope` and exactly that `resourcePath`. `changeType` (`"created"`, `"updated"` or `"deleted"`) narrows it. |
| `whenResourceMatching({ scope, pattern })` | Some `resource_change` item in `scope` has a path matching `pattern`. `*` is any run of characters except `/`, `**` is any run including `/`, and every other character is literal. |
| `whenAnyItem(predicate)` | Any item satisfies `predicate`. |

`onTaskChangeFor(collectionId)`, from `@flow-state-dev/orchestration/tasks`, is a `(item) => boolean` that is true for the `data` items of type `task-change` on that collection. It works as `wakeOn` and inside `whenAnyItem()`.

```ts title="src/flows/support/blocks/wait-for-reply-draft.ts"
import { sequencer, whenResourceChanged } from "@flow-state-dev/core";
import { z } from "zod";

export const waitForReplyDraft = sequencer({
  name: "wait-for-reply-draft",
  inputSchema: z.object({ message: z.string() }),
}).waitForCondition(
  whenResourceChanged({ scope: "session", path: "drafts/reply" }),
  { timeoutMs: 10_000 },
);
// next step receives { timedOut: boolean }
```

`.waitForSideChain()` is the other wait. It waits on the sequencer's side-chain tasks, not on items. See below.

## Side chains

A side chain runs a block beside the chain. The next step starts at once and receives the value `.sideChain()` was given, whatever the block returns. For lifetimes, durability and abort signals, see [Background work](./background-work.md).

| Method | Does |
|---|---|
| `.sideChain(block, { name? })`, `.sideChain(connector, block, { name? })` | Starts the block and moves on. The task is named `name` or the block's name. The connector runs in the chain, and a throw in it fails the chain. |
| `.sideChainIf(condition, [connector,] block, { name? })` | The same when `condition` is true. `condition` is a boolean or `(value, ctx) => boolean \| Promise<boolean>`, evaluated once before dispatch. False dispatches nothing, emits no items and skips the connector. A condition that throws fails the chain. |
| `.forEachSideChain(block \| factory, { concurrency?, blocks? })` | Queues the whole array as one task named `forEachSideChain[<n>]`. Each element's block runs as `<block name>[<index>]`. `concurrency` (default 16, minimum 1) caps elements at once. The option is `concurrency` here and `maxConcurrency` on `.forEach()`. One element failing does not stop the rest, and the task then fails with the first failure. |
| `.waitForSideChain({ failOnError?, timeoutMs? })` | A barrier. Continues once every side-chain task this sequencer has queued has settled, and passes the value on unchanged. A failure is logged and the chain continues. With `failOnError: true` it waits for all of them, then throws the first failure, so a `.rescue()` can catch it. `timeoutMs` rejects the wait with `waitForSideChain timed out after <n>ms` and the tasks keep running. |

`.waitForSideChain()` waits only for the sequencer it is called on. Use it to order a later step after a task's side effects, or to turn a failure into a step error.

### `.tap()` against `.sideChain()`

| | `.tap()` | `.sideChain()` |
|---|---|---|
| Next step starts | After the tap finishes | At once |
| A throw | Fails the chain | Does not fail the chain or the request, except in the cases [below](#what-a-side-chain-may-and-may-not-do) |
| Value passed on | The previous value | The previous value |

### What a side chain may and may not do

| May | Detail |
|---|---|
| Run any block | Its input can come from a connector. |
| Emit items | A message emitted from a side chain appears in the request's items. |
| Run beside its siblings | Side chains run at the same time, whether one sequencer queued them or several did. |
| Queue more side chains | The request waits for those too. |
| Outlive its sequencer | It can keep running after its sequencer returns, but not after the request: the request does not finish until every side chain has settled. |

| May not | Detail |
|---|---|
| Change the chain's value | Its output is discarded. |
| Fail the request | By default the request ends `completed`, with no retry. The exceptions are in the next paragraph. |
| Be waited on by the next step | Only `.waitForSideChain()` or the end of the request waits. An inner sequencer does not wait for its own side chains. |
| Stop on a dropped connection | Only an explicit abort cancels it. |

**Does a side chain's failure fail the request?** No, unless the sequencer calls `.waitForSideChain({ failOnError: true })`, which throws the failure into the chain, or the request is running a task from a [task board](./task-board.md), where the task's attempt fails with `Background work "<step>" failed: <message>`. Otherwise the request ends `completed`. The failure shows as a `block_trace` item with `status: "failed"` and an `error.message`, and as a server log line, `[runAction] Background work "<name>" failed: <message>`. Nothing reaches the user's stream. Request-end hooks receive the failures as `backgroundFailures`, described in [Background work](./background-work.md).

Every item a side chain emits, its `block_trace` items included, carries `provenance.phase: "sideChain"`. Items from the main chain carry `"main"`. The DevTool trace shows a side-chain badge on the former.

Side chains one sequencer queues start in call order and run at the same time. Nothing orders when they finish, so two side chains that write to the same place need their own ordering. Memory's background cleanup is an example: see [Memory](./memory.md).
