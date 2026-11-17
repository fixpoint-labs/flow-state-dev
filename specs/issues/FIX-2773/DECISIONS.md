# FIX-2773 · Decisions

[Spec](SPEC.md) · **Decisions**

One call for sign-off: the one framework change this issue needs. The epic already decided the
rest: the views to read ([its seams](../../epics/FIX-2683/DECISIONS.md#coordination-seams)), no
legacy path (ER-3), no read model growth (ER-4), and copies stay copies (ER-7). FIX-2766's owner
direction decided the row type.

## The tree

```mermaid
flowchart TD
  E["FIX-2773"] --> D1["D1 · answer and brief on the coding board row"]
  D1 -.->|"rejected"| X1["a one-task read when a popup opens"]
  E --> K["decided, not asked · the row type, the hooks, the answers, the tests"]
  E --> B["boundaries · B1 to B5, decided by the coordinator"]
```

<a name="d1"></a>
## D1 · A task's answer and its brief come on the coding board view's row

| | |
|---|---|
| **Instead of** | A one-task read when the page needs one: a `get(id)` on the Inbox client's board, sent when a popup opens on an ended task and when a re-run is filed |
| **Because** | Teammates shows a teammate's whole answer in a task's popup, and a re-run copies the task's brief. The coding board row carries neither today. Teammates gets the answer from row copies in the conversation's items, and the brief by sending `getTask` from the page (`withBrief`, an L3 finding). A one-task read is an action on the conversation, so each popup open records a request there, and a running task's popup must read again when it ends. On the row, the answer arrives with the status that ends the task, and nothing is sent. The view already reads the whole row on the server; it drops these fields today. The epic's seam says a row Teammates needs extends this view. [Tenet 2](../../../docs/philosophy.md): the view a second app needs grows, not a second path beside it |
| **Locks in** | Four nullable fields on harness-manager's published `CodingBoardTask`: `answer` (a teammate's text, or a coding run's `answer`, cut as `getTask` cuts output), `context`, `labels` and `priority`. Its `error` also carries a cancelled task's reason. A changeset (minor). Claude-code-style may read them; it is not changed here |

**The ask, in six parts**

- **The fork.** Does a finished task's answer, and its brief, travel with every read of the
  board, or does the page ask for one task when it needs it?
- **In plain terms.** Today Teammates finds a teammate's answer in its own copies of the
  conversation, and asks the server for a task's brief before a re-run. Both must come from a
  package now. Either every board read carries them, or the page sends one request per task when a
  popup opens or a re-run is filed.
- **The trade-off.** On the row: each board read is larger, by every ended task's answer, for
  every app on harness-manager. A one-task read: the board stays small, but each popup open adds a
  request to the conversation's record, and a popup open while the task runs must read again when
  it ends.
- **My recommendation.** On the row. A popup should cost nothing, and the size is bounded by the
  same cut `getTask` already applies.
- **What would change my mind.** A real conversation whose board read with answers passes about
  100 KB; or knowing that teammates' answers are routinely tens of KB.
- **What being wrong costs.** Little. The fields are nullable; moving the answer to a one-task
  read later changes one hook per app and one pre-1.0 view.

![D1: the answer and brief on the coding board row, chosen, beside a one-task read when needed. Decides it: what a popup open costs, nothing against a recorded request. Price: every board read carries each ended task's answer. A tie: both change one published package. Locks in four nullable fields; flips if a real board read passes about 100 KB](figures/d1-answer-on-the-row.svg)

It comes down to what opening a popup costs: on the row it costs nothing.

<a name="decided-not-asked"></a>
## Decided, not asked

- **The row type is `CodingBoardTask`, read with `?.` and `== null`.** FIX-2766's owner direction
  (A), and its note that Teammates' task child uses the same row shape with no translation layer.
  The screen's `running`, `done`, `failed`, `cancelled` fold is a function in `src/lib/`, not a
  type. `BoardTask` and `TaskWaiting` are deleted, not moved to the screen-type list. A component
  check that compares a field with `=== undefined` becomes `== null`; each is tested where it
  matters (FIX-2766's warning).
- **`taskView` is called at the call site** until FIX-2766 moves it into the view, as
  claude-code-style does today. This issue does not wait on FIX-2766.
- **No new file in `src/app/`.** The inventory fails one (FIX-2769's read-model rule). `runs.ts`
  goes; its hooks join `tasks.ts`, which shrinks. `useTasks` and `useTaskWork` copy
  claude-code-style's (ER-7).
- **Answers go to the hold the board holds now.** The Inbox client's `answerOne`, on the hold read
  from the row's `asks` at answer time (FIX-2628). `openHolds` and `holdsOfTasks` go.
- **Board actions stay the Inbox client's `board(at)`** on the conversation that filed the task.
  A re-run is `refile` with the row's brief and the existing `rerunOverrides` line, now a `src/lib/`
  function. `TaskActions` becomes orchestration's `BoardActions`; `TaskAnswer` becomes `InboxAnswer`.
- **A task's run:** steps from `useSessionFeed` on the run session through `runSteps`; the review
  from the latest review stop through harness-manager's `reviewDetail`; the call in flight from
  `useRequestStream` (`reconnect: true`, `tool_output` only) and the feed; the plan from the
  recorded work view, live. This replaces the hand-built request-stream store and the topic read.
- **A PR's link** stays `readSessionPullRequests`, the package direct read the popup uses today.
- **The answer's cut has one convergence point:** the view takes it from the same helper
  `getTask`'s read uses, so the two never cut differently.
- **`error` on a cancelled task.** Claude-code-style's checks that read `error` as a failure must
  check `status` too; the implementer runs its suite and its `acts-on-an-opened-task` goal.
- **Tests.** The four task tests that use the fake (`popup-holds`, `task-actions`, `task-spend`,
  `task-summary`) move to a stub server or the lab's own host, as claude-code-style's
  `stub-server.ts` and `app-host.ts` do. Every task or run scenario of the fake goes into the
  implementation PR's ledger: a test that now covers it, or "dropped, because …".
- **Goals re-pointed, not dropped.** `goals/task-board/a-settled-task-reaches-the-board`'s Teammates
  leg reads the lab's new path, and its controls patch that path. The same for
  `stops-and-re-runs-a-task-from-its-popup`'s `wrong-board` and `other-session` patches.

## Considered and dropped

- **Keep `BoardTask` as a screen type, with a reason.** The allowlist empties and the translation
  layer stays: what FIX-2766 rules out, and what FIX-2769 D1 exists to catch.
- **Read the answer from the conversation's items with `useSessionFeed`.** It is today's
  stitching on a package hook: a long conversation may not have the copy loaded, and a copy from
  before a retry speaks for the wrong attempt.
- **A second, Teammates-only board view.** The epic's seam forbids it.
- **The recorded work view for a PR's link.** It reads one request; the popup reads the whole run
  session today, and nothing here needs that to change.

## Open

None. The boundaries with siblings (B1 to B5) were decided by the coordinator and are in
[SPEC.md](SPEC.md#boundaries-with-siblings).

## Settled

- **The 12 entries.** `node specs/issues/FIX-2773/poc/entries/check.mjs` re-derives them from the
  real allowlist and fails on an entry no owner row classifies. On `origin/main` `e90786196b`: 57
  entries; 12 this issue's (6 in `tasks.ts`, 6 in `runs.ts`); the fake's `gone` entry the last
  Teammates child's (B1), with the four shared types (B2); t1 15 (`workers.ts` by B5), t2 25
  (`steps.ts` by B3). With `--control` (a planted unclassified entry) it FAILs, as it must.
- **Not checked before the gate:** whether the coding board view meets the settled-task goal's
  signals for Teammates (a settled task within 1 s; 0 board reads over 10 s while a reply streams).
  Claude-code-style reads the view today, and no goal measures it there. It is the implementation's
  first check; if it fails, the fix goes in the view's topics (ER-1), never in the app.

## Analysis

### Analysis — FIX-2773 issue spec · 2026-11-17 · watermark 2026-11-17

Run inline by the author, who had no sub-agent tool; the epic's analysis covered the set.
**Verdict:** right approach. The epic set the views; this spec finds one gap in them (D1) and the
seams with siblings.

1. **Reuse.** The coding board and recorded work views, `useSessionFeed`, `useRequestStream`, the
   Inbox client: **reuse**. The row's missing fields: **extend** the view.
2. **Prior art.** Claude-code-style's `useTasks` and `useTaskWork`, the same pattern on the same
   views.
3. **Other shapes.** A one-task read (D1); a screen type kept; a second view (*Considered and
   dropped*).
4. **New factors.** FIX-2769 merged today, with the read-model rule that forbids a new file in
   `src/app/`. FIX-2766 and FIX-2782 filed today.
5. **Necessity.** Yes: the epic can't close with these entries.
6. **Ergonomics.** A starter copies two hooks and reads the view's row.
7. **Concerns.** The fake spans three children (B1, decided); the view's read rate is unchecked for
   Teammates (*Settled*).

| Finding | Objective | Changes the approach? | Disposition |
|---|---|---|---|
| The coding board row lacks the answer, the brief and a cancel's reason | 1 | Yes | Folded: D1 |
| The fake implements every job's calls, so it can't go in one child unless that child lands last | 7 | No | B1, decided by the coordinator: each child cuts its own scenarios; the last to merge deletes the file |
| `src/app/` may not gain a file | 7 | No | Decided: hooks join `tasks.ts` |

## Related: FIX-2782

[FIX-2782](https://linear.app/fixpoint-labs/issue/FIX-2782) asks Shift Manager's review card for
the ask, the run's summary, this round's commits, the files and the PR. **Easier, a little.** After
this issue, Teammates reads a review only through harness-manager's `reviewDetail`, and a task's
answer from the board's row. When FIX-2782 widens the review stop's data, Teammates' copy of the
card can show it by drawing it, with no read change. Nothing here makes it harder: this issue
doesn't touch the review stop's data or either app's review card.

## How it got here

- **Draft** — the task screens read the views claude-code-style reads; the 13 entries in
  `tasks.ts`, `runs.ts` and the fake go; the coding board row gains the answer and the brief (D1);
  five boundaries with the sibling jobs named for the cross-spec review.
- **B1 decided (coordinator, 2026-11-17)** — Gitar on #5363: the goal counted the fake's `gone`
  entry, which this issue can't remove unless it merges last. Each Teammates child cuts its own
  scenarios; the last of FIX-2771, FIX-2772 and FIX-2773 to merge deletes the file and the entry.
  This issue's goal is now the 12 `src/app/` entries and the fake's task and run scenarios.
- **B2 to B5 decided (coordinator, 2026-11-17)** — the last Teammates child removes the shared
  plumbing types, after each child removes its own fields; FIX-2772 owns `steps.ts` and moves it to
  `src/lib/`; the first child to merge adds the client to `main.tsx` and `AppProvider`; FIX-2771
  owns `workers.ts`. This issue's count stays 12.
