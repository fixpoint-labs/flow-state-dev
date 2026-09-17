# Settled: can a board row reach a `harnessManager` on another flow instance?

**Throwaway.** This folder lives on the spec branch, which never merges. It is removed at
implementation (PLAN.md → S11).

## The claim

A `taskBoard` worker hands a claimed row **across flows** — to a task entry on a *different* flow
instance, addressed by a dispatcher carrying `flowKind: "<instance id>"` — and the `harnessManager`
block mounted at that entry still builds and runs.

D1 rests on this. If it were false, the coder seat could not be a separate hired seat at all and the
whole slice would collapse back to conductor's co-located shape.

## Verdict: CONFIRMED, and it was not free

Settled by a run before this spec was drafted, on the real path: two real `defineFlow` instances
through `createFlowState`/`runAction`, a real `harnessManager`, a scripted harness in the slot, no
model and no network. The row settled `completed` on the recipient flow, and the child session was
attributed to the recipient's kind.

**Red state produced:** `flowKind: "no-such-seat-instance"` errors the row `flow-not-found`. The
check reaches the seam rather than rubber-stamping it.

**The cost it found:** the recipient cannot declare *only* the remotely-addressed entry. `defineFlow`
refuses a flow whose task entry has no board reachable that hands off to it, and the claim gate
refuses a dispatch whose `boardId` differs from the one the recipient's own board was built with. So
the recipient declares the same logical board itself — same `boardId`, same ledger, its own same-flow
gating dispatcher. That is D1's *Locks in*, not a footnote.

## What a reader can reproduce today

The run above happened in a throwaway worktree and its verdict is recorded here, not re-runnable
from this branch. Two **committed** tests carry the same ground, and they are the reproducible
anchors — run these, not this folder:

| Claim | Committed test |
|---|---|
| Cross-flow hand-off works, and the recipient must declare the same logical board | `packages/orchestration/test/task-board/hand-off-cross-flow.test.ts` (states the constraint in its own header) |
| `harnessManager` drives any conforming harness through the slot, model-free | `packages/harness-manager/test/slot.spec.ts` |

```bash
pnpm --filter @flow-state-dev/orchestration test hand-off-cross-flow
pnpm --filter @flow-state-dev/harness-manager test slot
```

What the run added beyond those two is the join: a **real `harnessManager` at the far end of a
cross-flow hand-off**, settling the originating row. Neither committed test covers that composition,
which is why it was run rather than argued. S8 is where it becomes a standing check.

## Sketch — the two flow shapes

Directional only, per this PR's review contract. Not runnable, not what ships; S3 and S8 are where
this becomes real code. Note what it does **not** reach for: no vendor SDK and no conductor import.
The model-free harness follows `fakeHarness` in `packages/harness-manager/test/slot.spec.ts`, and the
phase is the three-line literal from the same file — which is what S5 and S7 should copy.

```ts
// The seat's own flow: its own board (same boardId + ledger as the sender)
// gating a real harnessManager entry. The shape hand-off-cross-flow.test.ts
// documents as the only legitimate recipient.
const manager = harnessManager({
  boardCollectionId: LEDGER_ID,
  boardCollection: tasks,
  phase: { phase: "implement", buildPrompt: () => "go", isDone: () => true },
  workspace: { root: workspaceRoot, sourceRepo, baseRef: "main" },
  harness: fakeHarness(seen),        // neutral contract, no vendor
});

const board = taskBoard({
  name: `${SEAT_KIND}-board`,
  boardId: BOARD_ID,                 // same id as the sender's board
  collection: tasks,                 // same ledger id
  workers: {
    // Same-flow dispatcher. Satisfies defineFlow's orphan-task-entry guard and
    // binds this board's claim gate onto the `run` entry below. This line is
    // the cost D1's *Locks in* names.
    [ACTION]: dispatcher({ name: `${SEAT_KIND}-hand-off`, action: ACTION, session: "per-task" }),
  },
});

defineFlow({
  kind: SEAT_KIND,
  task: { actions: { [ACTION]: { block: manager } } },
  actions: { drain: { block: board.drain } },
})({ id: SEAT_KIND });

// The sender's board: one row, handed off cross-flow by instance id.
taskBoard({
  name: `${SENDER_KIND}-board`,
  boardId: BOARD_ID,
  collection: tasks,
  workers: {
    [ASSIGNEE]: dispatcher({
      name: `${SENDER_KIND}-hand-off`,
      flowKind: SEAT_KIND,           // static instance id, never a function
      action: ACTION,
      session: "per-task",
    }),
  },
  initialTasks: [{ id: TASK_ID, goal: "…", assignee: ASSIGNEE, input: { issue: "FIX-poc", phase: "implement" } }],
});
```

`session: "per-task"` is a pure function of `(boardId, taskId)`, computed by the sender with no
flow-specific component — which is why it behaves identically cross-flow.
