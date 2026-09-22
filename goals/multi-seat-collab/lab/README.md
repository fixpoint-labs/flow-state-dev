# multi-seat-collab · the lab

The hire behind the ER-Collab exit proof (FIX-1497): a planner and two worker seats, declared in
Markdown, working one channel's board, served by the ordinary `fsdev dev` so the shipped DevTool can
watch it. The graded check is
[`../it-hands-a-row-between-two-seats-in-view/`](../it-hands-a-row-between-two-seats-in-view/goal.md).

To look at it by hand:

```bash
pnpm --filter @flow-state-dev/devtool build        # once per checkout
pnpm --filter @flow-state-dev/devtool build:assets
# from a scratch directory, with the intent overrides unset (see below):
pnpm tsx <repo>/packages/cli/bin/fsdev.ts dev --config <repo>/goals/multi-seat-collab/lab/fsdev.config.mts
```

## What is here

| File | What it is |
|---|---|
| `workforce/` | The scenario, whole: one `CHANNEL.md` declaring `boards: [work]` and its three members, three `WORKER.md`. The two worker files name the `worker` kind and the desk each answers for (`build`, `review`) — spelled unlike any seat id, so a check that confused a routing key with a seat could not pass. **No file names the ledger the framework mints.** |
| `host.mts` | Reads the tree, refuses it whole if anything did not load, and hires. Takes the desk → seat map as an argument and never reads one off the tree. |
| `kinds.mts` | The two kinds. `planner` has one action, a dispatch into the channel's own `fileTask`. `worker` has the channel's board with a desk-narrowed claim, a same-flow hand-off per desk, `onReview: "exit"`, a `drain` action, and the person's door: `answer`, over the board's unpark-and-drain step. |
| `fsdev.config.mts` | Everything `fsdev dev` serves: one `FlowState` over SQLite, and the app's desk → seat map. `GOAL_CONTROL` perturbs it here. |
| `run-scenario.mts` | The driver the check uses: spawns `fsdev dev`, opens the channel through `openChannels` over the HTTP session route, and files, drains and answers over the action route. Reports; grades nothing. |
| `diff-check.mts` | The fence: every path this change touches is under `goals/` or the spec folder. |

## What the lab owns rather than the framework

- **The two kinds and their bodies.** The worker body parks while the row carries no answer, and
  in finishing files the next desk's row naming the one it finished. A handoff here is that second
  row — not a status and not a reassignment (the board freezes the assignee, and the body tries
  once to move it so a board that ever allowed it would be caught).
- **The desk → seat map.** The app's, written in the config. Each seat's own `answersFor` line is
  what the check grades against, so the two sources can disagree — which is what `swapped-desks`
  and `one-seat` make them do.
- **The worker reaches its row through the board's own capability**, not through a reference it
  builds over the raw ledger. A hand-built reference skips the board's frozen-assignee policy: an
  early draft of this lab moved a handed-off row's assignee with it, and the move was accepted.

## What it works around

- **The intent overrides.** `FSDEV_DEFAULT_MODEL` or any `FSDEV_INTENT_*` in the environment makes
  every request on the served path stall at `in_progress` for a flow with no model in it
  (FIX-1511). The driver spawns the server through `goals/lib/env`'s `intentFreeEnv`; by hand,
  unset them.
- **A refusal that never settles.** An action sent to a seat's session as a different user is
  admitted (`202`) and then never advances — no items, nothing logged, still `in_progress`. It
  does not land, which is all the proof asks, but it is the same silent shape as FIX-1511 with a
  principal mismatch as the trigger. The check bounds its wait and says so in its notes.
- **Three screens, not one.** A board's changes are emitted into the session that made them: the
  claim into the seat's own session, the park and the finish into the child session the row ran
  in. The seat's Tasks tab therefore shows the row as it was handed off, the child's shows why it
  waited and what it was told, and the ledger collection in the Resources panel shows both rows
  as they stand. The DevTool's dispatch-run link is the route between the first two. No
  cross-session view is built here.
- **The claiming drain says `handed-off`.** The seats hand rows off, so the drain that claims a
  row returns as soon as it is running elsewhere, before the park. Whether a park holds a drain
  open is asked of the next drain over the parked row, which returns `parked-for-review`.
