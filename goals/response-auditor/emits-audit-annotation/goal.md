# response-auditor › it emits-audit-annotation

**Issue:** FIX-847
**Outcome:** When a response auditor surfaces findings, an audit card shows up in the chat UI on its own. The user sees the auditor's verdict rendered, without the app hand-wiring an emit.
**Input:** `fixtures/input.json` — a `topic` a real generator answers, producing the response that gets audited. Held-out: any topic must pass; the wording is not asserted on.
**Signal:** A `component` item with `component === "audit-annotation"` lands in the run's item stream, carrying a non-empty `surfacedResults`. Absence (or an empty card) fails.
**Anti-game:** Do not assert on the auditor block's return value (`getBlockOutput` / the sequencer output) — that shape existed before FIX-847 and a mocked block test already covers it. The card only renders off the *emitted component item*, so the check asserts that item in the stream. To keep the check deterministic, the harness fixes the one stochastic input that isn't FIX-847's concern — whether the model flags bias — by running the auditor with an always-surfacing analyzer over a **real generator's** response. So the real model is load-bearing (it produces the audited text through the gateway), while the emit-on-surface behaviour FIX-847 added is exercised deterministically. A hollow pass would be a card emitted with zero surfaced results.
**Model:** real — vercel/openai/gpt-5.4-mini (via the Vercel AI Gateway)
**Run:** `pnpm tsx goals/response-auditor/emits-audit-annotation/run.mts`

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-07-08 | fix/FIX-847 | vercel/openai/gpt-5.4-mini | PASS | real generator produced a response via the gateway; responseAuditor emitted an audit-annotation component item with 1 surfaced result into the stream. Also confirmed once end-to-end via `fsdev run chat-agent` with `features.biasCheck` on (real biasAnalyzer surfaced), though that path's surfacing is model-stochastic and not codified here. |
