# POC · a board whose tasks run on another flow, on today's Layer 1

An experiment retained as evidence for [FIX-1794](../../SPEC.md)'s
[D1](../../DECISIONS.md#d1). Not production code: nothing imports it, it has no package manifest,
and it is outside default build, test, lint and knip discovery ([specs/README.md](../../../../README.md)).

## The question

A lineage stops at a flow (the [epic POC](../../../../epics/FIX-1786/poc/singleton-worker-link/README.md),
leg C1), so a coordinator's board can't be shared down to a task session on the `agent` flow.
The owner's user scope does cross flows. Three things decide whether that is enough:

1. **Does an unpartitioned user-scoped ledger really let one conversation take another's tasks?**
   The epic struck it in review on that claim (ER-9). Nobody ran it.
2. **Can today's Layer 2 extension points keep each conversation's board its own** without a
   change to the task board? ER-22 asks for that answer before a Layer 1 change is raised.
3. **Can the task session on the other flow tell the conversation that filed the task** how it
   ended, as that user, with no address taken from the row or the payload?

**What would show no task-board change is needed:** leg E1 holding the read and the wake as well
as the claim.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1794/poc/board-partition/run.sh
```

It runs on the real engine: `createFlowState` with in-memory stores, `runAction` for each
request, and the real in-process dispatcher for each hand-off. Nothing in the scope, store or
task layer is stubbed.

## The setup

Two flows, as the chain has them. `coordinator-poc` keeps a board in each conversation, with one
seat that hands every row to `agent-poc`'s `work` entry, one task session per row. Both flows
declare one ledger, `chain-tasks`, at the owner's user scope, the shape
`hand-off-cross-flow.test.ts` already proves crosses a flow. The agent's task entry records the
run, then replies with a `{ from: true }` dispatcher to the coordinator's internal `settled` entry.

## What was observed

On `fa8161e88`: **4 passed**. Each assertion pins what is true today, so a change shows up here
as a red test.

| Leg | Question | Observed |
|---|---|---|
| U1 | Two of alice's conversations each file one task on the unpartitioned ledger; only `conv_a` drains | **`conv_a` takes `conv_b`'s task.** It runs in a task session parented to `conv_a`, its reply lands in `conv_a`, and `conv_a`'s board read lists both rows. The epic's claim holds |
| E1 | The same, with today's claim narrow (the `runOwnerDispatcher` shape) keyed on the conversation that filed each row | **The claim holds, nothing else does.** `conv_a` runs only its own task and leaves `conv_b`'s pending. But its board read still lists `conv_b`'s row, and its drain never reaches its exit: `conv_b`'s row is claimable to the substrate, so the drain polls until its iteration budget runs out, still `idle` and still asking to go on. At the default budget that is 10,000 polls, 50 ms apart, about eight minutes held open |
| F1 | The agent-flow task session replies `{ from: true }` | Yes. The task session is alice's, on `agent-poc`, a child of `conv_a` with a lineage of its own. The reply runs in `conv_a`, as alice |
| X1 | Bob's conversation on the same declaration | Reads and drains only his own row. Alice's stays pending |

U1 and E1 are each other's control: the same filings and the same drain, with only the narrow
added. U1's assertion that `conv_b`'s task ran under `conv_a` is the one E1 turns red.

## What it means

- **The owner's user scope works for the flow crossing, and the follow-up path back is free.**
  `{ from: true }` from the task session reaches the conversation that filed, as its owner (F1).
- **Unpartitioned, it breaks ER-9 exactly as the epic said** (U1).
- **Layer 2 can narrow the claim but not the board.** A claim narrow leaves the read and the
  wake on every conversation's rows (E1), so a conversation would show, and wait on, tasks it
  can never run. Keeping the board its own needs the ledger itself to be kept per conversation:
  a change to the task board, which is why D1 goes to the epic (ER-9, ER-22).

## What it doesn't cover

The partition itself: it is the task-board change D1 asks for, so there is nothing on `main` to
run it against. The real `agent` and coordinator flows, workers as resources (FIX-1788) and
delegates (FIX-1791), none of which are built. A real model.
