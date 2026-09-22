# devtool-workforce-visibility › it shows the checklist rows

**Issue:** FIX-1481, the VG check in its `PLAN.md → Checks`. It covers ER-Devtool checklist **rows 4 and 6** (epic FIX-1457). Rows 1–3 belong to FIX-1320 and row 5 to FIX-1502, and this check neither builds nor grades them.

**Outcome:** A person running a hired Workforce under `fsdev dev` opens the shipped DevTool and can answer two questions without opening an expander:

- **Row 4:** why is this row parked?
- **Row 6:** which of this seat's documents can be written, and which are sealed?

**Input:** `fixtures/input.json` holds the piece of work and the question the seat will park on. It is held out. The hire is `goals/multi-seat-collab/lab/`, and its desks and seat ids are read off its tree at run time. The fixture's desk is checked against the desks that tree declares before anything runs. The reason is then graded against the reason the ledger holds for the row, not against the fixture's sentence, so swapping the sentence still passes a correct view.

**Which hire each row is read on:** VG may read the two rows on two different live hires, each through the shipped `fsdev dev` and DevTool. That is the epic coordinator's ruling of 2026-09-22.

- **Row 4** is read on `multi-seat-collab` (FIX-1497). Its builder seat parks on a question by design, and nothing here makes it park. The hire is served by that lab's own `fsdev.config.mts` and driven by that lab's own driver. This check adds only the reading.
- **Row 6 is not graded, and the run says so as a failure line.** No live hire in the repository declares a sealed document: there is no `references/` file and no `ro` grant. `devforce-lab`'s handbook looked like the natural subject, but moving it under `references/` changes what that lab's graded legs read. ER-3 forbids a document that exists only so this inspection has something to show. Giving `multi-seat-collab`'s seats a document was also tried. The hire installs a document only when the seat's **kind** declares it, and that lab's kind declares none. So every working route needs kind code whose only purpose is giving row 6 a subject, which is the line ER-Devtool draws. **Whether to cross it is the owner's decision, and it is pending.** Until that decision is made, row 6 is *not graded*. That is not a failure of the row-6 code, which is proved by FIX-1481's own checks (V2, V3, V5).

**Signal:** One run of the shipped `fsdev dev` over the hire's config, then Chromium on the shipped DevTool bundle, rebuilt at the start of the run.

- **Row 4.** First the positive record: the ledger holds the row `parked`, with a non-empty reason, parked by the seat whose own file answers for the fixture's desk, in a known run. Then, on screen, that run is opened from the navigator (kind, then seat, then the seat's session, then the run it spawned), and its Tasks tab is read with **no expander open**. That no expander is open is counted in the same read, not assumed. Passes when:
  - the row's Status cell reads a `TaskStatus` value, namely `parked`;
  - a Reason cell exists and reads exactly the ledger's reason;
  - at least 40px of that cell can actually be seen, after every clipping ancestor and the window are applied;
  - when the text is clamped, the cell's title carries the whole reason.

  Graded at a 1600×1000 window, the same one `multi-seat-collab`'s own check uses for this screen. Widths of 1440px and 1280px are measured and noted, not graded (see Findings).
- **Row 6.** Not graded (above).

**Anti-game:** The hollow passes:

- Reading the reason off the store.
- Reading it with the expander open.
- Finding the reason's text *somewhere* on the page.
- Passing on a row that never carried a reason.

So the check reads the cell under the `Reason` heading, in the active Tasks panel, on the row with this id. It counts open expanders in the same read. It grades the reason against the ledger's value only after asserting that value exists. When the column is missing, it opens the expander and says whether the reason is there, so "only in the expander" is named apart from "nowhere". A reason that is in the DOM but scrolled or clipped entirely out of sight fails the 40px bound.

**Model:** n/a. The seat bodies are deterministic.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/devtool-workforce-visibility/the-checklist-rows/run.mts`. The run builds the DevTool bundle first. On a clean checkout, run `pnpm --filter @flow-state-dev/devtool build` once before it. The run needs `goals/multi-seat-collab/`, which lands with FIX-1497's PR.

**Controls:** Each one runs as `GOAL_CONTROL=<name>` on the same command. The lab's config reads the same variable. Each control must fail at exactly the legs named, and the run checks that itself. The row-6 line is the same under every control and is left out of that self-check.

- `silent-park`: the lab's worker parks with no reason. It must fail **row 4** only, at the positive record: the hire parked the row with no reason, so there is none for the screen to show.

The view-side red has no named control, because producing it means changing the DevTool. It was produced by hand once and reverted (see the verdict log): `showReason` was forced to `false` in `task-collections-view.tsx`, which is the view before FIX-1481's PR-A. The run must fail at row 4 and say the reason is **only inside the row's expander**.

## Findings

- **The Reason column is legible at 1600px and a horizontal scroll away below that.** The Goal column is up to 28rem wide and sits first, so on this hire the Reason cell starts about 930px into the page. At 1600px, 180px of it shows and the whole reason is on its title. At 1440px, 20px shows. At 1280px, none does, and neither does the Status pill. The Tasks pane scrolls horizontally, so the rest is reachable without an expander, and the checklist's wording is met. A reader on a laptop-width window still has to scroll to learn why a row is parked. This is recorded as a finding, not as a red row, and filed as [FIX-1523](https://linear.app/fixpoint-labs/issue/FIX-1523), which proposes putting Reason ahead of Goal or narrowing Goal.

## Verdict log

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-22 | `432f08554` (on `fix/FIX-1497` at `51064a891`, which carries `main` at `d3700555b`) | n/a | **Row 4 PASS · row 6 not graded, pending an owner decision** (exit is FAIL on the row-6 line alone) | The first graded run after #2051 lifted ER-26's fence. **Row 4 (multi-seat-collab hire):** `eng.builder`, whose own file answers for `build`, parked the row on its own. Its run, opened from the navigator, showed `parked`, and the Reason column read *"may the backup take the Sunday maintenance slot instead, or does finance need that too?"*, which is exactly the ledger's reason, with no expander open. The text is clamped, and the whole reason is on the cell's title. At the graded 1600px window, 180px of the cell is visible. At 1440px 20px is visible, and at 1280px none is. The pane scrolls horizontally (see Findings). **Row 6: not graded.** No live hire declares a sealed document. `devforce-lab`'s handbook was tried under `org/references/` and restored, because the move reddens that lab's model-free gate (details in the PR). The subject is pending an owner decision; this is not a failure of the row-6 code. |
| 2026-09-22 | `432f08554` (control: `silent-park`) | n/a | FAIL (expected) | **Row 4 only**, at the positive record: *"the hire parked row … with no reason on it, so there is no reason for the screen to show"*. The screen was never judged. The self-check added no line, so no other leg reddened. |
| 2026-09-22 | `432f08554` + a hand mutation, reverted | n/a | FAIL (expected) | `showReason` forced to `false` in `packages/devtool/src/react/components/workspace/task-collections-view.tsx`, which is the view before PR-A (#2032). **Row 4:** *"the parked row has no Reason column (columns: Id, Goal, Status, Assignee, Dispatch run, Latest kind, Details); the reason is only inside the row's expander"*. The expander was opened only after that verdict, to tell "only in the expander" apart from "nowhere". Reverted with `git restore` on that one file, and the bundle was rebuilt. |
| 2026-09-22 | `cffa3830e` (merges `fix/FIX-1497` at `54b81d015`, after the kinds split) | n/a | **Row 4 PASS · row 6 not graded, pending an owner decision** (exit is FAIL on the row-6 line alone) | Re-run on the merged head. **Row 4** reads the same as before: `eng.builder` parked the row on its own, and its run, opened from the navigator, showed `parked` with the ledger's reason in the Reason column, no expander open. 180px of the cell is visible at 1600px, 20px at 1440px and 0px at 1280px ([FIX-1523](https://linear.app/fixpoint-labs/issue/FIX-1523)). **Row 6:** not graded, because a subject needs kind code whose only purpose is giving it one, and whether to add that is with the owner. This is not a failure of the row-6 code. |
| 2026-09-22 | `cffa3830e` (control: `silent-park`) | n/a | FAIL (expected) | **Row 4 only**, at the positive record: the hire parked the row with no reason on it. The self-check added no line. |
| 2026-09-22 | `cffa3830e` with the row-6 line removed by hand, reverted | n/a | PASS (plumbing proof) | Shows that the check can go green when every graded leg is clean. It exits 0 with row 4's evidence as the PASS line. An earlier build appended its notes to the failures list, so it could never pass (Bugbot on `1315a1837`). The same run with `GOAL_CONTROL=silent-park` still **FAILs at row 4**, so a real leg failure still turns the verdict red. The row-6 line was restored with `git restore` on that one file. |
