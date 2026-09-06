# Dispatched Work

A request returns, and some of the work it started has to keep going: an
implementation that takes an hour, a research pass, a draft nobody is waiting
on. The framework runs that work in a **child session** of the session that
started it, on a request of its own, and calls it *dispatched*. A flow hands it
off in one of two ways: a `dispatcher()` block in a running request, or a task
board whose seat holds a `dispatcher({ type: "task" })`, which hands each row
it claims to a worker declared under `flow.task.actions`.

This document owns one question the other docs each answer a slice of: **what
happens to dispatched work over its lifetime**, per deployment topology. What
crosses into the child and what does not, what guards the row a task hand-off
leaves behind, where the child actually runs, whether it survives the process,
what `dispose()` settles, and what brings an abandoned run back.

Related, and deliberately not restated here:

- [State and Scopes](./state-and-scopes.md) → *Child sessions and scope* — what
  a child session inherits, and where a `sharedToLineage` resource stores.
- [Inbound Transports](./inbound-transports.md) — the dispatch operation on the
  host, and why a per-request config stops at a queue.
- [Action Forms](./action-forms.md) → *Dispatched: `internal` and `task`
  entries* — how a `task` or `internal` dispatch resolves its entry, and why
  neither is re-enterable from a public route.
- `packages/orchestration/README.md` → *Handing tasks off through a dispatcher
  seat* — the task-board surface that is the ordinary way to start one.
- `apps/docs/docs/server/background-work.md` — the HTTP surface for reading a
  session's children afterwards.

## What crosses into the child, and what does not

A child session is a separate `session` cell: its own state, items, history,
journal, metadata and session-scoped resources. It inherits the parent's
principal, tenant, org and flow kind, records `parentSessionId`, and carries
the parent's `lineageId` verbatim so a `sharedToLineage` resource resolves to
the same storage in both. Nothing else is shared. There is no handle to the
parent's state and no cross-session read path; what the child needs arrives
with the dispatch, and what the child produces lands on durable rows both can
address.

What crosses, exactly:

- **The payload.** A `dispatcher()` sends its `payload`; a task seat sends the
  `TaskDispatchInput` envelope — `{ boardId, seat, taskId, attempt, createdAt,
  incarnationId?, payload }`, where `payload` is the worker input the drain
  packed at claim time. The hand-off round-trips it through JSON before
  sending, so the in-process and queued paths see the same value and a payload
  that cannot serialize fails the row in the drain rather than in the child.
- **Identity, server-derived.** The envelope's `source` is the dispatch type
  (`task` or `internal`) and its principal is the sending request's. A block
  supplies the *target* of a dispatch and never the *authority* for it.
- **Provenance.** The child session record carries `topic` (the key it was
  derived from) and `coordinate` (`<type>:<target>`) as display labels. The
  child request record carries `metadata.dispatch = { type, target, from,
  key?, recipientLineageId?, taskId? }`. Read that bag only through
  `readDispatchStamp`, which is gated on `source: "internal"` / `"task"`.
  `{ from: true }` routes on the stamped sender (`from.sessionId`, and
  `from.lineageId` when present). Everything else on the stamp is correlation.
  `settleParentTask` does not read it.
- **The sending request's runtime config**, in-process only. See
  [What cannot cross the queue](#what-cannot-cross-the-queue).

### Which child a row lands in

The dispatcher's `session` policy decides, per row. Every task dispatch gets a
request of its own; the policy decides what keys its session:

| `session` | Keyed on | Use it when |
|---|---|---|
| `"per-task"` | the task id | rows are independent |
| `"per-worker"` | the seat, one child per claiming session | the worker should remember what it already did |
| `{ key: fn }` | what the function returns from the worker input | one issue across spec, implement and review |

The presets frame the board id into the key (`taskSessionKeyFor`,
`core/types/dispatch.ts`), so two boards' children stay apart even when their
task ids coincide; a custom key is used as returned, so two seats that return
the same string share one child. A shared child serialises its rows:
`defineFlow` defaults the entry a `per-worker` or `key` seat hands off to
`queue` concurrency, and an explicit policy on the entry wins.

The child id is derived, never chosen (`deriveDispatchChildSessionId`,
`engine/src/context/detached-child.ts`): tenant, principal, parent session,
lineage, the `dispatch` namespace and the key, each length-framed, hashed to
`dsx_<sha256[0:32]>`. The parent session is in the key material because every
other verb authorises by descent, so a child is reachable only *through* the
parent that owns it. The derivation is deterministic, which is what makes
"adopt if it already exists" the ordinary retry path rather than a conflict —
and `evaluateAdoption` re-checks flow kind, principal, tenant, org, parent and
lineage before adopting, because the public session-create route lets a
same-principal caller pre-create a record at that deterministic id.

## The claim gate and the fence ticket

A task hand-off leaves the row `in_progress` in the parent's ledger, owned by
a child that has not started yet. Between the claim and the child's first
statement there is no request, so a cancel or a reclaim landing in that gap
would leave the child proceeding from a stale snapshot. Two things close it.

**The child cannot reach the bare worker.** The flow declares a task entry as
a plain block, `task: { actions: { implement: { block } } }`, and the board
binds its claim gate onto the hand-off it installs at each dispatcher seat
(`bindTaskDispatcher`). `defineFlow` rebuilds every entry a reachable hand-off
addresses as `gate(entry)` (`createTaskGate`, `task-board/task-entry.ts`), so a
`task` dispatch resolves the gate around the block and never the block. The
gate's `inputSchema` is the envelope narrowed to *this* board's id, so a
dispatch addressed to a board since removed or renamed is refused before a row
is read. It also refuses an entry block that declares `sessionStateSchema`, at
its root or in a composed child (`assertHandOffBlockSupported`): a worker's
state belongs on the task, not on a session that may run many of them.

**The gate re-reads the row and runs the worker only if the claim is still
current** — the row exists, `attempts` matches, `createdAt` and
`incarnationId` match (so a row deleted and recreated under the same id is
caught), the status is still `in_progress`, the lease has not lapsed, and the
row still routes to this seat. Any miss throws `StaleTaskClaimError`
(`code: "stale-task-claim"`) and writes nothing; the row keeps its lapsed
lease and the next drain takes it back. Refused rather than adopted, because
the expensive direction is a worker whose side effects commit before the
refusal arrives.

Past the gate, the same read does three more jobs: it marks the task scope so
the worker's items are attributed, it **re-mints the claim ticket** from the
row it just verified, and it starts lease renewal from the child's own async
chain. The ticket is the fence every settlement is checked against, and it is
server-derived at both ends: the parent's ticket lives in an
`AsyncLocalStorage` that cannot reach the child, and a ticket carried on a
payload would be forgeable. This is why `settleParentTask` takes **no `claim`
parameter** — every field of a ticket is readable off the row `parentTask()`
exposes, so an argument would let a displaced child read the successor's
attempt and settle over work it no longer owns. A settlement whose ticket no
longer matches the row refuses `fence-rejected`.

The request host the child sees is three verbs, closed: `parentTask()` reads
the one row this request was dispatched for, `settleParentTask()` settles it,
and `livenessOf?()` asks whether requests this session dispatched are still
running. Identity is never a parameter to any of them.

## The rule that decides everything

**Locality is decided by the effective dispatcher, not by `worker.mode`.**

`createFlowState` resolves `options.dispatcher ?? #workerDispatcher`, then asks
`isInProcessDispatcher`, whose test is `dispatcher === undefined || "dispatchLocal" in dispatcher`.
`dispatchLocal` is the discriminator because it accepts a live `AbortSignal` and
`ResponseEmitter` — capabilities that cannot cross a serialization boundary, so
a dispatcher offering it is necessarily running the work here.

The two genuinely disagree, which is why the mode is the wrong thing to read:

- `options.dispatcher` is mutually exclusive with `worker`, so `mode` reads as
  its `colocated` default while the dispatcher may be external.
- A custom dispatcher exposing `dispatchLocal` is local whatever the mode says.
- `worker-only` constructs **no** dispatcher at all (`createFlowState` skips
  `createDispatcher` for that mode), so the effective dispatcher is `undefined`
  — which is *in-process*.

Everything below follows from that one test.

## Topology matrix

| Topology | Effective dispatcher | Where the child runs | Acceptance means | Survives the process? | `dispose()` waits? |
|---|---|---|---|---|---|
| No `worker`, no `dispatcher` | none (`undefined`) | this process | the child is registered here, and may still be awaiting execution | no | **yes**, bounded |
| Custom `dispatcher` exposing `dispatchLocal` | that dispatcher, **in-process** | this process | the child is registered here, and may still be awaiting execution | no | **yes**, bounded |
| Custom `dispatcher` without `dispatchLocal` | that dispatcher, **external** | wherever it routes the job | whatever that dispatcher confirms on accept | its dispatcher's answer, not ours | **no** — the child is never tracked, so nothing drains it |
| `colocated` | queue dispatcher | a worker (may be this process) | the job is on the queue | yes | a job this process has **claimed**: yes, *unbounded*; one still queued: no |
| `dispatch-only` | queue dispatcher | another container | the job is on the queue | yes | no |
| `worker-only` | **none** | this process | the child is registered here, and may still be awaiting execution | **no** | dispatched children **yes**, bounded; a claimed job yes, *unbounded* |
| No dispatch seam (a hand-built context) | — | nowhere | `NoDispatchSeamError` is thrown | — | — |

There is no "started" milestone to report — the column is acceptance, and
[What acceptance means](#what-acceptance-means) is the long form of these cells.

**Read the rows by what the runtime resolved, not by which option you typed.**
`worker` and `dispatcher` are mutually exclusive — `createFlowState` throws when
given both — and the low-level `dispatcher` option is the one that most easily
gets misread here: it produces no `worker` and no `mode`, so it looks like the
first row and behaves like the third if the dispatcher it installs is external.
The effective dispatcher is `options.dispatcher ?? worker.createDispatcher(...)`,
and `isInProcessDispatcher` decides everything downstream of it.

**Two different waits hide in that last column, and only one of them is
bounded.** The drain below waits for *in-process dispatched children* and races
`dispatchDrainTimeoutMs`. Separately, `dispose()` awaits the worker handle, and
for the BullMQ adapter that is a non-forced `Worker.close()`, which waits for
whatever jobs that process has already claimed. Any topology that consumes the
queue — `colocated` and `worker-only` both, since `startWorker` runs for every
mode except `dispatch-only` — therefore holds shutdown open for a claimed job
for as long as that job takes, with no framework budget over it. Size the
platform's kill timeout for the longest job, not for `dispatchDrainTimeoutMs`.

**`worker-only` is the trap.** It is the natural place to start durable jobs and
the one place they silently are not durable. The mode consumes the queue and
dispatches nothing, so a hand-off there runs the child in the worker process
itself and enqueues nothing. A crash or a redeploy loses the run outright
rather than costing a retry. For the queue to own the work, dispatch it from a
process that has a dispatcher — `colocated` or `dispatch-only`.

That the feature works at all in `worker-only` is deliberate: a topology that
claims support while refusing dispatched work is not supporting it. Running it
in-process is the honest interim answer, not a durability guarantee.

**No seam is a different failure from no dispatch operation.** A context with
no `DISPATCH_SEAM` attached throws `NoDispatchSeamError` (`code:
"no-dispatch-seam"`) — a unit test, a hand-built mock. A seam that exists but
whose host was wired without a dispatch operation *refuses* with
`no-dispatch-operation`, a named refusal rather than a throw. A
`createFlowState` deployment wires one in every topology, and so does the
shipped HTTP router, so the refusal is reachable only on a runtime config
assembled without either.

## What acceptance means

The seam resolves once the child is *accepted*, and what that guarantees
differs by row above.

**In-process.** The child is discoverable in this process, and what that rests
on depends on the entry's concurrency policy. Under `allow` and `reject` it is
the run's own `activeRequests` registration — the request is discoverable, but
has not necessarily begun executing, and its request record lands a few store
round-trips later, so `GET /requests/:id` can still 404 in that window. Under
`queue` it is the enqueue-time registration *and* request record, both written
before the concurrency gate releases — the same stub the external path writes,
so this arm has no such window, but a child whose key is already held is
accepted while it is still waiting its turn. Either way nothing outside this
process is holding the work, so the guarantee ends at the process boundary.

Accepted-and-still-waiting is the state shutdown handles worst: a child cancelled
in that window is written `aborted` without ever having run (FIX-1121).

**Queued.** The request record has been written and the queue has accepted the
job. Both are confirmed before the seam resolves: a failed store write or a
rejected enqueue is reported as not started rather than as a start, so an
unreachable queue surfaces as a refusal instead of as silence. Because the
request is registered at enqueue time, an SSE client can attach to
`GET /requests/:id/stream` before any worker claims the job.

Acceptance is not execution. A queue with nothing draining it is an ordinary
state — the job sits there, and the caller finishes exactly as it would if a
worker were pulling. Whether the work ever ran is a question for the child
session's own request list.

**A refusal is decided before anything is dispatched.** That is what lets the
task board's hand-off put the claim back and fail the row against it: the row
is still genuinely the parent's to settle. A throw *after* the attempt cannot
rule out a live child, so the hand-off treats the two differently — refused
means hand the claim back; threw means leave the row to its lapsing lease.

## What cannot cross the queue

A `RuntimeConfig` holds live model resolvers, providers and loggers. None of
them serialize, so a **per-request** config cannot travel with an enqueued job.
The job payload carries the serializable envelope only — flow kind, entry,
input, identity, source, metadata, request id — and the worker runs it under the
`runtimeConfig` that worker was built with.

The shipped case is `fsdev run --model`. The override reaches every generator in
the command's own process, including in-process dispatched work, and stops at
the queue. `createInboundTransportHost` detects exactly this — an external
dispatcher plus a launching config whose `modelResolver` differs from the host's
— and logs a warning naming the request that lost it.

The envelope contract this rests on, including why carrying the selected model
*id* across would not fix it, is
[Inbound Transports](./inbound-transports.md#execution-configuration-is-per-host-with-one-per-envelope-exception)'s.

## Liveness

A parent that wants to know whether the work it dispatched is still running
asks `ctx.requestHost.livenessOf(requestIds)`. It takes a batch and answers per
id; identity filters before the answer is built, so an id outside the caller's
descendant chain, or under a different principal, comes back indistinguishable
from an unknown id. There is no enumeration and no existence oracle.

**`false` means "no live registration was found", never "definitely dead".** A
request that completed, one never registered, and one whose registration was
lost all read the same, because terminal requests are deregistered. Treat
`false` as permission to stop waiting, never as proof the work did not happen —
re-dispatching on it alone is how double execution ships. Corroborate against
durable state you own first, which for a task hand-off is the row itself.

The verb is **absent** when the liveness gate refused at construction: the
request registry is not shared across processes, heartbeats cannot keep pace
with the stale threshold, or stale sweeping is off. Each makes the answer a lie
in a different direction, so the verb is missing and named rather than present
and wrong. `parentTask` and `settleParentTask` are unaffected.

## Shutdown: what `dispose()` settles, and what it does not

`dispose()` drains **in-process** dispatched children and no others.

The tracking is keyed on the same `isInProcessDispatcher` test: `onDispatched`
registers a child for the drain only when it runs here. An externally dispatched
child is deliberately untracked — the enqueue is already confirmed, so there is
no half-written row to strand, and its `finished` resolves only when some worker
completes the job. Waiting on that would block shutdown on a process this one
does not control, indefinitely when the workers live elsewhere.

Admission closes before the drain looks. Once `dispose()` begins, the dispatch
operation refuses new work outright (`notStarted`, with a reason — surfaced to
the sender as `dispatch-rejected`), which is what makes the drain's snapshot
complete rather than merely early. A dispatch already in flight arrives
afterwards and is refused: the child session record exists with no run, which
is the adoptable state a retry already handles, and a hand-off hands its claim
back and fails the row.

The drain runs in rounds, because dispatched work may itself dispatch and a
grandchild registered mid-await belongs to this drain too. Every wait races
`dispatchDrainTimeoutMs` (default 30 s; `0` skips the wait; the removed
`detachedDrainTimeoutMs` spelling is refused by name). At the budget it cancels
what is still running, gives it a brief window *inside* the same budget to
unwind, and reports the request and session ids it gave up on — on stderr,
even when the runtime logger is silenced, since work may have been left
unfinished.

**Shutdown cancels; settling is meant to be somebody else's job.** The drain
fires each child's abort controller and writes nothing on its behalf. One path
breaks that rule today: a child still queued behind the in-process concurrency
gate is written `aborted` by `terminateUnenqueuedRequest` at the moment the
drain cancels it, before it ever runs (FIX-1121). Everywhere else the division
holds, and it holds only because something else recovers — the next section.

## What a stopped process leaves behind, and what recovers it

A process can stop while dispatched work is still running — a shutdown that ran
out of budget, or a kill. That exposes two records, and they do not behave
alike: the task row reads the same however far the child got, while the request
record has three different endings.

**The task** stays `in_progress`, holding a lease nobody is renewing. Recovery
happens on the next claim, and it does **not** route through `pending`:
`isClaimable` admits a row whose lease has lapsed, and `applyClaimToTask` hands
it straight back out inside the atomic claim write — the row stays
`in_progress` while `attempts` and `abandonments` both advance. Counting the
abandonment in the same write as the hand-off is what leaves no window where a
row has been re-dispatched but not yet charged for it.

Past the abandonment allowance that same write settles the row `errored`
(`applyAbandonmentSettlement`) rather than handing out another duplicate
execution. Settling *inside the claim write* is what keeps the board's exit
question answerable: a row left `in_progress` with nobody on it still counts as
in-flight, so a board that neither re-claimed nor settled it would never report
`drained` or `blocked`.

`reclaim()` is a different thing and is easy to confuse with the above. It is an
explicit verb that returns a row to `pending` without touching `attempts`.
Lease-lapse recovery does not call it.

**A lapsed handed-off row resumes holding the launching drain open.** The
exclusion that lets a handed-off row drop out of the board's in-flight count
requires a live lease: `isHandedOff` is `in_progress && runsElsewhere(task) &&
!leaseLapsed(...)`. Routing says where the work belongs, the lease says whether
anyone is actually on it, and a claimant that died before its child ever started
leaves a row that is handed off by routing and abandoned in fact. So the row is
invisible to the drain while the lease is live and visible again once it lapses,
until some claim takes it back. The wake test reads the same lease, so a worker
stirs into an exit check that no longer calls the board drained.

### Two exclusions, and why only one is lease-gated

The routing exclusion above is not the only way a row drops out of the board's
in-flight count. A board declaring `onReview: "exit"` also excuses rows sitting
in `parked`, and the two live side by side in `countWaitable` as
separate predicates rather than one widened predicate. They answer different
questions:

| | routing exclusion (`runsElsewhere`) | park exclusion (`onReview: "exit"`) |
|---|---|---|
| Asks | where does this row's work belong? | is this row waiting on a *human*? |
| Derived from | the board's dispatcher seats, plus the row's `assignee` | the row's status |
| Applies to | `in_progress` rows only | `parked` rows only |
| Applies on | boards with a dispatcher seat | any board, however it dispatches |
| Liveness conjunct | **yes** — the lease | **no** |

`runsElsewhere` reads the row's `assignee` against the seats that hand off,
and that is sound only because a hand-off board freezes the assignee at
admission (`setAssignee` declines `immutable-assignee`): the value cannot move
under the predicate, and it survives a restart with no run state to rebuild.
`claimedBy` would not do — the child never claims, so a handed-off row still
carries the session of the parent that claimed it.

**The missing liveness conjunct on the park exclusion is deliberate, not an
oversight.** The routing exclusion needs one because a routed row can be
abandoned by a claimant that died while the row still says the work belongs
elsewhere — the paragraph above is that case. A parked row cannot be in that
state. Parking moves it off `in_progress`, and the lease deliberately stops
governing a row there so that a slow human cannot have the task reclaimed out
from under them (`ticketForClaim`'s status fence, and the lease short-circuit for
any status other than `in_progress`). A lease conjunct on the park exclusion
would therefore either exclude nothing or reintroduce exactly the reclaim the
substrate prevents on purpose.

The practical consequence for a board that declares both: a handed-off row that
parks stops being excused by *routing* — it is no longer `in_progress` — and
starts being excused by the *park* exclusion instead, if and only if the board
asked for that. On the default `onReview: "hold"` it is excused by neither and
holds the drain open. What hands an excused row back into a drain is
`board.unparkAndDrain` (FIX-1244): the fenced `unpark` write, then the board's
own drain in the answering request, so the row is claimed there rather than by
whatever happens to drain next. Note that this is not the same as saying a board with a
dispatcher seat needs park-exit for its launching request to end: the hand-off
already released that request before the park, and the parent's collection
mirror cannot observe a write the child made in a separate concurrent request.

**The request record** depends on how far the child got. Four endings; only the
third leaves a row mid-flight, and the fourth leaves no row at all:

- **It unwound inside the shutdown window.** The drain fires the child's abort
  controller and nothing else, so `runAction` sees a signal with no persisted
  abort intent, takes its disconnect path, and writes `interrupted` itself — the
  same resumable status a sweep would have written, arrived at without one.
- **It never started.** A child still queued behind the in-process concurrency
  gate is written `aborted` when the drain cancels it. It reads as a deliberate
  cancellation rather than something to resume, and it is the contradiction
  FIX-1121 tracks.
- **It could not unwind in time** — the budget expired mid-run, or the process
  was killed outright. This is the record that stays `in_progress` until a sweep
  marks it `interrupted`, the status a run can be resumed from.
- **It died inside the persistence window, and left no record to mark.** On the
  `allow`/`reject` arm, acceptance resolves at the `activeRequests` write and
  the request record lands a few store round-trips later — the window
  [acceptance](#what-acceptance-means) describes. A child killed in between
  leaves a registry entry and no record, so the sweep's `get` returns
  `undefined`: it deregisters the entry and has nothing to mark. Nothing reads
  `in_progress`, and nothing records that the child existed at all. The gap is
  narrow and it is not empty, so a caller reconciling by request id should treat
  "no record" as a possible outcome of a dispatch it was told was accepted.

An operator reading a store after a shutdown should therefore expect a mix, not
one status. Three things run the sweep that clears the third case:

1. **Runtime init** — `createFlowState`'s `#detectInterruptedOnStartup`, on every
   runtime init, router or not, honouring the `detectInterruptedOnStartup`
   option. Retained rather than fire-and-forget, so `dispose()` can let it finish
   before closing adapters — within a bound (`RECOVERY_SWEEP_DRAIN_MS`, 5 s), so
   a store that has stopped answering cannot wedge shutdown.
2. **A periodic sweeper** — `createStaleRequestSweeper`, built by
   `createFlowApiRouter`, so it runs wherever a router exists *and* sweeping is
   on: at `staleSweepIntervalMs <= 0` the factory returns a no-op handle and
   nothing periodic ever runs.
3. **A client poke** — `POST .../check-interrupted`, which the DevTool calls on
   mount and on every session-list refresh.

All three converge on the same write — re-read the record, check
`status === "in_progress"`, write `interrupted` — so running them together is
safe in outcome. Two things that re-check does *not* buy are worth naming,
because the surrounding code reads as though it does.

**It narrows the terminal-overwrite window; it does not close it.** The read and
the write are separate store round-trips, and the write is a whole-record `set`
with `expectedVersion: "any"`. A record that reaches a terminal status in
between is overwritten by the stale snapshot the sweep read, stamped
`interrupted` — along with anything else persisted in that window.
`RequestStore.setFieldsIfStatus` is the verb that makes the predicate and the
write one atomic step, and is what the abort route already uses; FIX-1128 tracks
moving the sweep onto it. The staleness threshold below is what keeps the window
narrow in practice, not the re-check.

**The two startup sweeps are not ordered.** `createFlowState`'s runs from
runtime init and `createFlowRouteHandlers`' starts when the router is built,
neither awaiting the other, so on a router deployment the second can begin while
the first is still scanning and see the same rows rather than finding the work
done. Both write the same status, so an overlap costs a duplicate write rather
than a wrong one — "the second pass is an empty scan" is the common case, not a
guarantee.

The sweep only picks up a record whose executor heartbeat has been quiet longer
than the staleness threshold. That delay is load-bearing: a request that has
gone quiet for a second is not the same as one nobody is running, and treating
them alike would reclaim live work.

So a row reading in-progress just after a process stopped is expected, and it
clears itself. If nothing ever runs against that store again, nothing sweeps it,
and the row stays as it is.

## Where the invariants live in code

| Concern | Module |
|---|---|
| Locality test | `engine/src/transports/host/in-process-dispatcher.ts` → `isInProcessDispatcher` |
| Dispatch operation install, drain, disposal gate | `engine/src/flowstate/createFlowState.ts` (`dispatchDrainTimeoutMs`) |
| The dispatch seam: entry, session, envelope, start | `engine/src/context/create-request-host.ts`, `engine/src/context/dispatch-operation.ts` |
| Child session derivation and adoption | `engine/src/context/detached-child.ts` |
| Session policy and the child key | `core/src/types/dispatch.ts` → `taskSessionKeyFor` |
| The hand-off at a dispatcher seat | `orchestration/src/task-board/blocks/hand-off.ts` |
| The claim gate | `orchestration/src/task-board/task-entry.ts` → `createTaskGate` |
| Reading a board's seats; construction-time refusals | `orchestration/src/task-board/hand-off.ts` |
| Per-dispatch runtime config and the override warning | `engine/src/transports/host/createInboundTransportHost.ts` |
| Interrupted-request detection | `engine/src/execution/request-recovery.ts`, `engine/src/execution/stale-request-sweeper.ts` |
| Lease and abandonment | `packages/orchestration` → task substrate |
