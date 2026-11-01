# workforce-apps › they can be driven from the keyboard

**Issue:** FIX-2401

**Outcome:** In the Claude Code-style and Teammates labs a person switches, starts and gets back to typing without the mouse. In Shift Manager, Jump to reaches every place the sidebar does, finds a worker or a task by its id or board, and behaves as a dialog: Tab stays inside, and Esc puts focus back where it was.

**Input:** each app on a fresh, empty data folder from its own config. Claude Code-style: one project made through its picker's form by keys, then two sessions the run opens and titles. Teammates: its shipped roster, plus one teammate the run hires. Shift Manager: the DevTeam profile, plus a private project, a workstream in it and one task on that workstream's board, created through the Lab's HTTP routes as its owner. The coder is found by its **id**, read from the DevTeam tree at run time, never by its shown name; the task by its **board ref**, never its title. **Held out:** no app source names the project, workstream, session titles or the hired teammate.

**Signal:** Playwright drives all three apps by key presses only (`ControlOrMeta` for ⌘/Ctrl) and reads the page after each step: what has focus (`document.activeElement` and its `data-composer`, `data-session-id`, `data-worker-id`), the route, `aria-current`/`aria-selected`, `aria-activedescendant`, and whether a dialog is open. Every step starts with focus on a non-text element (a list entry or a sidebar entry), so a palette's focus restore can't land it in a composer. The run never calls `click()`, and a browser dialog box opening fails the step it opened in.

- **a, Claude Code-style:**
  - *a1*: ⌘K, *New session*, Enter puts focus on the project; Enter opens a session with its composer active. Twice; each session's first line titles it.
  - *a2*: ⌘K, part of the first title, Enter: that session is selected (`aria-current`) and the composer carrying its session id is active.
  - *a3*: Alt+↑ and Alt+↓ select the neighbouring session.
  - *a4*: `/` from the list: the composer is active.
  - *a5*: `?` opens the key list, which names ⌘K, Ctrl+K, Alt+↑, Alt+↓, `/`, `?`, ← and →; Esc closes it and focus is back on the list's *New session*.
  - *a6*: the view switch has one element with `tabindex="0"`; Tab reaches it and the next Tab leaves it; → selects and focuses Projects.
  - *a7*: `x/?[` typed into the composer stays as text, and no key list opens.
- **b, Teammates:**
  - *b1*: ⌘K, a teammate's name, Enter: its conversation is open and its composer (carrying its session id) is active. A role can name another teammate ("asks researcher…"), so the run arrows down to the asked-for one, as a person would.
  - *b2*: Alt+↓ opens the next teammate.
  - *b3*: ⌘K *Hire*, Enter puts focus in the hire form; name, role and instructions typed and Hire pressed by keys: the teammate joins the roster, opened.
  - *b4*: the header's Fire (reached by Shift+Tab from the composer) shows the inline row with Keep focused; Keep keeps the teammate and puts focus back on the header's Fire; Fire again, Shift+Tab to the row's Fire, Enter removes it. No browser box.
- **c, Shift Manager:**
  - *c1*: ⌘K's input has `role="combobox"`, and ↓ changes its `aria-activedescendant`.
  - *c2*: each of the eight sidebar screens by name opens its path.
  - *c3*: the project's name opens `/p/private/<id>/stream`.
  - *c4*: the workstream's name opens the project's Workstreams on that workstream.
  - *c5*: the coder's id opens `/roster?team=<its team>` with its `[data-worker-id]` row focused and in view.
  - *c6*: the task's board ref opens `/tasks/<board>/<task>/…`.
  - *c7*: with the palette open, eight Tabs and eight Shift+Tabs never move focus outside it. The palette's only Tab stop is its input (results are reached by the arrows), so focus staying on the input is the trap working; the spec's "visit at least two elements" can't hold for it, and `plain-dialog` shows the check fails when the trap is gone.
  - *c8*: focus a sidebar entry, ⌘K, Esc: focus is on that entry again.

**Anti-game:** every assertion reads the live page after a real key press, not the app's state or its tests. Each app is built from a copy of the checkout's source (never the committed `dist-client`), so the run grades what is in the tree. The oracles come from outside the code under test: the route table's pinned paths, the store's ids (the filing's task id, the workstream session's board), the tree's worker ids. A step that never ran is red, not green.

**Model:** none. The Claude Code-style lab runs on a model no gateway serves (`goal/no-model`): a session's first line still titles it, and no turn reaches a model. Shift Manager's DevTeam runs on its stub harness.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/workforce-apps/keyboard-first/run.mts`. It builds all three apps' pages itself, into the run's scratch folder. About three minutes.

**Controls:** `GOAL_CONTROL=<name>` on the same command. Each patches the app's source in its scratch copy before the build (printed as `patched:`), and must fail exactly its own steps with every other step green; anything else is reported as `WRONG:`.

- `no-composer-focus`: a pick no longer focuses the composer, in both labs. Must fail *a1*, *a2*, *b1*.
- `no-type-guard`: the Claude Code-style lab's typing guard answers false. Must fail *a7*.
- `no-roving`: every view button gets `tabindex="0"`. Must fail *a6*.
- `label-only`: Jump to matches the shown label alone. Must fail *c5* and *c6*.
- `plain-dialog`: Jump to is a plain `div` again (its input takes focus itself, Esc closes it; no trap, no restore). Must fail *c7* and *c8*.
- `browser-confirm`: Fire asks with `window.confirm`. Must fail *b4*.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-01 | 5052658 | none | PASS | a1–a7, b1–b4, c1–c8 all PASS: two sessions opened and titled by keys; researcher opened by ⌘K; a hired teammate fired through the inline row; `eng.coder` (from the tree) opened `/roster?team=eng` with its row focused; the workstream board's ref opened its task; 16 Tab presses never left Jump to |
| 2026-11-01 | 5052658 | none | FAIL (expected) | `no-composer-focus`: a1, a2, b1 red ("focus is on <body>"), every other step green |
| 2026-11-01 | 5052658 | none | FAIL (expected) | `no-type-guard`: a7 red ("typing `?` in the composer opened the key list"), every other step green |
| 2026-11-01 | 5052658 | none | FAIL (expected) | `no-roving`: a6 red ("2 elements with tabindex=\"0\""), every other step green |
| 2026-11-01 | 5052658 | none | FAIL (expected) | `label-only`: c5 and c6 red ("Enter on `eng.coder` / the board ref left the palette open"), every other step green |
| 2026-11-01 | 5052658 | none | FAIL (expected) | `plain-dialog`: c7 red ("Tab left the palette for <body>"), c8 red ("after Esc focus is not back on the sidebar's Shift Coordinator"), every other step green |
| 2026-11-01 | 5052658 | none | FAIL (expected) | `browser-confirm`: b4 red ("a browser confirm box opened"), every other step green |
| 2026-11-01 | merge of main at f7c1637 | none | PASS | a1–a7, b1–b4, c1–c8 all PASS, twice in a row, after routes became real links: each Jump to result is a link Enter clicks; c8 now finds the sidebar entry by its test id, since that entry is a link, not a button. An earlier run had c4 red ("Enter on Lantern Sweep left the palette open"): the result's link was looked up by its entry object, which a data refresh replaces; each result now reads its own link |
| 2026-11-01 | merge of main at f7c1637 | none | FAIL (expected) | `label-only`: c5 and c6 red, every other step green. `plain-dialog`: c7 and c8 red, every other step green |
| 2026-11-01 | before 5052658 | none | FAIL | the first green run: a1 red, "picking the project opened no session with its composer active". A new session reaches the list on its next 3 s read, after `focusWhenDrawn`'s 60 frames; fixed in 5052658 |
