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
 */
import type { Holding } from "./portfolio-schema";

/** Where a holding's resolved per-unit price came from — surfaced so the UI can
 *  label provenance honestly (a statement mark is not a live quote). */
export type PriceSource = "quote" | "par" | "statement" | "unavailable";

/** The type-resolved per-unit price for a holding. `price` is null whenever no
 *  honest price exists for the type (→ "—" downstream). */
export type ResolvedPrice = { price: number | null; priceSource: PriceSource };

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
  quote: { price: number | null } | undefined,
): ResolvedPrice {
  // Cash-class (incl. money_market) values at par $1.00 — a money-market fund /
  // cash equivalent is always worth its face. Checked first so an MMF never falls
  // through to the quote path.
  if (holding.assetClass === "cash" || holding.assetType === "money_market") {
    return { price: 1, priceSource: "par" };
  }

  if (holding.assetType === "bond" || holding.assetType === "option") {
    const mark =
      holding.attributes.kind === "bond" || holding.attributes.kind === "option"
        ? finiteOrNull(holding.attributes.markPrice)
        : null;
    return mark === null
      ? { price: null, priceSource: "unavailable" }
      : { price: mark, priceSource: "statement" };
  }

  if (
    holding.assetType === "equity" ||
    holding.assetType === "etf" ||
    holding.assetType === "mutual_fund" ||
    holding.assetType === "crypto"
  ) {
    const price = finiteOrNull(quote?.price ?? null);
    return price === null
      ? { price: null, priceSource: "unavailable" }
      : { price, priceSource: "quote" };
  }

  // `other` (and any unhandled type) has no honest price.
  return { price: null, priceSource: "unavailable" };
}

/**
 * Market value of a holding using the type-resolved price. For an option the
 * value multiplies by the contract `multiplier` (a per-contract mark covers
 * `multiplier` shares of the underlying). Null price → null value (the
 * real-money gate). Pure.
 */
export function holdingMarketValue(
  holding: Pick<Holding, "quantity" | "assetType" | "assetClass" | "attributes">,
  quote: { price: number | null } | undefined,
): number | null {
  const { price } = resolveHoldingPrice(holding, quote);
  if (price === null) return null;
  const multiplier =
    holding.attributes.kind === "option" ? holding.attributes.multiplier : 1;
  return holding.quantity * price * multiplier;
}
