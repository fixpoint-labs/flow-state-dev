# Dispatched Work

Work a request hands off runs in a **child session** on a request of its own: from a `dispatcher()` block, or from a task board whose `workers` include a `dispatcher({ action, session })` (each claimed row goes to an entry under `flow.task.actions`). The user-facing surface is [Dispatched work](../../apps/docs/docs/server/background-work.md). Entry resolution and session targets are in [Action Forms](./action-forms.md); what a child inherits and where `sharedToLineage` stores are in [State and Scopes → Child sessions](./state-and-scopes.md#child-sessions-and-scope).

This page owns **what happens to dispatched work over its lifetime, per topology**: what crosses, what guards the row, where the child runs, what `dispose()` settles, and what recovers abandoned work.

## What crosses into the child

A child is its own `session` cell (state, items, history, journal, metadata, session resources). It inherits principal, tenant, org and flow kind, records `parentSessionId`, and carries the parent's `lineageId` verbatim. **There is no handle to the parent's state and no cross-session read path.** Exactly these cross:

- **The payload.** A board sends `TaskDispatchInput` (`{ boardId, seat, taskId, attempt, createdAt, incarnationId?, payload }`). It is round-tripped through JSON before sending so the in-process and queued paths see the same value, and an unserialisable payload fails the row in the drain, not in the child.
- **Identity, server-derived.** `source` is the dispatch type; the principal is the sender's. A block supplies the *target*, never the *authority*.
- **Provenance.** Session: `topic` (the key) and `coordinate` (`<type>:<target>`), display only. Request: `metadata.dispatch`, read only via `readDispatchStamp`. Only `from.sessionId` (and `from.lineageId`) routes anything (for `{ from: true }`); the rest is correlation. `settleParentTask` doesn't read it.
- **The sender's runtime config, in-process only.** See [below](#what-cannot-cross-the-queue).

### Which child a row lands in

| `session` | Keyed on |
|---|---|
| `"per-task"` | task id |
| `"per-worker"` | assignee, one child per claiming session |
| `{ key: fn }` | the returned string |

Presets frame the board id into the key (`taskSessionKeyFor`, `core/types/dispatch.ts`), so two boards never share a child; a custom key is used as returned, so two dispatchers returning one string share one. **A shared child serialises its rows**: `defineFlow` defaults the entry behind a `per-worker`/`key` dispatcher to `queue` (an explicit policy wins). In-process always enforces it; an external dispatcher enforces it only with `WorkerAdapter.leaseBackend` (the place is taken before enqueue and travels as `DispatchEnvelope.leasePlace`). Without a lease backend, rows sharing a child **can overlap**.

The child id is derived, never chosen: `deriveDispatchRunSessionId` (`engine/src/context/dispatch-run.ts`) hashes length-framed tenant, principal, parent session, lineage, the `dispatch` namespace and the key to `dsx_<sha256[0:32]>`.

- The parent session is in the key because every other verb authorises by descent: a child is reachable only *through* its parent.
- Determinism makes "adopt if it exists" the ordinary retry path. `evaluateAdoption` re-checks owning instance (`flowId`, or `flowKind` + cardinality for pre-owner records), principal, tenant, org, parent and lineage, **because the public session-create route lets a same-principal caller pre-create a record at that deterministic id.**
- A cross-instance target's id is in the key, so one conversation dispatching to `review-east` and `review-west` gets two children.

### Dispatching into another flow

`internal` and `task` dispatchers may name another flow with `flowKind` (an exact instance id). The mechanism is unchanged; only *when* the entry resolves moves, from `defineFlow` to the seam (`RequestHostConstructionInputs.resolveFlow`). Misses are `flow-not-found` / `no-entry` as `DispatchRefusedError`; neither retries nor falls back. A process without `resolveFlow` refuses every cross-flow address as `flow-not-found`.

An owner-pinned target (`context/instance-pin.ts`) whose pin excludes the sender's principal is refused the same way, **before** a child session is written. Refusing there (not at child admission) lets a board hand-off put the claim back and fail the row, instead of reporting an accepted hand-off whose child then refuses and strands the row until its lease lapses.

The boundary is a storage boundary as much as a routing one:

- **The child belongs to the addressed instance.** `flowId`/`flowKind` and session-state defaults come from the target; `parentSessionId` still names the sender. "Cross-flow" is `targetFlow.id !== flow.id`, so a sibling in the sender's own collection counts. `{ id }` and reply checks use `ownsRecord` (instance equality, not kind).
- **It roots its own lineage.** A `sharedToLineage` cell's key has no flow in it, so inheriting the sender's lineage would put two flows' declarations on one durable cell, a hazard the registry can only validate at user/org scope where both schemas are visible. Data crosses in the payload, validated by the entry's schema; that's the whole channel.
- The target kind joins the child-key material (cross-flow only, so same-flow ids are unchanged).
- **A cross-flow child is not a descendant** for verbs that authorise by descent (`isDescendantSession` re-checks flow at every hop), so `livenessOf` won't answer for it from the sending flow.
- Replies use a `{ from: true }` dispatcher pointed at the sender's `flowKind`; delivery happens only when the stamp's session and the address's flow agree.

## The claim gate and the fence ticket

A hand-off leaves the row `in_progress`, owned by a child that hasn't started. A cancel or reclaim in that gap must not let the child proceed from a stale snapshot.

**The child can't reach the bare worker.** `defineFlow` rebuilds every entry a reachable hand-off addresses as `createTaskGate(entry)` (`orchestration/src/task-board/task-entry.ts`). The gate's `inputSchema` is narrowed to *this* board's id, so a dispatch to a removed or renamed board is refused before any read. It also refuses an entry that declares `sessionStateSchema` anywhere in its tree (`assertHandOffBlockSupported`): worker state belongs on the task, not on a session that may run many tasks.

**The gate runs the worker only if the claim is still current**: the row exists; `attempts`, `createdAt` and `incarnationId` match (catching delete-and-recreate); status is `in_progress`; it still routes to this assignee. A miss throws `StaleTaskClaimError` (`stale-task-claim`) and **writes nothing**. These identity checks run *before* the lease arm (which writes), so a refused dispatch never extends a lease someone else is entitled to.

**A lapsed lease is adopted, not refused.** Nothing renews the lease while the dispatch waits in a queue, so a late child often finds it lapsed. `adoptLapsedLease` renews on the same attempt and proceeds if the write lands; it refuses (`stale-task-claim`, writing nothing) if the renewal is declined (a reclaim genuinely won), there's no committed lease span, or the collection returns no verdict. Adopting is safe because this claimant has run nothing yet; refusing would strand work behind a merely deep queue.

Past the gate, the same read marks the task scope for attribution, **re-mints the claim ticket** from the verified row, and starts lease renewal on the child's own async chain. The ticket is server-derived at both ends: the parent's lives in `AsyncLocalStorage` that can't reach the child, and one carried on a payload would be forgeable. **That is why `settleParentTask` takes no `claim` parameter**: every ticket field is readable off `parentTask()`, so an argument would let a displaced child read its successor's attempt and settle over work it no longer owns. A stale ticket refuses `fence-rejected`.

`RequestHost` is closed at three verbs: `parentTask()`, `settleParentTask()`, `livenessOf?()`. Identity is never a parameter.

## Locality: the effective dispatcher decides, not `worker.mode`

`createFlowState` resolves `options.dispatcher ?? workerDispatcher` and asks `isInProcessDispatcher`: `dispatcher === undefined || "dispatchLocal" in dispatcher`. `dispatchLocal` is the discriminator because it accepts a live `AbortSignal` and `ResponseEmitter`, which can't cross serialisation.

Reading `mode` instead is wrong because: `options.dispatcher` excludes `worker`, so `mode` shows its `colocated` default while the dispatcher may be external; a custom dispatcher with `dispatchLocal` is local regardless; and **`worker-only` constructs no dispatcher, so it is in-process**.

| Topology | Child runs | Acceptance means | Survives process? | `dispose()` waits? |
|---|---|---|---|---|
| No `worker`, no `dispatcher` | here | registered here, maybe not yet running | no | yes, bounded |
| Custom `dispatcher` with `dispatchLocal` | here | same | no | yes, bounded |
| Custom `dispatcher` without it | wherever it routes | what it confirms | its answer | **no**; never tracked |
| `colocated` | a worker (maybe here) | job is on the queue | yes | claimed job: yes, **unbounded**; queued: no |
| `dispatch-only` | another container | job is on the queue | yes | no |
| `worker-only` | **here** | registered here | **no** | children: bounded; claimed job: unbounded |
| No dispatch seam (hand-built ctx) | nowhere | throws `NoDispatchSeamError` | | |

- **Two waits, one bounded.** The drain of in-process children races `dispatchDrainTimeoutMs`. Separately, `dispose()` awaits the worker handle; for BullMQ that's a non-forced `Worker.close()`, which waits for claimed jobs with no framework budget. Every queue-consuming mode (`colocated`, `worker-only`) does this. **Size the platform kill timeout for the longest job.**
- **`worker-only` is the trap.** It's the natural place to start durable jobs and the one place they silently aren't durable: a hand-off runs in the worker process and enqueues nothing, so a crash loses the run. Dispatch from `colocated` or `dispatch-only` for queue ownership. Running in-process there is deliberate: a topology that refuses dispatched work isn't supporting it.
- **No seam ≠ no operation.** No `DISPATCH_SEAM` throws `NoDispatchSeamError`; a seam whose host lacks a dispatch operation *refuses* `no-dispatch-operation`. `createFlowState` and the shipped router always wire one.

## What acceptance means

- **In-process, `allow`/`reject`:** the run's `activeRequests` registration. The request record lands a few store round-trips later, so `GET /requests/:id` can 404 briefly.
- **In-process, `queue`:** the registration *and* the record, both written before the gate releases, so no 404 window, but a child behind a held key is accepted while still waiting.
- **Queued:** the record is written and the queue accepted the job, both confirmed before the seam resolves; a failed write or rejected enqueue is reported as not started, so an unreachable queue is a refusal, not silence. SSE can attach before any worker claims.

**Acceptance is not execution**; an undrained queue is an ordinary state. **A refusal is decided before anything is dispatched**, which is what lets a hand-off put the claim back and fail the row. A *throw* after the attempt can't rule out a live child, so the hand-off leaves that row to its lapsing lease instead.

## What cannot cross the queue

`RuntimeConfig` holds live resolvers, providers and loggers, so a **per-request** config can't travel with a job; the worker uses its own. Shipped case: `fsdev run --model` reaches in-process dispatched work and stops at the queue. `createInboundTransportHost` warns when an external dispatcher meets a launching config whose `modelResolver` differs from the host's. Why carrying a model *id* wouldn't fix it: [Inbound Transports](./inbound-transports.md#execution-configuration-is-per-host-with-one-per-envelope-exception).

## Liveness

`ctx.requestHost.livenessOf(requestIds)` answers per id; identity filters first, so a filtered id is indistinguishable from unknown (no enumeration, no existence oracle). A request passes if it's under the caller's principal, tenant and flow instance and its session is either:

- **on the descendant chain** of the caller's session (`isDescendantSession`, re-checking ownership at every hop), or
- **a dispatch run in the caller's organization**: has a `parentSessionId`, same principal/tenant/org/instance, whoever dispatched it.

The second arm lets a caller ask about work dispatched from another of its own conversations. It never reaches an undispatched session, and conjoins org explicitly because one person acting for two orgs under one tenant is two identities. Both arms exist on purpose: replacing the walk with the second would widen "work I started" to "anything of mine on this flow".

**`false` means "no live registration found", never "dead".** Completed, never-registered and lost registrations read the same. Re-dispatching on `false` alone is how double execution ships; corroborate against durable state (for a hand-off, the row).

The verb is **absent** when the liveness gate refused at construction (registry not shared across processes, heartbeats can't keep pace with the stale threshold, or sweeping is off). Each would make the answer lie in a different direction.

## Shutdown

`dispose()` drains **in-process** children only (tracked by the same `isInProcessDispatcher` test). External children are untracked: the enqueue is confirmed, and waiting on another process's worker could block forever.

- **Admission closes before the drain looks**, so the snapshot is complete. A dispatch in flight is refused (`dispatch-rejected`), leaving an adoptable child record with no run; a hand-off hands its claim back and fails the row.
- **Rounds**, because children may dispatch grandchildren. Every wait races `dispatchDrainTimeoutMs` (default 30 s; `0` skips; the old `detachedDrainTimeoutMs` is refused). At the budget it cancels, allows a brief unwind inside the same budget, and reports abandoned ids on stderr even with a silenced logger.
- **Shutdown cancels; it doesn't settle.** One known exception: a child still queued behind the in-process concurrency gate is written `aborted` by `terminateUnenqueuedRequest` before it ever ran (FIX-1121).

## What a stopped process leaves behind

**The task row** stays `in_progress` with an unrenewed lease. Recovery is on the next claim, **not via `pending`**: `isClaimable` admits a lapsed lease and `applyClaimToTask` re-issues it inside the atomic claim write, advancing `attempts` and `abandonments` together (so there's no window where a row is re-dispatched but uncharged). Past the abandonment allowance the same write settles it `errored` (`applyAbandonmentSettlement`); settling inside the claim keeps the board able to report `drained`/`blocked`. `reclaim()` is a different, explicit verb (back to `pending`, `attempts` untouched); lease recovery doesn't use it.

**A lapsed handed-off row rejoins the drain's in-flight count.** `isHandedOff = in_progress && runsElsewhere(task) && !leaseLapsed(…)`: routing says where work belongs, the lease says whether anyone is on it. A claimant that died before its child started leaves a row handed off by routing but abandoned in fact.

`countWaitable` has two exclusions:

| | routing (`runsElsewhere`) | park (`onReview: "exit"`) |
|---|---|---|
| Asks | where does this row's work belong? | is it waiting on a human? |
| Applies to | `in_progress`, boards with a dispatcher | `parked`, any board |
| Lease-gated | **yes** | **no** |

- `runsElsewhere` reads the row's `assignee`, sound only because hand-off boards freeze it at admission (`setAssignee` declines `immutable-assignee`). `claimedBy` won't do: the child never claims, so the row still carries the parent's session.
- The park exclusion's missing lease check is deliberate. Parking moves a row off `in_progress`, where the lease stops governing it so a slow human can't have it reclaimed; a lease conjunct would exclude nothing or reintroduce that reclaim.
- A handed-off row that parks switches from the routing exclusion to the park one only on `onReview: "exit"`; on the default `"hold"` it holds the drain open. `board.unparkAndDrain` puts it back (fenced `unpark`, then drain in the answering request).

**The request record** has four endings:

1. **Unwound inside the shutdown window:** `runAction` sees abort without persisted intent and writes `interrupted` itself.
2. **Never started** (queued behind the in-process gate): written `aborted`, the FIX-1121 contradiction.
3. **Couldn't unwind** (budget expired, or killed): stays `in_progress` until a sweep writes `interrupted`.
4. **Died in the persistence window** (`allow`/`reject`, between the `activeRequests` write and the record): no record at all; the sweep deregisters and has nothing to mark. **A caller reconciling by request id must treat "no record" as a possible outcome of an accepted dispatch.**

Three sweeps clear case 3, all converging on re-read → `status === "in_progress"` → write `interrupted`:

1. **Runtime init** (`#detectInterruptedOnStartup`, every init, honouring `detectInterruptedOnStartup`), retained so `dispose()` can await it within `RECOVERY_SWEEP_DRAIN_MS` (5 s).
2. **Periodic** (`createStaleRequestSweeper`, built by `createFlowApiRouter`); a no-op at `staleSweepIntervalMs <= 0`.
3. **Client poke** (`POST …/check-interrupted`, DevTool on mount and refresh). The only caller-scoped one: path `userId`, caller's org ([Authentication](./authentication.md)), and `tenantMatches` before reporting or writing; no tenant header sweeps only tenantless entries. Its `staleThresholdMs` is floored at the host's, so a poke can widen but never tighten the window.

What the re-check does **not** buy:

- **It narrows the terminal-overwrite window; it doesn't close it.** Read and write are separate round-trips and the write is a whole-record `set` at `expectedVersion: "any"`, so a record that goes terminal in between is overwritten as `interrupted`. `RequestStore.setFieldsIfStatus` is the atomic verb (the abort route uses it); moving the sweep onto it is FIX-1128. The staleness threshold is what keeps the window narrow.
- **The two startup sweeps aren't ordered** (`createFlowState`'s and `createFlowRouteHandlers`'), so they can overlap. Same status written, so a duplicate write, not a wrong one.

Only records whose heartbeat has been quiet past the threshold are swept; going quiet for a second isn't abandonment. If nothing ever runs against the store again, nothing sweeps it.

## Where it lives

| Concern | Module |
|---|---|
| Locality test | `engine/src/transports/host/in-process-dispatcher.ts` |
| Dispatch install, drain, disposal gate | `engine/src/flowstate/createFlowState.ts` |
| Dispatch seam | `engine/src/context/create-request-host.ts`, `dispatch-operation.ts` |
| Child derivation and adoption | `engine/src/context/dispatch-run.ts` |
| Session policy, child key | `core/src/types/dispatch.ts` |
| Board hand-off | `orchestration/src/task-board/blocks/hand-off.ts`, `task-board/hand-off.ts` |
| Claim gate | `orchestration/src/task-board/task-entry.ts` |
| Per-dispatch config warning | `engine/src/transports/host/createInboundTransportHost.ts` |
| Interrupted detection | `engine/src/execution/request-recovery.ts`, `stale-request-sweeper.ts` |
