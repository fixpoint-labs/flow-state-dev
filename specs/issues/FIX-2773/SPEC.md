# FIX-2773 · Teammates' task cards

**Spec** · [Decisions](DECISIONS.md)

## Five people, before and after

| Someone who… | Today | After |
|---|---|---|
| **starts an app from Teammates and copies its task cards** | Copies 709 lines of watchers in `src/app/tasks.ts` and `runs.ts`, seven hand-written types, and a 900-line fake | Copies thin hooks over harness-manager's coding board and recorded work views and the `react` session hooks. A task's type is the view's `CodingBoardTask` |
| **opens a teammate's finished task** | Sees its answer, read from copies of the row in the conversation's items, which a long conversation may not have loaded | Sees the same answer, on the board's row ([D1](DECISIONS.md#d1)) |
| **re-runs a failed task on another harness** | The page sends a `getTask` action for the brief, then files the re-run | The brief is on the board's row; the re-run is filed the same way, with nothing sent first |
| **answers a run's question or review from a card** | Answers the hold the app cached at its last read | Answers the hold the board holds now, as claude-code-style does |
| **maintains harness-manager's views** | Has one consumer of the coding board view | Has two. A field Teammates needs goes on the view, not into the app |

## The goal, and how we'll know it's met

**Teammates' task cards and popups (board, run, review, recorded work, holds, actions, working
now) read only harness-manager's coding board and recorded work views, the `react` session hooks
and orchestration's Inbox client; the 13 allowlist entries below are gone; and every goal the task
screens touch passes.**

| Is it the right goal? | |
|---|---|
| **The real need** | The epic's row: "the second consumer of claude-code-style's task views", with "a ledger of the fake's scenarios, then the fake goes". The epic is done only when Teammates' allowlist is empty ([FIX-2683](../../epics/FIX-2683/SPEC.md#the-goal-and-how-well-know-its-met)) |
| **Smaller, and rejected** | Delete the client imports and the `.flow(` calls, and keep `BoardTask` as a screen type. The allowlist shrinks, and a second translation layer stays, which [FIX-2766](https://linear.app/fixpoint-labs/issue/FIX-2766)'s owner direction rules out |
| **Bigger, and not this issue's** | The conversation feed, talk, roster and window (FIX-2771, FIX-2772). Moving `appTaskOf`'s derivations into the view (FIX-2766). The review card's content ([FIX-2782](https://linear.app/fixpoint-labs/issue/FIX-2782)) |
| **Not done if** | any of the 13 entries is still on the allowlist · a task row type is in `src/app/` or on the screen-type list · `tasks.ts` or `runs.ts` grows, or `src/app/` gains a file · a card or popup shows less than today: the answer, a cancel's reason, a PR's link after a steer, a run's question within the board's 1 s · `goals/task-board/a-settled-task-reaches-the-board` still calls the app's `watchTasks` · a second board view · claude-code-style's inventory goes red |

```mermaid
flowchart LR
  H["the PR's head · Teammates' real folder and allowlist"] --> I["Teammates' inventory test"]
  H --> G["the task goals · five teammates-lab goals and the settled-task goal"]
  I -->|"13 entries gone · green"| P["PASS · goal met"]
  G -->|"every leg PASS"| P
  C["controls · the 13 entries put back on main · a planted src/app file · the re-run goal's patches"] -.-> I
  C -.-> G
  I -.->|"under each control"| F["must FAIL · naming the file"]
  G -.-> F
```

The inventory proves the read path is gone; the goals prove the cards still work through the views.

| How we verify | |
|---|---|
| **Goal check** | `pnpm --filter @flow-state-dev/teammates test` (the inventory test), and in `goals/teammates-lab/`: `a-coding-task-waits-for-your-review`, `a-pr-task-waits-for-its-merge`, `stops-and-re-runs-a-task-from-its-popup`, `tells-a-stopped-task-from-a-working-one`, `survives-a-crash-mid-turn`. Also `goals/task-board/a-settled-task-reaches-the-board` with its Teammates leg reading the lab's new path, and claude-code-style's `pnpm test`. Run by the implementer; verdict on the implementation PR |
| **Signal** | The inventory test green with the 13 entries deleted; every leg of each goal PASS. In the settled-task goal: the Teammates view shows a settled task within 1 s, and makes 0 board reads over 10 s while a reply streams |
| **Input** | Each goal's own held-out input; the scripted coder where the goal names it |
| **Anti-game** | Don't assert on a hook's return or a stubbed view: the inventory reads the source, and the goals read the page and the store. Don't drop a goal's control because its patch target moved: re-point it |
| **Control that must fail** | (1) On `main` with the 13 entries deleted, the inventory test fails naming each. (2) A planted `src/app/task-row.ts` fails as a new read-model file. (3) `stops-and-re-runs-a-task-from-its-popup`'s `wrong-board` and `other-session` controls, re-pointed at the new code, must FAIL. (4) The settled-task goal's `whole-topic` control must FAIL its 0-reads signal |

## What changes

![Before and after. Before: the card and popup call src/app tasks.ts and runs.ts, which stitch four sources per row and build their own request stream, with seven types in the app and a 900-line fake. After: the card reads the coding board view, whose row also carries the answer and brief; the popup reads the react session hooks and the recorded work view; actions and answers go through the Inbox client; tests use a stub server or the lab's host; 13 entries become 0](figures/what-changes.svg)

The task screens read the views claude-code-style reads, and the app's stitching goes.

A card's read, and the view's new fields (illustrative; the implementer names them):

```diff
  // labs/teammates/src/components/Conversation.tsx
- const tasks = useWatch(adapter.watchTasks, sessionId) ?? [];
+ const tasks = useTasks(sessionId).value ?? [];        // useView(codingBoardViewRef(), { sessionId })
- {task.waiting?.prompt}
+ {task.asks[0]?.ask.prompt}
- {task.result ? <MarkdownText text={task.result} /> : null}
+ {task.answer ? <MarkdownText text={task.answer} /> : null}
```

```diff
  // packages/harness-manager/src/kit/coding-board.ts (D1)
  const codingTaskSchema = listedTaskSchema.extend({
+   /** What it came back with: a teammate's text, or a coding run's `answer`, cut as `getTask` cuts it. `null` until it ends. */
+   answer: z.string().nullable(),
+   /** Its brief as filed, for a re-run: */
+   context: z.string().nullable(),
+   labels: z.array(z.string()).nullable(),
+   priority: z.number().nullable(),
-   /** Why its last attempt failed; only on a failed task. */
+   /** Why its last attempt failed, or the reason it was cancelled with; `null` otherwise. */
    error: z.string().nullable(),
```

What goes: `src/app/tasks.ts`'s `taskCalls` and its four sources, `src/app/runs.ts` whole (its
hooks move into `tasks.ts`, since `src/app/` may not gain a file), `TaskCalls` and `RunCalls` from
`AppCalls`, and `runFlows` and `openHolds` from `AppState`. The fake's task and run scenarios go,
each listed in the implementation PR's ledger ([B1](#boundaries-with-siblings)).

**Docs:** no user docs; Teammates is private. A changeset for `@flow-state-dev/harness-manager`
names the coding board row's four new fields and the wider `error` (D1). Teammates' README is the last Teammates
child's (the epic's docs line).

```mermaid
flowchart LR
  B["coding board view · the row, its asks, answer and brief"] --> CARD["task card"]
  B --> POP["task popup"]
  F["useSessionFeed · the run's session"] --> POP
  S["useRequestStream · the call in flight"] --> POP
  R["recorded work view · plan and pull requests"] --> POP
  POP -->|"cancel · steer · release · retry · refile"| IB["Inbox client · board at the conversation"]
  POP -->|"answer"| IA["Inbox client · answerOne on the board's hold now"]
```

## What stays as it is

- Every task screen's behaviour and copy: the card, the popup, the time signal, the actions row.
- `src/lib/task-presentation.ts`, `attention.ts`, `cleared.ts` and `status.ts`: screen code; they
  take `CodingBoardTask` in place of `BoardTask`.
- The review card (`components/flow-state/review-hold.tsx`) and what it draws. It reads the stop
  through harness-manager's `reviewDetail`, as today.
- `steps.ts` and its types ([B3](#boundaries-with-siblings)).

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| **The job: show a conversation's tasks.** Two ways: harness-manager's coding board view (claude-code-style's `useTasks`), and Teammates' `taskCalls`, which stitches the board's task-list view with row copies from items. Searched `taskListViewRef`, `codingBoardViewRef`, `watchTasks`, `boardCopies` in `labs/`, `packages/`, `goals/` | **Folds** the second into the first: this would otherwise stay the 2nd way |
| **The job: show a task's run.** Claude-code-style's `useTaskWork` over `useSessionFeed`, `useRequestStream` and the recorded work view; Teammates' `runCalls`, with its own request-stream store and topic read | **Folds** into the first |
| Harness-manager's `readSessionPullRequests`, a package direct read | **Reused** for a PR's link, as the popup reads it today: the whole run session, not one request. Claude-code-style reads the recorded work view by request instead; whether a steer's run loses the link there is the implementer's test, not this spec's |
| The epic's seam: "a row Teammates needs extends that view; no second board view" ([coordination seams](../../epics/FIX-2683/DECISIONS.md#coordination-seams)) | **Applied**: D1 |
| [FIX-2766](https://linear.app/fixpoint-labs/issue/FIX-2766)'s owner direction: screens read `CodingBoardTask` with `?.`; no translation type | **Applied** here. Its view derivations stay FIX-2766's; until they land, the screen calls `taskView` itself, as claude-code-style does |
| [FIX-2769 D1](../FIX-2769/DECISIONS.md#d1): a type leaving the allowlist for the screen-type list needs a reason | **Kept**: no type moves; each is deleted |
| [FIX-2628](https://linear.app/fixpoint-labs/issue/FIX-2628): answer the hold the board holds now | **Applied** to Teammates' answers |

| Adds | Existing piece considered | Why it doesn't fit / how composed |
|---|---|---|
| `answer`, `context`, `labels`, `priority` on `CodingBoardTask`, and `error` on a cancelled task | The board's `getTask` action, which Teammates sends from the page today; a one-task read on the Inbox client | **Extends** the view (D1). Composed from `answerTextOf` and the row the view already reads |
| Hooks `useTasks`, `useTaskWork` in Teammates' `tasks.ts` | Claude-code-style's same hooks | **Copies** them, by the epic's ER-7: FIX-2756 shares them |

| The debt | |
|---|---|
| **Removes** | Teammates' `taskCalls` and `runCalls` (about 600 of 709 lines); seven types; the row-copy merge across three sources; a hand-built request stream; the fake's task and run scenarios |
| **Adds** | Four nullable fields on a published view. A second copy of claude-code-style's task hooks, which FIX-2756 pulls into one place (ER-7) |
| **Leaves** | The fake's file, if a sibling still uses it when this merges ([B1](#boundaries-with-siblings)). `steps.ts`'s types and the shared plumbing ([B2, B3](#boundaries-with-siblings)). `cleared.ts`'s and `attention.ts`'s "needs you", computed on the screen (the epic keeps it) |

**Net: down.** One of two ways to show a task goes; the view gains four fields.

## Boundaries with siblings

For the epic's cross-spec review. Each is a recommendation, not a decision of this spec.

- **B1 · The fake.** Fifteen test files use `test/fake-app.ts`; four are task tests. It implements
  all of `AppCalls`, so FIX-2771 and FIX-2772 must edit it when they remove their calls. Recommended:
  each child cuts its own scenarios and lists each in its PR's ledger (scenario to a test, or
  "dropped, because …"). This issue writes the ledger's form and cuts the task and run scenarios.
  The child whose cut leaves the fake empty deletes the file and its `gone` entry. If this issue
  merges last, that is this issue. The epic's row gives the whole fake to this issue; that holds only if this issue lands after both siblings.
- **B2 · Shared plumbing.** `AppCalls` (`calls.ts`), `AppState` (`state.ts`), `Unsubscribe`
  (`reads.ts`) and `Item` (`items.ts`) serve every job. Recommended: the child whose change leaves
  one unused deletes it, by the orphan rule. This issue removes `TaskCalls`, `RunCalls`,
  `runFlows` and `openHolds` from them.
- **B3 · `steps.ts`.** `SessionStep`, `StepRun` and `RunSummary` are used by conversations (t2),
  talk (t1) and a task's run (here). Recommended: FIX-2772 owns them; this issue keeps calling
  `runSteps`.
- **B4 · The provider.** Hooks need the client in context. Today `AppProvider` holds only
  `AppCalls`. Recommended: the first of the three to merge adds `client` and `pollIntervalMs` to
  it, as claude-code-style's `useAppContext`; the others use it.
- **B5 · `workers.ts`.** Its `topic` import and `Activity` serve both the roster (t1) and activity
  (t2). Not this issue's; named so the review assigns it.
- **The coding board view** is also changed by FIX-2766. Same file, no shared field: whichever
  lands second rebases.

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** the task screens on the views
claude-code-style reads, 13 entries gone, every task goal passing. If wrong: Teammates keeps a
second way to show a task, and the epic's allowlist can't empty.

**[The debt](#whats-already-here-and-the-debt), net down:** one of two task read paths goes; the
view gains four fields. If wrong: the published view grows for one app's needs.

1. **[D1](DECISIONS.md#d1) · A task's answer and brief come on the coding board's row.** The one
   to weigh. If wrong: every app on harness-manager reads every ended task's answer on each board
   read.

Improvement · `labs/teammates` (src/app, components, tests), `packages/harness-manager` (the coding
board view), two goals' Teammates legs · M (about 600 lines out, four fields in) · after FIX-2755 and
FIX-2769 (merged) · parallel with FIX-2771 and FIX-2772 (B1 to B4) ·
[Linear](https://linear.app/fixpoint-labs/issue/FIX-2773) · epic [FIX-2683](../../epics/FIX-2683/SPEC.md)
