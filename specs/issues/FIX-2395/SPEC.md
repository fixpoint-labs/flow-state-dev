# FIX-2395 · A teammate's tasks read newest first, with why each failed

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

The issue names a *Background* list in `WorkersList.tsx`. That list is gone: FIX-2525 (#4653)
moved a teammate's tasks into its panel on the right (`TeammatePanel.tsx`), which already groups
running tasks above collapsed *Done*, *Failed* and *Cancelled* lines, says when there are none, and
colours a failure. What the issue asks for and the panel still lacks is below.

| Someone who… | Today | After |
|---|---|---|
| **looks at a running coding task** | `running · Claude Code` | No change here. How long it has run is FIX-2394's running clock (`task-signals`, #4735), from this spec's times |
| **has a task that failed** | One collapsed *Failed (2)* line; opening it shows each row as `failed`, no reason | *Failed* is open, newest first, each row with its one-line reason (`failed · tests did not pass`) |
| **has run thirty tasks with a teammate** | *Done (30)* opens to all thirty, oldest first | *Done (30)* opens to the newest five and a *Show all 30* button |
| **scans the panel** | Rows in filing order; heading *Tasks* | Newest first in every group; heading *Tasks (32)* |
| **reads the same task in the conversation** (`TaskCard`) | Failed is red, waiting reads `running` | The same word and colour as its panel row: `waiting on you` in the attention colour, `failed` red |

## The goal, and how we'll know it's met

**A teammate's panel says, at a glance, what is running, what failed and why,
and what finished most recently; its task lines in the conversation use the same words.**

- **The real need:** [epic FIX-2369](../../epics/FIX-2369/SPEC.md), R-29 (*see what the work is
  doing*). A list in filing order with no times and no reasons makes you open each task to learn
  anything.
- **Smaller, and rejected:** sort and cap only, failures still folded. A failure is what you came
  to act on.
- **Not this issue's:** the running-row clock and the stall signal. FIX-2394 (#4735) owns them in
  its `task-signals` item, from each attempt's `run.startedAt`; this spec gives it the row times.
- **Bigger, and not this issue's:** a shared task-list component for every app. Shift Manager and
  the Claude Code-style lab draw tasks differently; FIX-2379 already gives them one vocabulary.
- **Not done if:** a failed row hides its reason, *Done* lists
  more than five before *Show all*, or a `TaskCard` and its panel row disagree on a task's word or
  colour.

**The check.** A Teammates test (`test/task-panel.test.tsx`) renders the panel from fake board rows
carrying times: two running (one waiting on you), two failed with errors, seven done, one
cancelled. It reads the heading count, the order, each failed row's
reason, five done rows plus *Show all 7*, and a `TaskCard`'s word and tone against its row. On
`main` it fails (no times, filing order, failed collapsed with no reason). An orchestration test
reads `createdAt`, `startedAt` and `completedAt` off the board's `listTasks` action and not off the
model's tool. The lab's adapter test confirms `toBoardTask` passes them through.

## What changes

- **Orchestration, the board's `listTasks` action:** each row carries `createdAt`, `startedAt` and
  `completedAt`, beside the `updatedAt` it already carries for clients. Client read only, like
  `spend`: the model's tool stays as it is ([D1](DECISIONS.md#d1)). `taskRowView` already reads
  these into `times`; today they arrive `null` from the board read.
- **Teammates' adapter:** `BoardTask` gains `createdAt`, `startedAt` and `completedAt` from the
  row view's `times`.
- **Teammates' panel:** the groups become *Running* (waiting tasks first), *Failed* (open), *Done*
  (collapsed, newest five, then *Show all N*), *Cancelled* (collapsed). Newest first throughout.
  A plain total in the heading (`Tasks (32)`); per-state counts are FIX-2394's `taskCounts`. A
  failed row shows its reason, one line ([D2](DECISIONS.md#d2)).
- **One helper for a task's word and tone** (`lib/task-state.ts`), read by the panel row and
  `TaskCard`, so the two can't drift. It is the lab's only owner of a task's tone: FIX-2396's task
  popup and FIX-2397's status line read it too, rather than deciding again. Its words are a row's short subline
  (`waiting on you`, `failed`); the worker status line's sentences are FIX-2397's.
- **This spec owns a task's times on `BoardTask`.** FIX-2396's run duration derives from
  `startedAt` and `completedAt` here; it reads no time a second way.
- **Docs:** the lab README's *Right* paragraph describes the new grouping. The orchestration README
  names the three times on the action's rows. No site page describes the panel. Changeset:
  `patch` for `@flow-state-dev/orchestration` (a client reading the action sees new fields).

## What stays as it is

- `WorkersList.tsx` and `status.ts`: FIX-2397's.
- Which tasks the panel lists (its conversation's board), and how a row opens its popup.
- The model's `listTasks` tool output.

## What's already here, and the debt

- **Reused:** `taskRowView`'s `times` (FIX-2379), `age` and `useNow` from `lib/use-watch.ts`, the
  panel's groups from FIX-2525.
- **Adds:** three optional fields on one action's rows, one small helper and its use in two
  components. **Removes:** the panel's and `TaskCard`'s separate status colouring. Net: neutral.

## Sign off

- **The goal**: the panel tells running, failed and recent at a glance. *If wrong:* one component reverts.
- **D1** · [the times come from the board's action](DECISIONS.md#d1). *If wrong:* three optional fields to drop.
- **D2** · [failed open, done capped at five](DECISIONS.md#d2). *If wrong:* two constants.
- **Open: none.**

Improvement · `labs/teammates`, `packages/orchestration` · S · epic FIX-2369 wave 3 · stack 2395 → 2397
