# FIX-1802 · Any worker can file work, and a filed task can be split down the chain

**Spec** · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **wants one of their workers, not a coordinator, to hand out work** | Only a coordinator's conversation files tasks ([FIX-1794](../FIX-1794/SPEC.md)) | They list the workers it hands work to in its file's `delegates:`. When one of them takes a task, the worker gets the task tools and files onto its own conversation's board, for those delegates, on whatever flow it runs |
| **gives a worker a big task** | The worker does it all itself: a task session that tries to file is refused | It splits the task: files the pieces on its own task session's board, waits, and its task finishes with what the pieces returned. Up to five boards deep |
| **gives a worker no delegate that takes a task** (a routing coordinator whose delegates only take posts, or a worker with no delegates) | n/a | That worker gets no task tools, and the app can't add tasks on its conversations. Nothing is refused when the app loads |
| **runs a worker on their own app flow** (the DevTeam's EM, `flow: em`) | Filing is built into the coordinator flow only | The flow puts the existing task tools on its model's block and their actions on the flow, wired to Workforce's session board, and the worker keeps the flow it names |
| **hands a post to a delegate that then files work** | n/a | The delegate's answer comes back as today. The work it filed reports to the delegate's own session, not to the post |
| **builds a worker that keeps splitting** | n/a | It stops at five boards deep, or at 100 tasks under one top task, whichever comes first. The app can raise the 100. A filing past either is refused as a full board is |

The epic's [D8](../../epics/FIX-1786/DECISIONS.md#d8): filing is a tool any worker can be granted,
and the split is in the MVP. The product owner's sign-off (2026-10-07): the grant is a delegate
that takes a task, with no flag, and the tools are Orchestration's existing task tools. Built on
FIX-1794's board kept per conversation ([epic D6](../../epics/FIX-1786/DECISIONS.md#d6)) and
FIX-1791's delegates.

## The goal, and how we'll know it's met

**Any worker whose file lists a delegate that takes a task, on any worker flow, files work for
those delegates onto its own session's board, and a worker given a task can split it the same way. Every session in
the chain is the owner's, the chain is bounded, and each task's result comes back up, board by
board, to the session that filed the top task.**

| Is it the right goal? | |
|---|---|
| **The real need** | The product owner, 2026-10-06 ([epic D8](../../epics/FIX-1786/DECISIONS.md#d8)): filing is a grant, opt-in per worker; multi-level delegation is in the MVP. 2026-10-07: the opt-in is a delegate that takes a task. FIX-1792 needs it twice: the DevTeam's EM leads storefront's feature workstream as an ordinary worker that files, and lab members that filed on boards file themselves (its BR-13a). Carried from [FIX-1794](../FIX-1794/DECISIONS.md#q): its leg b, D2, BR-7, BR-30 to BR-32 |
| **Smaller, and rejected** | "A coordinator's task session can file one more level." It keeps filing as what makes a coordinator, which D8 rejects, and leaves the EM on a flow it can't keep |
| **Bigger, and not this issue's** | Converting the lab files that file (FIX-1792) · the coordinator's routing policies (FIX-1791, amended on the epic) · a sweeper for boards nobody touches (FIX-1794's follow-up) · stopping a running task (FIX-1659) |
| **Not done if** | Only `agent` workers file · a worker with no delegate that takes a task still files, by tool or app · a split task ends before its pieces · a failed settling turn strands a parent · a chain passes five boards or its task cap (100, or the app's) · a filing lands on another session's board · a session in the chain isn't the owner's · Bob's worker is an assignee anywhere |

```mermaid
flowchart LR
  A["Shift Manager · two users · goal-local workers"] --> L1["a · an agent worker files · its delegate splits"]
  A --> L2["b · an app flow's worker files"]
  A --> L3["c · no task-taking delegate · nothing files"]
  A --> L4["d · the limits"]
  A --> L5["e · a real model splits"]
  L1 & L2 & L3 & L4 & L5 -->|"boards, sessions and notices match"| P["PASS · the goal is met"]
  C["control · the grant isn't checked"] -.-> L3
  L3 -.->|"under the control"| F["must FAIL · a worker with no task-taking delegate files"]
```

The check files through the app and the tools, then only reads boards, sessions and notices.
Under the dashed control every worker gets the tools, and leg c must fail.

| How we verify | |
|---|---|
| **Goal check** | `goals/workers/files-and-splits-down-the-chain/` · scripted workers for legs a to d, a real model for leg e · Shift Manager over HTTP, two users · run by the implementer at completion · verdict in the last implementation PR |
| **Signal** | **a**: Alice's `agent` worker (not a coordinator) files a task for its delegate; the delegate, whose own delegates take tasks, splits it into two pieces for two delegates; four sessions, all hers; each row on its own session's board; the top task completes within 120 s, after both pieces; Alice's conversation gets one `completed` notice. **b**: a worker on a goal-local app flow carrying the capability files for an `agent` delegate; the task completes. **c**: a routing coordinator whose delegates take only posts, and a worker with no delegates, have no task tool, and the app's `addTask` action on their conversations answers `no_delegation_board`. **d**: a chain scripted to split at every level is refused at the sixth board; one scripted to fan out is refused at the 101st task, and at the 4th with the app's cap set to 3; each answers `total_task_cap_exceeded`. **e**: asked for a two-part job, a real model with a task-taking delegate files at least one piece for a delegate, and its conversation hears the ending |
| **Input** | Two users through sign-in; a goal-local tree with scripted workers on `agent`, one on a goal-local app flow, a routing coordinator whose delegates take only posts, and Bob's worker of the same name. Asks held out at run time |
| **Anti-game** | No row, session or notice written by a fixture; no drain from the check. Counts read again after 5 s. Leg c asks the session's tool list, not the prompt |
| **Control that must fail** | `GOAL_CONTROL=no-grant-check`: leg c FAILS on *a worker with no task-taking delegate files nothing*. `GOAL_CONTROL=no-parent-settle`: leg a FAILS on *the top task completes after both pieces*. Today's `main`: every leg FAILS |

## What changes

![Two panels. Today: only a coordinator conversation files, and a task session that tries to file is refused. After: any session of a worker whose file lists a delegate that takes a task keeps a board, so a talk session, a workstream session or a task session files for its own delegates; a split task waits parked on the board above and settles from its pieces, up to five boards deep and 100 tasks under one top task](figures/what-changes.svg)

On the left, filing is a kind of worker. On the right, it follows from who the worker's file
lists as delegates.

**What a worker's file says** (the DevTeam's EM, which FIX-1792 converts):

```diff
  # teams/eng/workers/em/WORKER.md
  ---
  description: Leads the feature. Files the work, never does it.
  flow: em
  document: engineering-handbook
+ delegates: [eng.coder, eng.reviewer]
  ---
```

`eng.coder` takes tasks, so the EM files. That is the whole grant: no flag.

**And what an app flow adds** to carry the tools (the built-in `agent` and coordinator flows
already do). The tools are Orchestration's, wired to Workforce's session board as FIX-1794 wires
them; the Workforce names here are illustrative, the implementer's to pick:

```diff
+ import { createTaskToolsCapability, taskToolActions } from "@flow-state-dev/orchestration"
+ import { sessionBoard, taskDelegates, sessionBoardEntries, files } from "@flow-state-dev/workforce"
  const em = defineFlow({
    kind: "em",
    configSchema: workerConfigSchema().extend({ document: z.string() }),
+   actions: { ...taskToolActions(sessionBoard.id, sessionBoard.resolve, taskDelegates), … },
+   ...sessionBoardEntries,   // the board's run, its task entry and its notice entry
    …
  })
+ // and on the EM's generator block, the tools only for a worker that files:
+ //   uses: [(ctx) => files(ctx) ? [createTaskToolsCapability(sessionBoard.resolve, taskDelegates)] : []]
```

The model's tools are the existing eight: `addTask`, `assignTask`, `completeTask`, `failTask`,
`blockTask`, `cancelTask`, `updateTask`, `listTasks`. The app's actions are the same eight, named
`<tool>_<board>` by `taskToolActions`' rule (so `addTask_tasks` for FIX-1794's draft board id).
The resolver is the session's own board; the roster is its delegates that take a task.

## How a piece's result comes back up

```mermaid
flowchart LR
  C["Alice's conversation · board 1"] -->|"task t1 · for a delegate"| T1["t1's task session · board 2"]
  T1 -->|"pieces · for its own delegates"| T2["piece sessions"]
  T2 -->|"one notice each"| T1
  T1 -->|"last piece ended · t1 settles through its parent binding"| C
```

A task that filed pieces waits, parked, on the board above, and settles there from the pieces'
results through a binding the server wrote when it parked.

## What stays as it is

- FIX-1794's board per session, its wiring of the eight task tools, notices and lookup. This issue
  swaps FIX-1794's answer to "may this session file?" for the delegate rule, says for whom, and
  adds the wait.
- FIX-1791's delegate records and roster check. A coordinator still routes posts.
- The task board and the task tools: no Layer 1 change here
  ([POC](poc/split-on-one-flow/README.md)). The tools' one extension, a roster read per call, is
  FIX-1794's, amended on this PR.
- A post is answered and a task is worked.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** filing for task-taking delegates on any
worker flow, the split, results back up, and a bounded chain. If wrong: the EM moves flow to file, or a
split runs away before anyone looks.

1. **Answered: [D1](DECISIONS.md#d1) · a worker files for its delegates that take a task, and
   that is the whole grant: no `filing` flag** (product owner, 2026-10-07). If wrong: a worker
   that lists task-taking delegates but must never file; a "no filing" mark covers it.
2. **Answered: [D2](DECISIONS.md#d2) · a chain stops at five boards deep, fixed, and at 100
   tasks under one top task by default, which the app can raise** (product owner, 2026-10-07).
   If wrong: a job needing a 101st piece is refused unless the app raises it.

**Open: none.** Reasoning and what lost: [DECISIONS.md](DECISIONS.md). The cases:
[BUSINESS-RULES.md](BUSINESS-RULES.md).

Feature · `workforce`, `shift-manager` · large · 3 PRs, stacked on FIX-1794 · epic [FIX-1786](../../epics/FIX-1786/SPEC.md)
