# Goal: a trading-desk headless run is clean and machine-readable

**Contract.** An agent improving the desk can run the whole `analyze` pipeline
headlessly and read a machine-readable `RunSummary` of what happened — no
browser, no custom harness. The proof is the smoke test: a single fixture-mode
NVDA run, driven by raw `fsdev run`, completes with a decision.

**Real path.** The check shells `fsdev run analysis analyze --capture --quiet`
then `fsdev run analysis runSummary --capture --quiet` from `labs/trading-desk`
(config search is cwd-only), against real models resolved through the desk's
intent ladder + Vercel AI Gateway. Fixture mode stubs the DATA tools only — the
analyst / research / trader / risk / PM generators all call real LLMs — so this
exercises the real generator path. This is exactly the two-step the
`verify-trading-desk` skill teaches; there is no wrapper script to maintain.

**Pass criterion.** The `runSummary` capture
(`labs/trading-desk/.fsdev/headless/<session>.summary.json`) parses as a
`RunSummary` with `status === "completed"`, a non-null `finalRating`, and the PM
memo (`p5/portfolio-manager`) published. The summary records what happened; it
does not judge quality — that is the eval-suite's job (FIX-790).

**Anti-game.** A record alone is not enough — a stopped or errored run also
projects a summary. The check asserts `status === "completed"` AND a non-null
`finalRating` AND the PM memo published, so the pipeline must actually have
produced a decision.

**Model.** real — the desk's own intent ladder via the Vercel AI Gateway (`AI_GATEWAY_API_KEY`). Fixture mode stubs DATA tools only, so every generator runs live.

**Run.** Requires `AI_GATEWAY_API_KEY` (slow + costs tokens — ~30 real
generators). Out of CI, by hand:

```
pnpm tsx goals/trading-desk-headless/fixture-run-clean/run.mts
```

## Verdict log

- 2026-06-25 — **PASS** (prior batch form). Batch over NVDA/AAPL/JPM (fast,
  fixture) via the Vercel AI Gateway: 3/3 completed, each with a published PM
  memo and a non-null rating (NVDA Buy, AAPL Hold, JPM Hold).
