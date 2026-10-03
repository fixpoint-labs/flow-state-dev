# shift-manager › it draws v2's look

**Issue:** FIX-1737 (epic FIX-1649)

**Outcome:** Every screen of Shift Manager is drawn in design v2's look, in the day and night shifts, at a wide and a narrow window. That covers both typefaces loaded, mono on meta text, the title scale, v2's surfaces, square corners, the state squares, the tabs' underline, the highlighter only where something waits on a person, and the frame's widths. Each drawable value equals the Lab's store. The moment a screen drifts from v2, the check names the element, the screen state and the v2 line it broke.

**Input:** Shift Manager as checked out, copied to scratch and built with Vite. Two keyless Labs serve it, each through Shift Manager's own start script:
- **DevTeam** (`labs/shift-manager/teams/devteam`). Before the sweep, the check posts one filing line (`fixtures/input.json`) and drains it through the EM seat, so one row is running and one ask is pending, as the audit rendered it.
- **This check's desk Lab** (`lab/`). One `chief-of-staff` seat whose model is `@flow-state-dev/testing`'s mock resolver with one scripted reply. One line is sent through its door before the sweep.

The look table is read against v2 itself (`specs/epics/FIX-1649/assets/design/v2/shift-manager-v2.dc.html`).

**Signal:** Chromium walks every screen by clicking: workstream (its Stream, then its Board), task, Tasks, Chief of Staff, Inbox, Roster and project (the project holding the workstream, on its Board) on DevTeam, and Chief of Staff on the desk. It toggles the sidebar's shift switch and the window width (1600 and 1100) in place. It reads the computed style of every visible element in one `page.evaluate` per screen state. Each failure is tagged `<leg> [<screen> <shift> <width>]` and cites the v2 line.

- **type**: for every family and weight the page's text is set in, `document.fonts` holds a loaded face. Each row's family, size, weight and tracking match.
- **surface**: each row's surface token and border. Radius 0 on every element, except the registry parts the theme's radius can't reach.
- **marks**: the highlighter sits on every needs-you element and nothing else. Also graded: v2's state squares (fill and edge), and the selected tab's 2px info underline, with none on the others.
- **layout**: the sidebar is 248px and the rail 340px. The rail drops below 1180px, and the frame holds a 900px minimum.
- **content**: the stream composer's @-mentions are the store's running members. The Board tab's count is the store's rows. The Stream's feed names one author per stored line and pending member ask, and marks each such ask NEEDS YOU. The Board's columns stand in v2's order.
- **totality**: every painting element inside a graded region (the sidebar, the tabs, the composers, the screen titles) is covered by a look-table row or a named exception. Every row matches at least its expected number of elements, so a missing element fails as surely as an extra one.

Which regions are graded whole grows with each slice's screens: the workstream's header, feed and Board, the task's activity line, an ask in its session and the inspector's needs banner, and the project's team strip and Board lanes joined with slice C (`look-c.mts`). The fonts, the radius and the highlighter are graded on every element of every screen now.

**Anti-game:**
- Computed values are graded, never class names. A border is compared at the whole pixel Chromium computes, so v2's 1.5px box reads as 1px.
- Each row cites a v2 line, and setup fails if that line no longer holds the row's declaration. v2 sets no radius anywhere; setup fails if it ever does.
- No row exists that v2 doesn't draw. Elements v2 doesn't draw are listed as exceptions, each with a reason.
- **content** is read with this check's own requests to the Lab's routes, never from Shift Manager's state.
- No registry copy is edited, and no behaviour check is weakened.

**Model:** n/a (the desk's chief of staff is a scripted mock; DevTeam's runs are scripted).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-draws-v2s-look/run.mts` (`GOAL_SHOTS=<dir>` saves one screenshot per screen state).

**Controls** (scratch patches to the copy, never the checkout):
- `GOAL_CONTROL=drift`: the sidebar's team row is rounded, and its nav counts are set in the sans. Must FAIL at **surface** on that row and **type** on those counts, in both shifts, at both widths, and nowhere else.
- `GOAL_CONTROL=unclassified`: one visible line in the sidebar that no row covers. Must FAIL at **totality**, naming it, and nowhere else.
- `GOAL_CONTROL=missing`: the team rows' on-shift counts are removed. Must FAIL at that row's expected count, and nowhere else.

The SPEC names Tasks' ID column for `drift` and `missing`. That column arrives with slice D. Until then, both controls patch sidebar parts graded in this slice. They move to the ID column when D draws it.

**Before-state:** `GOAL_PAGES=<dir>` serves pages built elsewhere instead of building (not with a control).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-02 | c031c4316 (main) pages, this check | n/a | FAIL (before, expected) | Every leg fails. **surface**: no `--sidebar` or `--inspector`, and the project's `rounded-full` chips. **type**: nav counts, on-shift counts and the footer in Space Grotesk at 12px. **marks**: the selected tab is underlined in ink, not info. **layout**: the sidebar is 256px, the rail 288px and still drawn at 1100, with no frame minimum. **content**: no composer mentions, no Board count. **totality**: no screen title, no v2 composer, no state squares. Main also fails all ten slice-A audit rows (F2, F3, F4, F5, F7, F8, F9, W4, C9, W12). |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR) | n/a | PASS | 38 look-table rows and 7 exceptions. DevTeam: 3 seats, 1 running, 1 ask pending, 50 to 96 painting elements per screen state. Desk: chief of staff present, 54 to 62 elements. |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR), `GOAL_CONTROL=drift` | n/a | FAIL (expected) | Only **surface** (`button[team]` 4px radius) and **type** (nav counts in Space Grotesk), both shifts, both widths, both Labs. |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR), `GOAL_CONTROL=unclassified` | n/a | FAIL (expected) | Only **totality**: `p "A line no row covers"` on every screen state. |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR), `GOAL_CONTROL=missing` | n/a | FAIL (expected) | Only **totality**: the team on-shift count matches 0, 1 expected, on every screen state. |
| 2026-10-02 | feat/FIX-1737-a-foundation pages, this check with slice C's rows | n/a | FAIL (before, expected) | Only C's rows, and only **surface** and **totality**. **surface**: QUEUED and DONE columns drawn on `bg-muted/50`, both shifts. **totality**: the workstream `#` and WORKSTREAM tag, the day divider, feed names, NEEDS YOU tag and ask-in-inbox link, the five columns in v2's order, the column heads, the activity line and the team strip's name and counts all match nothing. A's own rows still pass. |
| 2026-10-02 | feat/FIX-1737-c-workstream-board (pre-PR) | n/a | PASS | 62 look-table rows and 14 exceptions. Screens: workstream, board, task, tasks, cos, inbox, roster, project; both shifts, 1600 and 1100. DevTeam: 3 seats, 1 running, 1 ask in the Stream's feed, 51 to 108 painting elements per screen state. Desk: chief of staff present, 54 to 62. |
| 2026-10-02 | feat/FIX-1737-c-workstream-board (pre-PR), `GOAL_CONTROL=drift` | n/a | FAIL (expected) | Only **surface** (`button[team]` radius) and **type** (nav counts in Space Grotesk), as on A. No C row moved. |
| 2026-10-02 | feat/FIX-1737-c-workstream-board (pre-PR), `GOAL_CONTROL=unclassified` | n/a | FAIL (expected) | Only **totality**: `p "A line no row covers"`, on every screen state including board. |
| 2026-10-02 | feat/FIX-1737-c-workstream-board (pre-PR), `GOAL_CONTROL=missing` | n/a | FAIL (expected) | Only **totality**: the team on-shift count matches 0, 1 expected, on every screen state. |
| 2026-10-03 | feat/FIX-1737-c-workstream-board, merge of 839a5f550 (pre-push) | n/a | PASS | The project screen is now the project holding the workstream, on its Board: C's Board rows also grade its lanes, under the team strip. 62 rows, 14 exceptions. DevTeam: 2 teams, 4 seats, 1 running; project 93 painting elements per state. Controls drift, unclassified and missing each FAIL only at their named legs, as before. |
