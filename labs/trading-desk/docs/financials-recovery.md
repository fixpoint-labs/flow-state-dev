# Critical-financials recovery (IPO prospectus fallback)

When companyfacts and Yahoo both miss the valuation-critical statements for a
US name, the desk does not immediately mark revenue, operating income, and free
cash flow "unavailable". A newly listed issuer has audited financials in its IPO
prospectus (an S-1 or 424B* primary document) long before those numbers show up
in periodic XBRL, and companyfacts only aggregates periodic forms. So a fresh
IPO can have authoritative public financials while the structured chain records
a total void. This is the failure the SPCX report exposed: SpaceX had audited
statements in its prospectus, but the desk declared revenue, operating income,
and free cash flow unavailable.

"Unavailable" should mean every safe recovery path was tried — not that the
first structured provider came up empty. This doc explains the recovery ladder,
what it will and won't promote, its cost behavior, and the audit trail it leaves.

## Recovery hierarchy

The three statement tools (`get_income_statement`, `get_balance_sheet`,
`get_cashflow`) resolve the subject's statements in this order:

| Tier | Source | Cost |
|------|--------|------|
| 1 | SEC EDGAR companyfacts (periodic XBRL) | keyless |
| 2 | Yahoo `fundamentals-timeseries` | keyless |
| 3 | **Registration / prospectus filings** (S-1, 424B*, F-1), deterministic table extract | keyless |
| 4 | **Bounded LLM transcription** over the same prospectus documents | one model call |
| — | Honest `unavailable` + `recoveryAudit` | — |

The load-bearing new branch is **sparse companyfacts**: an HTTP-success
companyfacts payload with null revenue / operating income / FCF used to stick as
a terminal `source: "edgar"` result. That mislabels a recoverable void as "the
authoritative source answered". Tiers 1–2 now treat a payload whose critical
fields are all null as a **miss**, so the chain falls through to recovery instead
of freezing on an empty shell.

Recovery runs only for the **subject** ticker (the one the session is keyed to).
A peer or benchmark probe never triggers a subject spine write. It is
**single-flight**: the three statement tools fan out in parallel, but they share
one recovery attempt per run.

`investigate` (the Phase 1 search/fetch affordance) does NOT promote numbers into
the spine. It stays citation-only memo color; recovery is the only path that
writes typed statements.

## Promote gates

A prospectus-derived candidate — deterministic or LLM — may only update the
spine if it clears every hard gate (`validate-financial-candidate.ts`):

- **Identity** — the filing's CIK matches the CIK resolved for the ticker, and
  the conformed company name agrees. Rejects a wrong-company / recycled-ticker
  document.
- **Period** — a fiscal period end that is present, not in the future, and not
  decades stale versus the run date.
- **Source authority** — an SEC Archives URL. Open-web statements are rejected
  (issuer-IR URLs are context only, never the promoted provenance).
- **Scale** — parsed explicitly from the table header ("in thousands" /
  "in millions"), never inferred from a number's magnitude. An ambiguous scale
  is rejected rather than guessed.
- **Currency** — USD only in v1.
- **Completeness** — at least revenue, operating income, and free cash flow
  (or operating cash flow + capex to derive it).
- **Reconciliation** — when operating cash flow, capex, and a stated FCF are all
  present, `FCF ≈ operating − |capex|` within tolerance (the larger of $1M
  absolute and 1% relative). An unreconciled triple is rejected.

A passing candidate is normalized to **USD billions** and tagged
`source: "edgar-prospectus"`, matching the companyfacts / Yahoo mappers and the
DCF consumer. Fields the prospectus does not disclose stay `null` — never
zero-filled, never magnitude-guessed.

## Cost behavior

Tiers 1–3 are keyless and free. Tier 4 (the bounded LLM extract) is a
**correctness path, not analyst color**, so — unlike `investigate` — it is NOT
skipped on the `fast` preset: one model call may fire on `fast` after the
deterministic tier misses. It is hard-bounded: **≤1** model invocation, **≤3**
document fetches, an SEC-first URL set, and no open-ended research loop. The
deterministic tier is always tried first, so a cleanly tabulated prospectus
costs zero model spend.

Known limitation: the bounded recovery model call is a direct `model.generate`
(not a generator block), so its token usage is not yet folded into the
framework's per-action cost accounting (`block_trace.modelUsage`). The call is
capped at one invocation, but its tokens are currently invisible to the token
budget — surfacing them needs a framework usage seam (follow-up).

## Audit trail

Every recovery attempt writes `financialsData.recoveryAudit` exactly once (the
recovery runtime is the sole writer):

```ts
{
  attempted: boolean,
  outcome: "promoted" | "rejected" | "no-candidates" | "extract-failed",
  formsTried: string[],      // e.g. ["424B4", "S-1/A"]
  urls: string[],            // SEC documents fetched
  rejectionReasons: string[],// why a candidate failed the gates
  recoveredSource?: "edgar-prospectus",
}
```

The audit is written only when recovery RUNS; when companyfacts or Yahoo
answered, recovery never runs and the audit is simply **absent** (absence is the
"skipped" signal — there is no explicit skipped record). So a downstream
evidence-sufficiency gate (FIX-781) can tell an honest exhaustion
(`outcome: "rejected"` with reasons) from an untried path. The
recovered statements carry the `edgar-prospectus` source tag; registration
filings are also surfaced on `get_sec_filings` in a sibling `registrationFilings`
array (kept apart from the periodic MD&A / red-flag extractors).

## SPCX regression fixture

`test/__fixtures__/spcx-prospectus.html` is a synthetic 424B4 shaped on the SPCX
failure: sparse companyfacts, no Yahoo statements, audited financials only in the
prospectus (revenue $8.5B, operating income $1.2B, operating cash flow $2.0B,
capex $3.5B → FCF −$1.5B, cash $4.0B, debt $1.0B, "in thousands").

- `prospectus-financials.spec.ts` pins the deterministic extract + validation +
  promote mapping, and the hard-reject table.
- `critical-financials-recovery.spec.ts` pins the runtime: single-flight,
  promote, no-candidates, stale-reject, and the LLM fallback.
- `financials-recovery-spine.spec.ts` drives the three statement tools live
  (providers mocked to the SPCX shape) and asserts the prospectus statements
  land on the spine, tagged `edgar-prospectus`, with a `promoted` audit — the
  end-to-end regression that a newly listed issuer is not mislabeled as having no
  primary financial statements.
- `goals/trading-desk-financials/ipo-prospectus-recovery/` is the machine-checked
  goal (promote + honest-reject), zero models, zero network.

`fixtures/SPCX/2026-05-06/` carries the recovered statement shape for fixture
replay (fixture mode does not run live recovery — it replays the recorded
result).

## What this is not

- Not open-web scraping into `financialsData` — SEC Archives only.
- Not a replacement for companyfacts when periodic XBRL exists (that stays tier 1).
- Not a `fixture`-mode fallback on a live miss (BP-020: a live miss stays a
  miss; recovery is a live/record tier, not a fixture read).
- Not multi-currency in v1 (non-USD candidates are rejected).
