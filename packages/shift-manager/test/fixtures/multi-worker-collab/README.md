# multi-worker-collab · the lab

The hire behind the ER-Collab exit proof (FIX-1497): a planner that files work for two workers on its
own conversation's board, declared in Markdown, served by the ordinary `fsdev dev` so the shipped
DevTool can watch it. The graded check is
[`goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view/`](../../../../../goals/multi-seat-collab/it-hands-a-row-between-two-seats-in-view/goal.md).
It lives here, among Shift Manager's test fixtures, because the package's own tests open it too;
the goals reach in here, never the reverse.

To look at it by hand:

```bash
pnpm --filter @flow-state-dev/devtool build        # once per checkout
pnpm --filter @flow-state-dev/devtool build:assets
# from a scratch directory, with the intent overrides unset (see below):
pnpm tsx <repo>/packages/cli/bin/fsdev.ts dev --config <repo>/packages/shift-manager/test/fixtures/multi-worker-collab/fsdev.config.mts
```

## How it is wired

![How the lab is wired: the Markdown tree under lab/workforce/teams/eng on the left (a coordinator, the planner with its delegates, two workers), the lab's code in the middle (host.mts with the app's desk-to-delegate map, the planner and worker flows under flows/workers, the driver), and what runs on the right (fsdev.config.mts, the shipped fsdev dev, the shipped DevTool). The user's answer enters only through the planner's conversation's answerTask_tasks.](figures/setup.svg)

Read it left to right: files on disk, code, what runs. No file declares a board. The planner's
`WORKER.md` names the two workers as its `delegates:`, and because both take tasks, a conversation
with the planner has the task actions. The one arrow that crosses from a desk to a worker goes
through `ROUTES` in `host.mts`, which the filer reads to name a row's assignee, never through a
`WORKER.md`: each worker's `answersFor` is only what the checks grade against. The user reaches
the board by one door, the planner's conversation's `answerTask_tasks`.

## How a run moves

![How one run moves: four lanes against time (eng.planner, eng.builder, the user, eng.reviewer) with the check that grades each step, and below them the three DevTool screens that read it.](figures/flow.svg)

The crossing from `eng.builder`'s lane to `eng.reviewer`'s is the handoff: a second row on the same
board, which the planner filed waiting on the first, run by the other worker. Each step carries the
leg that grades it, and every screen below the fence is graded by VB against what the board holds.
The figures' text was edited for the conversion; their layout still draws the old shape (the second
row starting from `eng.builder`'s lane) and wants a redraw.

## What is here

| File | What it is |
|---|---|
| `workforce/` | The scenario, whole: four `WORKER.md`. `eng.queue` is the team's coordinator, on Workforce's `coordinator` flow, delegating to the other three. The planner names the `planner` flow and `delegates: [eng.builder, eng.reviewer]`. The two worker files name the `worker` flow and the desk each answers for (`build`, `review`) — spelled unlike any worker id, so a check that confused a desk with a worker could not pass. **No file declares a board.** |
| `host.mts` | Reads the tree, refuses it whole if anything did not load or it is not exactly one coordinator, one planner and two workers, and hires. Holds the app's desk → delegate map (`ROUTES`, and `routesFor` for the controls), which nothing reads off the tree. `openLab` is the boot: it opens the organization's inventory, in-process, as the inventory docs show any app doing it, on the lab's own `inventory-writer` flow, and throws when the inventory reports a problem. |
| `workforce/flows/workers/` | The two flows, one file each, basename = the flow a `WORKER.md` names in its `flow:` line. `planner.mts` carries Workforce's filing factory (`defineSessionBoard`): the task actions on its conversation's own board, and the entries the board runs on. `worker.mts` takes tasks through `workerTaskEntry`; its turn parks on the row's question while the row has not been answered, and otherwise finishes. The loader does not walk `flows/`. |
| `workforce/flows/piece.mts` | The row's input contract (the desk, the question, the row it follows), the one piece both flows share. Beside the flows rather than among them, since a file under `flows/workers/` reads as a flow. |
| `fsdev.config.mts` | Everything `fsdev dev` serves: one `FlowState` over SQLite, and the boot (`openLab`) before the first request. `GOAL_CONTROL` perturbs the worker flow here (`ignore-the-answer`, `silent-park`); `no-inventory` skips the boot. |
| `goals/multi-seat-collab/run-scenario.mts` | The driver the check uses, kept with the goals since it needs `goals/lib`: spawns `fsdev dev` (optionally with `FSDEV_DEBUG_ENDPOINTS=0`), opens each worker's own session over the HTTP session route, files and answers through the planner's conversation's actions, and reads the board off the server's SQLite file. Reports; grades nothing. |

## What the lab owns rather than the framework

- **The two flows' bodies.** The worker body parks on the row's question while the row has not been
  answered. The park is written the way the board's `parkOnQuestion` tool writes it, on the
  conversation's own ledger under the claim the attempt holds, because the turn is not a model. A
  handoff here is a second row the planner filed waiting on the first — not a status and not a
  reassignment (the board freezes the assignee of a parked row, and the check tries once to move it
  so a board that ever allowed it would be caught).
- **The desk → delegate map.** The app's, in `host.mts`. Each worker's own `answersFor` line is
  what the check grades against, so the two sources can disagree — which is what `swapped-desks`
  and `one-worker` make them do.

## What it works around

- **The intent overrides.** The driver spawns the server through `goals/lib/env`'s
  `intentFreeEnv`, so an ambient `FSDEV_DEFAULT_MODEL` / `FSDEV_INTENT_*` cannot swap the models
  the lab resolves. A malformed value would fail every served request at setup.
- **Two screens, not one.** A board's changes are emitted into the session that made them: the
  filing, the claims and the answer into the planner's conversation, the park and the finish into
  the task session the row ran in. The planner's Tasks tab therefore shows the row as filed, the
  task session's shows why it waited and what it was told, and the ledger collection in the
  Resources panel shows both rows as they stand.
- **No run link on the planner's Tasks tab.** The DevTool links a task row to its run by decoding
  the run's session key, and it decodes a dispatched board's key, not a conversation board's. The row
  still names its run session (`run`), and the navigator lists that session under the worker's flow,
  which is how the check opens it.
