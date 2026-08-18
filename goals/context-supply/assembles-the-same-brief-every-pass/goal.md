# context-supply › it assembles-the-same-brief-every-pass

**Issue:** LAB-136

**Outcome:** One phase of work — review — is handed a brief that is what that phase actually needs, judged once by a human against the written review standard the brief itself carries, and identical byte for byte on every pass. Round eight behaves like round one. The brief is shaped as a standing half (the phase's instructions, the project's grounding, the review standards, the objective) and a small changing half (this issue, this pull request, this diff), and the standing half must survive a change of issue. The human read is a real gate with a real red state: if the brief is missing something a reviewer needs, the verdict is FAIL and the recipe changes. It has already gone red once — see the verdict log.

**Input:** `fixtures/world.json` — a hand-built world with no database and no event feed: two issues, each with a pull request, its diff and what the author verified; the project's grounding; the review standards; the objective they sit under. Identifiers are invented (`ISSUE-1`, `#101`) and never real tracker ids (BP-006). Held-out: `run.mts` reads the world from the fixture and grades every fact against it, so swapping in another valid world still passes a correct recipe. No brief text is hardcoded in the check. Each pass reads a fresh `structuredClone`.

**Signal:**
- **Eight passes, one issue.** Eight assemblies of the recipe, each over a fresh copy of the world, render to the same bytes under one named comparator (`briefsAgree`).
- **The precondition.** Exactly one leading `system` message and none after it — which is what makes "the leading system run *is* the standing half" exact for this recipe rather than a heuristic. If it fails, the boundary derivation is void and the standing-half signal is withdrawn, not reinterpreted.
- **Two different issues.** The standing half is byte-identical between issue A and issue B; the changing half **differs**; and each changing half carries its own fixture's facts (id, title, PR number) and **none** of the other's.

**Anti-game:** A hollow pass here looks like one of four things, and each has a check that closes it.
1. *A comparator that could never return false.* → A variant recipe whose grounding appends a **per-call counter** must make the same named `briefsAgree` return false. A counter, never the clock: eight in-process assemblies can land in one tick, and a flaky check is worse than none.
2. *A brief so thin nothing in it could drift.* → Every fact graded is pulled from the fixture; the assembled brief is printed on every run so a human sees what was actually measured.
3. *A standing-half comparison between two briefs that are secretly the same brief.* → Requiring the changing halves to differ and to carry their own fixture's facts. Without those two assertions a recipe that assembled issue A twice passes every other signal. (Verified: forcing exactly that turns three assertions red.)
4. *Measuring the wrong mechanism and passing green.* → The model stub is step-capable and its legacy `generate` **throws**. A `generate()`-only stub drives the SDK-owned compatibility path, which contains no `emitGeneratorStep` call sites and which production never takes. (Verified: removing `generateStep` routes the run into `generate()` and the guard fires.)

The check must **not** assert on `assembleMessages`'s return value — that is the unit suite's job. This grades what the model was handed, through the step-method path production uses.

**Recipe constraint — load-bearing, not stylistic.** Every dynamic contribution in this recipe must be a **top-level slot function**. No functions may survive inside a slot's returned value.

`resolveSlotValues` calls top-level slot functions and stops; a function nested inside object-form context (`context: { drift: () => … }`) is resolved *later*, by `aggregateContextEntries`, and so never enters the capture. Such a formatter drifts the assembled bytes while the capture reports the slot perfectly stable — and the localization step below would then blame the framework for this recipe's own nondeterminism. That is a false framework finding, which under the issue's decision 3 pauses the epic.

Anyone extending this recipe needs to know that the constraint is what makes attribution sound, not a style preference. `run.mts` enforces it (`unresolvedSlots`) rather than describing it, and a nested-formatter variant proves the guard fires.

**Localization — and the correction this issue made to it.** On a red byte comparison, the check attributes the drift before anything is reported: slot outputs are compared **from the same eight runs** (never a fresh re-run, which is a different sample and can report "slots were stable" for drift the slots caused). Slot outputs differ → recipe drift, ours to fix here. Slot outputs agree → the assembly seam, which is a framework finding to file, not to repair here.

Spelled that way alone, the step is unsound. The constraint check has to run **inside** the attribution, first: an unresolved slot means the capture is blind, and blindness is not evidence of stability. Before that ordering was in place, a nested recipe formatter produced a confident *"report and stop — the drift is in the assembly seam"*. It now produces *"ours to fix here, NOT a framework finding."* Both outputs are recorded in the verdict log.

**Coverage this does not have** (stated rather than papered over):
- The **seam** verdict is reachable but has never fired on a real drift. Producing one would require making the framework itself nondeterministic, which means editing `packages/*` — a non-goal of this issue. What is proven is that the classifier reaches that branch only when the capture can see every dynamic contribution.
- A grounding contribution that reads the **clock** is not reliably detected: eight immediate in-process assemblies can share a tick. The honest coverage is per-call variation.
- **Fixture mutation** is not detected either way — every pass starts from a fresh copy, so every pass performs the same mutation on clean data.
- Variance across **machines, processes, locales, timezones** is not covered. Eight passes seconds apart in one process are materially weaker than "round eight behaves like round one" in production. Do not report a green here as the epic's headline claim having been met.

**Model:** n/a — model-free. The stub records the messages it was handed and returns empty text; it cannot influence the brief, so the assembly under test is the framework's real one. Introducing a real model would put nondeterminism inside a determinism proof and would answer a different question (was the review any good?).

**Run:** `pnpm tsx goals/context-supply/assembles-the-same-brief-every-pass/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-18 | f56c6b216 (+goal) | n/a | FAIL (human read) | First read of the assembled brief against the standards it carries. Assembly was correct and all machine signals were green, but the brief asked a reviewer to check that "every claim has a re-runnable evidence path" while giving them nothing to check it against — no tests, no statement of what the author ran. Gap was in the recipe's world, not in the framework's assembly. Fixed by adding a `verification` field per pull request and rendering it in the changing half. Recorded because the human gate is only real if its red state is. |
| 2026-08-18 | f56c6b216 (+goal) | n/a | PASS | 8 passes over `ISSUE-1`, fresh world each, byte-identical (2153 bytes; standing half 1258). Precondition held: exactly one leading system message. `ISSUE-2` left the standing half unchanged, differed in the changing half, and carried its own facts and none of `ISSUE-1`'s. Anti-game: the per-call-counter variant made `briefsAgree` return false and localized to the **recipe**. Constraint guard: a nested context formatter looks stable to the raw slot signal (the hazard), is caught by the guard, and localization consequently refuses to blame the seam. **No framework finding** — the assembly seam was deterministic across every pass. |

### Falsification runs behind that PASS
Each was performed by breaking the check on purpose and confirming it went red, then reverting. A green from a check nobody has seen fail is decoration.

| What was broken | Result |
|---|---|
| Issue B assembled as issue A (the vacuous-green hole) | RED — three assertions: changing halves identical, B's facts missing, A's facts leaked |
| A raw string added to the context slot | RED — precondition saw 2 leading system messages. Also settles by execution the spec's source-read claim that a string context entry becomes an extra system message |
| `generateStep` removed from the stub | RED — the run routed into legacy `generate()` and the guard threw. Confirms the wrong-mechanism failure is real and would otherwise have passed green |
| A nested-formatter drift on the eight passes, **before** the localization fix | RED, but attributed to the **seam** — a false framework finding |
| The same drift, **after** the fix | RED, attributed to the **recipe** — "ours to fix here" |
