# FIX-2777 · Decisions

[Spec](SPEC.md) · **Decisions**

No decision here goes to sign-off. The epic decided the direction ([D2](../../epics/FIX-2683/DECISIONS.md#d2):
the snapshot goes; [ER-3](../../epics/FIX-2683/DECISIONS.md#who-owns-what): no legacy path;
[ER-8](../../epics/FIX-2683/DECISIONS.md#who-owns-what): this issue deletes last). What is left is how
the tests and goals keep their meaning, which is the implementer's discipline, written down so a
reviewer can hold the PR to it.

## The tree

```mermaid
flowchart TD
  I["FIX-2777 · the snapshot goes"] --> M["delete the three modules and the snapshot in lab-data.tsx"]
  I --> H["page health: the Inbox view and the feeds"]
  H -.->|"rejected"| H2["a health read of its own"]
  I --> T["tests and goals re-pointed at what screens read"]
  T -.->|"rejected"| T2["a test-only snapshot builder"]
  I --> C["each control re-aimed or retired, run red"]
  I --> L["the directory-live leg"]
  I -.->|"left out"| S["useWorkerStates · failure.ts and boards.ts"]
```

## Decided, not asked

- **What goes.** `src/lib/reads.ts`, `src/lib/derive.ts`, `src/lib/snapshot-subscribe.ts`, and in
  `lab-data.tsx` the reader, the snapshot, its live read, `refreshing`, `asking`, `refresh` and the
  lapse counter. `LabProvider` keeps the connection, the client, the feed reporter and the
  health ([SPEC → What changes](SPEC.md#what-changes)). The file header is rewritten for what is
  left. Nothing is kept beside the old shape (ER-3): no alias, no re-export, no fallback.
- **The page's health is the worst of the feeds on screen.** The snapshot read was one input;
  the Inbox view is already another, on every page, because the frame mounts `useInbox()` and it
  reports *lapsed* after a good read fails (`inbox.ts`). The view's retry is `client.live`'s, the
  same mechanism the snapshot's live read used. So a Lab that goes away still turns the bar
  *lapsed*. Before the first read, the page shows *Reading the Lab…* (`Landed`), so the
  snapshot's *connecting* state is not needed. `connection.test.tsx` keeps every case a person
  sees: the bar says *lapsed* when the Lab goes after a good read, the page keeps what it drew,
  and the bar clears when a read lands again. The cases become red first against a `health`
  that ignores the Inbox view.
- **A test checks the same fact through what a screen reads now.** Each *oracle* file reads the
  fact it checks through the view, collection, session list or workforce client call the screen
  for that fact makes ([SPEC → What changes](SPEC.md#what-changes) has the shape). Each *fixture*
  helper or mock feeds the screen through those reads too, as `test/helpers/directory.ts`'s
  `useFixtureReads` already does for the directory. The assertion's meaning stays: a re-point
  may change how a value is read, never what is expected of it. A test that called `read()`
  only to warm the Lab names the read it needs, or drops the line if the test passes without it.
- **A test whose subject is the snapshot goes, with a map.** `reads.test.ts` and
  `snapshot-subscribe.test.tsx` are deleted. The PR body lists each of their cases: the test that
  covers that behaviour now (the inbox view's, the directory's, workforce's), or why the behaviour
  is gone (it was the snapshot's own, such as which notices start a whole-Lab read). A case with
  no cover and a live behaviour gets a new test before the old one goes. No test is skipped, and
  no assertion is loosened.
- **Every goal control that aims at the snapshot is re-aimed or retired, and each kept one is
  run red.** Measured on `5a30c19092` ([Settled](#settled)):

  | Control | Today | Disposition |
  |---|---|---|
  | `it-briefs-and-talks-with-the-shift-coordinator` · `static-brief` (swaps `derive.ts`) | Cannot build: no module imports `derive.ts` | Re-aimed at the module that computes the brief's asks now, and run red on `reach` or its own leg |
  | `it-opens-a-lab` · `unanswerable-asks` (swaps `reads.ts`) | **Passes** under the control: the snapshot's asks are drawn by no screen | Re-aimed at the `answerable` flag the Ask card reads off the Inbox view's hold, where the defect would land now, and run red |
  | `it-shows-and-stops-a-task-run` · `wrong-board` (swaps `reads.ts`) | Plants into `taskActions`, which no screen calls | Re-aimed at the board actions the task screen calls (`useBoardActions`), and run red |
  | `it-shows-who-is-on-shift` · `status-from-snapshot` | Reads the snapshot this issue deletes | Retired, with a reason in its `goal.md`: the defect it plants (status from a second read of asks) needs a second read, and none is left. `one answer` keeps `ignore-asks` and `count-queued` |

  A retired control is a line in its goal's `goal.md`, never a silent removal.
- **A goal probe that waits on or counts the snapshot is re-pointed, and its leg is shown red.**
  `its-summary-changes-on-its-own` and `every-stop-is-one-inbox-item` draw the Inbox once the
  snapshot lands and pass it a `snapshot` prop the screen no longer takes: they wait on what the
  page waits on (the gate, then `Landed`). `realtime/app-views-read-on-notice` does the same for
  its Shift Manager screens. `live-read/one-loop-every-watcher`'s `sm` watcher counted snapshot
  reads: it counts Shift Manager's roster watch (`useRoster`) instead, which is what follows a
  hire now, and the goal's control is run against it.
- **The directory-live leg is three signals and three controls**
  ([SPEC → How we verify](SPEC.md#the-goal-and-how-well-know-its-met)). The probe draws the real
  Routines screen and Sidebar under the provider. The host gains the projects flow and one routine
  on a working schedule. The second client is the same user on Node's own `fetch`, so the
  provider's fetcher counts only the page's reads. *Within 2 s* is measured from the store
  reading the change, polled every 5 ms, as the goal's other legs are.
- **The inventory settles at nothing to allow.** `test/inventory-allowlist.json` is `[]`. The
  `gone` list gains `src/lib/derive.ts` and `src/lib/snapshot-subscribe.ts` beside `reads.ts`, so
  none can come back. `readModel`'s `reads.ts` entry is removed: ER-4's ratchet ends when the
  file goes.
- **Comments and codemods.** Comments that name a deleted module are reworded or dropped
  (BP-034): `test/inventory.test.ts`, `goals/lib/shift-manager.mts`, the contributor docs that
  describe the snapshot. The two codemods under `scripts/codemod/` that list `reads.ts` among
  their targets drop that entry; they have run, and a target that doesn't exist would fail them.
  `a-lab-is-worked-through-one-skinned-shell/parts.mts` reads `reads.ts`'s source to check it
  creates no session; that check goes with the file, and the same rule is checked over the files
  that read the Lab now.
- **Left out: the simplification follow-ups.** One memoized `useWorkerStates()` with a one-pass
  item map, and collapsing `failure.ts` (18 lines) and `boards.ts` (30). The deletion does not
  touch any of them: the five `workerStates` callers already read the Inbox view, and the two
  modules have 28 importers that the deletion does not change. Doing them here puts a
  behaviour-neutral refactor of five screens into a 50-file deletion. The comment on this issue
  says none blocks anything; they stay there for whoever next changes those screens.
- **One PR.** The deletion and the re-points cannot land apart: a test that still imports
  `reads.ts` fails to build once it goes. The directory-live leg lands in the same PR because the
  issue isn't done until it passes.
- **No changeset.** Shift Manager's behaviour is unchanged (BP-022).

## Considered and dropped

| Alternative | Why not |
|---|---|
| Keep a test-only snapshot builder, so the 25 test files change one import | It is the read model the epic deletes, kept in `test/` (ER-3). A screen test fed by it checks a shape no screen reads |
| A health read of its own for the connection bar | A second page-wide read to report what the Inbox view already reports |
| Delete the four snapshot-aimed controls with the modules | Three of them guard a defect that can still happen on the screens; only `status-from-snapshot`'s needs the snapshot |
| Split the goal leg into its own PR | The issue isn't done until it passes; a second PR is a second review for one change |

## Open / Settled

### Open

None.

### Settled

- **Which files reach the snapshot, and how.** `poc/snapshot-reach/check.mjs` on `5a30c19092`:
  52 files reach the three modules (3 of them control modules) — 3 *subject*, 25 *oracle*
  (19 test files, 6 goals), 6 *fixture*, 4 *control*, 4 *probe*, 1 *source*, 1 *inventory*,
  2 *provenance*, 2 *codemod*, and `lab-data.tsx`. PASS. `--control` plants an unclassified
  importer: FAIL, naming it. `--built`: FAIL, naming the three modules, as it must before the
  implementation. The first version missed four goal probes that read `{ snapshot } = useLab()`;
  totality was what found them.
- **`static-brief` cannot build on main.** Run on `5a30c19092`:
  `GOAL_CONTROL=static-brief pnpm tsx goals/shift-manager/it-briefs-and-talks-with-the-shift-coordinator/run.mts`
  throws *"control static-brief: the build never imported …/src/lib/derive.ts, so nothing was
  swapped there"*.
- **`unanswerable-asks` passes under its control.** Run on `5a30c19092`:
  `GOAL_CONTROL=unanswerable-asks pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts` prints
  `PASS` (*"devteam: inbox 1 listed / 1 asks + 0 questions pending … approved 1 of 1"*). The
  control marks the snapshot's asks unanswerable, and no screen draws them. It was meant to fail
  its leg.
- **`wrong-board` plants into code no screen calls.** Static, not run: `taskActions` has no
  caller in `src/` outside `reads.ts` (`grep -rn "taskActions" packages/shift-manager/src`).
  The implementation runs it after the re-aim.

## Analysis

Not run. This worker has no sub-agent to dispatch `analysis`, and the issue-spec skill asks for a
fresh one. The reuse question is small here: the spec adds one leg and two controls, on the
existing goal and its patch mechanism. Run it before the gate if the coordinator wants it.

## How it got here

- **Draft** — framed as "the epic says delete and edit nothing; the census says 47 more files
  and four controls depend on what goes". The approach: delete, re-point every test and goal at
  what screens read, re-aim or retire each snapshot control with a red run, keep the connection
  bar on the Inbox view, and add the directory-live leg moved here from FIX-2775. Builds on
  FIX-2775's census and the epic's D2, ER-2, ER-3, ER-8.
