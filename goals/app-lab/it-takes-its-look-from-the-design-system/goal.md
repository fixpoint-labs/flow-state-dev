# app-lab › it takes its look from the design system

**Issue:** FIX-1688 and FIX-1689 (epic FIX-1649)

**Outcome:** App Lab's light and dark look comes from the design-system package's one import. The FSD parts it reuses in a task's Session (message, reasoning, tool and code block cards) are its unedited registry copies, and they take that look with the rest of the shell. Remove the one import and no App Lab value is left on any of them: the shell and the cards show the registry's neutral defaults.

**Input:** App Lab as checked out, copied to a scratch directory and built twice: as written, and with the line `@import "@flow-state-dev/design-system/app-lab.css";` removed from `src/styles.css`. Each build is served by App Lab's start script over the run-lab (`goals/app-lab/it-shows-and-stops-a-task-run/lab/`), whose runs store a message, a reasoning item and a tool call with its result. App Lab's theme values and font families are read from `labs/design-system/app-lab.css` at run time.

**Signal:** Chromium opens a running task from Tasks by clicking, opens its tool card and reasoning, and reads the computed colour, background, border, outline, svg stroke and fill, and font of every visible element on the shell and inside each swept card. Two passes per build: light, then with `dark` on the root element. Each failure is tagged `<leg> [<build> <variant>]`.

- **reach**: the Session draws each swept registry part (message, reasoning, tool, code block) at least once.
- **themed**: on the build as written, every painted colour is one of App Lab's values for that variant (to within 3 per channel), and every font is one of its families.
- **neutral** (the closure's leg c): on the build without the import, no painted colour is any App Lab value from either variant, and no font is one of its families.

**Anti-game:**
- The no-theme build removes exactly one line. If that line isn't there, the setup fails: a build that "removed" an import that was never loaded proves nothing.
- Colours are graded by computed value, never by class name. Colours set by an inline literal (syntax highlighting) are content, not skin, and are skipped.
- The copies being unedited is CI's job (`labs/app-lab/test/static.test.ts`), checked against the install list in App Lab's `package.json`.

**Model:** n/a (the run-lab's scripted runs).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/app-lab/it-takes-its-look-from-the-design-system/run.mts` (`GOAL_KEEP=1` keeps the screenshots).

**Controls:**
- `GOAL_CONTROL=hardcoded-accent`: App Lab's copy of the tool card paints its completed icon with App Lab's accent (`--attention`, light) as a literal class, in both builds. Must fail at **neutral** naming `tool`, light and dark, and nowhere else.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-01 | a25134ebd (main) + this check | n/a | FAIL (before, expected) | App Lab as on `main`. **neutral** can't run: `src/styles.css` has no design-system import to remove. **reach**: the Session drew no registry message, reasoning, tool or code block. **themed**: the shell paints the neutral defaults (`#ffffff`, `#e4e4e7`; dark `#09090b`, `#27272a`), 200+ samples per variant. |
| 2026-10-01 | fix-1688-app-lab-skin (pre-PR) | n/a | PASS | Light: shell 129, message 8, reasoning 16, tool 51, code block 32 elements, 360 colours; dark the same parts, 370 colours. No-theme light 365 colours, dark 375, none an App Lab value. |
| 2026-10-01 | fix-1688-app-lab-skin (pre-PR), `GOAL_CONTROL=hardcoded-accent` | n/a | FAIL (expected) | Only **neutral**, on `tool` (`svg.lucide-circle-check-big` stroke `#e8f551`), light and dark. reach and themed pass. |
