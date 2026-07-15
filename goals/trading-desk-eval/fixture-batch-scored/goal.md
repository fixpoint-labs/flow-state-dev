# Goal: the desk's run-quality eval suite produces a trustworthy per-run score

**Contract.** A maintainer (or agent loop) improving the trading desk can run one
command over a fixture corpus and get a per-run quality read they can trust —
internal contradictions caught for free by the deterministic layer, and the
qualitative dimensions scored by a blinded LLM judge with a known noise band. The
proof is a small batch: two different tickers, evaluated end-to-end, landing two
separable records on the JSONL scoreboard, plus a variance pass that characterizes
the judge's own noise.

**Real path.** The check runs `pnpm eval sweep` over a two-tuple manifest
(NVDA + AAPL, `fast`, `fixture`) from `labs/trading-desk`. One framework runtime
executes both sessions against an isolated PGlite backing under `<out>/data`, so
`--concurrency` is safe and the runs stay out of Past Reports. `analyze` runs real
generators through the desk's intent ladder + Vercel AI Gateway (fixture mode stubs
the DATA tools only); the zero-model `runArtifacts` action reads each stored bundle
back through the same runtime; the deterministic invariants run for free; and the
LLM judges grade the four rubric dimensions on a BLINDED bundle, with a pinned judge
model. Then `pnpm eval variance --data-dir <out>/data` re-scores both sessions
(k=3, to bound cost) and records the per-dimension noise band + alpha.

**Pass criterion.**

- The scoreboard (`<out>/scoreboard.jsonl`) parses as two `QualityRecord` lines,
  both `runStatus: "completed"` with **zero hard invariant failures**.
- Every judge dimension on both runs is `scored`, with `k` scores each in `[0, 1]`
  and NON-EMPTY per-criterion reasoning + evidence in the detail sidecar.
- The two runs' stored bundles differ (a stubbed read path would emit identical
  bytes).
- The variance report records a `std` per dimension for each session and, because
  two sessions supply ≥2 items, a Krippendorff `alpha` per dimension.

**Anti-game.** The check reads the detail SIDECAR, not just the scoreboard counts:
empty reasoning, missing per-criterion evidence, or an all-skipped judge layer fail
it. The manifest uses two different tickers so a single hardcoded record can't pass
twice, and the two bundles must differ. Identical judge reasoning ACROSS repeats is
a valid low-variance outcome and must not fail the check — only empty reasoning does.

**Run.** Requires `AI_GATEWAY_API_KEY` (slow + costs tokens — ~60 real generators
across two runs, plus 4 dimensions × 3 repeats × 2 runs judge calls). Out of CI, by
hand:

```
pnpm tsx goals/trading-desk-eval/fixture-batch-scored/run.mts
```
