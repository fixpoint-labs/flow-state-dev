# POC · the split on one worker flow, on today's task board

An experiment retained as evidence for [FIX-1802](../../SPEC.md)'s claim that the split needs no
task-board change. Not production code: nothing imports it, it has no package manifest, and it is
outside default build, test, lint and knip discovery ([specs/README.md](../../../../README.md)).

## The question

FIX-1802 makes filing a grant any worker carries, and lets a worker given a task split it. Two
premises carry the design, and nobody had run either:

1. **Can one flow keep a board and work its own rows?** FIX-1794's POC used two flows. Now an
   `agent` worker files for `agent` delegates, so the board hands rows to `work` on its own flow.
2. **Can a parked row settle later, from another session, through a stored claim ticket, on
   today's board?** FIX-1794's S8 settles a split task that way. If it can't, the split is a
   task-board change, which the epic must record as Layer 1 (ER-22).

**What would show a task-board change is needed:** P2 failing to settle the parked row, or P3
accepting a forged or replayed ticket.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1802/poc/split-on-one-flow/run.sh
```

The real engine: `createFlowState` with in-memory stores, `runAction` per request, the real
in-process dispatcher for each hand-off and reply. Nothing in the scope, store or task layer is
stubbed.

## The setup

One flow, `worker-poc`, standing in for any flow that carries the filing capability. It keeps two
boards, each handing rows to `work` on the same flow through a per-task target. Two user-scoped
ledgers stand in for two of D6's partitions (the conversation's and the task session's), since
the partition isn't on `main`. `work` takes rows `from` a ledger resolver. A top task splits; a
piece just finishes and tells whoever handed it over. The parent binding is a map here, where
the build keeps it in server-written session state.

## What was observed

Against `main` at `ce06cb5c7`: one test, four legs, **passed**.

| Leg | Question | Observed |
|---|---|---|
| O1 | One flow, a board handing rows to `work` on its own flow | `defineFlow` accepts it, and the top task runs in a task session on the same flow, a child of the conversation, as alice |
| P1 | The task session files two pieces on its own board and parks its row | The row is `parked` above, with its note; the conversation's drain returned, holding nothing open |
| P2 | The pieces end and tell the task session; in that later request it settles the parked row through the stored ticket | Each piece ran in a child of the task session and told it once. The settle returned `recorded`; the row above is `completed` with both pieces; the conversation heard once |
| P3 | The fence | A replay of the settle: `declined`, `lost-claim`, status `completed`. A forged ticket on another parked row: `declined`, `lost-claim`, still `parked`; the genuine ticket then `recorded` |

P3's genuine ticket is the control for its forged one: the same parked row takes it, so the
refusal was the forgery.

## What it means

- **No task-board change for the split.** Park, the ticket-fenced settle of a parked row, and the
  per-task target to the same flow are all on `main`. FIX-1802's only board dependency is D6's
  partition, which FIX-1794 builds.
- **One flow can be filer and worker at once**, so an `agent` worker splits for `agent` delegates.
- **Order matters at the last piece.** A piece's reply here was sent inside its `work` request,
  before the gate recorded its ending, so the parent's turn couldn't see the piece as ended from
  the board alone. FIX-1794's S6 writes the ending before the notice; the plan keeps that order.

## What it doesn't cover

D6's partition, the grant, delegates and workers as resources (FIX-1788, FIX-1791, FIX-1794,
none built). The settle-owed marker and the chain count. A real model.
