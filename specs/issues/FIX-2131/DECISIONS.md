# FIX-2131 · Decisions

[Spec](SPEC.md) · **Decisions**

Most of this issue was decided above it: rule 11 of
[the concept](../../../docs/internal/design/workforce-coordination-concept.md#the-rules), the
epic's ER-4 and ER-5, and FIX-2129's `waitForUser`, its endings and its answer route. Two calls
are left, both about what a person sees.

## The tree

```mermaid
flowchart TD
  I["FIX-2131"] --> D1["D1 · a steer answers only a question"]
  D1 -.->|"rejected · a typed line is no verdict, and approvals are the user's"| X1["a steer answers any kind"]
  I --> D2["D2 · a task parked before the upgrade runs again and asks again"]
  D2 -.->|"rejected · held waits on FIX-2133; cancelled loses the work"| X2["map it to held on questions, or cancel it"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A steer answers only a question; approvals and reviews are answered in the Inbox

| | |
|---|---|
| **Instead of** | Letting any steer answer any kind of stop, so "looks good" typed in a task's session would answer its review, or "yes" its approval |
| **Because** | Rule 11: only the user answers approvals and reviews, and the concept names the session line and the filer's steer as answers to a *question*. An approval is a yes or no and a review is a verdict; free text read as either is a guess about what the person meant, and a filer answering one would approve its own work. A question's answer is text, so a steer is a whole answer |
| **Locks in** | A steer into a task waiting on an approval or a review is kept and the item stays open. The block's result is the Inbox's verdict alone; the steer reaches the work the way any steer does (FIX-2086): the next model call takes it, and a task does not complete with a steer untaken, so it takes one more turn whose brief holds it. The filer answers only a question asked midway, and not on a routed task, whose filer is the conversation (ER-4). The user answers a question from the Inbox, a line in the task's session (which the composer writes as a steer) or a screen's `updateTask`. Apps and screens write against this; widening it later changes what a typed line does to a waiting task |

![D1: a steer answers only a question, chosen, beside a steer answers any kind. Decides it: a typed line read as a verdict. Price: a user who types in the session still clicks in the Inbox for a review](figures/d1-steer-answers-a-question.svg)

It comes down to a typed line read as a verdict: "looks good" would approve work nobody looked at.

**What would change my mind:** users who review in the task's session and never open the Inbox.
Then a review takes a typed line, and an approval still doesn't.

<a name="d2"></a>
## D2 · A task parked before the upgrade runs again and asks again, using no attempt

| | |
|---|---|
| **Instead of** | Mapping a stored parked row onto *held on questions*, or cancelling it |
| **Because** | A parked row has no suspended request to resume, so it can't become a waiting stop as it is. Held on questions is FIX-2133's and would make this issue wait on it (the epic's seam). Cancelling loses open work. Running it again is what answering it did anyway, a new attempt from the top, and FIX-2080's `parked-for-turn` entry already reads its parked rows this way. The run asks again through `waitForUser`, so the question lands in the Inbox |
| **Locks in** | Three read-time entries in FIX-2080's map: a row parked on a question and a row parked for review read `pending`, one more turn re-entry, so no attempt is spent; a row answered but not yet run reads `pending` with the answer as one untaken steer. A person with an open question from before sees it again, perhaps in new words, after one more run. Nothing is written at upgrade |

![D2: run it again and ask again, chosen, beside held on questions or cancelled. Decides it: a parked row has no request to resume. Price: one more run, and the question may be worded anew](figures/d2-parked-runs-again.svg)

It comes down to a parked row having no request to resume: only a new run can ask again.

**What would change my mind:** stored parked rows whose work is expensive to redo, such as a long
coding run. Then those are FIX-2132's own entry, read first.

## Decided, not asked

- **This issue merges after FIX-2132.** A coding run's question on a conversation's board writes
  the same question park and is answered by the same unpark `answerTask` uses (harness-manager's
  `parkOnBoardQuestion`). Removing them first would leave that question no answer on `main`.
  FIX-2131 builds in parallel and owns removing the shared park, its status and the map entries;
  FIX-2132 moves every harness-manager park off it: the question, a held-work mismatch and a read
  failure, all of which call `parkOnBoardQuestion` or `awaitReview` today, and the run record's
  `parked`. Until this lands, FIX-2132's question lists are input to this issue's. A stored
  harness park reads through this issue's map entries like any park; FIX-2132 adds none.
- **"First answer wins, unless a cancel is already written"** (FIX-2129), at one convergence
  point: the stop's pending state. Its writers are the answer route (the Inbox), the steer write
  (`updateTask`'s `message`, from the model's tool, its action, a screen, and the task-session
  composer), the sweeper at the deadline, the cancel and the user's stop. The steer write checks
  the row's cancel as the Inbox answer does. A steer resolves nothing any other way.
- **A line in the task's session is a steer the composer writes.** While the task is open, Shift
  Manager's task-session composer calls `updateTask({ id, message })` as the user, instead of
  sending a turn to the session. A `sendMessage` to a session waiting on a person still queues and
  answers nothing (rule 10; the owner's call of 2026-10-22).
- **Who may answer by steer** is read from server-set state (BP-031): the steer's sender, the
  row's filer and `resultTo`, and the stop's kind on the row (`waitingFor`, FIX-2129).
- **A steer that answers** is kept on the row like any steer, taken by the attempt it answered,
  so it isn't handed over twice. The caller's result says whether it answered or was kept.
- **One loser rule.** An answer that loses, to another answer, a cancel or the deadline, is told
  `already-resolved` (FIX-2129); a steer that loses stays an ordinary steer, taken before the next
  model call (FIX-2086).
- **The steer cap doesn't refuse an answer.** The write checks the stop before `MAX_STEERS`: a
  steer that answers is kept, taken, even at the cap, so a question is always answerable. A row
  holds at most the cap plus one steer per answered question.
- **A retry asks again.** An Inbox answer lives on the stop, which ends with its attempt; a steer
  that answered is on the row, so the next attempt's brief holds it, as it holds any steer. Meant:
  writing the Inbox answer as a steer too would be a second record of one answer.
- **The model's tool is `waitForUser({ kind, prompt })`**, all three kinds, on every task turn,
  a waited-on task's included (the concept: "A waited-on task may still stop for a person"). It
  takes the host's person-stop default deadline and returns a no-answer result at it, since a
  model can't catch (FIX-2129 D1). It takes `parkOnQuestion`'s slot (`controlTools`), so a
  worker's tool list never has both. A turn with no task doesn't get it: its reply is already
  the question.
- **The Inbox** reads ER-1's predicate, names a review as a review, and takes a task's context
  from the board snapshot it already loads, not a read per task. `reads.ts`'s `PERSON_REASONS`
  and `send.ts`'s `stopOf` move onto the predicate. Chief of Staff's parked list goes: its
  questions are asks now.
- **The `parked` notice goes.** No ending `parked` is written. A stored one not yet delivered still
  reads and is delivered; the filer's reply is a steer the re-run reads (D2). Until FIX-2070 the
  filer is told nothing when its task asks, and finds the question through `getTask`.
- **Removed outright** ([FIX-2056 (e)](../../epics/FIX-2056/DECISIONS.md#e)): no deprecation
  release. A board built with `onReview` is refused by name (BP-030). The `parked` status is no
  longer written and is read only through the map; its board column and filters go.
- **FIX-2087's sweep** drops `answerTask` and `parkOnQuestion` from its allow list and its
  migration table, and lists `waitForUser` beside `reportProgress`.
- **FIX-1851** closes as superseded when this merges.

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep `answerTask` as a thin call onto the steer (simpler for callers) | A second way to answer, which ER-4 forbids |
| Merge before FIX-2132, leaving the shared park for the coding run; or land the new surface first and delete the shared park in a third PR | `main` carries both forms between the merges, and whichever PR lands last must remember the deletion. FIX-2132 builds in parallel, so the serial merge costs only the wait |
| A line in the task's session answers as a message to the session | The session is waiting on the stop, so the line queues behind it (rule 10) and contradicts the owner's call that a steer is the only way to change open work |
| Keep the `parked` status for app-written parks | The second form of stopping the epic's D1 removes |
| Rewrite stored parked rows at upgrade | A write pass over every store; the map reads them where they are (FIX-2056 D3) |

## Settled

- **No POC.** The new parts sit on FIX-2129's pending state and FIX-2086's steer write, both
  specced and tested there. The one fact the ordering rests on, that the coding run's board
  question uses the same park and unpark, is read from the code
  (`harness-manager/src/manager.ts`, `parkOnBoardQuestion`; `test/claim-host.ts`,
  `unpark(..., { answer: true })`). No counted fact carries the approach, so no checker.

## Notes from review

Recorded for the implementer from the epic review ([#3732](https://github.com/fixpoint-labs/flow-state-dev/pull/3732)), routed here on Linear; not folded into the design.

- **Round 1:** "Include one persisted legacy parked row, read through FIX-2080's map, in the tests (BP-030 dual-read is the one case the no-shim decision does not waive)."
- **Round 1 and 2:** "Plan the migration of the ~25 orchestration test files that touch answerTask/parkOnQuestion/awaitReview/unparkAndDrain inside the deletion PR, so it is not also a separate test rewrite."
- **Round 1:** "Build Inbox items from the board snapshot LabReader already loads, not from a getTask/listTasks call per task on each refresh (N+1)."
- **Round 1:** "Move both reads.ts PERSON_REASONS and send.ts stopOf onto the contracts predicate."

From this PR's round 1 ([#3738](https://github.com/fixpoint-labs/flow-state-dev/pull/3738)):

- **Cursor:** "share one internal resolve (Inbox route + steer write + session line) rather than a parallel `answerQuestionFromSteer` beside unpark logic."
- **Cursor:** "When Chief of Staff's parked list goes, dedup: question/review stops appear once (asks), not also via `shiftSummary.parked` / board scans."
- **Cursor:** "Steer admission: kind/filer/`resultTo` from trusted row state already loaded for the write (BP-031), not a follow-up fetch per steer."
- **Cursor:** "Inbox construction must not call task tools per row; enrichment joins snapshot boards in memory."
- **Cursor:** "Decided, not asked re-documents FIX-2129 / FIX-2086 mechanics … one paragraph pointing at FIX-2129 + FIX-2086 and listing only this issue's deltas." And: a leg → actor → pass table for the Signal.
- **Second look, D1:** "the tool result should make 'answered by session line' visible to the block so it can't be mistaken for the Inbox answer."
- **Second look, D2:** "the three new map entries must have disjoint predicates from `parked-for-turn` and `parked-split` … A parked row can carry `parkedForTurn` and a question. Please pin the precedence in a test."
- **Second look, tests:** "~40 files under `packages/orchestration/test`, plus `harness-manager/test` (3 files), `integration-tests/.../task-board-park-exit-across-requests.test.ts`, `devtool/test/task-actions.test.ts`, and `shift-manager/test/devteam-chief-of-staff-tasks.test.ts` … the `park-exit` drain tests … should be deleted, not migrated."
- **Second look:** "I'd not widen beyond [the predicate move] (e.g. leave `goal-seek-loop.ts`/`quiescence.ts` park handling to the removal itself)."

## How it got here

- **Draft** — framed as retiring both parks onto FIX-2129's `waitForUser`, with the steer as the
  filer's answer and the Inbox listing both kinds; ordered after FIX-2132, which shares the park.
- **Round 1** — a session line answers as a steer the composer writes, not as a message to the
  session, because a waiting session queues messages (rule 10). A steer into a review reaches the
  work through FIX-2086's owed turn, because a resumed block is handed only its verdict. Every
  `parked` surface got a named fate.

**Open: none.**
