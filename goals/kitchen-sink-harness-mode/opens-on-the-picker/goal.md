# kitchen-sink-harness-mode › opens on the picker

**Issue:** FIX-1914 (VG of the spec's PLAN; epic FIX-1907, ER-1 and ER-8)

**Outcome:** A person opening Kitchen Sink sees four modes on its front page, Flow State, Claude Code, Codex and Cursor, and opens the one they pick at its own address. A mode this host can't run says why, on the picker and at its address, and runs nothing. Flow State is today's app, at `/flow-state`.

**Input:** `fixtures/input.json`: the four modes in order with their labels and addresses, and four host settings, each with the reason a harness mode must show under it:

- `unset`: `KITCHEN_SINK_HARNESS_WORKSPACE` unset on a production server, which names the setting.
- `not-a-checkout`: the setting naming a directory that is not a git checkout, which names the path.
- `checkout`: the setting naming the top level of a git checkout. A built mode (one the app's mode list, `apps/kitchen-sink/lib/modes.ts`, gives a flow kind) is available here, since the server runs in test mode where its own check passes; every other harness mode says "Not built yet.".
- `vercel`: `VERCEL=1` with the setting naming that checkout, which says it runs on a local machine.

Held-out: the run makes its own directories (a plain one, and one with `git init`) under a fresh temporary folder, so any other directory of the same kind must give the same answer. Any harness mode at its address must behave as its card says.

**Signal:** one real browser against kitchen-sink's **production build**, built once by the run and served four times by `next start` on the scripted model and the in-memory store. No rebuild between starts: the run reads `.next/BUILD_ID` before each start and fails the **build** leg if it changed.

- **picker**: on every start, `/` lists the four modes in the fixture's order and labels. Flow State is available and links to `/flow-state`. On `checkout` a built mode is available and links to its address. Every other harness mode is unavailable, is not a link, and shows the start's reason; on `not-a-checkout` the reason names the path.
- **address**: on every start, each of `/claude-code`, `/codex` and `/cursor` that its card shows as unavailable shows the card's reason and a link back to the modes, and draws no rail, no navigator, no composer and no **New session**. An available one draws its frame: its rail and **New session**.
- **session**: on every start with harness modes off, opening each built mode's address, and pressing **New session** if it is drawn, leaves the mode's flow kind with no session.
- **served**: on the same starts, no built mode's flow is served: `POST /api/flows/<flow kind>/sessions` is not found.
- **return**: on `checkout`, picking Flow State opens `/flow-state` with the composer; the rail's **Back to the modes** link opens the picker again with all four listed.
- **phone**: on `unset` at 390×844, the four cards stack, every unavailable card's reason is on screen, and the page does not scroll sideways.

**Anti-game:** everything graded is read off the page as drawn, never the availability function or an API. One build serves every start, so a reason decided at build time fails at least three starts. A support-desk check deleted or skipped to get green is a fail of this issue, not of this check: the 8 e2e specs and the 6 `kitchen-sink-talk` goals run at `/flow-state` and are reported beside this verdict.

**Model:** n/a. No model is called: the picker and the refusals are decided on the server from the host's setting.

**Run:** `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness-mode/opens-on-the-picker/run.mts`

**Controls:** on the same command.

- `GOAL_CONTROL=gate-open`: the server, in a test-mode build only (`apps/kitchen-sink/lib/harness-gate.ts` through `goalControl`), lets every built mode past the host and its own check. Must FAIL at **picker**, **address**, **session** and **served** (on `unset`, `not-a-checkout` and `vercel` the host's reason is gone, a built mode is offered and drawn, New session makes a session, and its flow is served), and at nothing else.
- Today's `main` (before FIX-1914): `/` is the shell, so **picker** FAILS on the four modes listed.

The **session** and **served** legs (FIX-1915) loop over every built mode, so a harness mode's issue gives its mode a flow kind in the mode list and edits nothing here.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-12 | ff0a87181 | n/a (no model) | PASS | One build, four starts: unset (production reason naming the setting), not-a-checkout (names the path), checkout ("Not built yet." ×3), vercel ("Runs on a local machine." ×3); every harness address refused with its card's reason and drew nothing; Flow State opened at /flow-state and its rail led back; phone 390px stacked, no sideways scroll |
| 2026-10-12 | ff0a87181 | n/a (no model) | FAIL (control `gate-open`) | Reddened **picker** and **address** only: on unset, not-a-checkout and vercel each harness mode showed "Not built yet." instead of the host's reason; the checkout start stayed green |
