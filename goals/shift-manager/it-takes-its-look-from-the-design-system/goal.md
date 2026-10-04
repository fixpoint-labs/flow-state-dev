# shift-manager › it takes its look from the design system

**Issue:** FIX-1688, FIX-1689, FIX-1725 and FIX-1736 (epic FIX-1649)

**Outcome:** Shift Manager's light and dark look, its two typefaces included, comes from the design-system package's one import. The FSD parts it reuses in a task's Session (message, reasoning, tool and code block cards) are its unedited registry copies, and they take that look with the rest of the shell. Remove the one import and no Shift Manager value is left on any of them: the shell and the cards show the registry's neutral defaults. The Day shift / Night shift switch in the sidebar changes the look on the spot, either way, whatever the OS prefers, and the pick holds through a reload.

**Input:** Shift Manager as checked out, copied to a scratch directory and built twice: as written, and with the line `@import "@flow-state-dev/design-system/shift-manager.css";` removed from `src/styles.css`. Each build is served by Shift Manager's start script over the run-lab (`goals/shift-manager/it-shows-and-stops-a-task-run/lab/`), whose runs store a message, a reasoning item and a tool call with its result. Shift Manager's theme values and font families are read from `labs/design-system/shift-manager.css` at run time.

**Signal:** Chromium opens a running task from Tasks by clicking, opens its tool card and reasoning, and reads the computed colour, background, border, outline, svg stroke and fill, and font of every visible element on the shell and inside each swept card. Two passes per build: with the browser set to light, then to dark (Shift Manager follows that setting). Each failure is tagged `<leg> [<build> <variant>]`.

- **reach**: the Session draws each swept registry part (message, reasoning, tool, code block) at least once.
- **themed**: on the build as written, every painted colour is one of Shift Manager's values for that variant (to within 3 per channel), and every font is one of its families. For every family and weight the page's text is set in, `document.fonts` holds a face with status `loaded`.
- **neutral** (the closure's leg c): on the build without the import, no painted colour is any Shift Manager value from either variant, no font is one of its families, and `document.fonts` holds no face of one.
- **switch**: on the build as written, in a fresh browser with nothing picked, opened on Tasks with the OS set to light. Clicking *Night shift* makes the page's computed background Shift Manager's dark `--background`; after a reload it still is. With the OS set to dark, clicking *Day shift* makes it the light `--background`; after a reload it still is. Each time the switch marks the shift the page is on (`aria-pressed`).

**Anti-game:**
- The no-theme build removes exactly one line. If that line isn't there, the setup fails: a build that "removed" an import that was never loaded proves nothing.
- A font is graded by the face the browser loaded, not by the computed `font-family` string, which names the family whether or not it loaded.
- Colours are graded by computed value, never by class name. Colours set by an inline literal (syntax highlighting) are content, not skin, and are skipped.
- Each switch click is made against the opposite OS setting, so a page that ignored the click and followed the OS fails. The two backgrounds are read from `labs/design-system/shift-manager.css`, and the setup fails if they're the same colour.
- The copies being unedited is CI's job (`labs/shift-manager/test/static.test.ts`), checked against the install list in Shift Manager's `package.json`.

**Model:** n/a (the run-lab's scripted runs).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/shift-manager/it-takes-its-look-from-the-design-system/run.mts` (`GOAL_KEEP=1` keeps the screenshots).

**Controls:**
- `GOAL_CONTROL=hardcoded-accent`: Shift Manager's copy of the tool card paints its completed icon with Shift Manager's accent (`--attention`, light) as a literal class, in both builds. Must fail at **neutral** naming `tool`, light and dark, and nowhere else.
- `GOAL_CONTROL=switch-ignored`: the switch's buttons do nothing when clicked. Must fail at **switch**, on every step after the first click, and nowhere else.
- `GOAL_CONTROL=fonts-not-loaded`: the build as written imports a copy of the design-system stylesheet with only its font imports blanked, so the families are named and no face is declared. Must fail at **themed** on the fonts, light and dark, and nowhere else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | a25134ebd (main) + this check | n/a | FAIL (before, expected) | Shift Manager as on `main`. **neutral** can't run: `src/styles.css` has no design-system import to remove. **reach**: the Session drew no registry message, reasoning, tool or code block. **themed**: the shell paints the neutral defaults (`#ffffff`, `#e4e4e7`; dark `#09090b`, `#27272a`), 200+ samples per variant. |
| 2026-10-01 | fix-1688-app-lab-skin (pre-PR) | n/a | PASS | Light: shell 129, message 8, reasoning 16, tool 51, code block 32 elements, 360 colours; dark the same parts, 370 colours. No-theme light 365 colours, dark 375, none a Shift Manager value. |
| 2026-10-01 | fix-1688-app-lab-skin (pre-PR), `GOAL_CONTROL=hardcoded-accent` | n/a | FAIL (expected) | Only **neutral**, on `tool` (`svg.lucide-circle-check-big` stroke `#e8f551`), light and dark. reach and themed pass. |
| 2026-10-01 | fix-1688 follow-up (Shift Manager follows the OS setting; passes set the browser's colour scheme) | n/a | PASS | Light: shell 129, message 8, reasoning 16, tool 51, code block 32 elements, 360 colours; dark: message 12, 365 colours. No-theme light 360, dark 365, none a Shift Manager value. |
| 2026-10-01 | fix-1688 follow-up, `GOAL_CONTROL=hardcoded-accent` | n/a | FAIL (expected) | Only **neutral**, on `tool` (`svg.lucide-circle-check-big` stroke `#e8f551`), light and dark. |
| 2026-10-01 | 475b3cd4b (feat/FIX-1649-shift-manager) | n/a | PASS | After the rename to Shift Manager. DevTeam served from `labs/shift-manager/teams/devteam`; the pages carry the boot-shift code, unset in this run. |
| 2026-10-01 | fix/FIX-1697-design-v2 (pre-PR), v2 values with day `--card` #fcfbf7 as drawn | n/a | FAIL | Only **neutral**, light and dark: the registry's neutral `#fafafa` text sits within 3 per channel of the design's day card `#fcfbf7`, so leg c can't tell skin from default. |
| 2026-10-01 | fix/FIX-1697-design-v2 (pre-PR), day `--card` #fcfbf6 | n/a | PASS | Final v2 values. Light: shell 131, message 8, reasoning 16, tool 51, code block 32 elements, 363 colours; dark 368. No-theme light and dark 363 colours, none a Shift Manager value. |
| 2026-10-01 | fix/FIX-1697-design-v2 (pre-PR), `GOAL_CONTROL=hardcoded-accent` | n/a | FAIL (expected) | Only **neutral**, on `tool` (`svg.lucide-circle-check-big` stroke `#e8f551`), light and dark. |
| 2026-10-01 | feat/FIX-1649-shift-switch (pre-PR) | n/a | PASS | Adds **switch**. Shell 134 elements (the switch is graded with the rest). switch: OS light, nothing picked `#f0ece1`; Night shift clicked, OS light `#15140f`, and after reload; Day shift clicked, OS dark `#f0ece1`, and after reload. themed and neutral as before. |
| 2026-10-01 | feat/FIX-1649-shift-switch (pre-PR), `GOAL_CONTROL=switch-ignored` | n/a | FAIL (expected) | Only **switch**: every step after the first click keeps the OS look (`#f0ece1` where `#15140f` is wanted, then the reverse) and the switch never marks the clicked shift. reach, themed and neutral pass. |
| 2026-10-01 | feat/FIX-1649-shift-switch (pre-PR), `GOAL_CONTROL=hardcoded-accent` | n/a | FAIL (expected) | Only **neutral**, on `tool` (`#e8f551`), light and dark. switch passes. |
| 2026-10-01 | fix/FIX-1697-design-v2 merged with main (switch included) | n/a | PASS | v2 values with the switch. Shell 134 elements; light 373 colours, dark 378. switch: OS light, nothing picked `#f8f6f0`; Night shift clicked `#1c1b15`, and after reload; Day shift clicked, OS dark `#f8f6f0`, and after reload. |
| 2026-10-02 | origin/main (a font-load check added to themed and neutral, nothing else changed) | n/a | FAIL (before, expected) | Only **themed**, on the fonts, light and dark: text set in Space Grotesk 400, 500, 600 and IBM Plex Mono 400, and `document.fonts` declares no face of either family. Every colour and the switch pass. |
| 2026-10-02 | fix/FIX-1736-fonts (pre-PR) | n/a | PASS | Faces loaded, light and dark: Space Grotesk 400, 500, 600, IBM Plex Mono 400. No-theme: none loaded or declared. Shell 123 elements; light 372 colours, dark 377. |
| 2026-10-02 | fix/FIX-1736-fonts (pre-PR), `GOAL_CONTROL=fonts-not-loaded` | n/a | FAIL (expected) | Only **themed**, on the fonts, light and dark (`document.fonts`: none declared). Colours, neutral and switch pass. |
| 2026-10-02 | fix/FIX-1736-fonts, review round (Latin subsets, IBM Plex Mono 700, weights compared as numbers) | n/a | PASS | Same faces loaded as above; no-theme none. `GOAL_CONTROL=fonts-not-loaded` (font imports blanked): FAIL (expected), only **themed** on the fonts, light and dark. |
