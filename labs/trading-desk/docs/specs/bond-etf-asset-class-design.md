# Design: Correct asset class for bond ETFs

**Status:** Implemented
**Date:** 2026-07-07
**Scope:** `labs/trading-desk`
**Depends on:** FIX-773 asset taxonomy (already landed: `asset_class` / `asset_type` columns + `classify-instrument.ts`)

> **Scope note (revised during implementation).** The first cut targeted only the
> CSV/PDF import path + an allocation view ("Tier 0"). Testing against a real
> portfolio revealed it was **QFX/transaction-sourced**, and the ledger
> position-materialization path never classified — so classification never reached
> those holdings, and a curated list alone missed ~60% of a real bond sleeve. Scope
> expanded to: classify at materialization, a much broader list, and a durable
> user-editable class override. The original narrow design is preserved below the
> `---` for the reasoning trail; the **Implemented design** section is what shipped.

## Implemented design

1. **Classifier** (`classify-instrument.ts`) — `KNOWN_BOND_ETFS` (a broad curated
   set across treasury / TIPS / corporate IG + HY / floating-rate / MBS / muni /
   intl categories) + `isKnownBondEtf()`. A match short-circuits to
   `{ fixed_income, etf, {kind:none} }` **ahead of the type hint** (a stale
   `equity`/`etf` hint can't block it). `assetType` stays `etf` so valuation keeps
   the live quote.
2. **Auto-classify the transaction path** (`repository.ts` → `materializePositions`) —
   classifies each ticker on INSERT, and on CONFLICT reclassifies **only when
   `asset_class_manual = false`** (a SQL `CASE`). Existing `equity` rows self-heal
   on the next import; manual overrides are never clobbered.
3. **Provenance column** (`schema.ts` + migration `0003`) — `asset_class_manual`
   boolean, default `false`.
4. **Manual override** — `repository.setHoldingAssetClass()` (household-scoped,
   sets class + `manual = true`) → `PATCH /api/portfolio/holdings` → a per-row
   asset-class `<select>` in the holdings table. Sets the allocation class only;
   `assetType`/valuation untouched.
5. **Allocation view** — `allocationByClass()` (pure) + a breakdown line by NAV in
   the portfolio pane.

**Known limitation:** the CSV/PDF `upsertHoldings` path still overwrites class on
re-import unconditionally (FIX-773's load-bearing behavior) — a manual override is
durable against QFX re-imports (the real workflow) but not against an explicit
holdings CSV re-import. Documented, not fixed (no producer uses that path here).

---

---

## Summary (plain language)

A portfolio made of bond ETFs (BND, AGG, TLT, …) currently reads as 100% equity.
The desk already has the right data model — every holding carries both an
`assetType` (how it trades) and an `assetClass` (its economic exposure) — but two
gaps make bond ETFs look like stocks:

1. The classifier can't tell a bond ETF from a stock by ticker shape, so it falls
   through to `equity` / `equity`.
2. Nothing in the UI groups holdings by `assetClass`, so even a correctly-tagged
   portfolio wouldn't *show* a stocks-vs-bonds split.

This change fixes both with a curated bond-ETF list and a small allocation
breakdown view. It deliberately does **not** attempt ETF look-through, sector
tagging, or tax tracking — those are separately-scoped, higher-cost tiers.

---

## Problem

`classifyInstrument()` derives asset class from symbol shape. `BND` and `AAPL`
are indistinguishable as strings, so both land as `assetClass: "equity"`
([classify-instrument.ts:234](../../src/domain/portfolio/math/classify-instrument.ts#L234)).
Even an explicit `assetType: etf` import hint hardcodes `assetClass: "equity"`
([classify-instrument.ts:205-209](../../src/domain/portfolio/math/classify-instrument.ts#L205-L209)) —
the code comment already flags this as a known v1 gap.

Separately, `assetClass` is persisted and validated but has **no visible
consumer**: there is no allocation/exposure view, and the analysis context
(`build-portfolio-context.ts`) never reads it. The only surface that reflects
classification is the per-row type chip in the holdings table (`EQ` / `BOND` /
`MMF`). So classifying correctly, on its own, would only flip that chip `EQ`→`ETF`
and would not surface the split the user actually wants.

---

## Scope

**In scope (Tier 0):**
- Bond ETFs classify as `fixed_income` (class) while remaining `etf` (type).
- A portfolio allocation breakdown by asset class becomes visible near the NAV total.

**Explicitly out of scope (deferred, with reasons):**

| Deferred | Why not now |
|----------|-------------|
| ETF sector/category label (Tier 1) | Needs a classification data source; enriches analysis but isn't required for a correct allocation split. |
| ETF look-through — underlying holdings/weights (Tier 2) | This is FIX-801. Needs a real holdings provider. Large. |
| Tax tracking (Tier 3) | A separate subsystem on the FIX-774 ledger. Independent decision. |
| Analysis gate / context changes | Analysis is per-ticker today; there is no portfolio-level analysis consumer to feed asset class into. The per-ticker `checkAssetTypeSupported` gate stays as-is. |
| Decoupled `assetClass` import-hint column | No producer emits it yet; adding it now is speculative surface (BP-038). Add when a class-bearing import exists. |

---

## Design

### Piece 1 — Data correctness (the classifier)

File: [`src/domain/portfolio/math/classify-instrument.ts`](../../src/domain/portfolio/math/classify-instrument.ts)

1. **`KNOWN_BOND_ETFS`** — a curated `Set<string>` of well-known US bond-ETF
   tickers (normalized upper-case). Core lineup, explicitly incomplete by design:

   ```
   BND BNDX BNDW BIV BSV BLV VCIT VCSH VGIT VGSH VGLT VMBS VTIP EDV   (Vanguard)
   AGG TLT IEF SHY IEI SHV LQD HYG TIP MBB GOVT EMB USIG GOVZ         (iShares)
   BIL JNK SPTL SPAB SPTI SPSB                                        (SPDR)
   SCHZ SCHO SCHR SCHP                                                (Schwab)
   BOND                                                               (PIMCO)
   ```

2. **`isKnownBondEtf(symbol: string): boolean`** — `KNOWN_BOND_ETFS.has(norm)`.
   Single source of truth.

3. **`BOND_ETF: Classification`** — `{ assetClass: "fixed_income", assetType:
   "etf", attributes: { kind: "none" } }`.

4. **Wiring** — a short-circuit at the top of `classifyInstrument()`, immediately
   after `normalized` is computed and **before** the hint block:

   ```ts
   if (isKnownBondEtf(normalized)) return BOND_ETF;
   ```

   Placing it ahead of the hint block is deliberate: an `assetType: etf` (or
   `equity`) hint doesn't reveal the class, so the curated set is authoritative
   for known bond ETFs. Bond-ETF tickers never collide with CUSIP (9 chars),
   OCC option, money-market (`XX`+$1), or crypto (`-USD`) shapes, so the early
   return is safe.

**Key invariant:** `assetType` stays `etf`, not `bond`. A bond ETF has a live
quote; keeping it `etf` means `usesLiveQuote` still prices it from the market
([value-holding.ts:38](../../src/domain/portfolio/math/value-holding.ts#L38)). Only the
*class* changes. (Classifying it as `bond` would wrongly route it to the carried
statement mark and show `—`.)

**Unknown bond ETFs** (not in the set) keep today's behavior — they classify as
`equity`. No warning, no flag. Coverage is extended by adding tickers to the set.

### Piece 2 — Make it visible (allocation-by-class rollup)

File (pure): [`components/portfolio/portfolio-format.ts`](../../components/portfolio/portfolio-format.ts)

- **`allocationByClass(holdings, marketValues): AllocationSlice[]`** where
  `AllocationSlice = { assetClass: AssetClass; value: number; weightPct: number }`.
  Groups the already-computed per-holding market values by `assetClass`, sums each
  bucket, and divides by total NAV for the weight. Rows with no resolvable price
  (`—`) contribute 0. Pure, no IO — mirrors the existing derived-money-math
  functions in this file.

File (render): [`components/portfolio/portfolio-pane.tsx`](../../components/portfolio/portfolio-pane.tsx)

- A compact breakdown rendered near the NAV total (e.g. `Fixed income 62% ·
  Equity 30% · Cash 8%`), computed in `useMemo` over the same holdings + quotes
  the pane already has (BP-010). Never stored — it depends on live quotes and the
  whole-portfolio total, exactly like the NAV figure beside it.

---

## Testing

| Test | File | Asserts |
|------|------|---------|
| Bond ETFs → `fixed_income`/`etf` | `test/classify-instrument.spec.ts` | BND, AGG, TLT classify `fixed_income`/`etf` with `{kind:"none"}` |
| Equity control unaffected | same | AAPL stays `equity`/`equity` |
| Curated set beats a stale hint | same | `classifyInstrument("BND", { assetTypeHint: "equity" })` → `fixed_income` |
| Valuation unchanged | same / `value-holding.spec.ts` | a bond ETF still `usesLiveQuote` (assetType `etf`) |
| Allocation rollup | `test/portfolio-format.spec.ts` (or existing) | mixed portfolio → correct per-class value + weight; `—`-priced rows contribute 0; weights sum to 100% |

Verification evidence (BP-003): the classifier + rollup specs above; a manual
import of a bond-ETF CSV showing the breakdown line render.

---

## Cost

| Piece | File | Prod LOC | Test LOC |
|-------|------|---------:|---------:|
| Curated set + helper + constant + wiring | classify-instrument.ts | ~30 | ~35 |
| `allocationByClass` (pure) | portfolio-format.ts | ~25 | ~30 |
| Breakdown render + `useMemo` | portfolio-pane.tsx | ~35 | — |
| **Total** | | **~90** | **~65** |

No schema migration (columns exist), no new dependencies, no data provider.

---

## Follow-ups (not this change)

- **Tier 1** — ETF sector/category label from a classification source.
- **Tier 2 / FIX-801** — ETF look-through (underlying holdings + weights).
- **Tier 3** — tax tracking on the FIX-774 ledger.
- Thread `assetClass` into a portfolio-level analysis context once such a
  consumer exists.
- Decoupled `assetClass` import-hint column once a class-bearing import exists.
