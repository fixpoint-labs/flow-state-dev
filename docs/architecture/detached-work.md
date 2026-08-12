# Detached Work

Detached work is a unit of work that outlives the request that started it. It
runs in a **Workstream** — a child session hanging off the conversation that
started it — dispatched through `ctx.requestHost.startDetached`.

This document owns one question the other docs each answer a slice of: **what
happens to detached work over its lifetime**, per deployment topology. What
"started" means, where it actually runs, whether it survives the process, who
holds the task's lease when nobody is running it, what `dispose()` settles, and
what brings an abandoned run back.

Related, and deliberately not restated here:

- [State and Scopes](./state-and-scopes.md) → *Workstreams and Scope* — what a
  child session inherits, and where a `sharedToWorkstream` resource stores.
- [Inbound Transports](./inbound-transports.md) — the dispatch seam and the
  request host's four verbs.
- `packages/orchestration/README.md` → *Declaring detached work* — the task-board
  surface that is the ordinary way to start one.

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
| `worker-only` | **none** | this process | the child is registered here, and may still be awaiting execution | **no** | detached children **yes**, bounded; a claimed job yes, *unbounded* |
| No request host (CLI with no config) | — | nowhere | `NoRequestHostError` is thrown | — | — |

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
bounded.** The drain below waits for *in-process detached children* and races
`detachedDrainTimeoutMs`. Separately, `dispose()` awaits the worker handle, and
for the BullMQ adapter that is a non-forced `Worker.close()`, which waits for
whatever jobs that process has already claimed. Any topology that consumes the
queue — `colocated` and `worker-only` both, since `startWorker` runs for every
mode except `dispatch-only` — therefore holds shutdown open for a claimed job
for as long as that job takes, with no framework budget over it. Size the
platform's kill timeout for the longest job, not for `detachedDrainTimeoutMs`.

**`worker-only` is the trap.** It is the natural place to start durable jobs and
the one place they silently are not durable. The mode consumes the queue and
dispatches nothing, so `startDetached` there runs the child in the worker
process itself and enqueues nothing. A crash or a redeploy loses the run
outright rather than costing a retry. For the queue to own the work, start it
from a process that has a dispatcher — `colocated` or `dispatch-only`.

That the feature works at all in `worker-only` is deliberate: a topology that
claims support while refusing detached work is not supporting it. Running it
in-process is the honest interim answer, not a durability guarantee.

**No request host is a different failure from no start operation.** A context
with no `requestHost` at all throws `NoRequestHostError` (`code:
"no-request-host"`) — the CLI running on directory discovery or `--no-config`.
A host that exists but was wired without a start operation *refuses* with
`no-start-operation`, a named return rather than a throw. A `createFlowState`
deployment wires one in every topology, and so does the shipped HTTP router, so
the refusal is reachable only on a runtime config assembled without either.

## What acceptance means

`startDetached` returns once the child is *accepted*, and what that guarantees
differs by row above.

**In-process.** The child is discoverable in this process, and what that rests
on depends on the action's concurrency policy. Under `allow` and `reject` it is
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
job. Both are confirmed before `startDetached` returns: a failed store write or
a rejected enqueue fails the dispatch rather than reporting a start, so an
unreachable queue surfaces as an error instead of as silence. Because the
request is registered at enqueue time, an SSE client can attach to
`GET /requests/:id/stream` before any worker claims the job.

Acceptance is not execution. A queue with nothing draining it is an ordinary
state — the job sits there, and the caller finishes exactly as it would if a
worker were pulling. Whether the work ever ran is a question for the
Workstream's own request list.

## What cannot cross the queue

A `RuntimeConfig` holds live model resolvers, providers and loggers. None of
them serialize, so a **per-request** config cannot travel with an enqueued job.
The job payload carries the serializable envelope only — flow kind, action,
input, identity, source, metadata, request id — and the worker runs it under the
`runtimeConfig` that worker was built with.

The shipped case is `fsdev run --model`. The override reaches every generator in
the command's own process, including in-process detached work, and stops at the
queue. `createInboundTransportHost` detects exactly this — an external
dispatcher plus a launching config whose `modelResolver` differs from the host's
— and logs a warning naming the request that lost it.

The envelope contract this rests on, including why carrying the selected model
*id* across would not fix it, is
[Inbound Transports](./inbound-transports.md#execution-configuration-is-per-host-with-one-per-envelope-exception)'s.

## Shutdown: what `dispose()` settles, and what it does not

`dispose()` drains **in-process** detached children and no others.

The tracking is keyed on the same `isInProcessDispatcher` test: `onDispatched`
registers a child for the drain only when it runs here. An externally dispatched
child is deliberately untracked — the enqueue is already confirmed, so there is
no half-written row to strand, and its `finished` resolves only when some worker
completes the job. Waiting on that would block shutdown on a process this one
does not control, indefinitely when the workers live elsewhere.

Admission closes before the drain looks. Once `dispose()` begins, the start
operation refuses new detached work outright (`notStarted`, with a reason), which
is what makes the drain's snapshot complete rather than merely early. A
`startDetached` already in flight arrives afterwards and is refused: the child
session record exists with no run, which is the adoptable state a retry already
handles.

The drain runs in rounds, because detached work may itself detach and a
grandchild registered mid-await belongs to this drain too. Every wait races
`detachedDrainTimeoutMs` (default 30 s; `0` skips the wait). At the budget it
cancels what is still running, gives it a brief window *inside* the same budget
to unwind, and reports the request and session ids it gave up on — on stderr,
even when the runtime logger is silenced, since work may have been left
unfinished.

**Shutdown cancels; settling is meant to be somebody else's job.** The drain
fires each child's abort controller and writes nothing on its behalf. One path
breaks that rule today: a child still queued behind the in-process concurrency
gate is written `aborted` by `terminateUnenqueuedRequest` at the moment the
drain cancels it, before it ever runs (FIX-1121). Everywhere else the division
holds, and it holds only because something else recovers — the next section.

## What a stopped process leaves behind, and what recovers it

A process can stop while detached work is still running — a shutdown that ran
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

**A lapsed detached row resumes holding the launching drain open.** The
exclusion that lets a handed-off row drop out of the board's in-flight count
requires a live lease: `isHandedOff` is `in_progress && runsElsewhere(task) &&
!leaseLapsed(...)`. Routing says where the work belongs, the lease says whether
anyone is actually on it, and a claimant that died before its child ever started
leaves a row that is detached by routing and abandoned in fact. So the row is
invisible to the drain while the lease is live and visible again once it lapses,
until some claim takes it back. The wake test reads the same lease, so a worker
stirs into an exit check that no longer calls the board drained.

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
  "no record" as a possible outcome of a start it was told was accepted.

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
| Start operation install, drain, disposal gate | `engine/src/flowstate/createFlowState.ts` → `#installDetachedStart`, `#drainDetachedChildren` |
| Child session derivation and adoption | `engine/src/context/detached-child.ts`, `engine/src/context/create-request-host.ts` |
| Per-dispatch runtime config and the override warning | `engine/src/transports/host/createInboundTransportHost.ts` |
| Interrupted-request detection | `engine/src/execution/request-recovery.ts`, `engine/src/execution/stale-request-sweeper.ts` |
| Lease and abandonment | `packages/orchestration` → task substrate |
