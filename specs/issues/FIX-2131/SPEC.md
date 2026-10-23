# FIX-2131 · Questions and reviews suspend: retire the question and review parks

**Spec** · [Decisions](DECISIONS.md)

## Six people, before and after

| Someone who… | Today | After |
|---|---|---|
| **writes a worker that can't go on without an answer** | Its model calls `parkOnQuestion`. The task parks, the turn ends, and the answer comes back as a new turn from the queue | Its model calls `waitForUser`. The turn waits, and the tool's result is the answer, on the same attempt |
| **writes a flow block that wants its work reviewed** | Calls `awaitReview`, which parks the task, and mounts `unparkAndDrain` so something can answer it | Calls `ctx.waitForUser({ kind: "review", … })`. The Inbox answers it, and the block carries on |
| **filed a task that asked a question** | Answers it with `answerTask`, a fifth task tool | Answers it with a steer, `updateTask({ id, message })`. The first answer wins; a later one is an ordinary steer |
| **is the user, looking for what waits on them** | The Inbox lists approvals and input. A parked question sits in Chief of Staff's separate list; a parked review shows nowhere | The Inbox lists approvals, questions and reviews. A line typed in the task's session answers a question too: the composer writes it as a steer |
| **steers a task waiting on an approval or a review** | n/a | The steer does not answer it. The item stays open, the steer is kept, and the task takes one more turn for it before it ends ([D1](DECISIONS.md#d1)) |
| **had a task parked before the upgrade** | n/a | The task runs again at its next touch, using no attempt, and asks again in the Inbox. An answer already given reaches the run as a steer ([D2](DECISIONS.md#d2)) |

## The goal, and how we'll know it's met

**A worker or a flow that needs a person asks one way; the person sees a question or a review as
one Inbox item; and the first answer, from the Inbox, the task's session or the filer's steer,
carries on the same attempt.**

| Is it the right goal? | |
|---|---|
| **The real need** | The issue's objective: "A question or review is a stop for a person like any other: it suspends, shows in the Inbox, and is answered one way." The epic's legs a and b for these two kinds, and its rules ER-4 and ER-5 ([FIX-2058](../../epics/FIX-2058/DECISIONS.md#who-owns-what)) |
| **Smaller, and rejected** | "The four calls are deleted and `waitForUser` is documented." Met while the filer has no way to answer, a review shows in the Inbox as a question or not at all, and a row parked before the upgrade is stranded |
| **Bigger, and not this issue's** | A coding run's question (FIX-2132) · a task held on questions (FIX-2133) · the filer told of the question by a message (FIX-2070) · the five kinds proved together (FIX-2134) |
| **Not done if** | A review lists as an approval or a question · a steer answers an approval or a review · the filer's steer answers a routed task's question · a stored parked row reads as parked, or is lost · a plain message to a waiting task's session answers it · a task tool still answers a stop · the check answered through the store |

```mermaid
flowchart LR
  H["durable SQLite host · a task-board worker · scripted model turns"] --> A["leg a · a worker asks a question, a block asks for a review"]
  A --> I["Shift Manager's snapshot · one item each, kind named"]
  I --> B["leg b · filer's steer · leg c · Inbox · leg d · session line"]
  I --> W["leg e · a steer into the review is kept"]
  L["leg f · a row stored parked"] --> I
  B -->|"same attempt · first answer wins · item closes"| P["PASS · goal met"]
  W -->|"item stays · one more turn takes the steer"| P
  C["control · a steer is kept, never answers"] -.-> B
  B -.->|"under the control"| F["must FAIL · leg b, the tool's result is the filer's answer"]
```

The check reads what Shift Manager's Inbox read lists and what `getTask` returns, and answers the
way a person or a filer does, never through the store.

| How we verify | |
|---|---|
| **Goal check** | `goals/task-board/asks-a-person-one-way/` · model-free (`n/a`, scripted turns call the real tools) · run by the implementer at completion · verdict in the implementation PR |
| **Signal** | a: the snapshot lists one `question` item and one `review` item, `getTask` shows each task waiting on a person, no row is `parked`. b: the filer's `updateTask` message is the tool's result, `attempts` stays 1, the item leaves the list, and an Inbox answer after it is told `already-resolved`; a steer written after a cancel is told `already-resolved` and stays a steer. c: the snapshot lists the review as `review`, not as an approval or a question. d: a line the user types in the task's session is written as `updateTask({ id, message })` from the user and answers a second question; `sendMessage({ to: { task } })` to a task waiting on a third question queues and answers nothing (rule 10). e: a steer into a waiting review leaves its item listed; once the Inbox answers, the task takes one more turn before it completes, and that turn's brief holds the steer. A filer's steer to a routed task's question leaves its item listed. f: rows stored `parked` and `awaiting_review` on a question, and one parked for review, read `pending` with no attempt spent, run, and list as a question or a review; a stored answered row's answer is a steer the run reads. Sweep: the four calls, `awaitReview`, `unpark` and `onReview` have no references in package source outside the retired-shape map |
| **Input** | "Which region?" from a model turn; "Does this draft read right?" from a block. Any prompt passes the same way |
| **Anti-game** | Don't assert on the suspension store or on rows written by hand, except leg f's seeded legacy row. Read through the snapshot and `getTask` |
| **Control that must fail** | `GOAL_CONTROL=steer-kept-only` fails leg b on *the tool's result is the filer's answer*. `GOAL_CONTROL=no-park-map` fails leg f on *reads `pending`*. Today's `main` fails leg a (the task parks; no review item) and the sweep |

## What changes

![A grid of five moments, today and after: a worker asks, a flow asks for review, the filer answers, the user answers, a row parked before the upgrade](figures/what-changes.svg)

Read down each column: every red cell today is a second path or a stop the Inbox can't show.

**A worker's model asks:**

```diff
- parkOnQuestion({ question: "Which region?" })        // the task parks; the next turn is the answer
+ waitForUser({ kind: "question", prompt: "Which region?" })
+ // the result is the answer, on the same attempt; at the deadline, a no-answer result the model reads
```

**A block asks for review, and the app stops answering it:**

```diff
- await tasks.awaitReview(taskId, "Does this draft read right?");   // parks; the next attempt reads feedback
+ const review = await ctx.waitForUser({ kind: "review", prompt: "Does this draft read right?" });
+ if (review.cancelled) return { skipped: true };
  …
- actions: { answer: { block: board.unparkAndDrain } }   // gone: the Inbox answers through FIX-2129's route
```

**The filer answers:**

```diff
- answerTask({ taskId: "t1", answer: "EU" })
+ updateTask({ id: "t1", message: "EU" })   // answers the question t1 waits on; first answer wins
```

**Docs:** update `apps/docs/guides/human-in-the-loop.md` to teach `waitForUser` as the one way to
stop for a person, with `ctx.suspend` for forms and selections (the epic's docs line). In
`apps/docs/docs/orchestration/task-board.md`, extend FIX-2129's *When a task waits on a person*
section with questions, reviews and the steer; *Waiting on a person: `onReview`* and *When a task
stops on a question* go, and `answerTask_<board>` leaves the actions. Every other page and README
the sweep finds naming a removed call or the `parked` status is rewritten (about fifteen pages today,
and the READMEs it finds). A changeset with a migration
note covering each public item [below](#every-parked-surface-and-its-fate). No new page.

## How an answer reaches a stop

```mermaid
flowchart LR
  F["filer · updateTask message"] --> S["the steer write"]
  U["user · a line in the task's session, written as updateTask by the composer"] --> S
  M["sendMessage to the waiting session"] -->|"queues · rule 10"| Q["answered after the stop, outside the task"]
  S -->|"waits on a question · sender may answer · no cancel written"| X["the stop's one pending state · FIX-2129"]
  S -->|"approval, review, or a routed task's filer"| K["kept on the row · one more turn takes it"]
  I["Inbox · the answer route"] --> X
  X -->|"first resolution wins"| B["the waiting block or tool · same attempt"]
```

A steer reaches the same pending state the Inbox does, so the first answer wins, unless a cancel
is already written (FIX-2129). One loser rule: an answer that loses, to another answer, a cancel or
the deadline, is told `already-resolved`, and a steer that loses stays a steer. An answer is checked
before the steer cap, so a question is always answerable by steer.

## What stays as it is

- **`waitForUser`, its row mark, its endings and its answer route** (FIX-2129). This issue answers through them.
- **Approvals and input** in the Inbox, and a steer to a running or pending task (FIX-2086).
- **A message to a session waiting on a person queues** (rule 10; FIX-2129's pinned test). A line answers only as a steer.
- **Messages** until FIX-2070, the words until FIX-2071 (which drops the names this removes), the held start until FIX-2133.
- **harness-manager's `answerQuestion()`** until FIX-2132.

## What's already here, and the debt

| Already here | What this does with it |
|---|---|
| Ways to stop for a person, across `packages/`: `waitForUser` (the closest, FIX-2129), `ctx.suspend` with a person's reason, the question park, the review park, harness-manager's inbox. Searched `parkOnQuestion`, `awaitReview`, `unpark`, `answer`, `suspend` | **Replaces** the two parks with the closest. After FIX-2132, one way |
| Ways to answer one: the answer route (FIX-2129, the closest), `answerTask` and its action, `unpark` and `unparkAndDrain`, harness-manager's `answerQuestion()`, and the steer (FIX-2086), which today never answers | **Removes** `answerTask` and both unparks; **extends** the steer to answer a question. The Inbox's route and the steer are its two doors, for the user and the filer |
| [FIX-1817 D1](../FIX-1817/DECISIONS.md#d1): an answered question continues as a new turn through the board's re-queue | **Superseded** in whole: the answer resumes the same attempt (rule 12) |
| [FIX-2086](../FIX-2086/SPEC.md)'s "a steer to a task stopped on a question never answers it" | **Amended:** a steer answers a question, the filer's only on a task that isn't routed ([D1](DECISIONS.md#d1)) |
| [FIX-2056 D2](../../epics/FIX-2056/DECISIONS.md#d2) and [(e)](../../epics/FIX-2056/DECISIONS.md#e): answering by steer is this epic's; old APIs go outright | **Kept and finished** |
| [FIX-2056 D3](../../epics/FIX-2056/DECISIONS.md#d3), FIX-2080's map, with its `parked-for-turn` entry: a parked row reads pending, uncharged | **Extended** by entries for parked questions, answered questions and reviews ([D2](DECISIONS.md#d2)) |
| FIX-2087's task-surface sweep, allowing `answerTask` and `parkOnQuestion` | **Amended:** both allowances go; `waitForUser` joins `reportProgress` as a worker's own tool |
| FIX-2129's rule that a message to a session waiting on a person queues (rule 10), and its pinned test | **Kept.** The session line answers as a steer, not as a message |
| FIX-2086's session door: a line in an open task's session is a steer | **Kept** for a running task. A waiting session queues the line behind the stop, so Shift Manager's task-session composer writes `updateTask({ id, message })` as the user instead of sending a turn |
| `PERSON_REASONS` in Shift Manager and the Lab send's `stopOf` | **Replaced** by ER-1's predicate |

| The debt | |
|---|---|
| **Removes** | `parkOnQuestion` and its capability, `answerTask` and its action, `awaitReview`, `unpark`, `unparkAndDrain`, `onReview` and the drain's park exit, the `parked` status as a write, `parkedOnQuestion` and `answered`, Chief of Staff's parked list, two person-stop checks, two sweep allowances |
| **Adds** | FIX-2129's `waitForUser` wired into a worker's model tools, in `parkOnQuestion`'s slot · the steer as one more writer to FIX-2129's pending state · three map entries. All permanent by design; the map goes no earlier than FIX-2071 |
| **Leaves** | harness-manager's inbox and `answerQuestion()` (FIX-2132) · FIX-1851, which closes as superseded |

**Net: down.** Two parks, two unparks and a tool become one call and a steer.

### Every `parked` surface, and its fate

| Surface | Fate |
|---|---|
| The `parked` status (and `awaiting_review`, its older name), its transitions, the claim refusal for a parked row, the claim reason `parked` | **Removed** as a write and from the public status. A stored row is **read through the map** ([D2](DECISIONS.md#d2)) |
| `counts.parked` and the drain's rungs on it (board meta, check board, quiescence, the goal-seek loop) | **Removed.** A task waiting on a person is running with its claim (FIX-2129) |
| `onReview` and the drain's park exit | **Removed.** A board built with `onReview` is refused by name |
| `parkOnQuestion`, `createParkOnQuestion`, `parkedOnQuestion`, `answered` | **Removed.** `waitForUser` takes the tool's slot |
| `answerTask`, its action, `unpark`, `unparkAndDrain`, `awaitReview` | **Removed** |
| The notice ending `parked` (orchestration's notice and settled entry, workforce's settle notice) | **No longer written.** A stored, undelivered one still reads and is delivered; the filer's reply to it is a steer the re-run reads (D2). Until FIX-2070 the filer is told nothing when a task asks; it finds the question through `getTask` |
| Workforce's wake backfill, which checks for `parked` | **Read through the map:** a parked row is pending |
| harness-manager's parks: every `parkOnBoardQuestion` caller (the question, a held-work mismatch, a read failure) and its run record's `parked` | **FIX-2132's.** This merges after it; this issue's sweep fails until they are gone |
| The `parked` column, filters and answer action in Shift Manager, devtool, `react` and kitchen-sink | **Removed.** A waiting task shows through FIX-2129's mark and its Inbox item |
| The `ui` registry's `task-plan` copy | **Removed**, with a changeset line, since apps copy it. Its status read shows a legacy `parked` as pending |
| Chief of Staff's parked list | **Removed.** Its questions are asks |
| labs/conductor's `onReview: "exit"` and its unpark answer | **Rewritten** onto `waitForUser` and the Inbox route |
| Goals asserting `parked` or `answerTask` (about twenty today, from task-session-stays-open to a-mapped-project) | **Rewritten** onto the new stop, or **retired** where the park was the thing proved |
| Integration tests of the drain's park exit | **Deleted**, with the feature. Tests that only use a park to stop a task move onto `waitForUser` |

## Sign off

**[The goal](#the-goal-and-how-well-know-its-met), at that size:** both kinds in the Inbox, one
ask, three doors to one answer, old rows not stranded. If wrong: a person still hunts for a review.

**[The debt](#whats-already-here-and-the-debt), net down:** five calls, a board option and a
status go; one tool and three map entries come. If wrong: the map outlives every stored park.

1. **[D1](DECISIONS.md#d1) · A steer answers only a question; approvals and reviews are answered
   in the Inbox.** If wrong: a user types "looks good" and the review still waits.
2. **[D2](DECISIONS.md#d2) · A task parked before the upgrade runs again and asks again, using no
   attempt.** If wrong: an open question is asked again in new words, after one more run.

**Open: none.** D1 is the one to weigh: it decides what a typed line can do to a waiting task.
**Merges after FIX-2132** ([why](DECISIONS.md#decided-not-asked)).

Feature · `orchestration`, `workforce`, `patterns`, `devtool`, `react`, `ui`, `shift-manager` · large · epic FIX-2058 · blocked by FIX-2063, FIX-2129, FIX-2056, FIX-2132 (builds in parallel; merges after it)
