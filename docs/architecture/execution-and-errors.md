# Execution and Errors

The execution runtime orchestrates block dispatch, retry policies, rescue boundaries, work queues, and lifecycle hooks. This document covers how blocks run and how errors are handled.

## Execution Model

The runtime is responsible for:

1. Invoking blocks via `block.run(input, ctx)`
2. Applying kind-specific lifecycle seams
3. Maintaining block/step provenance
4. Emitting stream items and events
5. Applying retry policies
6. Enforcing rescue boundaries
7. Managing the work queue and convergence
8. Firing request lifecycle observers

## Block Dispatch

All blocks execute through the same entry point:

```ts
async function executeBlock<TInput, TOutput>(
  block: BlockDefinition<TInput, TOutput>,
  input: TInput,
  ctx: ExecutionContext
): Promise<ExecutionResult<TOutput>>;
```

The framework calls `block.run(input, ctx)` which handles input/output validation, retry, and lifecycle hooks internally. **Never call `block.config.execute` directly** — that's for framework internals only.

### Kind-Specific Behavior

**Handler:**
1. Run `validateChunk` (if present)
2. Execute user-provided `execute` function
3. Emit `block_output` item (internal/devtools)
4. Fire `onCompleted`/`onErrored` observers

**Generator:**
1. Assemble prompt/context/history/user messages
2. Resolve model via `ctx.resolveModel(modelId, blockName)`
3. Run tool loop until `outputSchema` is satisfied (or repair fails)
4. Emit items: reasoning, message (streaming), tool call block_outputs, final block_output
5. Return parsed `outputSchema` output

**Sequencer:**
1. Execute DSL steps in order
2. Maintain per-sequencer runtime state
3. Support rescue boundaries and work queue
4. Each step executes via `step.run(stepInput, ctx)`

**Router:**
1. Call router `execute(input, ctx)` to select a block
2. Execute selected block via `selected.run(input, ctx)`

## Error Model

All errors are normalized to `FlowError`:

```ts
type FlowError = Error & {
  code: string;
  retryable: boolean;
  blockName?: string;
  blockInstanceId?: string;
  scope?: "request" | "work" | "resource" | "block";
  cause?: unknown;
  details?: Record<string, unknown>;
};
```

### Error Types

| Error | Retryable | When |
|-------|-----------|------|
| `ValidationError` | No | Schema validation failure |
| `NetworkError` | Yes | Network connectivity issues |
| `TimeoutError` | Yes | Operation exceeded timeout |
| `RateLimitError` | Yes | Provider rate limit hit |
| `ModelError` | Yes | Model provider error |
| `ToolExecutionError` | Varies | Tool block execution failure |
| `AmbiguousBlockNameError` | No | Block name resolution conflict |
| `ConcurrentModificationError` | Yes | CAS contention exhausted |

Non-Error thrown values are automatically normalized to `FlowError`.

## Retry Policy

Retry is configured per-block with precedence:

1. Block-level retry (highest)
2. Sequencer/runtime default
3. App-level fallback

```ts
type RetryPolicy = {
  maxAttempts?: number;      // default varies by error type
  baseDelayMs?: number;      // exponential backoff base
  maxDelayMs?: number;       // backoff cap
  retryableErrors?: Array<new (...args: any[]) => Error>;
};
```

**Defaults:**
- Non-retryable: validation errors, schema failures, deterministic input failures
- Retryable: network/timeout/rate limit/transient model failures

## Rescue Boundaries

Rescue handlers catch failures from prior steps in a sequencer and route them to recovery blocks:

```ts
pipeline
  .then(riskyBlock)
  .rescue([
    { when: [NetworkError], block: fallbackBlock },
    { when: [ModelError], block: retryWithDifferentModel },
    { block: catchAllBlock },  // fallback handler
  ]);
```

**Behavior:**
- Handlers match by error type (checked in order)
- Rescue success converts the segment back to a successful chain state
- Rescue failure propagates to the next matching handler or bubbles up
- Rescue boundaries only handle failures from steps **before** them in the sequencer

## Work Queue

The work queue enables non-aborting side-chain execution:

```ts
pipeline
  .then(mainProcessing)
  .work(analyticsBlock)        // queued, won't abort main chain
  .work(notificationBlock)     // queued, won't abort main chain
  .then(nextMainStep)
  .waitForWork({ failOnError: false });  // wait for work, keep failures non-terminal
```

**Semantics:**
- `.work(block)` — queues side-chain execution, non-aborting by default
- `.waitForWork({ failOnError: false })` — waits for work, failures are non-terminal
- `.waitForWork({ failOnError: true })` — promotes any work failure to terminal request error
- Work failures emit `step_error` items and trigger `onStepErrored` observers

## Generator Repair

When generator output doesn't match `outputSchema`, the repair system handles it:

| Mode | Behavior |
|------|----------|
| `auto` (default) | Retry schema repair up to `maxAttempts`, then fail |
| `rescue` | Skip repair, throw into rescue/error routing immediately |
| `fail` | Immediate terminal failure on first mismatch |

```ts
generator({
  name: "structured-output",
  outputSchema: mySchema,
  repair: { mode: "auto", maxAttempts: 3 },
});
```

## Runtime Logging

Server runtime execution emits structured logs at action and block boundaries:

- Action lifecycle: started, completed, failed
- Block lifecycle: started, completed, failed
- Retry lifecycle: each scheduled retry with attempt + delay

Each entry includes request/action/block identity fields and summarized payloads (bounded strings) so logs remain readable for large outputs while preserving debugging signal.

You can override the sink by passing `logger` to `runAction` or `executeBlock`; by default logs go to the console (disabled in test environments).

## Request Lifecycle

The full request execution sequence:

```
1. Resolve flow instance and action
2. Validate action input
3. Resolve/create session
4. Require user context
5. Create request scope
6. Emit user message item (if userMessage defined)
7. Fire request.onStarted
8. Execute action root block
   ├─ Success path:
   │   ├─ Fire action.onCompleted
   │   ├─ Fire request.onCompleted
   │   └─ Fire request.onFinished
   └─ Error path:
       ├─ Fire action.onErrored
       ├─ Fire request.onErrored
       └─ Fire request.onFinished
9. Persist state, emit terminal stream status
```

**Guarantees:**
- `onCompleted` fires only on terminal success
- `onErrored` fires only on terminal failure
- `onFinished` fires always
- `onStepErrored` fires for non-terminal step/work failures (visibility hook)

## Error-to-Item Mapping

| Error Type | Stream Result |
|------------|---------------|
| Terminal request error | `error` item + `request.failed` |
| Recoverable step error | `step_error` item (`recovered: true`) |
| Work queue failure | `step_error` item + `onStepErrored` observer |

## Canonical Authority

For full type signatures, execution pseudocode, and edge cases, see `../preperation/architecture/EXECUTION_AND_ERRORS.md`.
