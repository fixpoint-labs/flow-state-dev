# Run-quality evaluation suite (FIX-790)

After the desk finishes an `analyze` run, nothing on its own says whether the
result was any *good* — a person has to read the report. This suite turns that
judgment into numbers a maintainer (or an agent loop) can move. It is a **report
card over a stored run**, not a backtest: it scores whether a run was internally
consistent and well-reasoned, with no ground truth and no measure of whether the
call was ultimately *right* (that is a separate, outcome-corpus concern).

It has two layers over the same stored run, plus a variance mode:

- a **deterministic invariant layer** — pure code, zero model spend — that catches
  internal contradictions in the recorded decision, and
- an **LLM-judge layer** that scores the qualitative dimensions code can't check,
  on a blinded bundle, with a judge model pinned distinct from the desk's
  generators.

The code lives in `eval/`; the read seam is the zero-model `runArtifacts`
action (`flows/analysis/orchestration/run-artifacts-action.ts`), the deeper
sibling of `runSummary`. The CLI is `scripts/eval-runs.ts` (`pnpm eval`).

## The read seam: `runArtifacts`

Evals read a run through the same resource API the app uses, not the store tables.
`runArtifacts` (`-i '{}' --session <id>`) projects one session into a
`RunArtifactsBundle`: the compact `RunSummary`, the decision snapshot, every memo
body, the valuation spine, the reward-to-risk figure, lens convergence, the frozen
risk mandate, and the Phase-2 debate transcript. A never-written resource is
normalized to `null` (never a partial `{}` or an empty `{entries: []}` transcript),
so a completeness check can tell *absent* from *malformed*. `buildRunArtifacts` is
pure; the action just feeds it the resource reads.

## Deterministic invariants

`checkRun(bundle)` is pure, total, and never throws — missing substrate degrades a
check to `skipped` (never a false `fail`). It asserts only on the computed/derived
records; all LLM-emitted prose routes to the judge layer, because a fixture replay
still calls real generators, so memo text is nondeterministic run-to-run.
Recomputation checks reuse the desk's OWN pure libs (`ratingBandFor`,
`computeMandateGates`, `computeRewardToRisk`), so they catch stored-record drift and
partial writes, not formula bugs.

Each check reports `{id, severity, status, expected?, actual?, detail}` — never a
pre-aggregated number. `hard` = an internal contradiction (gates the CLI exit
code); `soft` = a flagged signal (never gates).

| Group | Reads | What it asserts |
| -- | -- | -- |
| `memo-completeness/*` | the memo set | every expected memo (per `costPreset`, thesis presence) is `published` or honestly `error`; none left `pending`/`writing` on a completed run |
| `rating-envelope/*` | decision snapshot, PM memo, spine | `finalRating` within `[floor, ceiling]` (or an override reason is recorded); a clamp lands on a band edge; the band recomputes from `envelope.implied` + evidence thinness |
| `scenario/*` | scenario-forecaster memo | 3–5 scenarios; each probability ∈ [0,1]; recomputed sum ∈ [0.98, 1.02]; recorded `probabilitySum` ∈ [0.8, 1.2]; `expectedReturnPct` number-or-null |
| `reward-risk/*` | scenario memo, mandate, reward-to-risk resource | stored figure recomputes from the scenarios + mandate λ; snapshot mirrors match (gated on a mandate decision) |
| `mandate/*` | mandate, reward-to-risk, PM memo | recomputed verdict + capacity match; committed size within the applicable cap; a clamp lands on a cap; dial sanity `capacityVetoCapPct ≤ unclearedCapPct` |
| `decision-consistency/*` | snapshot, PM memo, trader memo | snapshot ↔ PM mirrors (rating, confidence, verdict) and snapshot ↔ trader mirrors (direction, size, stops) agree; `weightDeltaPct = target − current` |
| `valuation/*` | valuation spine | abstention honesty (`available: false` ⇒ a reason); `terminalValueShare > 0.85` ⇒ `tv-dominated`; triangulation consistent with its method count. Soft flags: tv-dominated, a wide expectations gap |
| `citations/*` | analyst memos, citation integrity | published analyst memos carry a `dataQuality`; every non-null citation has a title + a parseable URL. Soft flag: invalid Phase-2 citation tags |
| `null-honesty/*` | memo metrics | no `"NaN"`/`"undefined"`/`"null"` strings in metric values |

There is deliberately **no per-share cross-check** — the spine is company-level
($B) with no share count, so the dexter-style per-share bound is not implementable
and is dropped (see Limitations).

Example `CheckResult`:

```json
{ "id": "rating-envelope/final-within-band", "severity": "hard", "status": "pass",
  "detail": "finalRating Overweight within [Hold, Buy]" }
```

## Judge rubrics

Four dimensions (`rubrics.ts`), each graded on the analyzer's native **0–1** scale:

1. **evidence-quality** (graded) — Phase-1 analyst memos: are claims specific,
   sourced, and consistent with each memo's `dataQuality`?
2. **debate-engagement** (checklist) — over the Phase-2 *transcript* (the primary
   substrate) plus the consolidated bull/bear/RM memos: does the bear rebut a
   specific bull claim, is the bull's strongest point addressed, are the
   unresolved disagreements real, does neither side fabricate numbers? Skipped
   with a reason when the transcript is absent (older session).
3. **pm-coherence** (graded) — does the decision follow from the cited upstream
   memos; is a trader disagreement addressed; are accepted adjustments traceable?
4. **confidence-calibration** (graded, *epistemic congruence*) — is stated
   conviction proportionate to the evidence? Hedging language is neither rewarded
   nor penalized.

Graded rubrics express five anchor levels on the 0–1 scale (0, 0.25, 0.5, 0.75, 1);
checklist criteria are 0-or-1. Every recorded score, mean, and std is 0–1 — the
scoreboard never mixes scales.

**Mechanics.** Each dimension is graded by running the framework's
`utility.analyzer` block directly through `testBlock` with the eval finding schema
(the same internal path `analyzerScorer` takes, run directly so the RAW findings —
per-criterion score/assessment/evidence — survive for the sidecar). The judge model
is pinned via the block `model` against an injected `createModelResolver()`, reading
a **blinded** bundle (`blinding.ts` strips `sessionId`, timestamps, capture paths,
and reserved outcome fields; persona role labels stay). **k = 3** repeats per dimension (mean + std
recorded). A hung provider is bounded by a local `--judge-timeout-ms` race; a failed
or timed-out repeat records score 0 + a reason (a failed judge is a failed score,
never a crashed sweep). When a budget cap is set and a failed call exposes no
usage trace, the suite stops launching judges because the remaining spend is
unknowable; it never treats a known-cost subtotal as the total. If the judge family matches the desk's generators
(OpenAI/Google/xAI), a **self-preference warning** is recorded on the run — never a
block.

## Quality record

One JSONL line per evaluated run on `<out>/scoreboard.jsonl` (`scoreboard.ts`;
append-only, single-line `O_APPEND` writes). Deterministic and judged results stay
SEPARABLE — no composite. The bulky detail (full `CheckResult[]` + every judge
repeat's raw findings/evidence) lands in a per-run sidecar
(`details/<sessionId>.<evaluatedAt>.json`, the timestamp in the filename so
re-evaluating never overwrites a sidecar an earlier line points to). The line is
keyed by `evalVersion` for additive-only evolution (FIX-791 golden diffing and
FIX-792 cost accounting consume and extend it).

```json
{ "evalVersion": 1, "sessionId": "...", "ticker": "NVDA", "runStatus": "completed",
  "finalRating": "Overweight", "invariants": { "hardPassed": 18, "hardFailed": 0,
  "softPassed": 2, "softFlagged": 1, "skipped": 3, "failures": [] },
  "judges": [ { "dimension": "evidence-quality", "kind": "graded", "status": "scored",
  "mean": 0.78, "std": 0.05, "k": 3, "scores": [0.75, 0.8, 0.79] } ],
  "judgeModel": "vercel/openai/gpt-5.4-mini", "detailPath": "..." }
```

Readers skip torn lines (a killed process's partial write never breaks the corpus).

## Judge variance

`pnpm eval variance --session <id> [--session <id> ...] [--k 5]` re-scores fixed
sessions with no scoreboard append and emits a variance report: per-(session,
dimension) `{mean, std, scores}` plus the `2·SE` noise band. **Krippendorff's alpha
is computed only when ≥2 sessions are supplied** (items = sessions, raters =
repeats); with a single item the expected-disagreement denominator is degenerate.
Any dimension with `α < 0.8` is flagged as an unreliable rubric. `stats.ts`
implements `meanStd`, `seDiff`, and `krippendorffAlpha` locally.

**Measured noise bands.** _(To be filled from a live-model `variance` run; the goal
check runs k=3 on the NVDA + AAPL fixture sessions and records std + alpha per
dimension. Populate this table from a `--k 5` run once a gateway key is available.)_

| Dimension | k | mean-of-means | 2·SE band | alpha |
| -- | -- | -- | -- | -- |
| evidence-quality | — | — | — | — |
| debate-engagement | — | — | — | — |
| pm-coherence | — | — | — | — |
| confidence-calibration | — | — | — | — |

## Running the suite

```bash
pnpm eval sweep    --manifest <file.json> [--concurrency 2] [--out .fsdev/eval] [--judge-model <id>] [--no-judges] [--max-cost-usd <n>] [--judge-timeout-ms <n>] [--k <n>]
pnpm eval eval     --session <id> [--session <id> ...] [same flags]
pnpm eval variance --session <id> [--session <id> ...] [--k 5] [--judge-model <id>]
```

Manifest tuples: `[{ ticker, date?, costPreset?, dataSource?, riskMandate?, userThesis?, selectedAccountIds? }]`
— field names match `analyzeInputSchema` exactly (the per-run override is
`riskMandate`, a pack id). Default `--out` is the gitignored `.fsdev/eval/`; the
default judge model is `vercel/openai/gpt-5.4-mini`. Numeric flags must be positive
finite values; `--k`, `--judge-timeout-ms`, and `--concurrency` must also be
integers. Exit code is non-zero when any run errored or any **hard** invariant failed.

**PGlite is single-process.** `sweep` gives each run an isolated
`TRADING_DESK_DATA_DIR` under `--out` (so `--concurrency > 1` is safe and sweep
runs stay out of Past Reports); `eval`/`variance` reach those isolated sessions when
given the same `--out`. Against a real Postgres backing (`DATABASE_URL`) there is no
such constraint. **Session ownership:** `fsdev run` executes as the CLI user and
sessions are bound to their creator, so v1 evaluates harness-created sessions;
UI-created sessions (a different owner) are a named limitation.

## Limitations (v1)

- **Generator nondeterminism** — the deterministic layer can only assert on the
  computed records; prose claims are judged, never asserted.
- **No per-share valuation cross-check** — the spine is company-level ($B) with no
  share count; the EV-band and terminal-value-share soft flags cover the intent.
- **No outcome/ground-truth scoring** — process quality only; "was the call right"
  is a separate issue on the historical corpus.
- **CLI-created sessions only** — evaluating UI-created sessions needs a user-id
  seam in `fsdev run` that doesn't exist yet.
- **Judge field order** — the shipped finding schema emits `score` before
  `assessment`/`evidence`, so reasoning-before-score is instructed in the preamble,
  not enforced by the schema.

## See also

- [`CLAUDE.md` → Evaluating run quality](../CLAUDE.md) — the terse agent-guide entry
- [`flows/analysis/run-summary.ts`](../flows/analysis/run-summary.ts) — the
  compact projection the harness reads; this suite reads the deeper `runArtifacts` bundle
- [`goals/trading-desk-eval/fixture-batch-scored`](../../../goals/trading-desk-eval/fixture-batch-scored/goal.md) — the goal check
- `@flow-state-dev/testing` `analyzerScorer` — the judge primitive this layer builds on
