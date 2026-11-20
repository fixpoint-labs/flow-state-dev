---
title: Pause, resume and replay
type: reference
description: "How a run stops for an answer and continues: what ctx.suspend returns, what runs again, idempotency keys, the routes that answer a pause, and how long a paused run is kept."
---

import Figure from "@site/src/components/Figure";
import States from "./figures/durable-execution-states.svg";

# Pause, resume and replay

A run can stop partway and pick up later, on the same record, even after the server restarts. A block that needs an answer from a user, such as an approval or a form, stops the run and saves where it was. The answer continues that run. Steps that finished before the stop are not run again: their saved output is reused. That reuse is the replay. A run that a crash cut short continues the same way.

A paused run holds no process. The block that paused runs again from its top, so this page lists what runs again, what is kept, and who may answer.

A request is one run of an action. The tables below follow one flow, `refunds`: `loadOrder` reads an order, then `approveRefund` asks a user to approve the refund and pays it.

```ts title="src/flows/refunds/blocks/approve-refund.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const approveRefund = handler({
  name: "approve-refund",
  inputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  outputSchema: z.object({ refunded: z.boolean() }),
  execute: async (input, ctx) => {
    await ctx.runOnce!("notify-reviewer", async () => {
      const res = await fetch("https://chat.example.com/notify", {
        method: "POST",
        body: JSON.stringify({ text: `Refund of ${input.amount} waits for approval` }),
      });
      return res.status;
    });

    const answer = await ctx.suspendForUser({
      kind: "approval",
      prompt: `Refund ${input.amount} on order ${input.orderId}?`,
      deadline: 24 * 60 * 60 * 1000,
    });
    if (answer.cancelled || !answer.approved) return { refunded: false };

    await fetch("https://payments.example.com/refunds", {
      method: "POST",
      headers: { "Idempotency-Key": ctx.idempotencyKey! },
      body: JSON.stringify({ orderId: input.orderId, amount: input.amount }),
    });
    return { refunded: true };
  },
});
```

```ts title="src/flows/refunds/flow.ts"
import { defineFlow, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { approveRefund } from "./blocks/approve-refund";
import { loadOrder } from "./blocks/load-order";

export const refundsFlow = defineFlow({
  kind: "refunds",
  actions: {
    refund: {
      block: sequencer({ name: "refund" }).step(loadOrder).step(approveRefund),
      inputSchema: z.object({ orderId: z.string() }),
    },
  },
});
```

```ts title="src/flows/refunds/blocks/load-order.ts"
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

export const loadOrder = handler({
  name: "load-order",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ orderId: z.string(), amount: z.number() }),
  execute: async (input) => {
    const res = await fetch(`https://orders.example.com/orders/${input.orderId}`);
    const order = (await res.json()) as { total: number };
    return { orderId: input.orderId, amount: order.total };
  },
});
```

`loadOrder` finishes before the stop, so a resume skips it. `approveRefund` runs again from its top: the notification is guarded by `runOnce`, and the payment carries the request's idempotency key.

## A request's states

<Figure svg={States} caption="A request's states" description={"Four boxes. In progress moves to suspended when approveRefund calls suspend, and suspended moves back to in progress when the request is answered. In progress moves to a final box holding completed, failed, aborted and incomplete. Dashed arrows, which apply only after a crash, run from in progress to interrupted when the heartbeat stops and back when the request is continued, and from interrupted to the final box when it is discarded. Suspended is highlighted: the request waits for an answer. Notes say that one request keeps one id and one item log through every pause, that a stop ends a suspended or interrupted request as aborted, and that a suspended request is never marked interrupted."} />

| Move | Cause |
|---|---|
| `in_progress` to `suspended` | `ctx.suspend` throws `SuspensionError`. The request's status becomes `suspended`, a `pending` suspension record is stored, and the stream carries a `suspension` item and a `request.suspended` event before it ends. |
| `suspended` to `in_progress` | A resume, an answer or the sweeper continues the request. If a stop got there first, the run ends before any block executes. |
| `in_progress` to a final status | `completed`, `failed`, `aborted` or `incomplete`. |
| `in_progress` to `suspended` again | A later `ctx.suspend` in the same run. |
| `in_progress` to `interrupted` | The stale-request sweeper finds a heartbeat older than the threshold ([Interrupted requests](#interrupted-requests-and-continue)). |
| `interrupted` to `in_progress` | `continue`, which keeps the request id, or the sweeper finishing a gate that was already resolved. |
| `suspended` or `interrupted` to `aborted` | A stop. See [Stopping a paused request](#stopping-a-paused-request). |

While a request is paused it holds:

| Held | Detail |
|---|---|
| The request record | Status `suspended` and the items so far. A pause does not close the record: `GET` returns the whole pause-and-continue history on one record. |
| One suspension record | Status `pending` until answered ([Stores](./stores.md)). |
| Recorded block outputs | The `block_trace` items of blocks that finished. |
| The sequencer checkpoint | Written at the pause, even when nothing changed. |
| The token budget | A suspended request saves what it spent and the resume restores it, so both runs count against one budget. |

The order of items across a pause, the `suspension_resume` and `continuation` items with their `resolution` values, and resuming a stream after a pause are in [Items and the stream](./items.md).

## What `ctx.suspend` takes

| Call | Signature |
|---|---|
| `ctx.suspend` | `(options) => Promise<unknown>`. Optional on the context type, so TypeScript code writes `ctx.suspend!(...)`. |
| `ctx.suspendForUser` | `(options) => Promise<answer>`. Not optional. Shape under [`ctx.suspendForUser`](#ctxsuspendforuser). |

| Option | Type | Meaning |
|---|---|---|
| `reason` | `"user_approval" \| "user_input" \| "external_event" \| string` | Required. `user_approval` and `user_input` make the stop a user's stop, the kind the `answer` route takes. Any other string is a custom gate. |
| `message` | `string` | The body shown with the stop, markdown allowed. Omitted, the text is `Flow suspended: <reason>`. |
| `allow` | `ResumeAction[]` | What an answerer may do. Defaults by reason: `user_input` gives `["submit"]`; every other reason gives `["approve", "reject"]`. Add `"skip"` for an optional step. |
| `timeoutMs` | `number` | Deadline, counted from the call. Omitted or `0`, the pause has no deadline. |
| `resumeSchema` | Zod schema or JSON Schema | Stored as JSON Schema. The resume and answer routes check `submit`, and an `approve` that carries data, against it. |
| `suspensionId` | `string` | A name you choose, unique within the request and the same on every replay of the call. Omitted, one is minted. |

| Option | Type | Meaning |
|---|---|---|
| `title` | `string` | A short heading. |
| `data` | `Record<string, unknown>` | Stored on the record and carried on the `suspension` item. Client-visible, so keep secrets out. |
| `render` | `{ component, props? }` | A hint for the client screen. |
| `kind` | `"approval" \| "review" \| "input"` | Set by `suspendForUser`. A raw `ctx.suspend` leaves it unset. Clients then take the kind from `reason`. |

## What `ctx.suspend` returns

| Situation | Result |
|---|---|
| First reach, on a durable host | Throws `SuspensionError`, a control-flow signal. Rescue handlers do not fire for it and it is not a block failure. The request pauses. |
| The resuming action is `approve` or `submit` | Returns the payload, or `undefined` when none was sent. |
| The resuming action is `skip` | Returns the `SUSPENSION_SKIPPED` symbol, exported from `@flow-state-dev/core`. Only `resolution: "skipped"` is stored. |
| A gate resolved on an earlier pass | Returns or throws its recorded outcome, in the order recorded, instead of pausing again. |
| A gate resolved `stopped` | Never returns an answer on replay. The run ends `aborted` at that call. |

| Situation | Throws |
|---|---|
| The resuming action is `reject` | `SuspensionRejectedError` |
| A gate that allows `reject` past its deadline (an approval, or a custom gate that allows it) | `SuspensionRejectedError` with `expired: true` |
| The gate's task was cancelled | `SuspensionRejectedError` with `cancelled: true` |
| A user's review or input past its deadline, including a raw `user_input` gate | `SuspensionTimeoutError` |
| The host has no durable execution: `durable: false`, in-memory stores, or a router given no durability provider | A plain `Error`; the request ends `failed` and nothing is held. Message: "stopping for a person needs durable execution, which is on by default wherever stores persist. This host has none: it sets `durable: false`, runs on in-memory stores, or is a router given no durability provider. Remove `durable: false`, or set `durable: true` to hold stops in memory (tests only: they are lost when the process ends). Nothing was held."

### `ctx.suspendForUser`

| Call | Behavior |
|---|---|
| `ctx.suspendForUser({ kind, prompt, title?, deadline?, resumeSchema?, data?, render? })` | Stops for a user and returns the answer as a value. Needs durable execution, as `ctx.suspend` does. |
| A rejection | Only an `approval` returns one as a value. A review or an input has no "no". |

| `kind` | Returns | At the deadline |
|---|---|---|
| `approval` | `{ cancelled: false, approved: true, answer? }`, or `{ cancelled: false, approved: false, deadline, answer? }` for a rejection or an expired approval. A no never throws. | Reads as a no with `deadline: true` |
| `review` | `{ cancelled: false, answer }` | Throws `SuspensionTimeoutError` |
| `input` | `{ cancelled: false, answer }` | Throws `SuspensionTimeoutError` |
| any, when the task is cancelled while it waits | `{ cancelled: true }`. The block runs to its end and nothing it writes to the task is kept. Any later wait for a user in the run is cancelled at once. | |

| Deadline | Rule |
|---|---|
| `deadline` on the call | Milliseconds, a positive finite number, or the call throws `TypeError`. |
| The host's `userDeadlineMs` | Used when the call sets none. Set on the host: [Runtime configuration](./runtime.md). |
| Neither | The stop waits until answered, stopped or cancelled. |

## What runs again on resume

| Resume | Behavior |
|---|---|
| Mode | Runs the action again under the same request id, in replay mode. |
| Restored | Sequencer state from the checkpoint, and the recorded output of every finished block. |

| Which blocks are skipped on resume? | |
|---|---|
| Every block with a `completed` recorded output | Not run: no `execute`, no model call, no emit, no state write. Downstream blocks see the same value. |
| Background blocks (`.sideChain()`, `.sideChainIf()`, `.forEachSideChain()`) | Same rule. One that finished and recorded is skipped. |
| A step's `onSettled` hook | Does not fire for a skipped step. |
| The request's user message | Not emitted again, on resume or on crash continuation. |
| Never skipped | The block that paused, and any block marked `transient: true`. |
| Where finished is recorded | In the store, so skipping holds across a restart on any store that persists. |

| Runs again | Detail |
|---|---|
| The block that paused | Runs from its top. `ctx.suspend` returns the answer, or throws, as above. Anything it did before the `suspend` call happens again. |
| A `transient: true` block | Leaves no record, as does a failed or suspended block, so it runs again. |
| The generator whose tool paused | Called once more. Earlier model turns and finished sibling tools are rebuilt from the item log. Only the paused tool re-enters. |
| Composition callbacks (`.map`, `.stepIf`, `.sideChainIf`, connectors) | Run again to rebuild control flow. A `Date.now()`, `Math.random()` or generated id in one can pick a different branch on resume. Move it into a block, whose output is recorded, or into `runOnce`. |
| A router's `execute` selector | Runs again and is checked against the recorded decision ([Routers](#routers)). |
| Background work in flight at a crash | Runs again, so its side effects are at-least-once. |

| Matching | Rule |
|---|---|
| The key | A block's logical id, `<requestId>:<path>`. The match holds across retries and a restart. The path is what matches: a change that adds, removes or reorders steps between a pause and its resume changes which block a recorded output belongs to. |
| The path | Segments read `root`, `step[N]`, `iter[N]`, `branch[...]` and `tool[...]`. |
| Sequencer state (`ctx.sequencer`) | Restored from the checkpoint taken at the pause. Each write the paused block made before the pause counts once in the state after the answer, `incState` and `pushState` included. During the re-run, before the `suspend` call returns, a read sees the checkpoint plus the re-run's own writes, so an `incState` before the pause can read one higher than it will after the answer. |
| Session, user and org state, and resource writes | Not covered by the checkpoint. They run again with the block. |
| A finished block whose output was over `maxRecordedValueBytes` (default 262,144) | Cannot be injected and is never run again. The request fails with `RecordedValueOmittedError`. Return less, or pass bulk data between steps with `.map`. |

What an in-memory store keeps, and what `durable: true` over memory allows: [Stores](./stores.md).

## Idempotency keys

A block that runs again must not repeat a side effect. `ctx.idempotencyKey` and `ctx.runOnce` guard it.

| | Behavior |
|---|---|
| `ctx.idempotencyKey` | The string `<requestId>:<blockPath>`, set per block run. It leaves out the attempt number, so every retry of a step sees the same key. It is also the same on a resume or a continue, which keep the request id. It changes on a `retry`, which starts a new request. Pass it as the provider's idempotency header, as `approveRefund` does. |
| `ctx.runOnce(key, fn)` | The first call for a `(requestId, key)` pair runs `fn` and stores the result. Later calls return the stored value. The result must be JSON-serializable. |
| Within one process | Concurrent calls with one key share one in-flight call. An empty or non-string key rejects. |
| Across a resume or continue | The result is stored in the request store, so the re-run reads it and does not call `fn`. |
| Scope | One request. A `retry` starts empty. It is not a cache across requests. |
| Availability | Declared on every block's context. |
| Who needs it | The paused block, which runs again from its top, and any block in flight at a crash. Put the side effect after the `suspend` call, or guard it. |
| Concurrency policies | Not an idempotency key: [Concurrency policies](./concurrency.md). |
| The gap | The store write happens after `fn` resolves. A crash between the two leaves no record, so a continuation can run `fn` again. A failed store write logs a warning, and the in-process result holds for the rest of the process. Passing `ctx.idempotencyKey` to the provider closes the gap. |

## Several pauses in one run

| Case | Behavior |
|---|---|
| Pause, resume, pause again, resume | One request id and one log: `suspension`, `suspension_resume`, items, `suspension`, `suspension_resume`, and on. Sequence numbers continue. |
| Resuming a later gate | Earlier gates were resolved on the log. They return their recorded outcome in the original order (answer, rejection or skip symbol) and do not pause again. This works across a restart. |
| Which gate takes the answer | The one the request is resuming, matched by logical block path and position, and by `suspensionId` when the call names one. Any other gate reached on the same replay suspends normally. |
| One block waiting twice | Each unnamed `ctx.suspend` in the block gets its own resolution, in order. |
| A second pause | The next gate can be answered as soon as the request pauses again. |

## Pausing in a generator

| Case | Behavior |
|---|---|
| Where the gate lives | In one of the generator's tools: `ctx.suspend()` in the tool block's `execute`. A client answers it through the same resume or answer route. |
| Approval | The tool runs its real body after `suspend` returns, and the model receives the tool's real return value, not the resume payload. The approved tool runs once, and the model is not called again for turns before the approval. |
| How the conversation is rebuilt | From the item log: a `generator_step` item per tool-calling step, holding the assistant text and the tool calls, and the recorded `tool_output` items. Step 0 also holds the compiled prompt and context, so neither is resolved again. |
| Finished sibling tools in the same turn | Injected from the log. Only the gated tool re-enters. |
| Rejection | `ctx.suspend()` throws `SuspensionRejectedError` inside the tool. The generator records a completed `tool_output` of `{ denied: true, reason }`, tells the model, and goes on. It does not fail. |
| An expired approval | The same, with `expired: true` and a reason that says the approval expired and the tool was not run |
| A review or input past its deadline inside a tool | The run fails with `SuspensionTimeoutError`. |

| Case | Behavior |
|---|---|
| Two gated tools in one model turn | The first to suspend surfaces. The other reaches its gate on the next resume cycle. |
| A later gate | Two suspending tools in sequence pause and resume twice, in order. A rejected gate is not re-entered when a later gate suspends. |
| An ordinary error after the gate | A failed tool call the model is told about. A cancel inside the re-entered tool stops the run. A `mapModelOutput` that throws after an approved gate fails the run. |
| `cacheable` on a gated tool | Do not set it. A cache hit answers before the tool body runs and skips the gate. |
| Provider-native tools (`providerTools`) | Calls from an earlier turn cannot be rebuilt, because they record no `tool_output`. |
| A dynamic `tools` resolver | It must keep the pending tool present and unchanged, or the resume fails with `GeneratorToolUnavailableError`. |
| Side effects before the gate | Run again, unless guarded by `runOnce`. |
| A streaming generator | Suspends and resumes too. Recorded turns are rebuilt for the model and not streamed to the client again. |

## Routers

| Case | Behavior |
|---|---|
| The decision | A router records it as a `router_decision` item. On resume its selector (`execute`) runs again and is checked against the recorded route. |
| Same pick | The branch continues. Completed work inside it is injected, not run again. |
| A different pick, or the recorded route is not in the route table | The resume fails with `RouteUnavailableError`, code `route_unavailable`, `retryable: false`. Its `details` hold `routerName`, `recordedRoute`, `reselectedRoute` and `recordedRouteDeclared`. |
| `connectInput` mapping | A per-call wrapper's mapping the selector returns is kept across the pause. |
| Any router, including a root action block | Resumes on its recorded route. |
| Route names | Two different blocks cannot share one route name in a router. Defining it throws, because the decision stores the bare name. |

Rules for selectors and mapping closures, and for the types routes share: [Blocks](./blocks.md).

## Answering a pause

The resume and answer endpoints, their checks, status codes and messages, and the clients and screens that call them (`RequestHandle`, React `answerSuspension`, the DevTool Suspensions tab) are in [HTTP API](./http-api.md).

| Question | Answer |
|---|---|
| Who may answer | The signed-in caller who reaches the request: the same user and organization when the app authenticates, and otherwise only the tenant check applies. A `resumedBy` or `resumeContext` field in the body is ignored. |
| What the answer records | `resolvedBy` (the caller's user id, or the request's owner when the app does not authenticate), `resolvedAt`, `resumeData` and the status, on the suspension record and on the `suspension_resume` item. |
| Which flow the path names | The instance recorded as the request's owner. A path naming another copy of the same definition gets `404` on resume, the response for a request that does not exist. `retry` and `continue` answer `400` "Flow mismatch: request belongs to flow instance ...". |
| As whom the action runs | The record's owner, from the stored request, not the caller. |
| With no event-stream `Accept` header | The stream is closed. Read the request through `GET .../stream` or `.../status`. |
| `retry` | Not a resume: a new request id, from `interrupted` or `failed` only, with `inputOverride` allowed. |

What each caller gets back from the resume route, for a request Alice owns and Bob, another signed-in user, does not:

| Caller and call | Result |
|---|---|
| Bob sends a correct `{ suspensionId, action: "approve" }` | `404` `Request "<id>" not found`. The body is the same as for an unknown request or another tenant's, so Bob cannot tell them apart. The pause stays open. |
| Alice's first approve | `202` `{ requestId }`, the same id. With `Accept: text/event-stream`, the live stream of the continuation instead. The answer is recorded with `resolvedBy` set to Alice's user id. |
| Alice's second click while the first resume holds its 60 second lease | `409` `Concurrent resume in progress. Try again later.` |
| Alice's second click after the request has left `suspended` | `409` `Request is "in_progress", not "suspended"` |
| Alice's second click on the `answer` route, on a stop already resolved | `409` with `refused: "already-resolved"` |

## Interrupted requests and continue

| Setting or fact | Detail |
|---|---|
| Heartbeat | A run writes one to the active request registry while it works, every 10 seconds by default. A request whose heartbeat is older than the threshold is marked `interrupted`. A paused request is not touched: it stays `suspended`. |
| Sweep interval and threshold | 30,000 ms and 60,000 ms. Set `staleSweepIntervalMs` and `staleSweepThresholdMs`. An interval of `0` or less turns the sweeper off. The threshold should be at least twice the heartbeat interval. |
| After a restart | A request in flight shows `interrupted` once its last heartbeat is over 60 seconds old and a sweep has run. A finished request is never marked `interrupted`. |
| Which stores | Filesystem, SQLite and Postgres. On the in-memory stores the record and registry die with the process, so nothing is left to mark. |
| `client.requests.interrupted({ staleThresholdMs? })` | Has the server sweep, then lists every interrupted request of the user: `{ id, flow, sessionId?, flowKind, actionName, interruptedAt }`. Earlier results appear on every call until continued or removed. `staleThresholdMs` can only raise the host's threshold. |
| A request queued on an external runner | Never marked until `queuedGraceMs` (default 600,000 ms) passes. |

| Choice | What it does |
|---|---|
| Continue: `RequestHandle.continue()`, or `POST /:flowKind/sessions/:sessionId/requests/:requestId/continue` | Keeps the request id, replays the item log, injects every finished block and runs the in-flight step again, so a side effect inside it can fire a second time. Writes one `continuation` item and no `suspension_resume`. A step that is a gate nobody resolved pauses again. |
| Refusals | `409` unless the status is `interrupted` (it says to use `/resume` for a suspended request and `/retry` for a fresh run), `400` for a session or flow mismatch, `404` for a source that is not re-enterable, `409` for a dynamic scheduled dispatch, and `409` "Concurrent continuation in progress" when another resume or continue is already running on the request. |
| Discard: `RequestHandle.abort()`, or `POST /api/flows/:flowKind/requests/:requestId/abort` (`useSession().abortRequest()` in React) | With no gate holding the request, ends it `aborted` and removes it from the interrupted list. HTTP `204`. |
| Retry | A new request id. See above. |

What `fsdev run` and `fsdev chat` print and return for a paused request, and where they say to answer it: [CLI](./cli.md).

## Stopping a paused request

| Case | Behavior |
|---|---|
| `RequestHandle.abort()` on a request paused at a gate | Resolves the gate `stopped` and ends the request `aborted` before any block runs. A later approve is `409` `has already been resolved`. Needs durable execution. Without it, a parked request answers as a finished one: `409` `Request "<id>" is already in terminal state "<status>"`. |
| A stop that loses a race to an answer | `409` `Request "<id>" was resumed before the stop reached it; stop it again to stop the running turn`. The turn runs on. |
| A stop after an answer the turn never ran past | The stop wins. The gate is re-recorded `stopped`, the request ends `aborted`, and the approved step never runs. |
| The process dies after a stop is recorded | The sweeper ends the request. |
| A turn parked on a wait | Cancels the task it waits on. A run already started on it goes on and its result is discarded. |
| `RequestHandle.abort()` on a request running in another process with no browser | Stops within one `heartbeatIntervalMs` tick (default 10 seconds) and needs a request store shared across processes. |

## Under a concurrency policy

How each policy treats a resumed request, what the resume call returns, and what happens when the wait for a turn fails: [Concurrency policies](./concurrency.md#requests-that-pause-and-resume).

## Retention and cleanup

### Suspension records

The record's fields, who owns it, who sees it and where it is stored: [Stores](./stores.md).

| Fact | Detail |
|---|---|
| `status` | `pending`, or one of `approved`, `rejected`, `submitted`, `skipped`, `timed_out`, `expired`, `stopped` or `cancelled`. Only `pending` can be answered. |
| `timed_out` | Never written. A gate past its deadline reads `expired`. |
| `provider.listSuspended(filter)` | The filter takes `flowKind`, `userId`, `sessionId`, `status`, `limit`, `createdBefore` and `resolvedBefore`. |

### How long a paused run is kept

| Question | Answer |
|---|---|
| How long is a paused run kept? | A pause with no deadline stays `pending`, and the request stays `suspended`, until someone answers, stops or cancels it. Nothing ages it out: age-based pruning never touches the checkpoints of an `in_progress` or `suspended` request, and a pending suspension is not a terminal status, so pruning skips it. A pause survives a restart on SQLite, Postgres and the filesystem store. On the in-memory stores a pause is refused unless `durable: true`. |
| What happens to a pause nobody resolves? | With no deadline, nothing: it waits. With one (`timeoutMs`, `deadline`, or the host's `userDeadlineMs`), a running server's sweeper expires it at the deadline. What happens next depends on the gate, in the table below. |
| Whose server expires it? | One that serves the routes (`fsdev dev`, `fsdev serve`, a self-hosted server). A one-shot `fsdev run` sweeps nothing. A server reads pending deadlines when it starts, so a gate `fsdev run` left behind expires on time once a server runs. A gate that passed its deadline while no server ran expires as soon as one starts. |
| Can a late answer land? | The resume and answer routes check `expiresAt` too and mark the gate `expired` (`410`), so an expired gate is not answerable between sweeps or with retention off. |
| What does a completed request leave? | Its suspension records are deleted, with no setting. Checkpoints stay unless `flow.request.cleanupCheckpointsOnTerminal` is `true` (default `false`). Failed and aborted requests keep their suspension records. |

At the deadline:

| Gate | What happens |
|---|---|
| An approval | Continues as a rejection marked `expired`. |
| A review or an input, including a raw `user_input` gate | Continues with `SuspensionTimeoutError`. |
| A custom gate that allows `reject` | Continues as an approval does. |
| A custom gate that allows no `reject` | Marked `expired`. The resume route answers `410`. |

Pruning is off unless the host sets `durabilityRetention`. Its fields and defaults are in [Runtime configuration](./runtime.md).

Each sweeper tick, whether or not retention is on:

| Step | What it does |
|---|---|
| Enforce expiry | Marks a `pending` suspension past `expiresAt` as `expired`. For an approval, a custom gate that allows `reject`, and a user's review or input, it also continues the request in the same tick, as above. |
| Finish what a crash cut short | Continues a request that is `suspended` or `interrupted` behind a gate already resolved (answered, expired, stopped or cancelled). It never runs at the same time as a resume of that request. |
| Finish a stop | Ends a request whose stop was recorded while it ran and which then paused. |
| Fire due wakes | See [Background work](./background-work.md). |
| Prune, with retention on | Resolved suspensions past `suspensionTerminalMaxAgeMs`, checkpoints of terminal requests past `checkpointMaxAgeMs`, and an interrupted request's checkpoints past `orphanCheckpointThresholdMs`. |

Which host sweeps on a shared store, and when a router runs the sweeper: [Runtime configuration](./runtime.md).

### Whether a host is durable

| `durable` on `createFlowState` | Persisting stores (filesystem, SQLite, Postgres) | In-memory stores |
|---|---|---|
| Not set | On | Off |
| `false` | Off | Off |
| `true` | On | On |

Defaults per command and store, the providers `createFlowApiRouter` and `runAction` need, and `createCheckpointDurabilityProvider`: [Runtime configuration](./runtime.md). A sequencer's `durable` option: [Blocks](./blocks.md). The methods of a `DurabilityProvider`: [Stores](./stores.md).

## Errors

| Error | Raised by | Catchable | Fields |
|---|---|---|---|
| `SuspensionError` | `ctx.suspend()` on first reach | No. Rescue handlers do not fire for it. Do not catch it in a block. | `suspensionId`, `reason`, `kind?`, `title?`, `data?`, `resumeSchema?`, `render?`, `timeoutMs?`, `allow` |
| `SuspensionTimeoutError` | A user's review or input at its deadline | Yes. Uncaught, it fails the request. The block runs again from its top, so work before the call happens again. Finished earlier steps are not run again. | `suspensionId`. Message `Suspension <id> timed out`. |

| Error | Raised by | Fields |
|---|---|---|
| `RouteUnavailableError` | A router resume where the selector picks differently ([Routers](#routers)) | `routerName`, `recordedRoute`, `reselectedRoute`, `recordedRouteDeclared` |
| `GeneratorToolUnavailableError` | A generator resume where the paused tool is missing from the resolved tool set | `details.toolName` |
| `RecordedValueOmittedError` | A resume of a finished block whose output was over the record limit | `details.blockName`, `details.bytes` |

`SuspensionRejectedError`, raised by a reject, an expired gate or a cancel, is in [Errors](./errors.md). `RouteUnavailableError`, `GeneratorToolUnavailableError` and `RecordedValueOmittedError` are fatal, with `retryable: false`.

| A resume that fails | Result |
|---|---|
| Before the request goes `in_progress`: the record is unreadable, the flow is unregistered, or the checkpoint or replay build throws | The request stays `suspended`, the gate `pending`, so the same resume can be sent again. |
| After that | A durable `failed`. |

## Related

| Page | What it covers |
|---|---|
| [HTTP API](./http-api.md) | The resume and answer endpoints, their checks and status codes. |
| [Items and the stream](./items.md) | Items across a pause and resuming a stream. |
| [Concurrency policies](./concurrency.md) | What a second request on one session does, and a resumed request under each policy. |
| [Stores](./stores.md) | The stores that hold requests, checkpoints, suspensions and wakes. |
| [Runtime configuration](./runtime.md) | Retention, sweeper and durability settings. |
| [Errors](./errors.md) | The shape of an error the client receives. |
| [CLI](./cli.md) | `fsdev run`, `fsdev chat` and `fsdev dev`. |
