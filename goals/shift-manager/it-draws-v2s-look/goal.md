# shift-manager › it draws v2's look

**Issue:** FIX-1737 (epic FIX-1649)

**Outcome:** Every screen of Shift Manager is drawn in design v2's look, in the day and night shifts, at a wide and a narrow window. That covers both typefaces loaded, mono on meta text, the title scale, v2's surfaces, square corners, the state squares, the tabs' underline, the highlighter only where something waits on a person, and the frame's widths. Each drawable value equals the Lab's store. The moment a screen drifts from v2, the check names the element, the screen state and the v2 line it broke.

**Input:** Shift Manager as checked out, copied to scratch and built with Vite. Two keyless Labs serve it, each through Shift Manager's own start script:
- **DevTeam** (`labs/shift-manager/teams/devteam`). Before the sweep, the check posts one filing line (`fixtures/input.json`) and drains it through the EM seat, so one row is running and one ask is pending, as the audit rendered it.
- **This check's desk Lab** (`lab/`). One `chief-of-staff` seat whose model is `@flow-state-dev/testing`'s mock resolver with one scripted reply. One line is sent through its door before the sweep.

The look table is read against v2 itself (`specs/epics/FIX-1649/assets/design/v2/shift-manager-v2.dc.html`).

**Signal:** Chromium walks every screen by clicking: workstream, task, Tasks, Chief of Staff, Inbox, Roster and project on DevTeam, and Chief of Staff, Inbox, Tasks and Roster on the desk, where Inbox is empty. It toggles the sidebar's shift switch and the window width (1600 and 1100) in place. It reads the computed style of every visible element in one `page.evaluate` per screen state. Each failure is tagged `<leg> [<screen> <shift> <width>]` and cites the v2 line.

- **type**: for every family and weight the page's text is set in, `document.fonts` holds a loaded face. Each row's family, size, weight and tracking match.
- **surface**: each row's surface token and border. Radius 0 on every element, except the registry parts the theme's radius can't reach.
- **marks**: the highlighter sits on every needs-you element and nothing else. Also graded: v2's state squares (fill and edge), and the selected tab's 2px info underline, with none on the others.
- **layout**: the sidebar is 248px and the rail 340px. The rail drops below 1180px, and the frame holds a 900px minimum.
- **content**: the stream composer's @-mentions are the store's running members. The Board tab's count is the store's rows. Inbox's sub-line, filter counts, selected title (the ask's message), *From the session* calls and reply lines, and its empty sentence equal the store's asks, rows, seats and session items. Tasks' summary, Queued count, column order, shown ids (the rows in flight) and TIME (within the sweep's clock) equal the store's rows. Roster's columns and group sub-lines are v2's, every WAITING entry matches a stored parked row (its id and title) or pending ask (its kind and message), and the waiting tasks are exactly the store's parked rows. The empty Inbox counts running sessions, so rows that share one run session count once.
- **totality**: every painting element inside a graded region (the sidebar, the tabs, the composers, the screen titles, Inbox's list and detail, Tasks' header and table, Roster's columns, groups and waits) is covered by a look-table row or a named exception. Every row matches at least its expected number of elements, so a missing element fails as surely as an extra one.

Which regions are graded whole grows with each slice's screens. The fonts, the radius and the highlighter are graded on every element of every screen now.

**Anti-game:**
- Computed values are graded, never class names. A border is compared at the whole pixel Chromium computes, so v2's 1.5px box reads as 1px.
- Each row cites a v2 line, and setup fails if that line no longer holds the row's declaration. v2 sets no radius anywhere; setup fails if it ever does.
- No row exists that v2 doesn't draw. Elements v2 doesn't draw are listed as exceptions, each with a reason.
- **content** is read with this check's own requests to the Lab's routes, never from Shift Manager's state.
- No registry copy is edited, and no behaviour check is weakened.

**Model:** n/a (the desk's chief of staff is a scripted mock; DevTeam's runs are scripted).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-draws-v2s-look/run.mts` (`GOAL_SHOTS=<dir>` saves one screenshot per screen state).

**Controls** (scratch patches to the copy, never the checkout):
- `GOAL_CONTROL=drift`: the sidebar's team row is rounded, and Tasks' ID cells are set in the sans. Must FAIL at **surface** on that row and **type** on those cells, in both shifts, at both widths, and nowhere else.
- `GOAL_CONTROL=unclassified`: one visible line in the sidebar that no row covers. Must FAIL at **totality**, naming it, and nowhere else.
- `GOAL_CONTROL=missing`: Tasks' ID column is removed. Must FAIL at that row's expected count, and nowhere else.

**Before-state:** `GOAL_PAGES=<dir>` serves pages built elsewhere instead of building (not with a control).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-02 | c031c4316 (main) pages, this check | n/a | FAIL (before, expected) | Every leg fails. **surface**: no `--sidebar` or `--inspector`, and the project's `rounded-full` chips. **type**: nav counts, on-shift counts and the footer in Space Grotesk at 12px. **marks**: the selected tab is underlined in ink, not info. **layout**: the sidebar is 256px, the rail 288px and still drawn at 1100, with no frame minimum. **content**: no composer mentions, no Board count. **totality**: no screen title, no v2 composer, no state squares. Main also fails all ten slice-A audit rows (F2, F3, F4, F5, F7, F8, F9, W4, C9, W12). |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR) | n/a | PASS | 38 look-table rows and 7 exceptions. DevTeam: 3 seats, 1 running, 1 ask pending, 50 to 96 painting elements per screen state. Desk: chief of staff present, 54 to 62 elements. |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR), `GOAL_CONTROL=drift` | n/a | FAIL (expected) | Only **surface** (`button[team]` 4px radius) and **type** (nav counts in Space Grotesk), both shifts, both widths, both Labs. |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR), `GOAL_CONTROL=unclassified` | n/a | FAIL (expected) | Only **totality**: `p "A line no row covers"` on every screen state. |
| 2026-10-02 | feat/FIX-1737-a-foundation (pre-PR), `GOAL_CONTROL=missing` | n/a | FAIL (expected) | Only **totality**: the team on-shift count matches 0, 1 expected, on every screen state. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR) | n/a | PASS | 84 look-table rows and 10 exceptions, Inbox, Tasks and Roster graded whole. DevTeam: 3 seats, 1 running, 1 ask pending; content equal to the store on Inbox (sub-line, filter counts, title, calls, replies), Tasks (summary, Queued count, columns, ids in flight, TIME) and Roster (columns, group subs, WAITING). Desk: Inbox empty, its sentence equal to the store. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=drift` | n/a | FAIL (expected) | Only **surface** (`button[team]` 4px radius, every screen state) and **type** (Tasks ID cells in Space Grotesk, v2:677), both shifts, both widths. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=unclassified` | n/a | FAIL (expected) | Only **totality**: `p "A line no row covers"` on every screen state. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (pre-PR), `GOAL_CONTROL=missing` | n/a | FAIL (expected) | Only **totality**: Tasks ID matches 0, 1 expected, on Tasks in both shifts at both widths. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (review round) | n/a | PASS | 85 rows and 10 exceptions. The ask's session is ordered by the store's item order before calls and replies are placed; each call row is graded by its own count; Roster's waits are compared to the stored parked rows and asks. |
| 2026-10-02 | feat/FIX-1737-d-inbox-tasks-roster (review round), planted (reverted) | n/a | FAIL (expected) | One fabricated call in the store, a fabricated ask-wait title and a fabricated task wait on Roster. Only **totality** (FROM THE SESSION call 0 of 1, and its text) and **content** (calls [] against the stored call; the ask wait's second line; "a task planted-task … the store holds no such parked row"; waiting tasks [planted-task] against []). |
