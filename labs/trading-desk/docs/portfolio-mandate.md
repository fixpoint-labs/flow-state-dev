# Portfolio mandate (Investment Policy Statement) — FIX-761

The **portfolio mandate** is the household's durable statement of intent: what
the book is aiming for, the mix it targets, the standing rules it must respect,
and how far it lets things drift before rebalancing. It is the classic
Investment Policy Statement (IPS), modelled as the structured, machine-usable
part of that document.

Before this, "balanced," "drift," and "rebalancing" had no reference point for
the desk — the analysis could size one position against the current portfolio
(FIX-728) and against a per-run risk-appetite dial (FIX-752), but nothing
recorded what the user was *aiming for*. The mandate is that reference point.

It is a documented, user-set policy — **not financial advice**, and not a
production IPS governance framework.

## Schema

The mandate leaf lives in `src/flows/portfolio/portfolio-mandate-schema.ts`
(browser-safe: zod only). One record per household, stored in the user-scoped
`portfolioMandateResource`.

| Field | Meaning |
| -- | -- |
| `label` | Free-text policy name (e.g. "Household IPS 2026"). |
| `objectives.riskTolerance` | `conservative` / `moderate` / `aggressive` — the stated posture. |
| `objectives.returnTargetPct` + `returnBasis` | Optional annual return target; if set, the basis (`nominal` / `real`) is required. |
| `targetAllocation[]` | Per `assetClass` (`equity` / `fixed_income` / `cash` / `crypto` / `alternative`) `targetPct`, with an optional `minPct` / `maxPct` corridor. Percentage points 0–100. |
| `constraints.maxPositionWeightPct` | HARD, at-purchase single-position cap. |
| `constraints.minCashPct` | ADVISORY minimum-cash floor. |
| `constraints.exclusions[]` | Canonical upper-case tickers the desk never adds to. |
| `rebalancing.bandType` + `bandWidthPct` | `relative` (fraction of target, default 0.2 = ±20%) or `absolute` (percentage points, default 5 = ±5pp). |
| `timeHorizon.years` | Stored primitive; the short / intermediate / long category is derived, never persisted. |
| `riskAppetite` | An opaque FIX-752 `MANDATE_PACK` id the household adopts as its appetite default. |

### Units

All weights are **percentage points** (0–100) — the same unit as the sizing
contract (`weightPct`, the PM's `targetWeightPct`). Never fractions 0–1.

### Validation

`validatePortfolioMandate(record)` returns a list of human-readable issues
(empty = valid). The editor runs it client-side before dispatch; the
`savePortfolioMandate` action re-runs it as a throwing trust-boundary guard.
It checks:

- each asset class appears at most once; `minPct ≤ targetPct ≤ maxPct`;
- with an explicit `cash` bucket, targets sum to exactly 100; with no `cash`
  bucket, targets sum to ≤ 100 and the remainder is the implicit cash target;
- corridors are feasible (the minimum weights, including the cash floor, cannot
  sum above 100);
- the cash target respects `minCashPct`;
- band width is in range for its type (`relative` ≤ 1, `absolute` ≤ 100);
- a return target names its basis;
- an explicit `riskAppetite` is not on the opposite extreme from the tolerance.

An **unknown** `riskAppetite` id is *not* a validation issue — it is a save-only
guard in the action, so a legacy record with a stale id degrades only its
appetite at seed (see below), never the whole IPS.

## Reconciliation with the per-run risk-appetite mandate (FIX-752)

There is **one policy object, not two.** The FIX-752 risk-appetite dials fold in
as the mandate's `riskAppetite` facet. The effective appetite for a run resolves
in precedence order:

```
run override (analyzeInput.riskMandate)
  → most-conservative selected-account default (account.riskMandate)
    → IPS household appetite (mandate.riskAppetite, else derived 1:1 from riskTolerance)
      → null (appetite-blind)
```

The IPS is the durable **policy of record**; the FIX-752 dials are the per-run
appetite layered over it. When a mandate sets only `riskTolerance`, the seed
derives the appetite 1:1 (`conservative → conservative-income`,
`moderate → balanced`, `aggressive → aggressive-growth`) so a normal IPS still
steers the FIX-752 gate. The account-level `account.riskMandate` is retained as a
per-account exception above the household default (asset location — a retirement
book vs a taxable book).

## How analysis reads it

`seedSession` (`orchestration/guards.ts`) reads the mandate from the user-scoped
resource, **re-validates** it (a business-invalid persisted record degrades to
mandate-blind), and freezes it onto `state.portfolioMandate`. It also freezes the
analyzed ticker's **household** weight (`state.householdTickerWeightPct`),
computed from the pre-scoping account read so a scoped run still measures a
household cap against the whole book.

The portfolio manager (P5) reads the mandate via the `portfolioMandate`
capability preset (`<portfolioMandate>`) and narrates `policyFit`
(`allocationRead`, `constraintRead`). The trader (P3) also sees it for sizing
awareness.

## PM gating (what is enforced vs advisory)

At PM-commit, `computePolicyGate` (`lib/policy-gate.ts`, pure) clamps the size
deterministically — derived from the frozen mandate and the household snapshot,
never trusted from the model:

- **HARD — max-position cap.** An at-purchase cap: `min(target, max(cap,
  householdWeight))`. An already-over-cap holding is never force-trimmed (the
  single-ticker run can't rebalance); a buy is capped from adding beyond it.
- **HARD — exclusion no-add.** An excluded name is clamped to the current
  household weight (`min(target, householdWeight)`) — so it is never added to
  (and never initiated when not held).
- **ADVISORY — minimum cash + allocation drift.** Surfaced to the PM as context;
  the single-ticker run cannot mechanically enforce a portfolio cash floor or
  rebalance to a target, so the PM narrates rather than fabricating a
  portfolio-level action.

All clamps are **downward-only** and never touch `finalRating` (the FIX-715 /
FIX-752 orthogonality). When a held name can't be priced, the household weight is
unknown and the clamp is **skipped** (never coerced to 0 — that would fabricate a
full exit or a forced trim); the PM narrates that the cap couldn't be enforced
without a price.

The commit records a derived `policyVerdict`
(`within-policy` / `capped` / `excluded` / `no-mandate`) plus the clamp flags on
the decision snapshot and the headless RunSummary — the read path the
`policy-steers-sizing` goal check uses.

## Editing

The editor lives in the Portfolio view (`components/portfolio/mandate-dialog.tsx`
+ `mandate-form.ts` + `use-portfolio-mandate.ts`). It reads the mandate live via
the resource and writes through `savePortfolioMandate` / `clearPortfolioMandate`.
A summary chip on the Portfolio toolbar shows the active mandate at a glance.

## What it deliberately doesn't do (v1)

- **No drift measurement / health view** — the mandate *defines* the target
  allocation + bands; measuring actual-vs-target drift is FIX-762, which reads
  this object.
- **No thesis/mandate review loop** — flagging violations over time is FIX-763.
- **No per-strategy sleeves** — v1 is one flat household mandate (FIX-771 later).
- **No rebalancing execution** — the desk analyzes one ticker at a time and never
  produces a sell-to-rebalance plan.
- **No custom / sector-level target buckets** — v1 targets the existing
  `assetClass` enum only.
- Target allocation is a **household** target (asset location); per-account
  appetite exceptions are retained via `account.riskMandate`.
