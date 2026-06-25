# Goal: the trading-desk headless batch runs clean over the fixture corpus

**Contract.** An agent improving the desk can run the whole `analyze` pipeline
headlessly and read a machine-readable scoreboard of what happened — no browser.
The proof is the issue's named smoke test: a fixture-mode batch over the
3-ticker corpus (NVDA / AAPL / JPM, `fast` preset) runs clean and every run
completes with a decision.

**Real path.** The batch harness shells `fsdev run analysis analyze --capture`
and `fsdev run analysis runSummary --capture` from `labs/trading-desk` (config
search is cwd-only), against real models resolved through the desk's intent
ladder + Vercel AI Gateway. Fixture mode stubs the DATA tools only — the analyst
/ research / trader / risk / PM generators all call real LLMs — so this
exercises the real generator path. Each run executes in its own temp PGlite
database (concurrency-safe isolation).

**Pass criterion.** The scoreboard
(`labs/trading-desk/.fsdev/headless/scoreboard.fixture.jsonl`) has exactly 3
lines, each a valid `RunSummary`, every `status === "completed"`, and the PM memo
(`p5/portfolio-manager`) published on each. The harness records what happened; it
does not judge quality — that is the eval-suite's job (FIX-790).

**Anti-game.** Asserting the line COUNT and `status` is not enough — a stopped or
errored run is also a line. The check asserts `status === "completed"` AND a
non-null `finalRating` AND the PM memo published, so emitting a record is not
sufficient; the pipeline must actually have produced a decision.

**Run.** Requires `AI_GATEWAY_API_KEY` (and is slow + costs tokens — ~30 real
generators × 3 tickers). Out of CI, by hand:

```
pnpm tsx goals/trading-desk-headless/fixture-batch-runs-clean/run.mts
```

## Verdict log

- 2026-06-25 — **PASS**. Batch over NVDA/AAPL/JPM (fast, fixture) via the Vercel
  AI Gateway: 3/3 completed, each with a published PM memo and a non-null rating
  (NVDA Buy, AAPL Hold, JPM Hold). AAPL/JPM carried memoErrors (3/4) from
  non-primary fixture gaps — recorded, not fatal; the runs still produced a
  decision. Concurrency 3, each run in its own temp PGlite db.
