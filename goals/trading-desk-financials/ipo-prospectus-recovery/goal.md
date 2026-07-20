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

**Real path.** The check drives the REAL recovery logic — the deterministic
prospectus extractor (`lib/providers/prospectus-financials.ts`), the hard
validator (`flows/analysis/lib/validate-financial-candidate.ts`), and the
promote mapping (`flows/analysis/lib/financial-candidate.ts`) — against the
SPCX-shaped 424B4 fixture (`test/__fixtures__/spcx-prospectus.html`). Zero
models, zero network: the recovery ladder's deterministic tier is the correctness
path this goal pins. (The single-flight runtime, the bounded LLM fallback tier,
and the live statement-chain wiring are pinned by the vitest specs
`critical-financials-recovery.spec.ts` and `financials-recovery-spine.spec.ts`.)

**Pass criterion.** (1) The extracted candidate promotes to statements with
`incomeStatement.source === "edgar-prospectus"`; (2) revenue, operating income,
and free cash flow (or operating + capex) are non-null in USD billions;
(3) the validator accepts it. A second, poisoned candidate (a decade-stale
period) is REJECTED with a non-empty reason list.

**Anti-game.** Promotion alone is not enough — the poisoned scenario must be
rejected, so the check fails if validation is a no-op that waves everything
through. The reconciliation and scale checks mean a fabricated or mis-scaled
number cannot pass.

**Run.**

```
pnpm tsx goals/trading-desk-financials/ipo-prospectus-recovery/run.mts
```

## Verdict log

- 2026-07-19 — **PASS**. SPCX 424B4 fixture: revenue $8.5B, operating income
  $1.2B, FCF −$1.5B recovered and promoted (`edgar-prospectus`, USD billions);
  the decade-stale variant rejected on the stale-period gate.
