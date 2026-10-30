# The manager-queue lab

**This is evidence, not a tutorial and not a shape to copy.** It exists to make one sentence true or false on the real path: *work a manager files for its team reaches the worker it names, and that worker runs it.*

## What it declares

```
lab/workforce/
  teams/eng/
    workers/manager/WORKER.md      flow: coordinator, delegates: [the three builders], tools: []
    workers/builder-a/WORKER.md    flow: builder, answersFor: desk-one
    workers/builder-b/WORKER.md    flow: builder, answersFor: desk-two
    workers/builder-c/WORKER.md    flow: builder, answersFor: desk-three
  flows/workers/builder.mts
```

No file declares a board. The manager files on **its own conversation's board**: a row filed there is stored in that conversation's partition, at its user's scope, names the worker it is for by id, and is handed over at once to a task session of its own on that worker's flow. There is no board id to write, no drain, and no map from a routing key to a worker.

**The manager's file says `tools: []` and its turn holds the task tools anyway.** No line in its file grants them, and there is no `filing:` key. It has them because its `delegates:` names workers that take tasks: each builder's flow takes tasks through `workerTaskEntry`, and a worker one of whose delegates takes a task has orchestration's task tools on its turn and as its conversation's `<tool>_tasks` actions. Builders whose `work` entry takes no conversation's task leave the manager with none, and its filing answers `no_delegation_board`.

## The manager runs on Workforce's coordinator flow

The manager's file says `flow: coordinator`, and the lab registers Workforce's own coordinator flow under that name. The lab used to ship a flow of its own called `coordinator`, which composed the old mailbox board's tools. Since FIX-1791 `coordinator` is the framework's coordinator, and keeping a lab flow under the same name would have made this the one tree where `flow: coordinator` means something else. So the line in the file is unchanged and now means what it means everywhere: the coordinator whose judgment turn carries the task tools through its delegates (FIX-1802). Nothing in the lab composes them.

The builders keep the flow they name, `builder`, the lab's own.

## The two checks

Both drive the same host, the same tree and the same hire. They differ by who files.

| Check | What it proves |
|---|---|
| `it-stands-the-team-and-its-board-up-from-files` | Model-free. No file declares a board; four workers from one tree; the task tools on the manager's live turn coming from its delegates, with its `tools:` neither granting nor fencing them; the board's filing check, both arms; the queue as a read; the manager settling a task its worker is running; the status set. |
| `it-routes-a-queue-to-the-workers-their-files-name` | **The gate.** More work than workers, a manager choosing who gets what, every row on the worker it names and carrying that worker's own file, each in its own session, a second row for one worker neither re-routed nor dropped, and a row for a stranger refused by name. |

## The one idea worth carrying away

**The oracle and the implementation are two different sources.**

The stored row says which worker it was filed for. The running work reports, from inside its task session, which worker it runs as and what that worker's own file says in `answersFor:`. The tree, read at run time, says which file declares which worker. `answersFor:` routes nothing; it is a fact only the right file holds, so a check can ask whether the worker that ran a task is carrying that worker's file.

Which is why the negative control can go red at all. `repointed-map` hands the installation two builders' files **swapped** under their ids, and touches nothing on disk: every id stays well-formed, the roster still hires, every row still names a delegate, runs on it and completes. The tree still says which file declares which worker, the run says which file it carried, and the two now disagree. Grade the row's label against the session's label alone and the control stays green, because the board's hand-over agrees with itself.

## What this lab does not prove

- **Nothing about the nested cascade.** One hop only: the manager's board, then the worker. A builder files nothing.
- **Nothing about what a busy worker should do.** See below.
- **Nothing about scale, cost or a real coding run.** Builder turns are stubs that write a line. `goals/devforce-lab/` is where a row becoming a supervised coding run is evidenced.

## Retired: the drain width, and the row that waited

The lab used to run its builders' drains at a width set by `MANAGER_QUEUE_DRAIN_WIDTH`, pinned to `1` by the epic's ruling (2026-09-19): a busy worker took no second row, and the second row for one worker waited for the first to finish.

On a conversation board that step has no subject. There is no drain: each row filed is handed over at once to a task session of its own, so two rows for one worker run at the same time, each in its own session. The lab saw it: with the builder turns held, two rows filed for `eng.builder-a` were both `in_progress`, in two sessions, at once. So the "waits for its worker to free" half of the routing check is retired under FIX-1792's BR-24 (no converted step waits on another issue), and the knob is removed: nothing reads a width. What survives is the other half: the second row for one worker runs on that worker, once, and is neither re-routed nor dropped.

## How a leg that grades nothing gets caught

The lab's whole job is to be a check that can fail, so a leg of it that cannot is the worst defect available here. Three were found while it ran on a mailbox, and all three were the same shape: a leg green on an evidence line with a parenthesis where its input belonged, a filing leg satisfied by a filer that combined two pieces into one row and duplicated a third, and an identity leg that compared the tree against a map derived from the tree.

Each was fixed the same way: put something on one side of the comparison that the other side cannot move, then **build the control that makes it red** and check the red lands at that leg and no other. Both checks still grade their own controls for exactly this. The habit underneath: after a check goes green, read the sentence it wrote rather than the verdict, and ask what it would have said if the thing under test had been absent.
