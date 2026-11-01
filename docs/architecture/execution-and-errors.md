# Execution and Errors

The execution runtime orchestrates block dispatch, retry policies, rescue boundaries, side chains, and lifecycle hooks. This document covers how blocks run and how errors are handled.

## Execution Model

The runtime is responsible for:

1. Invoking blocks via `block.run(input, ctx)`
2. Applying internal [execution seams](internal-execution-seams.md) at block dispatch boundaries
3. Applying kind-specific lifecycle seams
4. Maintaining block/step provenance
5. Emitting stream items and events
6. Applying retry policies
7. Enforcing rescue boundaries
8. Managing side chains and convergence
9. Firing request lifecycle observers

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
3. Emit `block_trace` item (internal/devtools)
4. Fire `onCompleted`/`onErrored` observers

**Generator:**
1. Assemble prompt/context/history/user messages
2. Resolve model via `ctx.resolveModel(modelId, blockName)`
3. Run the tool loop until `outputSchema` is satisfied (or repair fails). **Who drives the loop depends on the model (FIX-814):** when the resolved `GeneratorModel` implements the optional single-step methods (`generateStep` for the non-streaming path, `streamStep` for streaming), **FSD owns the multi-step loop** — one provider model call per step, framework tools passed *without* `execute` so the framework runs them itself (concurrently for same-step calls, via the same executor/cache/retry/`tool_output` path as before), one assistant message per step (raw provider response messages when the adapter surfaces them, so reasoning/thinking parts round-trip; constructed from the step's tool calls otherwise) plus one tool-result message per call appended between steps, per-step usage summed into the block aggregate. Each path is chosen on its own: a streaming turn gets the owned loop only through `streamStep`, and a non-streaming turn only through `generateStep`. How text from different steps is combined differs by path, output kind and resume; blocks.md → Output Behavior → "Text across steps" states it for each. Models *without* the step methods (hand-rolled test mocks, older custom adapters, and `createFallbackModel` groups none of whose candidates has them) keep the legacy SDK-driven multi-step path unchanged (`generate({ maxSteps })`). The built-in AI-SDK adapter is step-capable, so a generator on a single concrete model gets the FSD-owned loop. Loop ownership is the substrate for in-loop suspension (a tool's `ctx.suspend()` reaching the framework instead of being swallowed by the SDK) — suspension support itself lands separately and requires a step-capable model.
4. Emit items: reasoning, message (streaming), tool_output per tool invocation, and the block_trace lifecycle (added → updated → done)
5. Return parsed `outputSchema` output
6. Fire `onCompleted(output, ctx, meta)` / `onErrored(error, ctx)` observers — `meta` carries `{ model: ModelIdentity }` for generators

**Sequencer:**
1. Execute DSL steps in order
2. Maintain per-sequencer runtime state
3. Support rescue boundaries and side chains
4. Each step executes via `step.run(stepInput, ctx)`

**Router:**
1. Call router `execute(input, ctx)` to select a block. Route names must be unique per router (validated at build) — the durable `router_decision` records a bare route name, so duplicates would make resume ambiguous.
2. On same-request continuation (FIX-814), validate the fresh selection against the recorded `router_decision` for the router's logical path. Re-running `execute` (rather than skipping it) preserves any per-call route wrapper it returns (`route.connectInput(...)`); a mismatch — the selector re-decided differently, or the recorded route no longer exists — throws `RouteUnavailableError`, never a silent branch switch.
3. Await the `router_decision` trace write, then dispatch the selected block through `executeBlock` — the same replay seam sequencer children use. On resume, a branch (or a completed descendant inside it) whose logical path holds a committed output is injected from the durable log instead of re-executing. The router's pass-through `ref` output falls back to the prior run's recorded `block_trace` id when the branch was replayed (the short-circuit emits no fresh trace).

**Suspendable-router purity contract (FIX-814).** Because resume re-runs the selector, `execute` on a router whose chosen branch may suspend must be pure — read-only over its input, no side effects (telemetry, state mutation), no ambient state reads that could change across the suspend window. The contract covers the returned wrapper's mapping closures too: a `connectInput` mapper must be pure over the router's own `input`; a `connectOutput` mapper must be pure over the selected child's `output` (plus anything closed over from the router's `input`). Either closure reading ambient state breaks resume determinism. Whether a branch can suspend is not statically decidable (a gate can hide arbitrarily deep, or in a dynamic generator tool), so treat every router that could sit on a durable path as suspendable.

## Error Model

All errors are normalized to `FlowError`:

```ts
type FlowError = Error & {
  code: string;
  retryable: boolean;
  blockName?: string;
  blockInstanceId?: string;
  scope?: "request" | "sideChain" | "resource" | "block";
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
| `ContextLengthError` | No | Prompt exceeded the model's context window — resending the same input fails identically, so the caller must shrink it |
| `ProviderUnavailableError` | Yes | Transient upstream provider outage (5xx, gateway failure) |
| `ToolExecutionError` | Varies | Tool block execution failure |
| `AmbiguousBlockNameError` | No | Block name resolution conflict |
| `ConcurrentModificationError` | Yes | Version-checked write lost a race — either CAS driver (`runWithCAS` for scope state, `runResourceCAS` for resource state) exhausted its retry budget, or a version-checked resource `delete` conflicted, which is terminal on the first conflict (`attempts: 1`, no internal retry loop — a fact about the loop, not a claim about what a caller's own retry policy can do) |
| `OutputValidationError` | No | Generator output failed `outputSchema` |
| `RouteUnavailableError` | No | Recorded router decision can't be honored on resume (re-decision drift or removed route) |

Non-Error thrown values are automatically normalized to `FlowError`.

`FlowError` lives in `@flow-state-dev/core` so author code in third-party packages can throw it without depending on `@flow-state-dev/engine`. Server's typed subclasses extend the core base; `instanceof FlowError` checks across server code continue to work unchanged.

At failure-phase trace emission, the runtime forwards `FlowError.details` into `block_trace.error.details` (and the parallel `tool_output.error.details`) verbatim. `OutputValidationError` populates `details` with `{ rawOutput, issues, phase }`; author-thrown details flow through unmodified.

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
  .step(riskyBlock)
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

### Block-level rescue (`block.rescue`, FIX-742)

`.rescue(handlers)` is also a method on every block, stored as `config.rescue`. When a block carrying it throws a non-`SuspensionError`, the first matching handler runs with the block's own scoped context and its output replaces the throw, so the enclosing chain / `forEach` / `parallel` / `router` continues. This is the same recovery operation as the chain-level rescue above, applied at block scope rather than sequencer scope — a leaf step continues the chain; a whole sequencer recovers as a unit.

It is honored at the block-execution seam so the handler inherits the executing block's context (sequencer state included):
- **Child invocations** (every in-flow composition): core's `executeBlock` catch (`packages/core/src/blocks/sequencer.ts`) runs the handler via the kernel at a `…/rescue[i]` path, giving it a full child trace, then stamps `_didRescue` on the scoped context.
- **Scope-less direct runs** (`asRuntime(block).run(...)`, e.g. a unit harness): `build-block`'s `run()` catch recovers inline.

`SuspensionError` is never rescued (control flow). Sequencer blocks are excluded from this seam — they keep their operation-loop rescue so a sub-sequencer handler runs in the sequencer's own state scope — which prevents double-handling.

### Rescue registry (`ctx.wasRescued`)

A downstream block can ask whether a prior block in the same sequencer scope threw and was recovered, via the public `ctx.wasRescued(target)` query (`target` is a block name or definition). This keeps rescue's shape-preserving contract intact — the recovered value carries no marker — while still letting a later step branch on "was this recovered?".

The rescued bit is a transient flag on each block's sibling-result entry, never persisted into snapshots. It is per-iteration correct under `.loopBack` because the descending sibling search consults the **most recent** matching entry, and nested rescues are tracked at the scope where the rescued block ran as a sibling (the scope whose `_withExecutionScope` invoked it).

The write → stamp → read chain:
1. **Write** — when a `.rescue()` handler recovers an error, `ctx._didRescue = true` is set on the rescued block's scoped context before the recovered value is returned. For chain-level rescue this happens in `runSequencerOperations`' catch; for block-level rescue it happens in `executeBlock`'s catch (both `packages/core/src/blocks/sequencer.ts`, via the shared `runRescue` helper).
2. **Stamp** — after the child returns, `_withExecutionScope`'s success branch copies `_didRescue` onto that block's `SiblingRegistryEntry.result.rescued` (`packages/engine/src/context/createExecutionContext.ts`).
3. **Read** — `ctx.wasRescued(target)` resolves `target` by name and returns `result.rescued === true` for the most-recent matching sibling, mirroring `getBlockResult`'s search. Returns `false` for a clean run, a never-dispatched step, an unknown name, or a call outside a sequencer; never throws.

This replaced an earlier `{ __rescued: true }` sentinel value that `routedSpecialists` smuggled through the pipeline to signal recovery.

## Side chains

A side chain runs alongside the main chain without aborting it:

```ts
pipeline
  .step(mainProcessing)
  .sideChain(analyticsBlock)        // queued, won't abort main chain
  .sideChain(notificationBlock)     // queued, won't abort main chain
  .step(nextMainStep)
  .waitForSideChain({ failOnError: false });  // wait for work, keep failures non-terminal
```

**Semantics:**
- `.sideChain(block)` — queues side-chain execution, non-aborting by default
- `.waitForSideChain({ failOnError: false })` — waits for work, failures are non-terminal
- `.waitForSideChain({ failOnError: true })` — promotes any side-chain failure to terminal request error
- Work failures are logged and the failed `block_trace` reaches the DevTool's trace channel; `onStepErrored` observers still fire

### Work queue signal lifecycle

Background `.sideChain()` tasks are decoupled from the request's transport-level abort signal (FIX-663). Each request has three `AbortController`s:

- `registered`: the abort-registry controller, tagged with the incarnation of the request the run executes as. It fires on an explicit cancellation only, never on a transport signal. Three paths reach it:
  - the `/abort` endpoint, or a block's `ctx.session.stopRequest(id)` for a request in its own session (FIX-1690), when the request is running in this process. Both go through one write, `recordRequestStop` (`execution/record-request-stop.ts`); the route admits the caller by owner and tenant, the session hook by `requestInSessionScope`. The fire is fenced on the incarnation it cancelled, so it does not reach a later request under the same id;
  - the run's own reads of the request store: once as it starts, then on each heartbeat tick, when the intent was recorded by another process (FIX-1026). Both reads are fenced the same way;
  - an unfenced fire (host shutdown, the CLI stopping its turn), which stops whatever runs under the id.

  A `suspended` request has no run and so no controller. `recordRequestStop` hands it to `durability/stop-suspended.ts` when the host has durable execution: the pending gate is resolved `stopped` under the request's lease, through its single pending state (the fence every resume uses). A non-wait gate then ends the request `aborted` with a fenced write; a wait gate continues the request with a stop outcome, and the parked call cancels its waited-on row and stops its own run, which then ends through the path above. A non-wait gate a person already resolved, whose turn never ran again (it is `suspended` or `interrupted` and owed the sweep's re-drive), is stopped the same way: under the lease, fenced on the resolution it read, the gate is re-recorded `stopped` and the turn continues with the stop, so it ends `aborted` and the approved step never runs. The gate is re-checked under the lease as still the turn's last logged gate, so a stop never overwrites a gate a re-drive already ran past. The person's resolution is replaced, not kept alongside: the gate then records only the stop (`resolvedBy: "stop"`, no `resumeData`), and since the turn never ran past it no `suspension_resume` item ever recorded their answer, so nothing keeps that they answered or what form data they sent. That is deliberate. If the stop's continuation fails setup, the gate goes back to the person's resolution, not to `pending`. A stop that loses the fence, or finds the lease held by a resume or re-drive, reports `already-resolved`; one that finds the lease held over a gate already `stopped` (a concurrent stop) reports stopped. The resolved gate is the record of what is owed: the durability sweep re-drives a request left `suspended` or `interrupted` behind a resolved wait gate or a `stopped` gate (`redriveResolvedGate`), so a crash between the gate's write and the request moving on loses nothing.

  A cross-process abort is therefore indistinguishable downstream from a local one. On the host's queued path, `registered` is the controller the host registered while the request waited, handed to the run rather than replaced, so a cancel that landed on it in between is kept.
- `abortController`: the run's own controller. It fires when `registered` fires, but only once the run has settled which request it executes as (see below).
- `sideChainController`: fires only when `abortController` fires.

```
runActionInternal
  registered             ← registry, tagged with the run's incarnation;
                           fires on /abort here (fenced), on the start or
                           heartbeat read of abortRequested (fenced), or on
                           shutdown (unfenced). May be the host's handed-over
                           controller.
  abortController        ← run-local; registered's fire is forwarded to it
                           only after the incarnation settles
  composedSignal = AbortSignal.any([options.signal, abortController.signal])
                         ← foreground chain; also fires on transport signal
  sideChainController    ← listens on abortController.signal ({ once: true })
                           does NOT see options.signal / composedSignal

  createExecutionContext({ signal: composedSignal,
                           sideChainSignal: sideChainController.signal })
    adopts whatever request holds the id now
    root ctx.signal = composedSignal
    root ctx._requestSideChainSignal = sideChainController.signal
    (re-attached on every child scope in _withExecutionScope)

  settle: context's incarnation ≠ the one registered was tagged with?
    fired only by fenced fires → drop registered, register a fresh one
    otherwise                  → re-tag registered (an unfenced fire stays)
  then forward registered's fire, if any, to abortController
  then read abortRequested once for the settled incarnation

  sequencer .sideChain(block):
    taskCtx = { ...ctx, signal: ctx._requestSideChainSignal }
    executeBlock(block, input, taskCtx, path, { signalOverride: taskCtx.signal })
      → _withExecutionScope threads signalOverride to every descendant scope,
        so the whole background task tree sees the background signal
```

Wiring details:

- Which request a run executes as is only known once the execution context has read the record. Admission reads it earlier, and another request can take the id in between. Until the context settles it, a fire on `registered` is held back. At the settle point:
  - If the context adopted a different incarnation and `registered` was fired only by fenced fires, those fires were for the earlier request. The run drops that controller and registers a fresh one.
  - Otherwise `registered` is re-tagged and any fire stays, since an unfenced fire applies to whatever runs under the id.
  - Then a held fire is forwarded to `abortController`, and the run reads the stored cancel once for the incarnation it settled on.

  How a controller was fired is recorded on the controller itself, so the answer holds even if another run has since taken its registry slot.
- A controller handed over by the host goes through the same rule when the run registers it. If it was fired only by fenced fires aimed at another incarnation than the one admission read, the run starts on a fresh controller instead.
- `sideChainController` listens on `abortController.signal` with `{ once: true }`, plus a defensive `if (signal.aborted)` guard for the registration/abort race. A transport signal composed into `composedSignal` via `AbortSignal.any` does **not** propagate to `sideChainController` because the listener is on `abortController.signal` directly. Neither does a fire on `registered` that the settle step drops.
- `_requestSideChainSignal` is an internal `BlockContext` field, propagated through every scope alongside `_requestSideChainPool`.
- The sequencer DSL substitutes `ctx.signal` with `_requestSideChainSignal` at `.sideChain()` / `.sideChainIf()` / `.forEachSideChain()` dispatch, and threads a `signalOverride` through `_withExecutionScope` so descendant scopes inherit it rather than the closure-captured root signal.
- `drainRequestSideChainPool` takes no signal: it waits unconditionally, on every terminal path — success, `failed`, `aborted`, and `interrupted` alike (FIX-1001). If an explicit `/abort` arrives mid-drain, in-flight tasks self-cancel via their own `ctx.signal` and settle as rejections, so the drain still resolves. **The suspend path is not a terminal path and still does not drain** — see the replay contract below; `suspended` is a pause, and its in-flight background work is re-run after resume.
- Quiescence is the pool's contract, not the caller's: `drainToQuiescence` repeats `drainAll` until a pass consumes nothing. `drainAll` splices one snapshot of the pool, so a task that queues further work while being drained lands after that splice and a single pass would never await it. `runAction` calls it once and keeps only the failure logging and the `sideChainTasks` status emission. It also waits for a scope drain (`.waitForSideChain()`) still awaiting the entries it took out of the pool: a wait whose `timeoutMs` fired and was rescued no longer waits for them, so without this the request would end before they settle and their failures would be lost (FIX-2088). A wait that gives up says so (`abandoned` on `drainScope`), and the pool then keeps and logs, once, what settles afterwards, even under `failOnError`: that throw has no caller left to reach.
- `ttsHook.cancel()` on the catch paths is best-effort. It runs above the drain (so a failing request stops paying for synthesis), which also puts it above the terminal write — an unswallowed rejection there would skip both the drain and the record patch and strand the request `in_progress`.
- On the catch paths the heartbeat deliberately outlives the drain and is cleared immediately after it, before the terminal patch. Clearing it first (as the catch prologue used to) would let the request go stale during its own unbounded drain, and `detectInterruptedRequests` would write `interrupted` over a live request with no version guard.
- The catch paths patch the record *before* publishing the terminal status event, matching the success path. A client closes its stream on that event and re-reads the record, so publishing first can permanently cache `in_progress`.
- An abort accepted during the drain overrides a `failed`/`interrupted` branch already chosen: the terminal branch is selected before a wait that now lasts as long as the background work, and `/abort` keeps being accepted for all of it because the record is still `in_progress`.

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
8. Execute action root block, then wait for its .sideChain() work
   ├─ Suspended (ctx.suspend()): persist status suspended, emit it, run the
   │   request-end hooks (told the suspension's reason), return. Steps below
   │   do not run; the request resumes under the same id.
   ├─ Success path:
   │   ├─ Fire action.onCompleted
   │   ├─ Fire request.onCompleted
   │   ├─ Wait for .sideChain() work those hooks queued
   │   ├─ Persist the terminal record, emit the terminal stream status
   │   ├─ Apply session retention (completed and interrupted requests)
   │   └─ Fire request.onFinished
   └─ Error path:
       ├─ Persist the terminal record, emit the terminal stream status
       ├─ Fire action.onErrored
       ├─ Fire request.onErrored
       └─ Fire request.onFinished
9. Wait for .sideChain() work the terminal hooks queued, run the request-end
   hooks, then stamp the record's finalizedAtMs (its last write) and leave
   the active registry
```

**Guarantees** (for a request that finishes; see the suspended note below):
- `onCompleted` fires only on terminal success
- `onErrored` fires only on terminal failure
- `onFinished` fires on every finished request, after the terminal record is persisted and the terminal stream status is emitted
- `finalizedAtMs` is written only after `onFinished` and any `.sideChain()` work it queued have settled; session retention frees a request's id only after that
- A run that calls `ctx.suspend()` ends as `suspended` instead: it fires no `onCompleted`, `onErrored` or `onFinished`, drains no terminal-hook work and writes no `finalizedAtMs`, because the id stays resumable. Session retention evicts only completed and interrupted requests, and never one parked on a gate that drives it again (pending, or resolved and owed a re-drive), so it keeps a suspended one.
- Request-end hooks (`onRequestEnded` from `@flow-state-dev/core/types`) run once per request end, after the last drain of step 9, on every terminal path and on a suspension, told the status (and a suspension's reason). Framework-facing, not a flow-author hook: a package registers one from a block (the task board's claim gate settles a dispatched task there, or records what it waits on). A hook's rejection is logged and changes nothing about the request. A hook that returns `{ fail: Error }` on a request that completed has the request recorded `failed` with that error, so work a package couldn't record never reads as success. A throw in `onFinished` cannot skip one. Disposing the router waits for requests still owed their hooks, within `shutdownDrainMs`
- Request-end hooks are also handed the request's background failures (`RequestEnding.backgroundFailures`, FIX-2088): every `.sideChain()` failure the request's pool kept across all its drains (the request's, those of work `onCompleted`/`onFinished`/`onErrored` queued, and a default `.waitForSideChain()`'s; a `failOnError` throw is the sequencer's and is not kept), each as `{ step, message }`. Absent when none failed. Never handed on when the request's cancel fired (`abortController`, the explicit abort; a transport disconnect is not a cancel), and never at a suspension (the resume reruns the step; its outcome is the one handed on). The engine only hands them on; the claim gate is the reader, and fails a task's attempt on any. Request status is unchanged: background work still never drives it.
- `onStepErrored` fires for non-terminal step/side-chain failures (visibility hook)
- A setup failure after the request has been accepted (`onRegistered`) settles a **fresh** request as `failed` with an `error` item. The HTTP 202 path awaits acceptance, not `finished`; leaving the row `in_progress` (or never writing one) is a silent hang. The failed record is written before `request.failed` is published, and the write leaves a row this run does not own untouched. Replay continuations still stay `suspended` / `interrupted` so they remain re-attemptable. Request observers (`onErrored` / `onFinished`) do not run on this path — there is no execution context yet.

## Error-to-Item Mapping

| Error Type | Stream Result |
|------------|---------------|
| Terminal request error | `error` item + `request.failed` |
| Recoverable step error | failed `block_trace` (trace channel) + `onStepErrored` observer |
| Work queue failure | failed `block_trace` (trace channel) + `onStepErrored` observer |

## Error Capture Sink

`RuntimeConfig.errorCapture` (set via `createFlowState({ errorCapture })`) is an opt-in, provider-neutral sink for routing runtime block failures to an external observability service. It is wired in `createExecutionContext`: the per-block `_runtimeHooks.onBlockError` hook fires it for nested block failures (carrying the leaf block's identity), and `executeBlock`'s catch fires it via `ctx._captureError` for the root action block. Both paths dedupe on the raw thrown value through a per-request `Set`, so a single failure propagating up the block tree is reported once, at the leaf. Under a retry policy each failed attempt is a distinct throw and reports once (distinguished by `attempt`): nested blocks fire via `onBlockError` per attempt, and the root block's non-terminal attempts are captured from `retryWithPolicy`'s `onRetry` while the terminal attempt is captured in the catch. The callback is fire-and-forget: a throw or rejection is swallowed and logged, never affecting the request.

## The request-host seam

A capability's helper functions are typed against the `BlockContext` that `@flow-state-dev/core` declares, and `core` must not depend on `engine`. Some facilities only the runtime can provide: starting a child request, settling a durable row owned by another session, asking whether dispatched work is still running. Without a declared seam, reaching them means casting the context to a shape TypeScript says it does not have, and nothing warns when that shape stops being true.

`core` declares the interface (`RequestHost`, on the optional `BlockContext.requestHost` member) and `engine` implements it, so the package graph stays one-way. Read it with `requireRequestHost(ctx)`, which throws by name when absent rather than failing as `undefined is not a function`.

Two rules make the seam safe, and both are structural rather than validated:

- **What crosses is behaviour, not handles.** No `core` type names a store, a flow instance, a session record, or a task row. A value read from another session crosses as `unknown` and the consumer parses it with its own schema.
- **Identity is never a parameter, and neither is a session id.** Every verb closes over the running request's server-derived identity. A caller supplies a *routing seed*; the seam derives the child session id by hashing it together with the tenant, the principal, **and the parent session**. The parent session is in the key material because every other verb authorises by descent — omit it and one principal's second parent session derives the first's child key, adopts its child, and its work then settles onto the wrong board while its own interrupt and liveness calls refuse.

Adoption validates the stored record's full identity — flow kind, principal, tenant, org, parent session — before reusing it. The derivation alone is not sufficient, because the seam is not the only writer: the public session-create route lets a caller choose a session id, so a record can be pre-created at the deterministic child key, and `createExecutionContext` validates user/tenant/org bindings but neither flow kind nor parent session. A mismatch is a named refusal, never a silent create.

The member is optional in the *type* so a hand-built test context still type-checks. It is not optional in *deployment*: a process that executes requests without one is a construction failure, `worker-only` included — that mode constructs no runner today, so a deployment whose capabilities dispatch must supply the start operation there explicitly.

### The liveness enablement gate

The liveness verb reads the active request registry, and three supported configurations make that read a lie. All three are checked once, at construction, and the verb is **absent and named** when any fails — never present and wrong. The other verbs are unaffected.

| Arm | Failure it prevents | Direction of the lie |
|---|---|---|
| The registry declares itself shared across processes | A per-process registry cannot see another process's requests at all | Live work reads **dead** → double execution |
| `heartbeatIntervalMs` is nonzero and the stale threshold is at least twice it | `heartbeatIntervalMs: 0` creates no timer while the sweeper still reaps | Live work reads **dead** |
| A stale sweeper is running at a nonzero cadence | `staleSweepIntervalMs: 0` returns a no-op handle before creating any timer, so a crashed worker's entry is never removed | Dead work reads **alive** → reconciliation deadlocks |

The third arm's failure deadlocks rather than merely overspending, which is why it is a hard gate arm and not a documented caveat. Sweep cadence is a construction input like the registry itself; a host that cannot answer is treated as not sweeping (fail-closed).

The sweeper is constructed by `createFlowApiRouter`, so the cadence only becomes a fact once a router exists. `createFlowState` therefore leaves it unset on the runtime config it builds — a host that initializes solely through `getRuntime()` really has nothing sweeping — and stamps it onto that same config when it builds the router. The stamp is what a **colocated worker** reads: `worker.startWorker` captured the shared config during runtime init, and the context factory reads the cadence per request, so once `ready()` has started the sweeper the worker beside it stops refusing. Fail-closed is the answer for a process with no sweeper, not for a process whose own router is sweeping.

A nonzero cadence is necessary but not sufficient — a cadence much larger than the threshold leaves a worker that crashed just after a sweep registered until the next tick. So the read also compares `lastHeartbeatAt` against the threshold, which is correct however the cadence is tuned and adds nothing for an operator to configure.

The backing read is `ActiveRequestRegistry.get(requestId)`, issued for the ids the caller supplied — never `listStale()` and never `listAll()`. `listStale` returns *registered* entries older than the cutoff, and terminal requests are deregistered, so a completed request and a freshly-registered healthy one are both absent from it: complementing that set reports finished work as alive, and treating membership as alive reports healthy work as dead. `listAll()` is rejected separately because it enumerates across tenants.

**Absence means "no live registration was found", never "definitely dead."** A completed request, one that never registered, and one whose registration was lost are indistinguishable by construction. A consumer may treat a not-live answer as permission to stop waiting; re-dispatching on it alone is how double execution ships, so anything that re-runs work must corroborate against durable state it owns.

### Registry sharedness

`ActiveRequestRegistry` carries a `sharedAcrossProcesses` declaration, read fail-closed through `isRegistrySharedAcrossProcesses` — **absent means not shared**, so an adapter compiled against the older contract gets liveness refused rather than silently wrong. The answer is a property of the *constructed store*, not of the adapter's package name: the Postgres adapter declares shared on the pooled and connection-string shapes and **not** shared when handed an injected `{ executor }` (PGlite is process-local). In-memory declares not shared definitively; filesystem and SQLite cannot tell a shared volume from a per-process path and therefore declare not shared.

## Canonical Authority

This document is authoritative for execution and error semantics. For full type signatures, refer to the published types in `@flow-state-dev/core` and `@flow-state-dev/engine`.


### Token budget enforcement

Actions may define `tokenBudget` with `maxTotalTokens`, optional `warnAt`, and `onExceeded` policy (`error` | `stop` | `warn`). Runtime emits warning status items with `system.token_budget_warning` detail when thresholds are crossed.

## Sequencer State Persistence

Sequencers checkpoint their state at every step boundary so the durable execution runtime can resume an interrupted request mid-sequencer without losing progress. The mechanism is on by default; combine it with a `DurabilityProvider` on `RuntimeConfig` to enable `ctx.suspend()` and the resume endpoint.

### Wire model

At every step boundary a sequencer emits a `state_snapshot` item with:

- `key: blockInstanceId` — stable dedup key. Every snapshot from the same sequencer instance shares the same `key`; the wire-level convention is that consumers treat each new emit as an in-place update of the same logical item.
- `version: number` — monotonic write counter. Increments on each emission that actually changed state.
- `durable: boolean` — when `true`, the runtime persists the snapshot to `stores.checkpoints`.
- `terminal?: boolean` — set on the final emission for the sequencer's run (success, error, or cancellation). The durability provider treats terminal frames as a delete signal.

Net wire effect: instead of N items per sequencer per turn (one per step), there is one logical item per sequencer that updates N times. The DevTool collapses these into one row per sequencer instance showing the current state.

### Storage model

`stores.checkpoints` is a small interface on `StoreRegistry`:

```ts
interface CheckpointStore {
  write(checkpoint: SequencerCheckpoint): Promise<void>;
  latest(requestId: string, blockInstanceId: string): Promise<SequencerCheckpoint | null>;
  delete(requestId: string, blockInstanceId: string): Promise<void>;
}
```

Identity is `(requestId, blockInstanceId)`. Each `write` overwrites the prior record — storage is constant per sequencer regardless of step count. Memory, filesystem, SQLite, and Postgres adapters all ship with first-class implementations; no migration is required when FIX-141 starts reading these records.

The filesystem adapter derives each checkpoint's basename from a truncated SHA-256 digest (32 hex chars) of the `blockInstanceId`, keeping filenames bounded against per-component length limits on deeply-nested compositions. The canonical `blockInstanceId` is preserved in the JSON body so DevTool and operator inspection are unaffected; identity semantics are unchanged.

### Defaults and opt-out

```ts
sequencer({ name: 'my-flow', stateSchema })                  // durable: true (default)
sequencer({ name: 'my-flow', stateSchema, durable: false })  // explicit opt-out
```

Always-on durability is cheap under latest-only semantics. Opt-out exists for tests and single-shot ephemeral fanouts where persistence is unwanted overhead. With `durable: false` and trace observability off (production default), no `state_snapshot` items are emitted at all.

### Lifecycle

Each sequencer instance owns its own checkpoint:

1. Pre-execution: emit baseline snapshot. If durable, write a baseline record.
2. After each step that mutated state: emit + (if durable) overwrite.
3. On terminal completion (success, rescued error, rethrown error, cancellation): emit a terminal snapshot. By default the final record is **retained** for post-mortem inspection — the `latest()` of a completed run reflects its final state. Operators that want eager GC opt in via `flow.request.cleanupCheckpointsOnTerminal: true`, in which case the durability hook treats terminal frames as `delete(requestId, blockInstanceId)`.

Nested sequencers each get their own keyed checkpoint, and (when cleanup is enabled) their own delete on terminal — there is no enumeration pass at request termination. The `parentBlockInstanceId` on each `SequencerCheckpoint` records the nesting relationship for the resume runtime.

Latest-only persistence keeps storage bounded regardless of the retention setting (one record per sequencer instance per request), so retention doesn't compound across step counts.

### Durable execution: suspend and resume

When a block calls `ctx.suspend()` inside a durable action, the runtime:
1. Catches the `SuspensionError` at the sequencer boundary (bypassing rescue handlers).
2. Creates a `SuspensionRecord` via the `DurabilityProvider`.
3. Emits a `SuspensionItem` on the response stream.
4. Sets the request status to `"suspended"` and closes the SSE stream.

The resume endpoint (`POST /:flowKind/requests/:requestId/resume`) re-invokes the action on the **same** request id (FIX-811). The record's status walks `suspended → in_progress → terminal` (and `interrupted → in_progress → terminal` on crash recovery); no new linked request is spawned. The item log continues by sequence number across the pause, and the resume audit is appended to it as a `suspension_resume` item (the durable record of who resolved the suspension, the `resolution`, and the `resumeData` injected on continuation).

Completed blocks are not re-executed. The runtime replays each one's recorded `block_trace` output, keyed by the block's logical path (`${requestId}:${path}` — the attempt-independent prefix of a `blockInstanceId`, so replay tolerates code changes and retries between suspend and resume). The division of labor: the **item log** is the source of truth for block outputs (what replay reads), while `state_snapshot` restores accumulator state only (the sequencer's `stateSchema` fields). The suspending block re-runs because it has no committed output yet; on this re-run, `ctx.suspend()` returns the `resumeData` provided by the external actor instead of throwing. The sequencer writes its checkpoint again as the suspension passes through it, so the re-run starts from the state as it stood at the wait: a `patchState` the suspending step made before `ctx.suspend()` is kept, and the re-run reads it. On the re-run, writes to the restored sequencer's state are skipped until the waiting block reaches the last gate the log records for it (on a resume, or on a crash's continuation after its answer was logged), because the checkpoint already holds them, so each applies once. That covers the code around the waiting block too (its connector, the sequencer's own `.map`). Transient fields, which no checkpoint holds, are written again, as is any state the checkpoint does not hold (a handler's own `ctx.self`). Session, user and org state and resource writes are not covered: they re-run with the block (FIX-2444, FIX-2446).

`SuspensionError` is a control-flow signal, not a block failure — rescue handlers never fire for it. `SuspensionRejectedError` is an ordinary catchable error thrown on resume when the suspension was rejected, when an approval expired (`expired: true`), or when it was cancelled (`cancelled: true`). `SuspensionTimeoutError` is thrown on resume when a suspension that is not an approval passed its deadline unanswered: a review's or an input's `ctx.suspendForUser`, or a raw `ctx.suspend` that allows no `reject`.

#### Waiting for a user

`ctx.suspendForUser({ kind, prompt, deadline? })` is `ctx.suspend` with a kind (`approval`, `review`, `input`, recorded on the suspension beside the `user_approval` / `user_input` reason it maps to), a deadline, and a cancel (FIX-2129). One predicate, `isUserSuspension` in `contracts`, says whether a suspension waits for a user; a raw `ctx.suspend` with either reason is one too. Every way such a stop ends resolves its single pending state under the request's lease, so the first wins and the rest are told `already-resolved`:

- **Answered** through the answer route (`POST /:flowKind/requests/:requestId/answer`, `routes/answer-routes.ts`). Unlike resume, it is open to every source, `task` included, because the caller sends only where the stop is and the answer. It runs resume's ownership checks (`ownsRecord`, `callerReachesRequest`) on the stop's request before it reads the stop, answers a stop that isn't the caller's, or isn't a user's, as a missing one, checks the answer against the stop's `allow` and `resumeSchema`, and records the signed-in caller as `resolvedBy`.
- **Its deadline**: the call's `deadline`, else the host's `userDeadlineMs` (`RequestHost.userDeadlineMs`), else none; a raw `ctx.suspend` keeps its own `timeoutMs`. The sweeper expires it and re-drives the request: an approval reads as a no, a review or an input throws `SuspensionTimeoutError`. A stop with no deadline is never expired.
- **Cancelled** (`durability/cancel-user-suspension.ts`, behind `RequestHost.resumeWait({ suspension, outcome: { cancelled: true }, first?, taskCancelled? })`): the stop resolves `cancelled` and the request continues with a `reject` whose resolution is read from the stop. `suspendForUser` returns `{ cancelled: true }`. When the cancel carries `taskCancelled: true` (recorded on the stop's resume data, so a re-drive keeps it), any later wait for a user in that continuation resolves `cancelled` at once without a stop; without it only that one stop ends, and the next wait suspends as usual. The caller must be the stop's principal (user, tenant, organization); `first` runs under the lease before the stop resolves. A `cancelled` stop whose request never continued is owed a re-drive, like a `stopped` one.
- **Stopped.** A run with the `task` source parked on a user's stop is not aborted before anything runs: it continues with the stop resolved `stopped` and no abort recorded, so the board's claim gate, ahead of the stop, can cancel the task (`requestResumeOf(ctx)` tells it how the request resumed), and `ctx.suspend()` then records the stop on the request and throws its abort at the stop itself (`stopsAtItsGate`). Any other parked request is stopped as before.

### Background work under replay (locked contract)

Background blocks (`.sideChain()`, `.sideChainIf()`, `.forEachSideChain()`) ride the **same** `executeBlock` replay gate as foreground steps. There is one replay rule for both, not two. On continuation:

- A background block whose logical path holds a `completed` `block_trace` is injected from the log; its body is skipped — identical to a completed foreground step.
- An in-flight background task (no `completed` trace at continuation time) re-runs from the top. There is no intra-task checkpoint, so in-flight background work is **at-least-once**, not exactly-once. Non-idempotent side effects guard themselves with `ctx.runOnce` (a per-item key under `forEachSideChain`, since `runOnce` dedupes by `(requestId, key)`) plus a provider idempotency key.
- The suspend path does **not** drain or abort the work pool. This is the deliberate asymmetry with the terminal/success path, which drains unconditionally (`drainRequestSideChainPool`). Background work in-flight at suspension is therefore a reachable, supported state, recovered by the re-run rule above — not an error to defend against.
- A failed background task is isolated and drop-and-logged: it emits a `failed` `block_trace` (never `completed`), the failure is logged, and it does **not** drive request terminal status (the foreground `result.error` does). In a request working a dispatched task it still reaches the request-end hooks, and the claim gate fails the task's attempt (FIX-2088); the request's status is unchanged. `.waitForSideChain({ failOnError: true })` promotes a failure into the parent by **drain-then-throw**: it drains the scope's queued work, then throws the first failure, so the parent reaches `failed` only after the scope settles (not fail-fast). A `failed` request is not continuable on the same id (the `/continue` route accepts only `interrupted` records); only `/retry` re-runs it as a fresh request.
- All of the above presuppose retained `block_trace` items. A completed block's trace is recorded whatever the trace-observability setting: with observability off (the `NODE_ENV === "production"` default) it is a lean record carrying only the block's identity, output and rescued mark, enough for replay; full capture (input, generator prompt, resource loads, failed traces) stays gated by observability. `transient: true` suppresses retention either way. With no retained trace (a transient block), `ReplayLog.getCompletedOutput` returns `undefined` and the completed work re-runs on continuation — background and foreground alike. An output larger than the recorded-value limit (`maxRecordedValueBytes`, 256 KiB by default) is stored as an `omitted` placeholder, so replay cannot inject it: a resume that reaches that step fails with `RECORDED_VALUE_OMITTED`, naming the block, rather than skipping it or running it again. Replay skipping applies when a durability provider is configured, both for a resume after a stop and for `/continue`. Without one, `/continue` restores no sequencer checkpoint and keeps its earlier behaviour: it skips a completed block only from a full trace and ignores lean records (`lean: true`), so what it does follows how the request was recorded, not the trace setting at recovery. With one, crash recovery is at-least-once for a block whose completion had not been persisted when the process died: with no record to replay, it runs again. A completed trace records `rescued: true` when a `.rescue()` handler produced the output, and replay restores it, so `ctx.wasRescued()` reads the same after a resume.

### Retention model

Durability records (checkpoints, suspension records, leases) are reclaimed by two mechanisms with a deliberate division of labor.

**The `cleanup()` seam runs eagerly on the success path.** When a durable request completes, `runAction` calls `DurabilityProvider.cleanup(requestId)` for its own records (and `cleanupCheckpoints` when `cleanupCheckpointsOnTerminal` is set). The resume path cleans the original request the same way. This is the common case and needs no background work.

**The durability sweeper is the backstop** for everything `cleanup()` misses: a process that crashed before completion, a suspension that expired unanswered, a lease whose holder died, a gate resolved but never acted on. The router builds it (`createDurabilitySweeper`) whenever a durability provider is configured. Its correctness work always runs; its pruning runs only with a retention policy (`RuntimeConfig.durabilityRetention`), so without one nothing is deleted.

It runs on a self-re-arming timer (`setTimeout` + `unref`, an `inFlight` guard, idempotent `dispose`). After every tick, whatever the tick came to, the timer is re-armed from the store: the earlier of `sweepIntervalMs`, the earliest wake (a wait's deadline is one, FIX-2082), and the earliest `expiresAt` among the pending suspensions, a person's approval or question included (FIX-2063 D3), never sooner than a second. A gate still pending past its deadline is retried after `OVERDUE_WAIT_RETRY_MS` (5 s), or after `sweepIntervalMs` when that is shorter: a wait its resume left pending, or an approval whose expiry found its request's lease held elsewhere (`expireUnderLease` returned `busy`). That retry is bounded: a gate overdue by `sweepIntervalMs` or more no longer pulls the timer forward and waits for the interval. The deadlines are also read once when the sweeper starts, so a suspension a one-shot process (`fsdev run`) left in the store is expired at its deadline once a server runs on it, not an interval later. A gate with a deadline that this process parks after the sweeper started brings the armed tick forward to its `expiresAt` (`noteSuspensionDeadline`, keyed on the provider); a gate another process writes is seen at the next tick. A wake owed in this process also brings the armed tick forward; nothing depends on that.

Each tick takes a single-holder sentinel lease (reusing `LeaseStore`) so co-located hosts serialize, then:

- enforces suspension expiry: `pending` past `expiresAt` → `expired` (resolved by `durability-sweeper`), written under the request's lease after re-reading the gate there (`expireUnderLease`, which the resume route's own expiry write shares), so a resume that resolved it first is never overwritten; a wait gate whose deadline is its expiry (parked before FIX-2082) is instead resumed with `wait_timed_out`, since nothing else may resume it. A current wait gate's deadline is a wake: when it falls due the sweep resumes the wait with the work still running, cancelling nothing (`resumeDueWaits`);
- re-drives each parked (`suspended` or `interrupted`) request whose last gate on its log is resolved: a wait's answer, ending or stop continues the turn with the recorded outcome, a stopped approval ends it `aborted`, a person's resolution of any other gate (`approved`, `rejected`, `submitted`, `skipped`) continues it with that action and its recorded `resumeData`, all under the request's lease. A setup failure of that continuation (before its handle is returned) releases the lease and leaves the gate resolved for the next sweep (`continueUnderLease`); only a live resume's setup failure reopens the person's gate to `pending`, so they can answer again (`resumeUnderLease`). **Waiting for the turn on the session's concurrency key is not setup** (FIX-2062): it runs after the handle is returned, inside `finished`, so the resolution is already accepted. A live resume or a re-drive whose wait fails (the `queue` budget runs out, or the backend fails) releases only its own lease (the `leaseId` its caller passed to `host.continueRequest`, never one another process took after it lapsed), keeps the gate resolved, and stays parked; the next sweep re-drives it. An **expired approval** (a non-wait gate whose `allow` includes `reject`) is re-driven too, in the same tick that expired it: the turn continues with a `reject` resume that names the expiry itself (`ResumeContext.resolution: "expired"`, honoured only with `reject`; never read back from the gate, whose status an expiry write could race), and `ctx.suspend()` throws `SuspensionRejectedError` with `expired: true`. A gated tool call turns that into a completed denial result telling the model the approval is no longer valid, so the tool never runs and the model carries on. The `suspension_resume` item records `expired`, and the replay log reads it back as a rejection. The `expired` record is the obligation: a crash before the continuation runs is finished by the next sweep, and a setup failure leaves it `expired` rather than reopening it. A stop recorded on the turn still wins: its first abort poll ends it `aborted`. A gate that allows no `reject` is only marked `expired`, unless it waits for a user (`isUserSuspension`, FIX-2129): a review's or an input's is re-driven the same way, and `ctx.suspend()` throws `SuspensionTimeoutError` into its block;
- carries a stop recorded on a parked request (`abortRequested`, accepted while the turn was being written parked) onto its gate, as a stop of a parked turn does;
- continues a request that died owing a park (FIX-2269, `durability/park-owed.ts`). A wait that starts its own work before it parks owes the park first, through `RequestWaits.owingPark(work)`. Today only Workforce's call does: its message id is kept under `runOnce` before the send, and the recipient takes the message once. The dispatcher doesn't owe a park yet, because a replay could start a second child (FIX-2322). The owe is an engine-owned wake (`parkOwed:<requestId>`) on the request's session, due one stale threshold out. It is cleared when the wrapped work returns or throws anything but a `SuspensionError`, once the suspension item of a park is flushed to the log, or when the request is stopped. Waits in one request that owe at the same time share the wake: the last one to settle clears it, and none clears it once one has parked. When the wake falls due, a request still `interrupted` is continued under its lease, exactly as `/continue` does, after re-reading the owe under that lease. Its replay finds the work it already started (`runOnce`) and parks on it. A request still running moves the wake on, and one that parked or ended clears it. A request still owing its park 10 minutes after the first owe (`PARK_OWED_GIVE_UP_MS`, measured from the wake's age, not a count of tries) is left `interrupted`, so a crash loop can't spin the sweep. A stop takes the same lease to let the owe go, so a stop and a continuation never both land: a stop that finds the lease held answers `already-resolved`. History, retention and `waits.ended` read an owed request as parked (`parkedInterruptedIds` reads the owe before any logged gate). The wrapped work must be safe to repeat up to the park, because `runOnce` records only after its function returns;
- with a retention policy only: prunes resolved suspensions and expired leases past their windows, and prunes orphaned checkpoints.

The two record kinds are treated asymmetrically by design. **Checkpoints are disposable infrastructure** — they exist only to resume an interrupted run, so a terminal run's checkpoints can be dropped. **Suspension records are audit-bearing** — they are the evidence of an approval decision. Note the current behavior: the eager `cleanup()` seam still deletes a *completed* request's suspension records immediately (including on the non-resumed completion path), so the sweeper's retention *window* applies to the records the eager path does not reach — suspensions of requests that failed, aborted, or expired without completing. Reconciling the eager path with the audit window (so resolved suspensions survive the window on the success path too) is a tracked follow-up; until then, treat the window as a backstop for non-completed terminal records rather than a guarantee for every resolved suspension.

The load-bearing invariant: **the sweeper never age-prunes checkpoints of an `in_progress` or `suspended` request.** Orphan detection is anchored on a request's terminal/interrupt timestamp, not its creation time, so a flow legitimately parked on a slow HITL gate is never misclassified as abandoned. Only `completed`/`failed`/`aborted` requests (past `checkpointMaxAgeMs`) and `interrupted` requests (past `orphanCheckpointThresholdMs`) are eligible.

### Out of scope

- Append-and-prune step-history retention. The latest-only model is intentional; an opt-in `persistFullHistory` mode is a future ask if it materializes.

