# Execution and Errors

User-facing behaviour is in the user docs: [Error handling](../../apps/docs/docs/advanced/error-handling.md) (`FlowError`, `details`, `.rescue`, `ctx.wasRescued`), [Side Chains](../../apps/docs/docs/advanced/sequencer-side-chains.md), [Durable execution](../../apps/docs/docs/advanced/durable-execution.md), [Error capture](../../apps/docs/docs/advanced/error-capture.md), [Sequencer State](../../apps/docs/docs/advanced/sequencer-state.md). Execution order and hook timing are in [Flows and Actions](./flows-and-actions.md#request-execution-order). This page holds the runtime invariants behind them.

## Generator loop ownership

When the resolved `GeneratorModel` implements the optional step methods, **FSD owns the multi-step loop**: one provider call per step, framework tools passed *without* `execute` so the framework runs them (concurrently within a step, through the same executor/cache/retry/`tool_output` path), one assistant message per step (raw provider messages when surfaced, so reasoning parts round-trip) plus one tool-result message per call, per-step usage summed.

- Each path is chosen independently: a streaming turn is owned only through `streamStep`, a non-streaming turn only through `generateStep`.
- Models without step methods (test mocks, older adapters, `createFallbackModel` groups where no candidate has them) use the legacy `generate({ maxSteps })` path.
- The built-in AI SDK adapter is step-capable.
- **Loop ownership is what makes in-loop suspension possible**: a tool's `ctx.suspend()` reaches the framework instead of being swallowed by the SDK. Suspension inside a generator needs a step-capable model.
- Text joining across steps differs by path: [Blocks → Text across steps](./blocks.md#text-across-steps).

## Routers under resume

- Route names must be unique per router (checked at build): the durable `router_decision` records a bare name, so duplicates would make resume ambiguous.
- On continuation the selector **re-runs** (preserving any per-call wrapper it returns, e.g. `route.connectInput(...)`) and is validated against the recorded decision. A different choice or a removed route throws `RouteUnavailableError`, never a silent branch switch.
- The `router_decision` write is awaited before dispatch through `executeBlock`, the same replay seam sequencer children use. A replayed branch emits no fresh trace, so the router's `ref` output falls back to the prior run's `block_trace` id.
- **Purity contract.** Because resume re-runs the selector, `execute` on any router whose branch may suspend must be pure: read-only over input, no side effects, no ambient reads that could change across the suspend window. This covers the returned wrapper's closures (`connectInput` pure over the router's input; `connectOutput` over the child's output). Whether a branch can suspend isn't statically decidable, so **treat every router on a durable path as suspendable.**

## Errors

- Non-`Error` throws normalise to `FlowError`. `FlowError` lives in `core` so third-party packages can throw it without depending on `engine`; engine subclasses extend it.
- `FlowError.details` is forwarded verbatim into `block_trace.error.details` (and `tool_output.error.details`).
- `ContextLengthError` is **not** retryable: resending the same input fails identically.
- `ConcurrentModificationError` means a version-checked write lost: `runWithCAS` / `runResourceCAS` exhausted retries, or a version-checked resource `delete` conflicted, which is terminal on the first conflict (`attempts: 1`, no internal loop).
- A failure in a `.sideChain()` emits a failed `block_trace` and fires `onStepErrored`; it never drives request status unless `.waitForSideChain({ failOnError: true })` promotes it.

### Rescue

- Block-level `.rescue()` (`config.rescue`) is honoured at the block-execution seam so the handler inherits the block's context, sequencer state included. In-flow it runs from core's `executeBlock` catch (`packages/core/src/blocks/sequencer.ts`) at a `…/rescue[i]` path with its own trace; scope-less direct runs (`asRuntime(block).run`) recover in `build-block`'s `run()` catch.
- **Sequencer blocks are excluded from that seam**; they keep their operation-loop rescue so a sub-sequencer handler runs in the sequencer's own state scope. That exclusion is what prevents double handling.
- **`SuspensionError` is never rescued** (control flow). `SuspensionRejectedError` / `SuspensionTimeoutError` are ordinary catchable errors.
- `ctx.wasRescued` chain: the rescue sets `ctx._didRescue` on the rescued block's scoped context (shared `runRescue`) → `_withExecutionScope` copies it to that block's `SiblingRegistryEntry.result.rescued` (`engine/src/context/createExecutionContext.ts`) → the query reads the **most recent** matching sibling. The bit is transient and never in snapshots. "Most recent" is what makes it per-iteration correct under `.loopBack`.

## Request finalisation guarantees

- `onCompleted` fires only on terminal success and `onErrored` only on terminal failure; `onStepErrored` is the non-terminal visibility hook. Success is known only after the drain and the abort check, so a cancel accepted during the drain ends the request `aborted` and **no success hook runs for it**.
- `onFinished` fires after the terminal record is persisted and terminal status emitted. `finalizedAtMs` is written only after `onFinished` and any side-chain work it queued settle; retention frees a request id only after that.
- **A setup failure after acceptance** (`onRegistered`) settles a fresh request `failed` with an `error` item, written before `request.failed` is published, leaving rows this run doesn't own untouched. The HTTP 202 awaits acceptance, not `finished`, so leaving it `in_progress` would be a silent hang. Replay continuations stay `suspended` / `interrupted` so they remain re-attemptable. `onErrored`/`onFinished` don't run (no execution context exists yet).

## Abort and the side-chain signal

Background `.sideChain()` work is decoupled from the transport's abort signal: a client disconnecting must not kill background work, but an explicit cancel must. Three controllers per request:

- **`registered`** (abort registry, tagged with the run's incarnation). Fires only on explicit cancellation: `/abort` or `ctx.session.stopRequest(id)` for a request running here (both through `recordRequestStop`, fenced on the incarnation they cancelled); the run's own start and heartbeat reads of a stop recorded by another process (also fenced); or an unfenced fire (host shutdown, CLI stop). So a cross-process abort is indistinguishable downstream from a local one. On the host's queued path, `registered` is the controller the host registered while the request waited, handed over rather than replaced, so a cancel landing in between is kept.
- **`abortController`** (run-local). Receives `registered`'s fire, but only after the run settles which request it executes as.
- **`sideChainController`** listens on `abortController.signal` only. The foreground `ctx.signal` is `AbortSignal.any([transportSignal, abortController.signal])`, so a **transport signal never reaches background work.**

**Incarnation settle.** Which request a run executes as is known only once the execution context reads the record, and another request can take the id between admission and then. Until settled, a `registered` fire is held. At settle: if the context adopted a different incarnation and `registered` was fired only by fenced fires, those were for the earlier request, so the run registers a fresh controller; otherwise it re-tags `registered` (an unfenced fire applies to whatever runs under the id). Then it forwards any held fire and reads the stored stop once for the settled incarnation. How a controller was fired is recorded on the controller itself, so the answer survives another run taking its registry slot. A host-handed controller goes through the same rule.

`.sideChain()` / `.sideChainIf()` / `.forEachSideChain()` dispatch with `ctx._requestSideChainSignal` and thread `signalOverride` through `_withExecutionScope`, so the whole background subtree sees the background signal rather than the closure-captured root signal.

### Drain on terminal paths

- `drainRequestSideChainPool` takes no signal and waits **on every terminal path**: success, `failed`, `aborted`, `interrupted`. Under `/abort` mid-drain, tasks self-cancel via their own `ctx.signal` and settle as rejections, so the drain still resolves.
- **Suspend is not terminal and does not drain** (see replay below).
- `drainToQuiescence` repeats `drainAll` until a pass consumes nothing, because `drainAll` splices one snapshot and work queued during a drain lands after it.
- **On catch paths the heartbeat outlives the drain** and is cleared right after, before the terminal patch. Clearing it first lets the request go stale during its own unbounded drain, and `detectInterruptedRequests` would overwrite a live request with `interrupted`.
- **Catch paths patch the record before publishing terminal status**, like success. A client closes its stream on that event and re-reads, so publishing first can permanently cache `in_progress`.
- `ttsHook.cancel()` runs above the drain and so above the terminal write; an unswallowed rejection there would strand the request `in_progress`.
- An `/abort` accepted during the drain overrides an already-chosen `failed`/`interrupted` branch, since `/abort` keeps being accepted while the record is `in_progress`.

## Error capture dedupe

`errorCapture` fires from `_runtimeHooks.onBlockError` (nested failures, leaf identity) and `ctx._captureError` in `executeBlock`'s catch (root block). Both dedupe on the raw thrown value per request, so one failure propagating up is reported once, at the leaf. Each retry attempt is a distinct throw and reports once (distinguished by `attempt`); the root's non-terminal attempts come from `retryWithPolicy`'s `onRetry`. Fire-and-forget: a throwing sink is logged and swallowed.

## The request-host seam

Capability helpers are typed against core's `BlockContext`, and `core` can't depend on `engine`. Runtime-only facilities (start a child request, settle another session's durable row, ask liveness) used to require casting the context to a shape TypeScript didn't know, and nothing noticed when the cast went stale. So `core` declares `RequestHost` on optional `BlockContext.requestHost` and `engine` implements it. Read it with `requireRequestHost(ctx)`, which throws by name.

- **Behaviour crosses, handles don't.** No core type names a store, flow instance, session record or task row. A value read from another session crosses as `unknown` and the consumer parses it.
- **Identity is never a parameter, nor is a session id.** Callers supply a routing seed; the seam derives the child id from it plus tenant, principal and **parent session** (omit the parent and one principal's second parent session derives the first's child key and adopts it). Adoption re-validates the stored record's full identity because the public session-create route can pre-create a record at that key. Details: [Dispatched Work](./dispatched-work.md).
- Optional in the *type* so hand-built test contexts compile; **required in deployment**. A process executing requests without one is a construction failure, `worker-only` included (it constructs no dispatcher, so a deployment whose capabilities dispatch must supply the start operation there).

### The liveness gate

`livenessOf` is **absent and named**, never present and wrong, when any construction-time arm fails:

| Arm | Without it | Lie |
|---|---|---|
| Registry declares itself shared across processes | per-process registry can't see other processes | live reads **dead** → double execution |
| `heartbeatIntervalMs` nonzero and stale threshold ≥ 2× it | `0` creates no timer while the sweeper still reaps | live reads **dead** |
| A stale sweeper runs at nonzero cadence | `staleSweepIntervalMs: 0` is a no-op, crashed entries never removed | dead reads **alive** → reconciliation deadlock |

- The third arm deadlocks rather than overspends, which is why it's a gate and not a caveat. A host that can't answer counts as not sweeping (fail-closed).
- The sweeper is built by `createFlowApiRouter`, so `createFlowState` leaves the cadence unset until it builds the router, then stamps it on the shared config. A **colocated worker** reads that config per request, so it stops refusing once `ready()` has started the sweeper.
- Cadence is necessary but not sufficient, so the read also compares `lastHeartbeatAt` against the threshold.
- The read is `ActiveRequestRegistry.get(id)` for supplied ids only. **Never `listStale()`**: terminal requests are deregistered, so both its complement and its membership answer wrong. **Never `listAll()`**: it enumerates across tenants.

**Registry sharedness** is read fail-closed through `isRegistrySharedAcrossProcesses` (absent ⇒ not shared), and is a property of the *constructed store*: Postgres is shared for pooled/connection-string shapes but **not** for an injected `{ executor }` (PGlite is process-local). Memory, filesystem and SQLite declare not shared (the latter two can't tell a shared volume from a local path).

## Durability

### Sequencer checkpoints

- One logical `state_snapshot` item per sequencer instance (`key: blockInstanceId`), updated in place at each step boundary; `version` is monotonic over emissions that changed state; `terminal` marks the last.
- `stores.checkpoints` is keyed `(requestId, blockInstanceId)`, **latest-only**: each write overwrites, so storage is constant regardless of step count. That is why `durable: true` is a safe default. The filesystem adapter names files by a 32-hex SHA-256 of the id to bound filename length.
- The final record is **retained** for post-mortem unless `flow.request.cleanupCheckpointsOnTerminal`. Nested sequencers each own their checkpoint; `parentBlockInstanceId` records nesting.

### Suspend and resume

- `ctx.suspend()` → `SuspensionError` caught at the sequencer boundary (bypassing rescue) → `SuspensionRecord` → `SuspensionItem` → status `suspended`, stream closed.
- Resume re-invokes on the **same request id**: `suspended → in_progress → terminal` (and `interrupted → in_progress → terminal` on crash recovery). The item log continues by sequence number; `suspension_resume` is the durable audit (who, `resolution`, `resumeData`).
- **The item log is the source of truth for block outputs; `state_snapshot` restores accumulator state only.** Completed blocks are injected from their recorded `block_trace`, keyed by logical path `${requestId}:${path}` (attempt-independent, so replay tolerates retries and code changes). The suspending block re-runs, and `ctx.suspend()` then returns `resumeData`.

### Background work under replay (locked)

One replay rule for foreground and background (`.sideChain`, `.sideChainIf`, `.forEachSideChain` all go through `executeBlock`):

- A background block with a `completed` trace at its path is injected; its body is skipped.
- An in-flight one re-runs from the top: **at-least-once**, no intra-task checkpoint. Non-idempotent effects need `ctx.runOnce` (per-item key under `forEachSideChain`, since it dedupes by `(requestId, key)`) plus a provider idempotency key.
- **Suspend does not drain or abort the pool**, unlike terminal paths. Work in flight at suspension is a supported state, recovered by re-run.
- `.waitForSideChain({ failOnError: true })` is **drain-then-throw**, not fail-fast. A `failed` request isn't continuable (`/continue` takes only `interrupted`); `/retry` re-runs it fresh.
- **All of this presupposes retained `block_trace` items.** Trace capture is off when `NODE_ENV === "production"` and suppressed by `transient: true`; without a trace, `ReplayLog.getCompletedOutput` returns `undefined` and completed work re-runs.

### Retention

- `cleanup(requestId)` runs **eagerly on success** (and on the resume path for the original request). The durability sweeper (`createDurabilitySweeper`, opt-in via `RuntimeConfig.durabilityRetention`) is the backstop: single-holder sentinel lease per tick, expires pending suspensions past `expiresAt`, prunes resolved suspensions and expired leases past their windows, prunes orphaned checkpoints.
- **Checkpoints are disposable; suspension records are audit evidence.** Known gap: eager `cleanup()` still deletes a *completed* request's suspension records immediately, so the sweeper's retention window only protects suspensions of requests that failed, aborted or expired. Don't promise audit retention for resolved suspensions on the success path.
- **Invariant: the sweeper never age-prunes checkpoints of an `in_progress` or `suspended` request.** Orphan age is measured from the terminal/interrupt timestamp, not creation, so a flow parked on a slow human gate isn't reaped. Eligible: `completed`/`failed`/`aborted` past `checkpointMaxAgeMs`, `interrupted` past `orphanCheckpointThresholdMs`.
