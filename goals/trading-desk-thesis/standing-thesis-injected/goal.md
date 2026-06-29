# Goal: a standing thesis reaches the desk's decision tier

**Contract.** When the user has recorded a durable per-position thesis (FIX-760)
for a name, running the desk on that name injects the standing thesis into the
trader and PM — they reason with the user's standing intent, not just position
size. The proof: seed a thesis, run `analyze` on the same ticker, and the
machine-readable `RunSummary` reports `hasStandingThesis === true` on a completed
run.

**Real path.** The check shells three raw `fsdev run` steps from
`labs/trading-desk` (config search is cwd-only), all sharing one throwaway
`TRADING_DESK_DATA_DIR` so they hit the same PGlite backing and the same CLI
principal:

1. `portfolio saveThesis` — writes the thesis to the app-owned `app.theses` table
   through the real action + repository.
2. `analysis analyze` (NVDA, fixture, fast) — `seedSession` reads the thesis from
   the repository (household × ticker), freezes it, and the `standingThesis`
   capability preset renders `<standingThesis>` into the trader (P3) and PM (P5)
   prompts; the PM commit derives the `hasStandingThesis` echo onto the decision
   snapshot. Real models via the desk's intent ladder; fixture mode stubs DATA
   tools only, so the generators run live.
3. `analysis runSummary` — the zero-model read-back.

**Pass criterion.** The `runSummary` capture parses as a `RunSummary` with
`status === "completed"`, the PM memo (`p5/portfolio-manager`) published, and
`hasStandingThesis === true` — the deterministic echo proving the standing thesis
was injected into the decision tier on the real generator path.

**Anti-game.** `hasStandingThesis` is derived in the PM commit from frozen
session state (never LLM-emitted), and it is only `true` when `seedSession`
actually found and froze a thesis. A run with no seeded thesis projects
`hasStandingThesis === false` (and a stopped/errored run leaves it null), so the
check fails unless the seed → seed-freeze → preset → commit chain all fired.

**Run.** Requires `AI_GATEWAY_API_KEY` (slow + costs tokens — ~30 real
generators). Out of CI, by hand:

```
pnpm tsx goals/trading-desk-thesis/standing-thesis-injected/run.mts
```

## Verdict log

- (pending first manual run with a gateway key)
