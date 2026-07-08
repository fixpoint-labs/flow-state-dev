# response-auditor › it emits-audit-annotation

**Issue:** FIX-847
**Outcome:** When a response auditor surfaces findings, an audit card shows up in the chat UI on its own. The user sees the auditor's verdict rendered, without the app hand-wiring an emit.
**Input:** `fixtures/input.json` — a held-out `{ userInput, aiResponse }` pair where `aiResponse` is a deliberately one-sided, absolutist essay. The response text is a fixture (not generator-produced) so the only stochastic step is the real analyzer's judgment call. Held-out: any response a reasonable rater would call biased must also pass; the exact wording is not asserted on.
**Signal:** A `component` item with `component === "audit-annotation"` lands in the run's item stream, carrying a non-empty `surfacedResults`. Absence (or an empty card) fails.
**Anti-game:** Do not assert on the auditor block's return value (`getBlockOutput` / the sequencer output) — that shape existed before FIX-847 and a mocked block test already covers it. The card only renders off the *emitted component item*, so the check asserts that item in the stream. The harness runs the REAL `biasAnalyzer` (the same one `apps/kitchen-sink`'s bias-check wires into `responseAuditor`) via a real gateway-bound model resolver — not a stub that always surfaces — so the model's actual judgment call is load-bearing: if the analyzer scored the fixture below threshold, the check would correctly fail. Whether a given model call crosses the threshold is inherently probabilistic, so the runner retries a bounded number of times (`GOAL_ATTEMPTS`, default 3) and passes on the first surfacing run. A hollow pass would be a card emitted with zero surfaced results, or an emit forced independent of the analyzer's actual score.
**Model:** real — vercel/openai/gpt-5.4-mini (via the Vercel AI Gateway), running the real `biasAnalyzer` pipeline (agreement-detect → classify → score → optional counterpoint)
**Run:** `pnpm tsx goals/response-auditor/emits-audit-annotation/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-08 | fix/FIX-847 | vercel/openai/gpt-5.4-mini | PASS | Four consecutive runs, all passed on the first attempt (no retry needed): real biasAnalyzer scored the held-out response 0.94, 0.86, 0.90, 0.88 respectively (all ≥ 0.3 threshold); responseAuditor emitted an audit-annotation component item with 1 surfaced result each time. |
