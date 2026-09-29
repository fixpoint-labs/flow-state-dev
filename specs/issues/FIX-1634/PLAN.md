# FIX-1634 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan** · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

Written for the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md)
(BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. Two PRs; the seam is the arbiter contract.
Both start only after FIX-1018 ([#2377](https://github.com/fixpoint-labs/flow-state-dev/pull/2377))
merges ([D3 of the epic](../../epics/FIX-1635/DECISIONS.md#d3)).

## Surfaces

| ID | Package · role | Change | Rules |
|---|---|---|---|
| S1 | `engine` · the concurrency arbiter contract | The public cross-process contract is **two calls**: **take a place** (at dispatch, async, `reject` refuses here) and **give the place back** (at run end, on cancel, or when the enqueue fails). **Waiting for the turn is not on it**: it is private to the adapter's worker (S8). The in-memory arbiter keeps its one synchronous gate and unchanged behaviour. [Contract sketch](#the-public-contract-sketch) | BR-6 to BR-13, D1, D2 |
| S2 | `engine` · `WorkerAdapter` / `createFlowState` | An optional member through which an adapter supplies that two-call arbiter. When present, it is the one arbiter for every host in the process: the router's, the request-host operations host, and the worker's runs (D2) | BR-14, D2 |
| S3 | `engine` · the host's external branch (`createInboundTransportHost`) | **Remove** the "external dispatch skips arbitration" passthrough. With a cross-process arbiter: take the place before `admitOwnership`/`materializeOwned` (FIX-1018's fenced writes, kept), carry it on the envelope, release it if the enqueue fails. With none: today's behaviour | BR-5, BR-7, BR-8, BR-16 |
| S4 | `engine` · the dispatch operation | Refuse `delivery: "existing"` only when the host is external **and** its arbiter is not cross-process. Refusal text names the missing capability | BR-1, BR-2, BR-20 |
| S5 | `engine` · the HTTP action and webhook routes | A `ConcurrencyRejectedError` now also arrives through `accepted`; map it to the same 409 as the synchronous throw | BR-7 |
| S6 | `engine` · `DispatchEnvelope` | Carries the place (key + ticket) so the worker can wait on it and give it back. Optional, `== null`-guarded | BR-17 |
| S7 | `bullmq` · a Redis arbiter | Places as a per-key ordered set in Redis, each a lease renewed on the run's heartbeat and expiring within the stale threshold; each place records its job id. `reject` is claim-if-empty; turn is "lowest live place". Take, turn check, renew and give-back are each one Lua script. **Give-back wakes the next waiter explicitly** (`arbiter-give-back.lua`, [guardrail](#guardrails)) | BR-6, BR-7, BR-11, BR-15 |
| S8 | `bullmq` · the job processor | Before `runAction`: not its turn → **delayed requeue with jitter**, holding no slot and counting no attempt ([guardrail](#guardrails)). Give the place back on completion and on final failure; keep it across retries. A job with no place runs as today. The turn check and the requeue loop are private to this package | BR-9, BR-10, BR-12, BR-13, BR-17 |
| S9 | `bullmq` · `bullmqWorker` | Supplies S7 through S2 | D2 |
| S10 | `integration-tests` · the two-users harness | A BullMQ variant: a `dispatch-only` web runtime and two `worker-only` runtimes, each with its own in-memory arbiter (separate OS processes are optional; separate arbiters are not), one SQLite file, real Redis from `REDIS_URL` | the goal |
| S11 | `integration-tests` · `queue-delivery.test.ts` | The goal check, in the shared suite | BR-1, BR-3, BR-6, BR-20 |
| S12 | CI | A Redis service on the job that runs the suite; the case fails rather than skips when `CI` is set and Redis is absent | the goal |
| S13 | Docs | [DOCS.md](DOCS.md) | — |

## Sequence

```mermaid
flowchart TD
  S1["S1 · take and give back"] --> S2["S2 · adapter supplies it"]
  S1 --> S3["S3 · external branch arbitrates"]
  S3 --> S4["S4 · refusal narrowed"]
  S3 --> S5["S5 · async 409"]
  S3 --> S6["S6 · place on the envelope"]
  S2 --> S9["S9 · bullmqWorker supplies it"]
  S6 --> S8["S8 · processor waits and releases"]
  S7["S7 · Redis arbiter"] --> S9
  S8 --> S9
  S9 --> S10["S10 · harness"]
  S10 --> S11["S11 · the case"]
  S11 --> S12["S12 · CI Redis"]
  S11 --> S13["S13 · docs"]
```

### PR plan

| id | deliverables | depends_on |
|---|---|---|
| PR-A | S1 to S6, with engine tests against a fake two-call arbiter (two instances over one backing map, standing in for two processes). No adapter supplies one yet, so no deployed behaviour changes | FIX-1018 merged |
| PR-B | S7 to S13: the Redis arbiter, the processor, the harness, the case, the VP graduation test, CI Redis, docs | PR-A |

PR-A ships nothing a user sees, which is what makes it a clean seam. PR-B is where D1 and D2
become true, and it carries the goal check and the changeset.

## Checks

| ID | Runs after | Passes when |
|---|---|---|
| V1 | S1 | The existing in-process concurrency suite is green unchanged: behaviour of the in-memory arbiter does not move |
| V2 | S3, S4 | With the fake cross-process arbiter: an `{ id }` delivery is accepted and runs; the existing stub-dispatcher test in `dispatch-delivery-guards.test.ts` still refuses `external-dispatcher` (BR-20, **D2's check**) |
| V3 | S5 | Two HTTP actions under `reject` on the fake arbiter: the second gets 409 naming the first, and no record exists for it (BR-7) |
| V4 | S7, S8 | `bullmq` tests on real Redis: BR-9 (N+1 waiters, N slots, holder in backoff; the stress case also shows waiters back off rather than spin, and a give-back starts the next waiter without it waiting out its delay), BR-10, BR-11 (kill the holder's worker), BR-12, BR-13, BR-15, BR-16 (Redis stopped) |
| V5 | S8 | A replaced recipient is dropped in the worker and its place given back (BR-18), through the real `{ id }` path (VP) |
| VP | S9 | **The POC graduation gate.** PR-B lands a `REDIS_URL`-gated test in `packages/bullmq` (fails rather than skips when `CI` is set) that drives P1 and P2 through the real `dispatcher()` `{ id }` envelope, not the POC's `delivery: "child"` shortcut. P1 and P2 count as graduated only when it passes; until then [Settled](DECISIONS.md#settled) rests on the POC alone |
| V6 | S9 | Two HTTP actions into one session on BullMQ serialize; on the commit before S9 they overlap (**D1's check**, the POC's P1 turned around) |
| VG | S11 | [The goal](SPEC.md#the-goal-and-how-well-know-its-met): `packages/integration-tests/src/two-users-one-tenant/queue-delivery.test.ts` PASSES, after FAILING on the commit before the fix (**delivers**, **one-at-a-time**) and under `GOAL_CONTROL=local-arbiter` (**one-at-a-time**). The PR names the commit |
| V7 | S12 | CI runs the case with Redis, and a run with `CI` set and no Redis fails it rather than skipping |

**Minimal proof set:** VG, VP, and from V4 BR-9, BR-11 and BR-16. PR-B does not merge without
these. The rest of V4 is wanted, but PR-B should not grow into a wall of Redis tests before VG is
green.

Second path (BP-035): cancel while waiting (BR-13), concurrent-409 (BR-7), multi-tenant (BR-15),
legacy job (BR-17), null place on the envelope (S6).

## Pinned names

| Where | Name | Why pinned |
|---|---|---|
| Refusal | `external-dispatcher` | Public; kept, narrowed (D2). Renaming it breaks every `.rescue()` that branches on it |
| Refusal | `dispatch-rejected` | Public; a delivery refused by `reject` on a queue host gets the one it gets in process |
| Env var | `REDIS_URL` | Read by the case; the closure's leg c sets it |
| Control | `GOAL_CONTROL=local-arbiter` | The case's named control |

The adapter member, the two calls and the job fields are yours to name.

## The public contract sketch

Illustrative, to pin the **shape** of D2's public surface: two calls and one envelope field.
Nothing else goes on the engine contract or `WorkerAdapter` in PR-A.

```ts
/** A run's place in one session key's line, as the adapter's arbiter issued it. */
interface ArbiterPlace {
  readonly key: string;      // tenant-namespaced concurrency key
  readonly ticket: string;   // opaque to the engine
}

/** Supplied by a queue adapter that can arbitrate across processes. */
interface CrossProcessArbiter {
  /** Take a place before anything is written. `reject` with the key held throws
   *  ConcurrencyRejectedError; `allow` / key `none` never reach it. Unreachable → throws (fail closed). */
  take(input: {
    key: string;
    policy: "queue" | "reject";
    requestId: string;
    jobId?: string;          // lets give-back wake this waiter
  }): Promise<ArbiterPlace>;
  /** Give the place back; idempotent. Wakes the next waiter on the key. */
  giveBack(place: ArbiterPlace): Promise<void>;
}

interface WorkerAdapter {
  // ...existing members
  readonly arbiter?: CrossProcessArbiter;
}

interface DispatchEnvelope {
  // ...existing fields
  readonly arbiterPlace?: ArbiterPlace | null; // == null → legacy job, runs as today (BR-17)
}
```

Waiting for the turn is deliberately absent. BullMQ's turn check and requeue live in
`packages/bullmq` (S8). If a second adapter needs the same, that is when a shared shape is earned.

**BR-14 with no public wait.** A `worker-only` process that runs a delivery in process must still
wait its turn. `bullmqWorker` owns that process's run loop, so it meets BR-14 privately. If the
engine turns out to need a public wait to meet it, stop and raise it: that widens D2 again and
goes back to the owner.

## Guardrails

| Rule | Because |
|---|---|
| One arbiter per process, and every host in it uses the same one (tenet 5) | A second host with its own lock is a second answer to "who holds this session", and the two answers race |
| Take the place before any write, give it back on every exit | A refused caller must leave nothing, and a stranded place blocks a session until its lease runs out |
| Waiting never holds a worker slot | Holding one deadlocks a worker whose slots are all waiters behind a holder in backoff |
| **Not its turn → delayed requeue with jitter**, never an immediate requeue. The delay backs off from a short base to a cap of a few seconds, with full jitter, and is clamped to what is left of the wait budget, so the last requeue lands at the budget's end and fails `ConcurrencyQueueTimeoutError` there. The time spent delayed counts against the wait budget (BR-10). A requeue is **not an attempt**: it must not consume BullMQ `attempts` or trigger its backoff (confirm the mechanism in the pinned version; see *At implement time*) | An immediate requeue under one hot key churns Redis and the queue with no useful work, which is the BR-9 scenario. Counting requeues as attempts would fail a healthy waiter as if it had errored |
| **Give-back wakes the next waiter explicitly.** `arbiter-give-back.lua` removes the place, reads the next live place's job id, and promotes that delayed job to waiting in the same script | Without it, the gap between one run ending and the next starting is the waiter's remaining delay, and `queue`'s arrival order holds only in the store, not in when runs start |
| Fail closed when the arbiter is down | An unarbitrated run is the silent under-delivery ER-14 forbids |
| The seam's checks and the worker's lineage check are consumed, not moved or duplicated | They already hold on the queue path (POC P2); a second copy drifts |
| Nothing in core, engine or bullmq names a channel, seat, specialist or roster (ER-13) | Layer 1 only; Workforce adopts later |
| The case imports only package entry points | The closure runs it against installed tarballs |

## Docs

Reconcile [DOCS.md](DOCS.md) against shipped behaviour in PR-B, after V6 and VG pass, through
the `docs-writer` then `docs-editor` agents. PR-A publishes nothing.

## Sketch · pseudocode, illustrative, react to the shape

```
at dispatch (any process):
    decision ← the entry's policy and key            (unchanged)
    if host is external and arbiter is cross-process:
        place ← arbiter.take(decision, requestId)     ← reject refuses here
        write the request record, carrying the place   (FIX-1018's fence)
        enqueue(envelope + place)
    else if external: today's path, and an existing-session delivery is refused
    else: in process, as today

in the worker, before running:
    if job has a place and it is not its turn:
        requeue delayed + jittered, no slot, no attempt; fail if the wait budget is spent
    run  (lineage check, as today)
    on completion or final failure: arbiter.giveBack(place)   ← wakes the next waiter
```

**POC:** [`poc/queue-path/`](poc/queue-path/README.md), a characterization on a real BullMQ host.
It showed both premises: no run on a queue host is arbitrated today (P1), and the incarnation
guard already crosses the queue (P2). The second moved the design: the lineage is consumed, not
rebuilt. Both graduate only through VP, on the real `{ id }` path.

No factual-base checker: the only counted facts are the six doc sentences that state the
refusal (three in `channels.md`, three in the Workforce README), listed by `grep -rn
external-dispatcher` at `5886ca846`.

## At implement time

- FIX-1018 merged: rebase on it and confirm `materializeOwned` still fences the external branch's
  enqueue-time write. Take the place before it.
- The keeping-flows-alive page ([FIX-1639](https://linear.app/fixpoint-labs/issue/FIX-1639)) may
  have published the fence sentence. If so, it is on [DOCS.md](DOCS.md)'s list ([FIX-1637
  ER-14](../../epics/FIX-1637/BUSINESS-RULES.md)).
- Check how BullMQ's pinned version moves a running job to delayed without counting an attempt
  (move-to-delayed plus its delayed-error signal is the expected route), and how a delayed job is
  promoted from inside a Lua script. If either is missing, the processor needs its own requeue;
  the guardrails still hold.

## Follow-ups

- The Workforce adopt child ([epic plan](../../epics/FIX-1635/PLAN.md#not-children-deliberately)):
  with this merged, channel posts and escalations should run on BullMQ with no Workforce code
  change. Its work is the end-to-end proof under `FSD_BULLMQ_DISPATCH=1`, the kitchen-sink README
  paragraph, and the stale comments in `workforce/src/channel/channel-flow.ts` and
  `channel-post-capability.ts`.
- Several web servers with in-process dispatch and no queue stay single-instance for concurrency.
  Flagged, not filed.

## Notes from review

Recorded verbatim for the implementer to weigh against real code. Not folded into the design.

**Round 1 · Cursor, review 5357984259 (optional trim):**

> SPEC/DECISIONS/PLAN repeat the same guardrails in prose + mermaid + SVG; one canonical list plus
> one figure per decision (D1/D2) would shrink amendment cost. BR table vs V1–VG overlaps — marking
> a **minimal proof set** (goal + BR-9/11/16) vs nice-to-have CI could keep PR-B from becoming
> fifteen Redis tests before VG.

The minimal proof set is marked under [Checks](#checks). The duplicated guardrails are left as
they are.

**Round 1 · second-look + architecture comment on the PR (issue comment 5898065498).** It arrived
in the same round but outside the coordinator's triage list, so it is recorded here and not
triaged. The part on how give-back wakes a waiter overlaps the give-back guardrail above:

> **1. A waiting run has no heartbeat, but the place is "a lease renewed on the run's heartbeat"
> (DECISIONS → dead holder; PLAN S7).** A run that is queued or waiting for its turn isn't running,
> so nothing renews its place. Either waiters expire from the ordered set and lose their position
> (breaks BR-6 order under any wait longer than the stale threshold), or the lease is never really
> renewed for waiters and a web process that dies between "take place" and "enqueue" strands a
> place. Pin who keeps a *waiting* place alive (only the holder holds a heartbeat lease and waiters
> are un-leased and removed by job completion/cancel/failure? or waiters renew on each requeue
> tick?). BR-11 only covers the dead *holder*.

> **2. "Back to the queue" reads as polling; D2's own rationale says a waiter must be *woken rather
> than poll*.** S7 says give-back "wakes the next", but S8's requeue has no wake path to the
> specific delayed job. Without one, latency between holder finish and next start is the requeue
> delay, and N waiters each cost a Redis round trip per cycle. Suggest the place carry the
> waiter's job id so give-back can promote the next place's job. That's the concrete meaning of
> "wake" and it makes D2's arrival-order argument true in the mechanism, not just the store. The
> PLAN's open item (does moving a running job back to waiting count an attempt) is the right thing
> to settle first, because BR-12 (keeps its place across retries) and BR-10 (budget) both lean on
> it.

> **3. The wait budget counted "from acceptance" changes meaning on a queue host (DECISIONS →
> decided, BR-10).** In process, acceptance→start is only key wait. On a queue host it also
> includes worker-backlog time that has nothing to do with the session key. Under load, a run can
> hit `ConcurrencyQueueTimeoutError` (terminal) without ever having waited on its session. Count
> only time spent waiting on the key (from first eligible attempt), or say why acceptance is
> intended. This also matters for D1's "if wrong" line: it names slower bursts and 409s but omits
> *terminal timeouts* for existing BullMQ apps that declared `queue` with long runs and a 30s
> default budget. That belongs in the sign-off price, since it's the worst upgrade outcome, not a
> slowdown.

> **4. D1 has no escape hatch beyond editing every flow.** "Declare `allow`" works, but an app
> upgrading gets enforcement silently. Consider whether the release note plus the changeset is
> enough, or whether the adapter member should be opt-in for one release (feature-flagged supply of
> the arbiter). I lean toward flagging: D1 is the one changing existing behaviour and the spec
> already treats it as the weighty call. Your call as product owner; if you keep it as-is, just
> say the changeset must lead with this.

> **Split policy from backend instead of shipping a second arbiter.** S7 ("a Redis arbiter") plus
> S1's three halves means BullMQ reimplements `reject` claim-if-empty, `queue` FIFO, budget and
> holder-naming, which today live once in `engine/src/transports/concurrency/arbiter.ts`
> (`resolve`, `gate`, `holders`, the 30s budget). Two implementations of one policy is the tenet-5
> drift the spec's own guardrail warns about ("a second answer to who holds this session"), just
> moved one level down. Deeper shape: engine keeps the single arbiter (policy, key resolution,
> budget, `ConcurrencyRejectedError`), and the adapter supplies only a small ordered-lease
> *backend* (take / is-my-turn / give-back / renew). The in-memory keyed gate becomes the default
> backend; Redis is the second. Consequences: S2's "optional member" becomes a narrow backend
> contract (easier for a third-party adapter than a full arbiter, which softens D2's "second
> public contract" price), PR-A's fake cross-process arbiter is literally the test backend, and V1
> (existing suite unchanged) covers the shared policy for both. Existing
> `createInboundTransportHost({ arbiter })` injection already gives one seam for this. S2 may not
> need to add a new one.

> - PLAN S5 says a `ConcurrencyRejectedError` "now also arrives through `accepted`". Worth a single
>   owner for the 409 mapping so the sync and async paths can't diverge.
> - Confirm the `poc/` tree is excluded from default vitest/tsc discovery (retention isn't
>   permission to weaken checks); the README's copy-into-`packages/engine/test` run instructions
>   imply it is, but I did not verify the configs.
