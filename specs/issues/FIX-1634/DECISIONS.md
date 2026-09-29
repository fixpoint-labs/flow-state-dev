# FIX-1634 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What was considered, what was chosen, and what each choice locks in. Two decisions are the
sign-off. The rest is recorded so nobody re-derives it.

## The tree

```mermaid
flowchart TD
  I["FIX-1634"] --> D1["D1 · the policy governs every run on a queue host"]
  D1 -.->|"rejected · HTTP runs still take no key"| X1["arbitrate deliveries only"]
  I --> D2["D2 · the queue adapter supplies an ordered-lease backend"]
  D2 -.->|"rejected · a lease has no order"| X2["the shared store's leases"]
  D2 -.->|"rejected · silent under-delivery"| X3["delete the refusal outright"]
  I --> S["Settled · the incarnation guard already crosses the queue"]
```

Solid edges are what you're signing. The settled node is recorded with evidence, not asked.

<a name="d1"></a>
## D1 · On a queue host, the session's concurrency policy governs every run, not only deliveries

| | |
|---|---|
| **Instead of** | Arbitrating only the new deliveries into an existing session, the issue's literal ask |
| **Because** | A delivery can only wait behind a key that other runs actually hold. Today no run on a queue host takes a key: two `queue` runs into one session overlap ([POC P1](poc/queue-path/README.md)). Arbitrating deliveries alone would line them up behind nothing. Tenet 5: an invariant enforced at one entry point is not enforced |
| **Locks in** | Every BullMQ app that declared `queue` or `reject` gets it enforced on upgrade: bursts into one session serialize, duplicates get 409s, and **the worst case: an app that declared `queue`, runs long, and keeps the 30s default wait budget can now see runs fail with a terminal timeout** where they used to overlap. The docs' "not enforced on external workers" limit goes away. An app that wants parallel runs declares `allow`, as it would on one server |
| **Default: no opt-out flag** | Engineering recommendation, which the owner's D1 call can override. We are pre-1.0, a flag is a second code path to keep, and declaring `allow` on a flow is already the opt-out. Instead the behaviour-change changeset **leads with this change**, and the release note says how to opt a flow out |

![D1, whose runs a session's policy governs on a queue host: every run, chosen, beside only the new deliveries. Decides it: what a delivery waits behind, which under deliveries-only is nothing. Price: existing BullMQ apps see their declared policy enforced, including terminal timeouts for long queued runs. Flips if deliveries and ordinary runs never share a session.](figures/d1-every-run.svg)

It comes down to what a delivery waits behind: deliveries-only lines up behind runs that hold
no key.

**What would change my mind:** evidence that no real flow mixes deliveries and ordinary runs in
one session. Then deliveries-only is enough, and existing BullMQ apps keep today's behaviour.

<a name="d2"></a>
## D2 · The queue adapter supplies an ordered-lease backend under the engine's one arbiter; BullMQ supplies it on its Redis; an adapter without it keeps the named refusal

| | |
|---|---|
| **Instead of** | Arbitrating on the shared store's leases, so every host gets it with no adapter work · or deleting the refusal for every external dispatcher · or the adapter shipping a whole second arbiter |
| **Because** | `queue` promises arrival order, and a queue waiter must be woken rather than poll. Redis gives BullMQ both, and BullMQ already needs it. The store's lease is one holder per request id, with no order, and whether it is shared across processes depends on the store adapter. An adapter that can't arbitrate must still fail loudly ([ER-14](../../epics/FIX-1635/BUSINESS-RULES.md#what-no-child-may-do)). And the policy (`reject`, FIFO, the budget, holder naming) stays written once, in the engine: an adapter that re-implemented it would be a second answer to who holds a session (tenet 5) |
| **Locks in** | A public, optional member on the worker-adapter contract that supplies an **ordered-lease backend with four calls: take, is-my-turn, give back, renew**, plus the place carried on the dispatch envelope. The backend holds no policy. The engine keeps its one arbiter over whichever backend is present; today's in-memory gate becomes the default backend. A third-party queue adapter implements the four calls or keeps the refusal. How a worker waits (requeue, renewal timer) stays private to the adapter. `external-dispatcher` stays in the refusal vocabulary with a narrower meaning. Every process of a deployment arbitrates over the adapter's backend, including `worker-only` processes |

![D2, where cross-process arbitration lives: the adapter's lease backend under the engine's one arbiter, chosen, beside the store's leases and deleting the refusal. Decides it: arrival order, which only the adapter keeps. Price: each queue adapter builds a four-call lease backend; the policy stays in the engine. Flips if a second adapter can store but not order.](figures/d2-adapter-supplies.svg)

It comes down to arrival order: a lease can hold a session but cannot line runs up behind it.

**What would change my mind:** a second queue adapter (the durable-execution spike,
[FIX-830](https://linear.app/fixpoint-labs/issue/FIX-830)) that can't order waiters but whose
store can. Then the store is the better home for the backend, and the adapter member becomes a default.

## Decided, not asked

- **One arbiter per process, over the adapter's backend when it supplies one.** The router's
  host, the request-host operations host and the worker's runs all use it, through the existing
  `{ arbiter }` host seam. A `worker-only` process, which
  runs its own deliveries in process today, arbitrates on the same key as the web process.
- **A place is taken before anything is written.** A `reject` refusal leaves no request record,
  as in process. Under `queue`, the place is taken at acceptance, so order is acceptance order.
- **Waiting never holds a worker slot.** A job whose turn hasn't come goes back to the queue.
  Otherwise N waiters on N slots deadlock behind a holder still in backoff.
- **A retried attempt keeps its place.** The key frees when the job is done for good, so a
  failing run can't be overtaken mid-retry.
- **The wait budget is the in-process one, counted only while waiting on the key**, from the
  run's first eligible turn, not from acceptance, so worker backlog never consumes it. A run that
  waits longer fails `ConcurrencyQueueTimeoutError`, terminal, as on one server.
- **A place's liveness never depends on the run heartbeat.** The holder's place is renewed on the
  processor's own timer, a waiter's on each requeue tick, and an expired place is checked against
  its job's BullMQ state before it is dropped, so retry backoff and heartbeat-free runs keep their
  place. A dead holder frees the key within the stale threshold. A take whose enqueue fails is
  given back in the same call path.
- **Fail closed.** If the arbiter can't be reached, the dispatch is not started and says why. It
  never runs unarbitrated.
- **A job enqueued by an older release carries no place and runs as it would have** (BP-030).
- **Upgrade workers before dispatchers.** The reverse mix (an old worker running a new job) runs
  that job unarbitrated once and its key frees within the stale threshold. No envelope version: an
  old worker can't read one. The release note and the bullmq README say so.
- **A refused duplicate is answered by one owner**: 409 for an HTTP action, `200 skipped` for a
  webhook, on the sync and async paths alike.
- **A delivery dropped for a replaced recipient leaves no record**: `request.get(id)` returns
  `undefined`, matching the POC.
- **Workforce docs sentences that state the refusal on BullMQ are narrowed in the same PR.** Docs
  only; no Workforce code. The kitchen-sink README waits for the adopt child's proof.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Route every run for a session to one worker (partitioned queues, BullMQ Pro groups) | Pro-only, or a queue per session. Fixes placement, not the policy: `reject` still needs a holder |
| Take the key at enqueue and release it at enqueue | Frees a `reject` key before the run ends. The arbiter's own note already rejects it |
| Re-approve the recipient in the worker | Approves against a record the sender never saw, the issue's own concern. The carried lineage is stricter |
| Revive the canceled Relay design ([FIX-1230](https://linear.app/fixpoint-labs/issue/FIX-1230), [FIX-1231](https://linear.app/fixpoint-labs/issue/FIX-1231)) | Those add a reply wait and a cross-worker wake channel. A delivery stays fire-and-forget; nothing here waits on a reply |
| A cross-process lock for multi-server deployments with no queue | Not this issue's host. Documented as single-instance |

<a name="settled"></a>
## Settled

- **The incarnation guard already crosses the queue** — **CONFIRMED** on a real BullMQ host
  (`5886ca846`). A delivery carrying the approved lineage runs; the same delivery with a stale
  one is dropped in the worker, its record reconciled away. So the guarantee is restated, not
  rebuilt. The residual window, a recreate after the worker's check, is the same as in process.
  ([POC P2](poc/queue-path/README.md))
- **A queue host applies no concurrency policy to any run today** — **CONFIRMED**. Two `queue`
  runs into one session overlap on BullMQ and serialize in process. This is D1's premise.
  ([POC P1](poc/queue-path/README.md))
- Both rest on the POC until [PLAN VP](PLAN.md#checks) passes in PR-B: the same claims through the
  real `{ id }` dispatcher envelope, in a `REDIS_URL`-gated test in `packages/bullmq`.

## How it got here

- **Draft** — framed as the refusal guarding two guarantees, one of which a POC showed already
  holds; chose cross-process arbitration for every queue-host run, supplied by the adapter, with
  the refusal kept for adapters that can't; two PRs, engine then BullMQ.
- **Round 1** (Cursor review): D2's public surface narrowed to two calls, take and give back,
  plus the place on the envelope; waiting for the turn stays private to BullMQ. The plan gained
  a jittered-requeue guardrail, an explicit wake on give-back, the VP graduation gate and a
  minimal proof set. D1 unchanged.
- **Round 2** (second-look comment, Codex review): policy split from backend, so D2's public
  surface is a four-call lease backend under the engine's one arbiter. Place liveness made
  independent of the run heartbeat; the wait budget counts key-wait only; rollout order named;
  one owner for refused duplicates, keeping the webhook's `200 skipped`; the stale-lineage record
  outcome pinned to deletion. D1's price now names terminal timeouts, with no opt-out flag as the
  default.

**Open: none.**
