# FIX-1634 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

Two promises change for readers: a concurrency policy now holds on a BullMQ deployment, and a
delivery into an existing session works there. Every page below already states the opposite, so
each is an UPDATE; no new page. The epic's shared narrative (ids as addresses) is FIX-1018's and
is not repeated. Published in PR-B, reconciled against shipped behaviour through `docs-writer`
then `docs-editor`.

Voice rules most at risk here: no internal issue numbers on `apps/docs`, no "now" or "no longer"
(describe what it does, not what changed), and introduce "arbitrate" in plain words on first use.

## UPDATE · `apps/docs/docs/advanced/concurrency-policies.md` · "Limits" (replaces the section)

> ## Limits
>
> On a single server with no queue, the policy is enforced in memory, in the process that runs
> the request.
>
> On a queue-backed deployment such as `bullmqWorker`, the policy is enforced across every
> process of the deployment, the web process and each worker. A run takes its place on the key
> when it is accepted, and waits for its turn in whichever worker picks it up. A worker never
> spends one of its slots waiting: a run whose turn hasn't come goes back on the queue. Order is
> the order runs were accepted in. The wait budget is the same as on one server and counts only
> time spent waiting for the session, not time spent queued behind unrelated work.
>
> If the process running the holder dies, the key frees within the stale threshold, and the next
> run starts. If the queue adapter's store can't be reached when
> a run needs a place, the run is not started and the caller is told why. It never runs without
> the policy.
>
> Several web servers that each run requests in process, with no queue between them, each keep
> their own keys. Run that shape as a single instance, or put a queue in front of it.
>
> A dispatcher you pass directly, rather than through a `worker` adapter, applies no policy to
> the work it hands off, and a [delivery into an existing session](../server/background-work.md#starting-a-job-from-a-flow)
> is refused on it.

## UPDATE · `apps/docs/docs/server/background-work.md` · the refusal table's last row, and one paragraph after the table

The row:

> | `external-dispatcher` | An `id` delivery on a deployment whose dispatcher hands work to another process and cannot hold a session's concurrency policy across processes: a dispatcher passed directly, or a `worker` adapter that doesn't supply one. `bullmqWorker` supplies one, so it does not refuse. A `key` dispatch is unaffected |

After the table:

> On a queue-backed deployment, an `id` delivery runs in whichever worker picks it up, and it
> waits for the recipient session's concurrency policy like any other run into that session. If
> the session is deleted and created again while the delivery waits in the queue, the worker drops
> the delivery rather than run it in the new session.

## UPDATE · `packages/bullmq/README.md` · new section "Concurrency across workers", before "Limits"

> ## Concurrency across workers
>
> `bullmqWorker` enforces each entry's `concurrency` policy across the whole deployment, using the
> same Redis as the queue. Two `queue` runs into one session run one after the other even when
> they land in different worker containers, and a `reject` duplicate gets a 409 naming the run in
> flight. A worker never blocks a slot waiting: a job whose turn hasn't come goes back on the
> queue, and a retried job keeps its place.
>
> A delivery into an existing session (`dispatcher()` with `session: { id }`) runs here, under the
> recipient's policy. Declare `concurrency: "allow"` on an entry that should run in parallel.
>
> When you upgrade, roll out workers before the processes that enqueue. A job enqueued by the new
> release and picked up by a worker from the release before runs once without the policy, and its
> session can then wait up to the stale threshold before the next run starts.

## UPDATE · `packages/core/README.md` · the refusal table's `external-dispatcher` row

> | `external-dispatcher` | An `id` target (or `{ from: true }`) on a host whose dispatcher runs requests in another process and cannot apply the recipient's concurrency policy there: a dispatcher passed directly, or a `worker` adapter that supplies no cross-process arbitration. `bullmqWorker` supplies it. |

## UPDATE · `packages/engine/README.md` · "Execution backend (worker adapters)"

Append to the `WorkerAdapter` bullet:

> An adapter may also supply an ordered-lease backend for concurrency. When it does,
> `createFlowState` runs its one concurrency arbiter over that backend for every run in the
> process, in process or queued, and an `id` delivery through the adapter's dispatcher is
> accepted. The backend stores ordered leases only; the policy stays in the engine. An adapter
> without one keeps the `external-dispatcher` refusal for `id` deliveries.

The member's name and signature are pinned in PR-A and written in here then.

## UPDATE · `apps/docs/docs/workforce/channels.md` · three sentences

Each keeps its paragraph and changes only the condition, so the page states the refusal where it
still applies and promises nothing about a desk it has not seen run.

> It needs a deployment that can deliver into an existing session. Behind a dispatcher that
> can't apply the channel's concurrency policy across processes, the tool call fails with
> `external-dispatcher`.

> The dispatch goes into an existing session by its id. Behind a dispatcher that can't apply the
> recipient's concurrency policy across processes, it is refused with a `DispatchRefusedError`
> whose `refused` is `"external-dispatcher"`. To tell the model the board is unavailable rather
> than letting the tool fail, put the dispatcher in a sequencer and handle the error in the
> sequencer's `.rescue()`.

> Posting from another flow needs a deployment that can deliver into an existing session. Behind
> a dispatcher that can't apply the channel's concurrency policy across processes, a post into an
> opened channel is refused with `external-dispatcher`.

The heading "Where posting from another flow works, and where it doesn't" stays.

## UPDATE · `packages/workforce/README.md` · the three `external-dispatcher` statements

The same narrowing: "on a deployment whose dispatcher hands work to an external queue" becomes
"behind a dispatcher that can't apply the channel's concurrency policy across processes", in the
flow-to-flow post paragraph, the refusal list, and the refusal table's row.

## UPDATE · `docs/architecture/inbound-transports.md` · the `usesExternalDispatcher` paragraph

> `host.usesExternalDispatcher` says whether `dispatch` hands the run to another process. A
> request-host operation refuses a `dispatcher()` delivering into an existing session (`{ id }`)
> with `external-dispatcher` only when the host is external **and** the worker adapter supplied
> no lease backend. With one, the process's single arbiter runs over it: every dispatch on the
> external branch takes its place on the concurrency key before anything is written, carries it
> on the envelope, and the worker waits for its turn and gives it back.

Also retire the arbiter note "v1 enforces the policy for the in-process dispatcher only" in the
same file wherever it is restated.

## UPDATE · `docs/architecture/action-forms.md` · the `{ id }` sentence

"and is refused under an external dispatcher (`usesExternalDispatcher`, refusal
`external-dispatcher`) because the run would start on another process against a session this one
cannot fence" becomes:

> and is refused under an external dispatcher whose worker adapter supplies no lease backend
> (refusal `external-dispatcher`), because the run would start on another process with no
> arbiter shared across processes to hold the recipient's policy.

## UPDATE · `docs/architecture/dispatched-work.md` · the shared-child concurrency sentence

"Only the in-process dispatcher enforces it: with an external dispatcher the host skips
arbitration (`createInboundTransportHost.ts`), so rows sharing a child can overlap there" becomes:

> It is enforced wherever the process's arbiter can see every run: in process, or on an external
> dispatcher whose worker adapter supplies a lease backend. A dispatcher passed directly, with no
> backend, still skips arbitration, so rows sharing a child can overlap there.

## UPDATE · `docs/contributing/architecture-reference.md` · the action-forms bullet

Its unconditional "`{ id }` … refused under an external dispatcher" clause gains the same
condition: refused only when the worker adapter supplies no lease backend.

## UPDATE, conditional · the keeping-flows-alive page's fence sentence

If FIX-1639's page has published the `{ id }` fence, its sentence becomes: *"On a host whose
dispatcher can't apply a session's concurrency policy across processes, `session: { id }` is
refused with `external-dispatcher` before anything starts. `bullmqWorker` applies it, so `{ id }`
runs there."* [FIX-1637 ER-14](../../epics/FIX-1637/BUSINESS-RULES.md) assigns this edit here.

## Not changed

- The kitchen-sink README's limitation paragraph. The Workforce adopt child updates it once the
  desk is proved on BullMQ end to end.
- `apps/docs/docs/server/authentication.md`: FIX-1018's.
