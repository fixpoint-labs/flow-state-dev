---
---

Trading Desk: portfolio-aware analysis + an investor-lens conviction signal in
the private `@flow-state-dev/trading-desk` example.

A run can now carry the live portfolio. The trader and the Portfolio Manager see
a `<portfolioContext>` block — total NAV, the existing position and current
weight in this name, each account's cash and tax type — and the PM emits a
**portfolio-fit verdict**: `{ action ∈ initiate|add|trim|exit|hold,
targetWeightPct, sizingRationale, concentrationRisk, suggestedAccount,
convictionBasis }`, sized against real constraints. The portfolio snapshot is
built client-side at dispatch from the stored accounts × live quotes; a holding
with no live price degrades to a null market value and weight (never fabricated),
and the snapshot is labelled as-of, not live. The suggested account is validated
against the real account list (a hallucinated label is dropped).

After Phase 2, a configurable pack of four documented-methodology investor lenses
(Quality-Value, Cycle/Risk, Macro-Reflexive, Forensic-Skeptic) re-reads the same
evidence and emits independent verdicts. A deterministic convergence summary
(convergent / mixed / divergent + agreement score) is computed in a handler — not
by a model — and feeds the PM as a sizing-conviction input: convergence permits
the PM's sizing, divergence pulls it down. Convergence is framed as robustness
across philosophies, never a probability of being correct, and it only ever
adjusts sizing down. The lens pack is cost-gated to the `full` preset.

Documented methodology, not financial advice. Persistence remains the dev-only
filesystem store and session reads are unauthenticated by ownership — known,
documented gaps, not production durability.
