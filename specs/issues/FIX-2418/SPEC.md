# FIX-2418 · Not-yet-built placeholders and ticket ids hidden by default

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens Tasks** | NOW and COST columns that always read `—`, and an IN REVIEW group that is always empty, with "arrives with FIX-1651" beside it | Six columns that all carry data. No IN REVIEW group unless a row is in it |
| **opens a task** | Three disabled buttons (Hand off, Reassign, Open PR) under a line naming FIX-1651; Diff and Checks tabs with nothing in them; a disabled *Also post to the workstream* box; Brief rows and inspector sections that only say what arrives later | Interrupt, Session and Brief, and only the fields that hold something. A link to `/diff` or `/checks` opens Session |
| **reads Roster or Inbox** | Lines that end with "arrives with FIX-1672" or "is FIX-1652's call" | The same lines without the ticket sentence |
| **builds or tests Shift Manager** | Sees every gap | Turns on **Show what's coming** in Settings and sees every gap as today. A line that stays on screen keeps its ticket sentence in `data-gap`; a hidden control, column or tab isn't mounted at all, so tests assert it's absent with the switch off and check its owner with the switch on |

## The goal, and how we'll know it's met

**By default, Shift Manager draws only what works: no control, column, tab or line for
something not built, and no internal ticket id anywhere on screen.**

- **Smaller, and rejected:** strip only the ticket ids and keep the empty columns and
  disabled buttons. The issue's main cost is the space and attention they take every day.
- **Bigger, and not this issue's:** filling COST. FIX-2398's package slice reads it, and the
  epic's build order hands that to it ([FIX-2369 seams](../../epics/FIX-2369/DECISIONS.md#coordination-seams)).
  When it lands, its entry leaves `gaps.ts` and the column is drawn for everyone. The
  workstream board's five columns stay as they are: no ticket id is drawn there.
- **Not done if:** a fresh browser shows any `FIX-` id or any of the placeholders above, or
  turning the switch on stops drawing them exactly as before.

**How we verify.**

- **Unit (shift-manager vitest):** new default-off tests on the task screen (`task-screen.test.tsx`),
  Tasks and Roster (`roster-screen.test.tsx`): the placeholders are absent, the frame's tabs are
  `session, brief`, `/diff` opens Session, and the screen's text matches no `FIX-\d+`. The
  existing gap tests run with the switch on and keep asserting every line names its owner.
  The registry's owner audit reads each `{ text, coming }` entry's `coming` half, since `text`
  names no owner by design. `coming.test.ts` covers the switch: off by default, kept in storage, held for the page when
  storage refuses. **Red state:** with the switch forced on, exactly the four default-off tests
  fail (prototyped).
- **Goal (`goals/shift-manager/it-shows-and-stops-a-task-run`), real path, no model:** its
  `gaps` leg first checks the default screen draws none of the placeholders and no ticket id,
  then turns the switch on, reloads, and runs the existing owner checks. **Control that must
  fail:** `GOAL_CONTROL=always-coming` swaps `src/lib/coming.ts` for one that is always on; it
  fails at `gaps` on every row (prototyped: "task-disabled-action is drawn…", "the screen
  shows ticket ids…: FIX-1651, FIX-1652"). The goal's two other failures (`inspector: plan`
  on one row, `reach` on the finished row) fail the same way on `main` and aren't this issue's.
- **Goal (`goals/shift-manager/it-draws-v2s-look`):** grades v2's full design, placeholders
  included, so it runs with the switch on.

## What changes

- **`src/lib/coming.ts` (new):** the switch. `useShowComing()` reads it, `setShowComing()` flips
  it for every screen at once. Kept in this browser's storage, as the theme pick is ([D1](DECISIONS.md#d1)).
- **Settings:** a **Show what's coming** checkbox above the MCP keys.
- **`gaps.ts`:** every entry stays where it is. The three "records no plan / files / pull
  requests" lines, Roster's worker-match line and Inbox's scope line become `{ text, coming }`:
  `text` is true today and always drawn; `coming` (the ticket sentence) is drawn only with the
  switch on and always sits in `data-gap` ([D2](DECISIONS.md#d2)).
- **Surfaces that draw a gap only with the switch on:** Tasks (NOW, COST, the empty IN REVIEW
  group and its line), the task frame (Hand off, Reassign, Open PR and their line; Diff and
  Checks; *Also post*; Brief's context and acceptance rows), the inspector (harness, tokens and
  cost; acceptance and review), Roster (the harness `—`).
- **Docs:** the package README's Settings line and its two "not there yet" sections.

## What stays as it is

Turn reasons (why a message can't be sent), partial marks, the Shift Coordinator's named
states, and empty states that describe real data ("No tasks in flight"): these are states,
not gaps. The gap registry stays the one place a gap is written. No package outside
`shift-manager` changes; the labs and Kitchen Sink draw no gaps.

## What's already here, and the debt

| Piece | What this does with it |
|---|---|
| `gaps.ts`, the gap registry (FIX-1664) | **Kept** as the single registry; two entry shapes now, string and `{ text, coming }` |
| The theme's and panels' per-browser storage (`lib/theme.ts`, `lib/panels.ts`) | **Same pattern**: storage that throws keeps the pick for the page |
| The task-screen goal's `controls/` swap | **Extended**: a control may now swap `coming.ts` as well as `run.ts` |
| FIX-2398 (COST), FIX-2382/2384/2387 (task-frame tabs) | **Compatible:** each removes its entry from `gaps.ts` and draws its real piece without the switch |

**Adds:** one small module, one checkbox, one goal control. **Removes:** nothing. **Debt:** a
gap a later issue adds must be drawn behind `useShowComing()`; the registry's header says so.
**Net:** small.

## Sign off

**Approve by merging.** The one call is **where the switch lives** ([D1](DECISIONS.md#d1)): a
per-browser setting, rather than `--dev`. *If wrong:* a served flag can set the same switch
later, and nothing else moves.

Improvement · `shift-manager` · small · 1 PR · wave 0 of FIX-2369 · merges after FIX-2413,
before FIX-2414
