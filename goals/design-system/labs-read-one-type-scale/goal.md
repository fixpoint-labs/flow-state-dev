# design-system › it labs read one type scale

**Issue:** FIX-2783 (epic FIX-2369)

**Outcome:** In each of the three labs (Shift Manager, Teammates, Claude Code-style), the feed and the composer read at a comfortable long-session size, no text in the main views is below 12px, and one value in the design system's `type.css` changes that size in all three labs.

**Input:** each lab copied to scratch and built by its own Vite config, served by its own command on a fresh store, with no model credential, and seeded through its own screens and actions:

- **Shift Manager** over the run-lab (`packages/shift-manager/test/fixtures/run-lab/`, scripted runs): Shift Coordinator, Tasks (the densest view), two tasks' Sessions found by clicking Tasks' entries, Inbox. Day and night.
- **Teammates** with its scripted harness (`GOAL_HARNESS=stub`): Chief of Staff's conversation and panel, a coding task filed on its board and opened in its popup, and a second teammate's conversation. A user's line is sent from each conversation's composer (no model answers it). Dark only: the lab has no light theme.
- **Claude Code-style** with its scripted harness (`CLAUDE_CODE_STYLE_HARNESS=stub`): two sessions on a new project, each with a line sent from the composer, and a task filed on the first session's board, opened in its background-task sheet; and a Projects session with a thread filed on its board, opened in the thread's own view (`ThreadView`), whose feed and composer must both draw. Light and dark.

The lines, titles and project are the goal's own; no lab names them. **Held-out:** any other line or task title must pass.

**Signal:** computed styles read in headless Chromium, in every view and variant.

- **a**: every feed body (the registry's message, Shift Manager's received message and Shift Coordinator summary, the labs' user and worker entries, a popup's steps) sets most of its words at the body step, 16px; every composer computes 16px.
- **b**: no visible text is below 12px. The only exception is an `aria-hidden` glyph at a size that a reasoned `eslint-disable-next-line fsd/no-hardcoded-text-size` line in that lab's source sets (Shift Manager's two 7.5px sidebar marks). The allowance is read from the source, not listed here.
- **c**: each lab is built a second time with its `node_modules`' design system swapped for a copy whose `type.css` sets the body step to 17px (the lab's own import line untouched). The same server serves it: the browser routes the second build's files in. Every feed body and composer computes 17px. Setup fails if the 17px stylesheet never reached the page.

Each failure names its lab, view and variant.

**Anti-game:**
- Sizes are read as the browser computes them, never from class names; the lint covers source.
- A feed body is graded by the size most of its words are set in, so a body whose class says `text-base` while its text sits in a `text-sm` child fails.
- c proves each lab reads the file: with the comfortable sizes, `xs`, `sm` and `base` equal Tailwind's defaults, so a lab without the import passes a and b and only c tells.
- Every graded list is floored with `tell.over`: a lab whose views drew no feed body or composer is CAN'T TELL, not PASS.

**Model:** n/a (scripted runs; no model credential reaches any server).

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/design-system/labs-read-one-type-scale/run.mts` (about 10 minutes; `GOAL_ONLY=<lab>` reads one lab; screenshots land in the scratch folder the run prints).

**Controls:**
- `GOAL_CONTROL=drop-import`: Teammates' copy drops its `type.css` import line. Must FAIL **c** naming Teammates, and nothing else.
- `GOAL_CONTROL=drop-import:<lab>`: the same for `shift-manager` or `claude-code-style`. Must FAIL **c** naming that lab only.
- `GOAL_BASELINE=<ref>`: each lab's `src/` from that ref. One-time evidence: the commit before this change must FAIL **a** and **b** in every lab (and **c**, having no import).

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-11-18 | `claude/project-thread-emkjet` on ea58bfe54, uncommitted | n/a | PASS | a, b and c in all three labs. Shift Manager: 21 feed bodies and 4 composers read at 16px, day and night, 10 reads of its two 7.5px sidebar marks let through; at 17px, 36 and 4. Teammates: 5 and 3; at 17px, 7 and 3. Claude Code-style: 7 and 6, light and dark; at 17px, 13 and 6. |
| 2026-11-18 | same, `GOAL_CONTROL=drop-import` | n/a | FAIL (expected) | c only, Teammates only (9 lines: the user's lines, the popup's steps and both composers at 16px, not 17px). |
| 2026-11-18 | same, `GOAL_CONTROL=drop-import:shift-manager` | n/a | FAIL (expected) | c only, Shift Manager only: task messages, the Shift Coordinator's summary and the task composers at 16px, not 17px. |
| 2026-11-18 | same, `GOAL_CONTROL=drop-import:claude-code-style` | n/a | FAIL (expected) | c only, Claude Code-style only (19 lines, light and dark). |
| 2026-11-18 | same, `GOAL_BASELINE=ea58bfe54` (main before this change) | n/a | FAIL (expected) | a, b and c in every lab. a: bodies and composers at 14px (Shift Manager 24 lines, Teammates 8, Claude Code-style 13). b: text at 7.5–11.5px (Shift Manager 268 lines, Teammates 44, Claude Code-style 14). c: no type file to move (40, 9, 19). |
| 2026-11-18 | `claude/project-thread-emkjet` at 200c31270 + this round, `GOAL_ONLY=claude-code-style` | n/a | PASS | The Projects thread view added: 20 feed bodies and 10 composers at 16px, light and dark; at 17px, 28 and 10. |
| 2026-11-18 | same, `ThreadView`'s composer put back to `text-sm` in the checkout | n/a | FAIL (expected) | a and c, the thread view only: `textarea[Message this task]` at 14px, light and dark. The goal at 200c31270 PASSES this patch: its *thread* view opened the background-task sheet, never `ThreadView`. |
| 2026-11-18 | same, `GOAL_CONTROL=drop-import:claude-code-style` | n/a | FAIL (expected) | c only, Claude Code-style only (38 lines, light and dark). |
