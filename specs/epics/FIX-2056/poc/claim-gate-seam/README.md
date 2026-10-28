# POC · the claim gate where FIX-2076, FIX-2077 and FIX-2082 meet

An end-state experiment retained as evidence for [FIX-2056](../../SPEC.md). Not production code:
nothing imports it, it has no package manifest, and `specs/**/poc/**` is outside default build,
test, lint and fallow discovery ([specs/README.md](../../../../README.md)).

## The question

Does the claim gate need exactly one "is this task done?" answer across a plan board's waited
dispatch (FIX-2076), rule 6 at the gate (FIX-2077) and nested `getTask` waits (FIX-2082), or more
than one? If more than one, the division moves before three specs are written against it.

**What would show more than one:** a scenario where the single answer breaks one of rules 6, 9 or
18, and only a second, seam-local "done" could keep it.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/epics/FIX-2056/poc/claim-gate-seam/run.sh
```

## What it is

| Part | What runs | |
|---|---|---|
| Census | A grep of `orchestration/src` and `workforce/src` | Every place that writes a task's ending today |
| `today.poc.test.ts` | The real engine: `createFlowState({ durable: true })`, a real `taskBoard` dispatching to a `task` entry in a child session, the real claim gate | What today's gate can see when it settles. Each assertion pins today, so a child that changes the gate turns it red |
| `end-state.poc.test.ts` | A small executable model of the three children merged | Three variants of who answers "done", over the same six scenarios |

## What was observed (on `c179030c`)

**7 passed.** The census finds three code paths that decide a task is complete today: the gate's
recorders (`record-result.ts`), `completeTask`/`failTask` (`task-tools-capability.ts`) and
`settleSplitTask` (`workforce/.../split.ts`); and two that end a row from a wait
(`wait-for-response.ts`'s timeout and stop cancels).

| Leg | Observed on the real engine |
|---|---|
| G1 | The gate wrote `completed` about 300 ms before the request's `.sideChain()` finished. It settles at the entry's last step, and the engine drains background work after that step (`engine/src/execution/runAction.ts`, the side-chain pool drain) |
| G2 | The row settled while a task it filed was still `pending` |
| G3 | A `human_input` stop and an `external_event` wait leave the same row: `in_progress`, the same fields, nothing telling them apart |
| G4 | A request working a task asking for a wait is refused, `wait_unavailable` |

| Scenario | today | two answers | one answer |
|---|---|---|---|
| S1 waited dispatch; the child files a task and returns | settles with a filed task open | **drain moves past a running row** | clean |
| S2 the child's background work outlives its return | settles with background running | **drain moves past a running row** | clean |
| S3 three waits nested in a waited dispatch | waits refused | clean | clean |
| S4 a `getTask` deadline mid-chain, then the task ends | refused; settles with a filed task open | **drain moves past a running row** | clean |
| S5 the drain's own deadline passes | **a deadline ends the row, then it ends twice** | clean | clean |
| S6 a person's stop, a queued message, then the end | settles with a message queued | **drain moves past a running row** | clean |

S6's queued message is retained as run. Since FIX-2103 a message queued to an open task's session
holds nothing: the task settles when its turn ends, and the message is conversation, not part of it,
so "settles with a message queued" is no longer a violation. The person's stop in S6 still is.

"Two answers" applies FIX-2077's predicate at the gate but lets the plan board's drain take "the
child's request returned" as done. Where rule 6 already holds at return (S3, S5), the two answers
agree and nothing breaks; wherever it does not, the drain moves on early.

## What it showed

**One answer.** Rule 6, evaluated by the gate, is the only "done" the three need. Every waiter,
the plan board's drain included, wakes on the ending the gate writes, and a deadline writes none.
No scenario needed a second answer.

What moves:

- **The waited dispatch belongs with the waits.** FIX-2076's "a plan board waits on a row it
  dispatched" and FIX-2082's `getTask` wait are one wait, and the only way to get two answers is
  to build them twice. The row moves to FIX-2082, which is now blocked by FIX-2076. G4 shows the
  waited dispatch inside a task can't land before FIX-2082's depth change anyway.
- **The gate's check is not only at the entry's last step.** G1: background work ends after the
  entry returns, so FIX-2077's check runs after the engine's side-chain pool drains, and again when
  a task the request filed ends. That is FIX-2077's scope, written into its issue; FIX-2078 (the
  ending path) calls the same predicate for that re-check rather than deciding it.

## What it does not cover

The model is a model: it shows the division holds together, not that the code will. It does not
cover leases, crashes (FIX-2078's sweeper), or an inline plan row's background work, whose request
is the drain's own; FIX-2076's spec has to say when an inline row's background counts.
