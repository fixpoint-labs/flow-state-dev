# Goal: a newly listed issuer's prospectus financials are recovered, not voided

**Contract.** When a newly listed issuer (the SPCX failure mode) has audited
financial statements in its IPO prospectus but nothing in periodic XBRL yet, the
desk must not mark revenue / operating income / free cash flow "unavailable"
after only companyfacts + Yahoo miss. A validated S-1 / 424B* recovery populates
the valuation-critical fields onto the financials spine, normalized to USD
billions and tagged `edgar-prospectus`, with a `promoted` recovery audit. When a
candidate is poisoned (wrong company / stale / non-SEC / unreconciled), recovery
stays honestly `unavailable` with an explicit rejection trail — never a
fabricated zero.

**Real path.** After FIX-913 the deterministic prospectus parser is gone: the
bounded model call is the ONLY extraction step. This check drives the REAL model
tier — `recoverFinancialsExtract` (a real model call) → the hard validator
(`flows/analysis/lib/validate-financial-candidate.ts`) → the promote mapping
(`flows/analysis/lib/financial-candidate.ts`) — against the SPCX-shaped 424B4
fixture (`test/__fixtures__/spcx-prospectus.html`). It exercises the risky
transcribe-then-gate step in isolation; the single-flight runtime, the fetch
loop, the audit write, and the live statement-chain wiring are unchanged by the
reduction and are pinned by the vitest specs
`critical-financials-recovery.spec.ts` and `financials-recovery-spine.spec.ts`.
This goal proves "model + gate clears a real filing", not that plumbing.

**Model.** `openai/gpt-5.4-mini` (a small/fast model is appropriate — the task is
strict transcription of provided text). Requires an inference credential (Vercel
AI Gateway `AI_GATEWAY_API_KEY` or a provider key the resolver uses); a
listing-scope-only key will 401 on generate.

**Pass criterion.** The promote arm runs `RUNS = 5` times and passes **iff
`k === 5`** (unanimous); the check always prints `k/5` and exits non-zero on any
miss. Each promoting run yields statements with `incomeStatement.source ===
"edgar-prospectus"`, USD billions, and non-null revenue / operating income /
free cash flow. A `k < 5` result is reported, not silently retried — the
run-to-run stability of the model tier against the validator is the honest cost
signal of dropping the deterministic parser. Separately, a zero-model anti-game
arm feeds a hand-built poisoned candidate (a decade-stale period) to the pure
validator and asserts it is rejected with a non-empty reason list.

**Anti-game.** Promotion alone is not enough — the poisoned scenario must be
rejected, so the check fails if validation is a no-op that waves everything
through. Keeping the anti-game arm zero-model means the "validator is not a
no-op" guarantee stays deterministic even as the promote arm becomes
model-dependent.

**Run.** From `labs/trading-desk` (so the AI gateway package resolves):

```
cd labs/trading-desk && pnpm tsx ../../goals/trading-desk-financials/ipo-prospectus-recovery/run.mts
```

This runs by hand at finish / release, not in CI (real inference, ≤5 calls) — the
mocked CI specs cannot catch model flakiness, which is precisely this check's job.

## Verdict log

- 2026-07-20 — **PASS 5/5** (FIX-913, model tier alone, `openai/gpt-5.4-mini`).
  SPCX 424B4 fixture: revenue $8.5B, operating income $1.2B, FCF −$1.5B recovered
  and promoted (`edgar-prospectus`, USD billions) on all five runs; the
  decade-stale variant rejected on the stale-period gate. Stability note: the
  first cut of this check scored **0/5** because the model reliably emits a
  fabricated `freeCashFlow` the reconciliation gate rejects; making the extractor
  derive FCF downstream (never transcribe it — the deterministic tier's behavior)
  took it to a stable 5/5. See the extractor header docstring for why deriving is
  equivalent-or-safer than trusting a model-stated FCF.
- 2026-07-19 — **PASS** (pre-FIX-913, deterministic tier). SPCX 424B4 fixture:
  revenue $8.5B, operating income $1.2B, FCF −$1.5B recovered and promoted; the
  decade-stale variant rejected on the stale-period gate.
