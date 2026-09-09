# FIX-1066 — is the agreement denominator the panel, or the survivors?

**Question.** §7 claimed a safety property: *"the denominator never shrinks and only majority-side
terms are ever scaled down, so no gap flag anywhere can raise the agreement number."* The first
clause is a claim about `computeConvergence`. Is it true of it?

**No.** `convergence-math.ts:50` sets `n = verdicts.length` — the set that **reported**, not the set
that was **seated**. A lens that errors returns no verdict, is absent from `verdicts`, and shrinks
`n`.

## Run it

```
npx tsx spec-poc/FIX-1066-attendance/attendance.ts
```

Exits non-zero if any characterized behaviour has moved. Case A runs the **real shipped function**;
B and C model the spec's proposed aggregate (which does not exist yet) so the round-11 design could
be checked before it was built; D characterizes the tie-break.

## What it showed

| | Finding |
|---|---|
| **A** | **Live in shipped code, at today's four seats.** Three bullish lenses + a dissenting skeptic → `0.750 mixed`. The same run with that skeptic *crashing* → `1.000 convergent`. A lens failing is worth more to the headline than a lens surviving and disagreeing. |
| **B** | **The round-11 design would have made it worse.** At six seats, a lens that reports and flags a gap → `0.917 MIXED`; that same lens crashing → `1.000 CONVERGENT`, sizing floor `1.000`. A lens is better off crashing than admitting what it was missing. With the seated denominator: `0.917` and `0.833`, both MIXED, honest report ranked above the crash. |
| **C** | **Quorum does not catch it.** One lens erroring at six seats leaves four of five methodology verdicts against a floor of three — quorum passes comfortably and the panel still prints unanimity. |
| **D** | **The tie-break fails closed** — `counts[neutral] <= maxCount` by construction on a tie, so its agreement never exceeds the modal fraction. Measured: `0.000` vs modal `0.500`; `0.500` on the nose; `0.333` on the nose. This is why the tie-break could be deferred and the attendance hole could not. |

B's "seated" column is a **model of the fix**, not the fix. It is here so the ordering claim in
decision 9c and §10's inversion regression rest on arithmetic somebody ran.

Folded into decision 9c, §7's derived property, §9's above-quorum partial-panel rows, and §10's two
named attendance regressions. Throwaway — this directory dies with the spec PR (`spec-poc/README.md`).
