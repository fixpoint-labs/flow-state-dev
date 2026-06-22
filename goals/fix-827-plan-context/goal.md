# FIX-827 — Plan & Execute carries concrete task context to workers

**Outcome:** When you hand Plan & Execute a data-heavy request (e.g. five concrete subdomains to research), each worker actually receives the concrete data, and the final answer covers those specific items — not generic filler like "research the listed subdomains" with nothing attached.
**Input:** `fixtures/subdomains.json` — five named subdomains. Held-out: swapping the five for any other five distinct strings must still pass a correct implementation. The assertion derives the expected facts from the fixture; it never hardcodes these specific names.
**Signal:** every dispatched worker's `context` contains the subdomain string for its task, AND the final synthesized answer names at least 4 of the 5 subdomains. (5 is enough to exercise the dropped-data bug; more is just waste.)
**Anti-game:** the gameable pass is asserting the *pattern ran* — that it emitted a `TaskInit[]`, or that the board reached `complete`, or that the decomposer returned the right schema shape. All of those pass on the original (broken) behavior where workers got a bare instruction with no data. The check MUST grade against the fixture: the concrete subdomain strings have to appear in worker context and in the output. Do not assert on schema shape, item counts, or that `taskContext` was called.
**Model:** real — openai/gpt-5.4-mini
**Run:** `pnpm tsx goals/fix-827-plan-context/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| _not yet run_ | | | | runner targets the app flow that composes `planAndExecute`; wire `<flow> <action>` before first run |
