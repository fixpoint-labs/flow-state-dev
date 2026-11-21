---
title: Errors
type: reference
description: "What a client receives when a block throws, every error code and which are retryable, what is recorded and where, which errors are retried, and the hooks that run on failure."
---

# Errors

A request is one run of an action. It fails when a block in it throws, or when the input it was given is refused. Whatever was thrown, the client receives the same thing: one `error` item with a code, a message and optional details, and a stored request record that says `failed`. The code tells a screen or a monitoring tool what kind of failure it was. The thrown error, as a `FlowError`, also has a `retryable` flag. The `error` item does not carry it; the retry mechanisms below and `errorCapture` read it. [When something fails](../concepts/when-something-fails.md) explains where a throw goes and how a flow catches it.

The examples use the `support` flow. Its `handleTicket` action runs `lookUpOrder`, a block that throws when the order service is down.

```ts title="src/flows/support/blocks/look-up-order.ts"
import { z } from "zod";
import { FlowError, handler } from "@flow-state-dev/core";

export const lookUpOrder = handler({
  name: "look-up-order",
  inputSchema: z.object({ orderId: z.string() }),
  retry: { maxAttempts: 3, baseDelayMs: 200 },
  execute: async (input) => {
    const res = await fetch(`https://orders.example.com/${input.orderId}`);
    if (!res.ok) {
      throw new FlowError("Order service unavailable", {
        code: "orders_unavailable",
        retryable: res.status >= 500,
        details: { status: res.status },
      });
    }
    return res.json();
  },
});
```

`retry` is the block's retry policy; its fields are in [Retry](#retry). When all three attempts fail, the client gets this item and a request that ends `failed`:

```json
{
  "type": "error",
  "status": "failed",
  "message": "Order service unavailable",
  "code": "orders_unavailable",
  "details": { "status": 503 }
}
```

## What the client receives

| Field of the `error` item | Value |
|---|---|
| `type`, `status` | `"error"`, `"failed"` |
| `message` | The thrown error's `message`, unchanged, for any thrown value. |
| `code` | The thrown `FlowError`'s `code`. Anything else, and a `FlowError` with no code, gets `execution_error`. |
| `details` | Present only when the thrower set some, or the error has a cause. Passed through as set. |
| Stack | Never sent. |

The item reaches the client before the stream's `failed` status event. It never enters the model's history. It carries no block name; the block's name is on the error the hooks and `errorCapture` receive.

`details.cause`, when the error has a cause, is a serialized chain. Each level has `name` and `message`, plus `code` when the cause has a string code (`ECONNRESET`), and a nested `cause` for each deeper level, to five levels. For a plain `throw new Error(...)`, `details.cause` describes that error's own `cause`. A thrower's own `details.cause` is kept as it is.

### The shapes by failure

| Failure | `code` | `retryable` | `details` |
|---|---|---|---|
| A plain `throw new Error(...)` | `execution_error` | `false`, as hooks, `errorCapture` and BullMQ read it. A block retry policy retries it anyway; see [Which errors are retried](#which-errors-are-retried). | `cause` only |
| A block's input or output refused by its schema | `execution_error` | `false` | none. Message: `Block "<name>" input validation failed at "<path>": <issue>`, or `output validation failed` for the output, first issue only. When the input is refused, `execute` does not run. The error is recorded on the block's `block_trace` item. |
| The action's input refused, before any block runs | `validation_error` | `false` | none. Message: `Action input validation failed at "<path>": <issue>`. No block ran, so there is no `block_trace` row. |
| A generator's output fails its `outputSchema` | `output_validation_error` | `false` | `rawOutput` (the model's text as it arrived), `issues` (Zod issues), `phase` (`"stream"` if caught mid-stream, `"final"` after the model finished) |
| A sequencer's returned value fails its declared `outputSchema` | `sequencer_output_schema_error` | `false` | `sequencerName`, `lastStepName`, `rawOutput`, `issues` |
| An AI SDK error from a model call | `rate_limit_error`, `context_length_error`, `timeout_error`, `provider_unavailable_error` | see Codes | the original error as `cause` |

Action-input refusal does not make `send` reject. The request is accepted, settles `failed`, and carries the `validation_error`. An unknown action name is not a failed request: the call rejects with `Flow "<kind>" does not define action "<name>"`, and no record or `error` item is written. The HTTP status for a refused route is on [HTTP API](./http-api.md).

### What does not fail the request

| Case | What happens |
|---|---|
| A tool a generator called throws | The model is handed `Tool "<name>" failed: <message>` and the run continues. The call is recorded as a `tool_output` item with `status: "failed"` and `error: { message, code?, details? }`. |
| A tool call that suspended | Recorded `failed` with `error.code` `"SUSPENSION"`. It is a pause, not a failure. |
| A failure a `.rescue()` handled | No `error` item, no `final` event to [`errorCapture`](#errorcapture), no request-level `onErrored` hook. The block's own `onErrored` runs before the rescue. |
| A step in `.sideChain()` that throws | The main chain goes on. |
| A cancelled request | Ends `aborted` with an aborted message and no `error` item. A dropped connection ends it `interrupted`. |

### A hook that throws after the action returned

If an `onCompleted` hook throws after the action has returned, the request fails with the hook's error and keeps the action's return value as `output`. The request's result, as `handle.result()` returns it, is:

```json
{ "error": { "code": "execution_error", "message": "hook fail" }, "output": "fine" }
```

### What the record keeps

The stored request holds `status: "failed"`, `failedAtMs`, and `result.error = { code, message }`. `details` and `cause` are on the stream's `error` item, not in the record. The client reads the record as `SessionRequestResult.error` through `handle.result()` or the session's request list. `result` can be absent on a failed request, so guard it with `== null`.

Calls that fail before a request exists reject instead of producing an item or a record. Which calls, and the classes they reject with, are on [Authentication and tenancy](./authentication.md).

## `FlowError`

Throw a `FlowError` to choose the code and say whether the failure is retryable. It is exported from `@flow-state-dev/core`.

```text
new FlowError(message, { code?, retryable?, details?, cause? })
```

| Option | Meaning |
|---|---|
| `code` | Any string. Defaults to `execution_error` on the client. |
| `retryable` | Defaults to `false`. Read by block retry, the BullMQ job processor and `errorCapture` consumers. |
| `details` | Anything serializable. Sent on the `error` item as set. |
| `cause` | The error that led to this one. Serialized into `details.cause`. |

`FlowError.isInstance(err)` matches by `instanceof`, or by name for a copy of the class from another bundle. `blockName`, `blockInstanceId` and `scope` are filled in by the runtime; do not set them. `scope` is `"block"` for a block failure and `"request"` for a request-level one.

## Codes

The client sees `code` on the `error` item and on `result.error`. The runtime raises the codes below. Match them on `code`. These classes can be imported:

| Class | Import from |
|---|---|
| `FlowError`, `OutputValidationError`, `SequencerOutputSchemaError`, `SequencerSchemaMismatchError`, `StrictSchemaError`, `SuspensionError`, `SuspensionRejectedError`, `SuspensionTimeoutError`, `RouteUnavailableError`, `RecordedValueOmittedError` | `@flow-state-dev/core` |
| `UnresolvedIntentError` | `@flow-state-dev/core/errors/unresolved-intent-error` |
| `ConcurrentModificationError` | `@flow-state-dev/engine` |
| `OrgRequiredError`, `RequestOwnerMismatchError`, `UserBindingMismatchError`, `StoreSubscriptionError` | `@flow-state-dev/engine/host` |

### Your blocks and their schemas

| Code | When | `retryable` |
|---|---|---|
| `execution_error` | Anything thrown with no code of its own. | `false` |
| `validation_error` | Action input refused. An unknown action throws it too, but the call rejects and no request is recorded. | `false` |
| `output_validation_error` | A generator's output fails its `outputSchema`. | `false` |
| `sequencer_output_schema_error` | A sequencer's value fails its declared `outputSchema`, on any exit path. | `false` |
| `sequencer_schema_mismatch` | `.validate()` at build time finds the declared and inferred output disagree (`details`: `sequencerName`, `declaredKind`, `inferredKind`, `reason`), or a child block's `sequencerStateSchema` disagrees with the sequencer's `stateSchema`. See [Router, target and sequencer-state errors](#router-target-and-sequencer-state-errors). | `false` |
| `strict_schema_error` | A generator's `outputSchema` uses a construct strict structured output rejects. Raised when the generator is built. | `false` |

### Models and tools

A thrown AI SDK error is classified by its status or message unless it is already a `FlowError` or the thrower set a code. The original stays on `cause`.

| Code | When | `retryable` |
|---|---|---|
| `rate_limit_error` | Status 429. | `true` |
| `timeout_error` | Status 408 or 504, or a timeout message. | `true` |
| `provider_unavailable_error` | Any other status 500 or above. | `true` |
| `context_length_error` | A message matching context length. | `false` |

The framework's own tools raise these codes too. `unresolved_intent` (`false`) is raised when a generator names a model `intent/<name>` and the app has no mapping for that name and no default model; see [Models](./models.md). The `fetch` tool's `fetch_http_error`, `fetch_transport_error`, `fetch_blocked_url` and `fetch_provider_error` are on [Tools](./tools.md).

### State and resources

| Code | When | `retryable` |
|---|---|---|
| `concurrent_modification` | A version-checked write lost. `details.attempts`. An in-memory scope never raises it. | `true` |
| `resource_deleted` | A resource write reaches a deleted key. `details.resourceKey`. | `false` |
| `resource_already_exists` | A create-if-absent write loses its race. `details.resourceKey`. | `false` |

### Resume

| Code | When | `retryable` |
|---|---|---|
| `route_unavailable` | A resumed router's recorded route is gone, or its selector chose differently. | `false` |
| `generator_tool_unavailable` | A resumed generator's pending tool is missing from its tool set. `details.toolName`. | `false` |
| `RECORDED_VALUE_OMITTED` | A resume needs a block's or tool's recorded output that was over `maxRecordedValueBytes` and was stored as a placeholder. Return less from that block; see [Pause, resume and replay](./durable-execution.md). `details`: `blockName`, `bytes`. | `false` |

### Setup

| Code | When | `retryable` |
|---|---|---|
| `ambiguous_block_name` | A block name resolves to more than one block. | `false` |
| `flowstate_config_error` | `createFlowState` configuration refused. | `false` |
| `flowstate_disposed_error` | `getRouter()` or `ready()` called after `dispose()`. | `false` |
| `store_subscription.<subCode>` | A store's event subscription failed. | `false` |

Starting background work in a process that has no runtime host throws `NoRequestHostError`, which is not a `FlowError`. `fsdev run` with no config is one such process. [Background work](./background-work.md) covers the code and what the client sees.

### Pause signals

`SuspensionError`, `SuspensionRejectedError` and `SuspensionTimeoutError` are how a block pauses and how a pause ends. A pause is not a failure, and no `.rescue()` handler fires for the signal. What a rejected or expired pause does is on [Pause, resume and replay](./durable-execution.md).

## Block hooks, rescue and retry

These are set on a block's config, or with `.rescue()`. The action and request hooks are on [Flows and actions](./flows.md).

### `onCompleted` and `onErrored`

| Hook | Called with | Fires | If it throws |
|---|---|---|---|
| `onCompleted` | `(output, ctx)`. A generator's gets a third argument, `meta`, whose `meta.model` is the resolved `ModelIdentity`. | After the output check succeeds, and not on a failed block. Under a retry policy, only for the attempt that succeeded. | The block fails, and `onErrored` runs next. |
| `onErrored` | `(error, ctx)`, the thrown error as an `Error`. | On any throw from the block: the connector, either schema check, `execute` or `onCompleted`. It also runs when the block throws a suspension signal. Under a retry policy, once per failed attempt. Before a rescue handler of the same block runs. | Ignored. The original error stands. |

`.connectOutput(fn)` drops `onCompleted`. A sequencer has neither hook.

### Rescue

`rescue: [{ when?: ErrorClass[], block }]` on a config, or `block.rescue(handlers)`.

- The first handler whose `when` matches runs, with the thrown error as its input. Its output replaces the throw, and the chain continues.
- A handler with no `when`, or an empty one, matches any error.
- A suspension signal is never rescued.
- `ctx.wasRescued(block)` reports afterwards whether a handler recovered the block.
- On the action's block, retries run first. Rescue fires after the last attempt, or at once for a non-retryable error.

### Retry

`RetryPolicy = { maxAttempts?, baseDelayMs?, maxDelayMs?, retryableErrors? }`.

Where a policy comes from, and how it combines with rescue:

| Rule | Detail |
|---|---|
| Where it is read | Only on the action's block. A block used as a step, a route or a tool runs once whatever its `retry`. A generator used as a tool is retried only by `tools.defaults.retry`. If the action's block is a sequencer, a `retry` on a step inside it is not read, and the run's policy retries the whole sequencer. |
| The run's policy | The `retry` option of `runAction`. No HTTP or host option sets it. |
| Merge | The block's fields override the run's, per field. `{ maxAttempts: 4 }` over `{ baseDelayMs: 100, maxAttempts: 2 }` gives `{ maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 5000 }`. |
| With rescue | Retries are used up first. Then a `rescue` on the action's block fires. |

How the attempts run:

| Rule | Detail |
|---|---|
| Defaults once a policy exists | `maxAttempts` 1 (a lower value becomes 1), `baseDelayMs` 0, `maxDelayMs` 5000 (never below `baseDelayMs`), `retryableErrors` unset. With neither a block nor a run policy there is no retry. |
| Backoff | The delay before retry *n* is `baseDelayMs × 2^(n−1)`, capped at `maxDelayMs`. No jitter. |
| Per attempt | Each failed attempt runs the block's `onErrored` and raises `ctx.attempt` (0-indexed). `ctx.idempotencyKey` is the same across attempts. |
| Logging | A `warn` log, `[flow-state] block execution retry scheduled`, before each retry that will happen, and not before the last failure. |
| Cancel | A cancel before the first attempt, during a backoff wait or during an attempt ends the loop with `Error("Retry aborted")`. |

### Router, target and sequencer-state errors

| Failure | What is thrown |
|---|---|
| A router's `execute` returns a block that is not one of its `routes`, by object or by name | A plain `Error`, so the client sees `execution_error`: `Router "pick-replier" selected invalid route "refund-bot". Route must be one of declared candidates.` A `validateRoute` on the router replaces the check. |
| `ctx.targets.<name>` or `ctx.getTarget(name)` finds more than one ancestor with the name | `AmbiguousBlockNameError`, `ambiguous_block_name`, `retryable: false`: `getTarget("<name>") is ambiguous from block instance "<nearest instance id>". Matching instances: <id>, <id>`. Siblings never raise it. |
| A write through a target whose block declares no `stateSchema` | `Target "<name>" does not expose instance state operations.` |
| A child's `sequencerStateSchema` disagrees with the sequencer's `stateSchema` on a field's kind | `SequencerSchemaMismatchError`, `sequencer_schema_mismatch`, `retryable: false`: `Sequencer state conflict at "<sequencer>": block "<child>" requires a different state field "<key>": declared ZodString but a block requires ZodNumber`. It throws when the sequencer or router that carries the requirement is built, at `.step()` or `router()`, before `defineFlow`. |

## Which errors are retried

Each mechanism below has its own policy.

| Mechanism | Retried automatically | Details |
|---|---|---|
| A block's `retry` policy | Only when the policy sets `maxAttempts` above 1, and then any error except a `FlowError` with `retryable: false`. | [Retry](#retry), [Sequencer methods](./sequencer-methods.md) |
| A tool's retry | Only when `tools.defaults.retry` is set on the flow. | [Generators](./generators.md) |
| The model call | Yes, per model, then the next model in the group. | [Models](./models.md) |
| A BullMQ job | Yes, up to `attempts` (default 3), unless the failed result is marked `retryable: false`. A plain throw is marked `false`, so that job fails at once with no retry. | [Background work](./background-work.md) |
| The retry route | Never. `handle.retry({ input? })` re-runs a `failed` or `interrupted` request as a new request with a new id, and the response names the old one in `retryOf`. The original record stays `failed`. A request that is `in_progress` answers `409`. A caller who does not own the request gets `404`, the same answer as an unknown id. Only a request that arrived over `http`, `mcp` or `scheduled`, or a source the host names, can be re-run. | [HTTP API](./http-api.md), [React](./api/react.md) |

A block's retry policy looks at the error as thrown. It retries any error except a `FlowError` with `retryable: false`, a suspension signal, or, when the policy sets `retryableErrors`, an error outside those classes. A plain `Error` is not a `FlowError`, so it is retried, and so is a block whose input fails its schema. The runtime then wraps a plain error as a `FlowError` with `retryable: false`, and that is the flag BullMQ and `errorCapture` read: BullMQ fails the job at once. Throw a `FlowError` with `retryable: true` when a job should be retried.

## What is captured and where

A failed request leaves the parts below. Who can read them, and which stores keep them across a restart, is on [Stores](./stores.md).

| Part | Stored in | How many |
|---|---|---|
| The outcome: `status: "failed"`, `failedAtMs`, `result.error = { code, message }`, and `result.output` when the action had returned first | The request record | One per request. A retry writes a new request, and the old one remains `failed`. |
| The `error` item | The record's `items`, and the request's stream | One per failed request |
| Items emitted before the throw | The record's `items` | As many as the run emitted |
| The failed block's `block_trace` row (`status: "failed"`, `error: { message, code?, details? }`) | The request's trace items. A client gets them with `includeTrace: true`. | One row per block run |

### `errorCapture`

`errorCapture` is a callback for sending failures to a monitoring tool. It is off until set.

```ts title="src/lib/report-error.ts"
import type { ErrorCaptureEvent } from "@flow-state-dev/engine";

export function reportError(event: ErrorCaptureEvent) {
  if (!event.final) return; // one report per failed request
  console.error(event.flowKind, event.actionName, event.error.code, event.error.message);
}
```

Pass it as `createFlowState({ errorCapture: reportError })`. Where else the option goes, and what a throwing callback does, is on [Runtime configuration](./runtime.md).

An event has the fields below.

| Field | Meaning |
|---|---|
| `error` | The normalized `FlowError`. For a wrapped plain throw, the raw value is on `error.cause`. |
| `requestId`, `flowKind`, `actionName`, `userId` | The request's identity. |
| `sessionId?`, `orgId?` | Set when the request has them. |
| `final?` | `true` on the request's one summary event. |
| `transient?` | `true` for a high-frequency block such as a poll loop, so an adapter can down-sample. It does not mean the failure was rescued or retried. |

Block-level fields, set on per-block events:

| Field | Meaning |
|---|---|
| `blockName?`, `blockKind?` | The leaf block that threw. Absent when no block threw. |
| `blockPath?` | The block's structural path, such as `root/step[0]`. The same across attempts. |
| `blockInstanceId?` | `<requestId>:<blockPath>:<attempt>`. Differs per attempt. |
| `attempt?` | 0-indexed attempt of the failing block. Always set on the action's root block; on a nested block, only under a retry policy. |
| `scope?` | `"block"` on a per-block event, `"request"` on the final event. |

`error.retryable` is the failure type's flag. It does not say the runtime will retry.

| When | Events |
|---|---|
| A block throws | One event for the leaf block. The sequencers and root block above it that re-throw the same error fire nothing. |
| A block fails under a retry policy | One event per failed attempt, with its `attempt`. A block that recovers on a later attempt reports the attempts that failed and no final event. |
| A failure a `.rescue()` recovers | The per-block event, and no `final`. |
| A request settles `failed` | One more event with `final: true` and `scope: "request"`, after the failed record is written and before the `failed` status event and the `onErrored` hooks. It names the leaf block when one threw. |
| Input refused before any block, or a setup failure on a fresh request | The `final` event only, with no block name. |
| A hook that throws | An event for the hook block. A failure-path hook (`action.onErrored`, `request.onErrored`, or `request.onFinished` after a failure) leaves the request's outcome unchanged. A success-path hook (`request.onStarted`, `action.onCompleted`, `request.onCompleted`, or `request.onFinished` after success) fails the request with the hook's error, and a `final` event follows. |

A call that rejects before a request exists fires nothing. Forwarding every event reports a failed request twice, once for the leaf and once as the final event. Forward only `event.final` for one report per failed request, or skip `event.final` to report each failing block.

## Hooks

Hooks that run when a request fails are documented where each is declared. Their order, what each receives and what they cannot change are there too.

| Hook | Declared on | Details |
|---|---|---|
| Action `onErrored` | An action in `defineFlow({ actions })` | [Flows and actions](./flows.md) |
| Request `onErrored` and `onFinished` | `defineFlow({ request })` | [Flows and actions](./flows.md) |
| Block `onErrored` | The block's config | [`onCompleted` and `onErrored`](#oncompleted-and-onerrored) |
| `onToolErrored` | `defineFlow({ tools })` | [Generators](./generators.md) |
| `errorCapture` | `createFlowState` | [`errorCapture`](#errorcapture), above |

## Next

- [When something fails](../concepts/when-something-fails.md): where a throw goes, how a step catches it, and the hooks that report it.
- [Items and the stream](./items.md): every item type, including `error`, and who sees each.
- [HTTP API](./http-api.md): the status codes a refused route returns.
- [Pause, resume and replay](./durable-execution.md): what survives a restart, and how a suspended request resumes.
