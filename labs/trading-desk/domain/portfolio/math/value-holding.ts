/**
 * Pure, browser-safe per-type valuation rule for a holding (FIX-773 Slice C).
 *
 * This is the SINGLE place the "value each holding by its type" rule lives, so
 * the holdings table (UI) and `build-portfolio-context.ts` (the analysis snapshot
 * builder) value identically — a bond never values one way in the pane and
 * another in the NAV. It imports ONLY the `Holding` type (no `@flow-state-dev/
 * core`, no IO), so it runs in the client and the server action alike and is
 * unit-testable in isolation (BP-019: leaf module, no cycles).
 *
 * REAL-MONEY DISCIPLINE (non-negotiable): a type with no resolvable price returns
 * `{ price: null, priceSource: "unavailable" }`. A null price → null market value
 * downstream → the existing "—" rendering. We NEVER fabricate a price.
 *
 * The owner's per-type rules:
 *  - equity / etf / mutual_fund / crypto → the live quote (`"quote"`, or
 *    `"unavailable"` when the quote is null/absent);
 *  - money_market, OR any holding whose `assetClass` is `cash` → par $1.00
 *    (`"par"`) — money-market funds and cash equivalents value at par;
 *  - bond / option → the carried statement mark (`attributes.markPrice`),
 *    `"statement"` when present else `"unavailable"`;
 *  - other → `"unavailable"`.
 *
 * `markPrice` is the per-UNIT statement value (value ÷ quantity, computed at
 * import), so market value is simply `quantity × markPrice` for every type — no
 * contract multiplier or quoting-convention factor is re-applied here (the
 * statement's own value already baked those in). This is what keeps a
 * percent-of-par bond and a per-contract-vs-per-share option from valuing 100×
 * off.
 */
import type { AssetClass, AssetType, Holding } from "../schema/portfolio-schema";

/** Asset types valued from a LIVE quote (as opposed to a carried statement mark
 *  or par). The Portfolio pane fetches quotes only for these — a bond / option /
 *  cash / money-market symbol is valued without a quote, so sending it through
 *  the live provider path just burns retries and can surface a misleading quote
 *  (e.g. `CASH` = Pathward). */
export function usesLiveQuote(assetType: AssetType): boolean {
  return (
    assetType === "equity" ||
    assetType === "etf" ||
    assetType === "mutual_fund" ||
    assetType === "crypto"
  );
}

/** Where a holding's resolved per-unit price came from — surfaced so the UI can
 *  label provenance honestly (a statement mark is not a live quote). */
export type PriceSource = "quote" | "par" | "statement" | "unavailable";

/** The type-resolved per-unit price for a holding. `price` is null whenever no
 *  honest price exists for the type (→ "—" downstream). `asOf` (FIX-823) is the
 *  quote's own market time for a quote-sourced price, so a consumer can label
 *  PER-HOLDING staleness (AAPL fresh, TSLA 3 days old); it is null for par
 *  (timeless — $1.00 is always current), for a bare statement mark (no captured
 *  statement date in v1 — provenance `"statement"` already signals "not live"),
 *  and for `unavailable`. */
export type ResolvedPrice = {
  price: number | null;
  priceSource: PriceSource;
  asOf: string | null;
};

/** A finite number, or null. Guards against `NaN`/`Infinity` sneaking in as a
 *  "price". */
function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Resolve a holding's per-unit price BY TYPE (see the module rules). `quote` is
 * the live quote for the holding's ticker (`undefined` when none was fetched);
 * only `equity`/`etf`/`mutual_fund`/`crypto` consult it. Pure.
 */
export function resolveHoldingPrice(
  holding: Pick<Holding, "assetType" | "assetClass" | "attributes">,
  quote: { price: number | null; asOf?: string | null } | undefined,
): ResolvedPrice {
  // Cash-class (incl. money_market) values at par $1.00 — a money-market fund /
  // cash equivalent is always worth its face. Checked first so an MMF never falls
  // through to the quote path. Par is timeless, so `asOf: null` is honest.
  if (holding.assetClass === "cash" || holding.assetType === "money_market") {
    return { price: 1, priceSource: "par", asOf: null };
  }

  if (holding.assetType === "bond" || holding.assetType === "option") {
    const mark =
      holding.attributes.kind === "bond" || holding.attributes.kind === "option"
        ? finiteOrNull(holding.attributes.markPrice)
        : null;
    // A bare statement mark carries no captured date in v1 (`asOf: null`); the
    // `"statement"` provenance already signals "not a live quote". Capturing a
    // per-holding statement date is a deferred follow-up (FIX-823 non-goal).
    return mark === null
      ? { price: null, priceSource: "unavailable", asOf: null }
      : { price: mark, priceSource: "statement", asOf: null };
  }

  if (
    holding.assetType === "equity" ||
    holding.assetType === "etf" ||
    holding.assetType === "mutual_fund" ||
    holding.assetType === "crypto"
  ) {
    const price = finiteOrNull(quote?.price ?? null);
    // Thread the quote's own market time so consumers can label per-holding
    // staleness (FIX-823). Null when the quote is absent/unpriced.
    return price === null
      ? { price: null, priceSource: "unavailable", asOf: null }
      : { price, priceSource: "quote", asOf: quote?.asOf ?? null };
  }

  // `other` (and any unhandled type) has no honest price.
  return { price: null, priceSource: "unavailable", asOf: null };
}

/**
 * Market value of a holding using the type-resolved per-unit price/value:
 * `quantity × price`. For bond/option the price is the carried per-unit statement
 * value, so no contract multiplier is re-applied (see the module doc). Null price
 * → null value (the real-money gate). Pure.
 */
export function holdingMarketValue(
  holding: Pick<Holding, "quantity" | "assetType" | "assetClass" | "attributes">,
  quote: { price: number | null } | undefined,
): number | null {
  const { price } = resolveHoldingPrice(holding, quote);
  if (price === null) return null;
  return holding.quantity * price;
}

/**
 * Unrealized P/L of a holding, consistent with {@link holdingMarketValue}:
 * `(price − costBasis) × quantity`, where `price` is the type-resolved per-unit
 * value. Null when the price or the cost basis is unknown — never fabricated from
 * a partial input. Pure.
 */
export function holdingUnrealizedPL(
  holding: Pick<Holding, "quantity" | "costBasis" | "assetType" | "assetClass" | "attributes">,
  quote: { price: number | null } | undefined,
): number | null {
  const { price } = resolveHoldingPrice(holding, quote);
  const cost = finiteOrNull(holding.costBasis);
  if (price === null || cost === null) return null;
  return (price - cost) * holding.quantity;
}

/** One ticker's classification, resolved from its DOMINANT (largest
 *  `|marketValue|`) row. */
export type DominantClassification = { assetClass: AssetClass; assetType: AssetType };

/**
 * For each ticker across a flat holdings list (possibly spanning multiple
 * accounts), resolve the `{ assetClass, assetType }` of the row with the
 * LARGEST `|marketValue|` — the deterministic tie-break `portfolio-health.ts`'s
 * ticker-merge Pass 1 uses so a merged line's class/type is decided by the
 * dominant lot, not by iteration order or an "any row" test, when two accounts
 * (or a single manual reclassification) disagree on a symbol's type. An
 * `inconsistent_history` row never enters money math, so it is excluded from
 * the comparison — but the FIRST row encountered for a ticker still seeds the
 * entry's classification (mass `-1`, beaten by any comparable row's mass,
 * including an unpriced row's `0`) so a ticker whose every row is excluded
 * still resolves to SOME classification rather than none (mirrors Pass 1's own
 * entry-creation-time default).
 *
 * Extracted so a caller that needs "this ticker's classification" OUTSIDE
 * `summarizePortfolioHealth`'s own merge (e.g. `excludeFixedIncomeFromProfileMap`,
 * which runs BEFORE the leaf and cannot reach into its internal `merged` map)
 * uses the SAME rule instead of an independently-drifting one — two
 * implementations of "which lot wins" is exactly the kind of duplicated
 * judgment call this codebase's `distill-lessons` process flags (Codex review,
 * FIX-801 sub-PR c round 14: `excludeFixedIncomeFromProfileMap` used to
 * suppress on ANY row being `fixed_income`, which let a tiny manually-
 * reclassified lot suppress attribution for a much larger equity-classified
 * position in the same ticker elsewhere in the household — disagreeing with
 * what `summarizePortfolioHealth` itself would classify that ticker as).
 */
export function dominantClassificationByTicker(
  holdings: ReadonlyArray<
    Pick<Holding, "ticker" | "assetClass" | "assetType" | "quantity" | "attributes" | "dataQuality">
  >,
  quotes: ReadonlyMap<string, { price: number | null }>,
): Map<string, DominantClassification> {
  const dominant = new Map<string, DominantClassification & { mass: number }>();
  for (const h of holdings) {
    const key = h.ticker.toUpperCase();
    let current = dominant.get(key);
    if (current === undefined) {
      current = { assetClass: h.assetClass, assetType: h.assetType, mass: -1 };
      dominant.set(key, current);
    }
    if (h.dataQuality === "inconsistent_history") continue;
    const mv = holdingMarketValue(h, quotes.get(key));
    const mass = mv === null ? 0 : Math.abs(mv);
    if (mass > current.mass) {
      current.assetClass = h.assetClass;
      current.assetType = h.assetType;
      current.mass = mass;
    }
  }
  return new Map(
    [...dominant].map(([ticker, { assetClass, assetType }]) => [ticker, { assetClass, assetType }]),
  );
}
