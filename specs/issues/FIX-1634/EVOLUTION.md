# FIX-1634 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Three earlier designs are amended here; none is wholly superseded. Neither predecessor has a
retained spec directory, so each cites its Linear issue and the code that carries it on `main`
at `5886ca846`.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| [FIX-1302](https://linear.app/fixpoint-labs/issue/FIX-1302) (PR #1544): a delivery into an existing session refuses `external-dispatcher` past an external queue, because the recipient's concurrency policy is not applied there and the incarnation guard runs against a record the sender never approved. Carried by `engine/src/context/dispatch-operation.ts` and `create-request-host.ts` | **Amended**: narrowed to hosts whose adapter supplies no cross-process arbitration. The refusal, its name and its "nothing enqueued" promise are retained | [POC](poc/queue-path/README.md) P2: the approved lineage already rides the job and the worker drops a replaced recipient. P1: the policy gap is real and general, which D1 closes | [D2](DECISIONS.md#d2), [BR-20](BUSINESS-RULES.md#what-is-still-refused-by-name); the two guarantees restated as [BR-6](BUSINESS-RULES.md#the-recipients-concurrency-policy-across-processes) and [BR-18](BUSINESS-RULES.md#the-incarnation-guard) | A `.rescue()` branching on `external-dispatcher` still compiles and still fires on a directly passed dispatcher. On `bullmqWorker` it stops firing |
| [FIX-837](https://linear.app/fixpoint-labs/issue/FIX-837): the concurrency policy is enforced for the in-process dispatcher only; external dispatch skips arbitration, deferred to a durable substrate ([FIX-830](https://linear.app/fixpoint-labs/issue/FIX-830)). Carried by the arbiter's header in `engine/src/transports/concurrency/arbiter.ts` and the host's `isExternalDispatcher ? allow` | **Superseded in part**, for adapters that supply cross-process arbitration. The in-process arbiter, the three policies, the key ladder and the wait budget are retained | Same POC, P1. The deferral's worry, a `reject` key freed at enqueue, is met by giving the place back at run end in the worker | [D1](DECISIONS.md#d1), [PLAN S1–S3](PLAN.md#surfaces) | Existing BullMQ apps with a declared `queue` or `reject` see it enforced; `allow` is unchanged. Multi-server with no queue stays single-instance |
| [FIX-1637 ER-4](../../epics/FIX-1637/BUSINESS-RULES.md): the keeping-flows-alive page states that `{ id }` is refused on a queue host | **Amended** when this ships, as that epic's ER-14 assigns | The statement becomes false on `bullmqWorker` | [DOCS.md](DOCS.md#update-conditional--the-keeping-flows-alive-pages-fence-sentence) | Docs only |

FIX-830 is a related spike, not a replaced design: if it lands a substrate that can order
waiters, D2's *what would change my mind* applies. FIX-1018 is a dependency (its request-record
fence is consumed), and the canceled Relay issues are not revived
([Considered and dropped](DECISIONS.md#considered-and-dropped)). Before implementing, compare
these rows with current code; approved intent alone is not shipped behaviour.
