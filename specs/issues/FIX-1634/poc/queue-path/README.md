# POC · what the `external-dispatcher` refusal actually protects

An experiment, not a supported API. Nothing here is imported by production code, and it is
outside default test, lint and knip discovery.

## The question

The refusal names two guarantees a delivery would lose past a queue: the recipient's concurrency
policy, and the incarnation guard. Which of them is really lost on a BullMQ host today, and for
which runs?

## What it checks

`characterize.test.ts` boots `createFlowState` with `bullmqWorker` (colocated, worker concurrency
4) against a real Redis, and runs through the real enqueue → worker → `runAction` path. Nothing is
stubbed.

| Test | The claim it makes falsifiable |
|---|---|
| P1 · in process | Reference: two `queue` runs into one session never overlap on a single server |
| P1 · on BullMQ | The same two runs **overlap** on a queue host. The policy governs no run there, not only deliveries |
| P2 · lineage matches | A delivery-shaped job, past the refusal, runs when the lineage the sender approved still matches |
| P2 · recipient replaced | The same job with a stale lineage is **dropped in the worker**: the handler never runs and the request record is reconciled away |
| control | A `dispatcher()` into an existing session is refused `external-dispatcher` on this host today |

P2 reaches past the refusal by calling the installed dispatch operation with `delivery: "child"`
and the provenance the seam would stamp. That is what the queue path does once the refusal is
narrowed. The two P2 tests differ only in the approved lineage, so the matching one is the stale
one's negative control.

## How to run it

It sits in no package, so copy it into `engine` and run it there. It imports `bullmq`'s source by
relative path, which resolves to the same engine module instance. From the repository root, with
a Redis on `127.0.0.1:6379` or `REDIS_URL` set:

```bash
cp specs/issues/FIX-1634/poc/queue-path/characterize.test.ts packages/engine/test/zz-poc-1634.test.ts
(cd packages/engine && ../../node_modules/.bin/vitest run test/zz-poc-1634.test.ts)
rm packages/engine/test/zz-poc-1634.test.ts
```

## What was observed

Run against `main` at `5886ca846`, Redis 7 locally. All five green, which means every
characterization held as written:

- **P1:** in process, the two runs were sequential. On BullMQ they overlapped. Guarantee one is
  missing for every run on a queue host, which is why D1 arbitrates every run.
- **P2:** the matching delivery ran; the stale one never reached its handler and left no request
  record. Guarantee two already holds on the queue path, so the spec consumes it instead of
  rebuilding it.
- **control:** refused `external-dispatcher`, nothing enqueued.

P2 is load-bearing enough to keep, so PLAN's V5 graduates it into `bullmq`'s own tests.
