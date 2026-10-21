# FIX-2076 · A board's mode decides whether its drain waits: plan boards and delegation boards

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **builds a worker that does a job in steps** | Its steps for itself go to new sessions of itself, and its task parks until they report back | It files them on its **plan board**; its own request works them in order, each step seeing the one before ([D1](DECISIONS.md#d1)) |
| **reads that worker's answer** | `{ answer, pieces }`, from whichever turn ran after the last piece | One answer, from a turn that saw every step end, a failed one included; it is the result unless the worker checkpointed an `output`, when the latest checkpoint is ([D2](DECISIONS.md#d2)) |
| **builds a board that hands rows to other sessions** | Declares a dispatcher; the drain quietly stops waiting on those rows | Declares `mode: "delegation"`. Without it the board is refused when built, with that fix in the error ([D3](DECISIONS.md#d3)) |
| **builds a goal-seek loop** | Over a board that dispatches, the judge rules while rows still run, and each `continue` burns an iteration | Refused when built over a delegation board, or a board that lets a parked row out of its drain. Over a plan board the judge sees every row ended |
| **builds a pattern** | `planAndExecute`, `parallelTasks`, `supervisor` drain inline | The same, unchanged: they are plan boards already |

## The goal, and how we'll know it's met

**Whether a board's drain waits on its rows is the flow author's declared choice, a board that
contradicts it is refused before it runs, and a worker's own steps run in its own request.**

| Is it the right goal? | |
|---|---|
| **The real need** | The issue's three problems: the assignee kind decides waiting; a worker has no plan of its own; `goalSeekLoop` doesn't check its board ([FIX-2076](https://linear.app/fixpoint-labs/issue/FIX-2076), epic [FIX-2056](../../epics/FIX-2056/SPEC.md) rows *plan board and delegation board*, *a goal-seek loop needs a plan board*) |
| **Smaller, and rejected** | "`taskBoard` takes a `mode`." Hittable with no worker able to plan, so T-01 stays unmet and the self-piece keeps parking |
| **Bigger, and not this issue's** | "A plan board waits on a row it dispatched." [FIX-2082](https://linear.app/fixpoint-labs/issue/FIX-2082) owns every wait, this one included (epic POC) |
| **Not done if** | A board that dispatches builds without `mode: "delegation"` · a goal-seek loop over one builds · a worker's step for itself, filed without an explicit `session: "new"`, opens a child session · a plan row counts as the session's open task · no test pins who settles a row (rule 18) |

```mermaid
flowchart LR
  W["a hired agent worker · real model · durable store"] --> P["a task: outline, draft, tighten"]
  P --> S["its sessions and both boards, read through task actions"]
  S -->|"three plan rows ended in order · no child session · no open delegation row"| OK["PASS · leg a"]
  B["the five wrong boards"] -->|"each refused when built, naming the fix"| OK2["PASS · leg b"]
  C["control · today's main"] -.-> P
  C -.-> B
  S -.->|"under the control"| F["must FAIL · child sessions opened, wrong boards built"]
```

The check reads what a user could list and what a builder throws, not the drain's internals.

| How we verify | |
|---|---|
| **Goal check** | `goals/task-board/a-worker-plans-its-own-steps/` (leg a, real model) and `goals/task-board/refuses-a-board-built-wrong/` (leg b, no model) · run by the implementer at completion · verdict in the implementation PR |
| **Signal** | Leg a: three plan rows `completed` in the task's own session, each started after its dependency ended, and each step's output carrying a value only the step before it produced; zero child sessions (the steps are filed without `session: "new"`, which FIX-2082 makes a dispatched plan row); the session's delegation rows open count stays 0; the task's result names the tightened draft. If FIX-2080 is on main when this lands, a failed attempt's open plan row ends `cancelled`. Leg b: five refusals, each naming the setting and the fix, plus a plan row filed held refused at filing once FIX-2080 is on main |
| **Input** | Leg a: a three-step brief; a two-step one, or one with a failing step, must pass too (the answer names the failure). Leg b: the five boards under the fence in *What changes*; the plan board with a dispatcher holds until FIX-2082 lifts that refusal, and FIX-2082 swaps it out |
| **Anti-game** | Assert on rows and sessions read through the public task actions and on thrown builds. Not on mocked turns or on the drain's quiescence verdict |
| **Control that must fail** | Today's `main`: leg a fails on *zero child sessions*, leg b on *five refusals* |

## What changes

![Two panels. Today: one board per session, every row dispatched, waiting decided by the assignee kind. After: a plan board, mode plan, rows worked inline by the session's own request, the drain waiting on every row; and a delegation board, mode delegation, rows dispatched, the drain never waiting. A fence lists five boards refused when built](figures/what-changes.svg)

The left panel is today's single board; the right is the two the session gets, with the fence of
boards refused at build.

**A board that dispatches, as its author writes it:**

```diff
  const board = taskBoard({
    name: "issue-work",
    boardId: "issue-work",
+   mode: "delegation",
    collection: issues,
    workers: { implement: dispatcher({ action: "work", session: "per-task" }) },
  });
```

**A worker's own step** is filed with the same call as today, naming itself as the assignee. The
filing now routes it to the plan board, and this request works it next.

**Docs:** update `orchestration/task-board` (`mode`, the dispatching assignee section and its
construction checks), `orchestration/configuration` (the `mode` row), `orchestration/goal-seek-loop`
(the plan-board precondition), `workforce/delegating-work` (a step for itself is a plan row), and
the orchestration, core and workforce READMEs. No new page; FIX-2081 publishes the one-task opening.
**Migration:** the implementation PR adds three rows to the epic's [migration lines](../../epics/FIX-2056/migration.md),
carried in the `orchestration` and `workforce` changesets (minor): a worker's steps for itself
answer once instead of `{ answer, pieces }` (FIX-2077's row covers pieces for others; aligned with
#3592); a board that dispatches adds `mode: "delegation"`, the fix its refusal names; and the
exported `dispatchedTaskPredicate` is removed, use the board's `mode`.

## How a worker's request runs its plan

```mermaid
flowchart LR
  E["work, respond or onTaskSettled"] --> T["the worker's turn · files plan rows"]
  T --> D["plan board drain · mode plan"]
  D -->|"each row: the same turn, the row's brief"| D
  D --> A["one more turn · sees every row's ending · files no step for itself"]
  A -->|"its answer, unless an output was checkpointed"| R["the request's result"]
  T -.->|"rows for delegates"| G["delegation board · mode delegation"]
```

Rows for itself run inline and the drain waits on them all; rows for delegates are handed off.

## What stays as it is

- **Patterns**, plan boards already, with the same outputs.
- **The delegation board**: today's conversation board, now declared; routing, notices, chain limits.
- **Pieces for other workers**, and their split park until FIX-2077.
- **`dispatcher()` outside a board**, which FIX-2082 gives `wait`.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| Whatever decides whether a drain waits: the dispatcher assignees' `runsElsewhere`, `onIdle`, `onReview: "exit"`, `shouldExit` | **Replaces** the first with `mode`, a parameter on `taskBoard`, the closest entry. The other three stay: they say when an idle pool stops |
| `goalSeekLoop`'s construction guards ([FIX-910](https://linear.app/fixpoint-labs/issue/FIX-910)) | **Extends** with two: a delegation board, and a board with `onReview: "exit"` |
| The drain's recorders and the claim gate | **Builds on.** Rule 18 is pinned by a test, not built |
| [FIX-1802 → *Decided, not asked*](../FIX-1802/DECISIONS.md#decided-not-asked), "one board per session" | **Superseded in part:** two per session |
| FIX-1802's roster that lets a task session file a piece for itself (`workforce/src/conversation-board/board.ts:290`) | **Superseded:** a filing for itself is a plan row. This lands before FIX-2081 narrows `reach()`, so a step for itself is never refused in between |
| [FIX-1802 D1](../FIX-1802/DECISIONS.md#d1): a worker files for its delegates that take a task, "and that is the whole grant" | **Superseded in part:** a worker is also offered the task tools for its own steps, whether or not it has delegates |
| [FIX-1786 D8](../../epics/FIX-1786/DECISIONS.md#d8): a worker whose delegates take a task gets the task tools, and the split ships | **Kept** for pieces to others |

| The debt | |
|---|---|
| **Removes** | The assignee-derived `runsElsewhere` and its exported `dispatchedTaskPredicate` (a migration row) · the self-piece's child session and park · a mixed board |
| **Adds** | `mode` · a second session ledger, plan rows' · the plan board's interim refusal of a dispatched row ([D3](DECISIONS.md#d3)), lifted by FIX-2082 |
| **Leaves** | A worker can still settle a row through the raw collection, the substrate's escape hatch ([decided](DECISIONS.md#decided-not-asked)) · the split park for other workers' pieces, FIX-2077 |

**Net: up, and small.** One inference, one park and the mixed board go; one option, one ledger and
one interim refusal arrive, and the refusal goes with FIX-2082.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** declared waiting, wrong boards
refused, and a worker's own plan. If wrong: a `mode` field ships while workers still can't plan.

**[The debt](#whats-already-here-and-the-debt), net up and small.** If wrong: the plan ledger is a
second place every reader of a session's tasks has to look.

1. **[D1](DECISIONS.md#d1) · A worker's step for itself is a plan row, worked in the same request.** If
   wrong: a step that needs its own session waits for FIX-2082. **The one to weigh.**
2. **[D2](DECISIONS.md#d2) · After its plan drains, the worker answers once more, and that answer is the result unless it checkpointed an output.**
   The latest `output` checkpoint is the result whenever one exists (FIX-2081's D3).
   If wrong: one model call per planned request, spent for nothing.
3. **[D3](DECISIONS.md#d3) · Until FIX-2082, a plan board refuses a dispatched row.** If wrong: a board
   that wants a waited dispatch can't be built for one issue's span.

**Open: none.**

Feature · `core` + `orchestration` + `workforce` · medium: three packages, one board option, one session ledger · epic FIX-2056
