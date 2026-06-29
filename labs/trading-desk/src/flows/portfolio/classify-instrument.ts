/**
 * Pure, browser-safe instrument classifier — the SINGLE source of asset
 * classification for portfolio import.
 *
 * It imports ONLY `zod`-backed types/values from `portfolio-schema.ts` (no
 * `@flow-state-dev/core`, no IO), so it runs identically in the client (the
 * import dialog's live preview) and the server action, and is unit-testable in
 * isolation (BP-019: leaf module, no cycles). BOTH importers (CSV and PDF) call
 * it, so a statement row never silently changes class depending on which path it
 * arrived through.
 *
 * The contract is a CLASSIFIER, not a filter: every non-empty symbol resolves to
 * a typed `{ assetClass, assetType, attributes }`. An unrecognizable symbol
 * becomes a VISIBLE `other`/`alternative` row, never a dropped position — the
 * importers no longer drop bonds / money-market funds / cash; they preserve them
 * as typed holdings.
 */
import type {
  AssetClass,
  AssetType,
  HoldingAttributes,
} from "./portfolio-schema";
import { assetTypeSchema } from "./portfolio-schema";

/** The classifier result — the three taxonomy fields a `CanonicalRow` carries. */
export type Classification = {
  assetClass: AssetClass;
  assetType: AssetType;
  attributes: HoldingAttributes;
};

/** Pure cash placeholders (compared against the normalized symbol). Mirrors the
 *  `CASH_LIKE_TICKERS` set the PDF importer dropped on before this slice. */
const CASH_LIKE_SYMBOLS = new Set(["CASH", "USD"]);

/** Money-market fund signal — mirrors `looksLikeMoneyMarket` in portfolio-pdf.ts:
 *  symbol ends in "XX" AND the per-share price sits at ~$1.00. Both signals are
 *  required (suffix alone could catch a real XX equity; a $1 price alone could be
 *  a penny stock). With no price the fund cannot be confirmed → not a match. */
function looksLikeMoneyMarket(symbol: string, price: number | null | undefined): boolean {
  if (!/XX$/.test(symbol)) return false;
  if (price === null || price === undefined) return false;
  return Math.abs(price - 1) <= 0.02;
}

/** A CUSIP is 9 alphanumerics with at least one digit — mirrors `looksLikeCusip`
 *  in portfolio-pdf.ts. Checked AFTER the OCC-option rule (an OCC compact symbol
 *  also contains digits) so a real CUSIP like `912828YK0` lands as a bond. */
function looksLikeCusip(symbol: string): boolean {
  return /^[A-Z0-9]{9}$/.test(symbol) && /[0-9]/.test(symbol);
}

/** A carried statement mark is valid only when it is a finite POSITIVE price.
 *  A bond/option mark cannot be negative or zero, so a typo / OCR error like
 *  `-98.5` or `0` becomes a null mark (the row then shows "—") rather than a
 *  value that would subtract the holding from NAV — the same real-money gate
 *  cost-basis import already applies. */
function validMarkPrice(price: number | null | undefined): number | null {
  return typeof price === "number" && Number.isFinite(price) && price > 0 ? price : null;
}

/** Crypto USD pair, e.g. `BTC-USD` / `ETH-USD`. */
function looksLikeCryptoPair(symbol: string): boolean {
  return /^[A-Z0-9]{2,10}-USD$/.test(symbol);
}

/** A valid equity ticker — same shape the CSV/PDF importers accept as a symbol. */
function looksLikeEquityTicker(symbol: string): boolean {
  return /^[A-Z0-9.\-]{1,12}$/.test(symbol);
}

/** The option attributes parsed from an OCC/OSI symbol, or null if it does not
 *  parse. Accepts both the 21-char space-padded canonical form and a compact
 *  `ROOT + YYMMDD + C|P + 8-digit strike` form. The root is the leading alpha
 *  run; the strike is the 8-digit field / 1000; the year is `20YY`. A symbol that
 *  superficially looks like an option but whose date won't parse returns null
 *  (the caller falls through to the next rule rather than throwing). */
function parseOccOption(
  symbol: string,
  markPrice: number | null | undefined,
): Extract<HoldingAttributes, { kind: "option" }> | null {
  // ROOT is the leading alpha run (space-padding in the canonical form is
  // collapsed by the trim/upper-case the caller already applied, but the root may
  // still be followed by spaces in the 21-char form — match an alpha run, then
  // optional spaces, then the OCC numeric tail).
  const match = /^([A-Z]{1,6}) *(\d{6})([CP])(\d{8})$/.exec(symbol);
  if (match === null) return null;

  const [, underlying, yymmdd, rightChar, strikeRaw] = match;
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const month = Number(mm);
  const day = Number(dd);
  // Reject impossible calendar fields — fall through rather than emit a bad date.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const expiry = `20${yy}-${mm}-${dd}`;
  const strike = Number(strikeRaw) / 1000;
  return {
    kind: "option",
    underlying,
    strike,
    expiry,
    right: rightChar === "C" ? "call" : "put",
    multiplier: 100,
    // The carried statement mark (FIX-773 Slice C): a finite positive price →
    // stamped, else null. An option is valued at this mark × multiplier (no quote).
    markPrice: validMarkPrice(markPrice),
  };
}

/** Whether a symbol is an OCC/OSI option (the 18–21-char form the equity ticker
 *  regex rejects). Exported so the CSV importer can widen its acceptance gate to
 *  let an option row through to the classifier instead of rejecting it as an
 *  "invalid ticker" before it is ever classified. */
export function isOccOptionSymbol(symbol: string): boolean {
  return parseOccOption(symbol.trim().toUpperCase(), null) !== null;
}

/** The cash-equivalent classification (CASH lines + money-market funds). */
const CASH_EQUIVALENT: Classification = {
  assetClass: "cash",
  assetType: "money_market",
  attributes: { kind: "cash_equivalent", yield: null },
};

/** The bond classification for a given symbol (the CUSIP becomes the bond's
 *  recorded cusip; the remaining bond fields are unknown at import → null). The
 *  carried statement mark (FIX-773 Slice C) is stamped from `mark` when a finite
 *  price is supplied — a bond has no live quote, so this mark is the only value
 *  it ever carries; null when the import had none. */
function bondClassification(
  symbol: string,
  markPrice: number | null | undefined,
): Classification {
  return {
    assetClass: "fixed_income",
    assetType: "bond",
    attributes: {
      kind: "bond",
      cusip: symbol,
      coupon: null,
      maturity: null,
      yield: null,
      markPrice: validMarkPrice(markPrice),
    },
  };
}

/**
 * Classify a holding symbol into `{ assetClass, assetType, attributes }`.
 *
 * `assetTypeHint` (when a valid `AssetType`) WINS over symbol-shape inference —
 * it is the CSV `type` column and the PDF's price-aware pass passing its result
 * downstream. The one exception keeps the output VALID: a hinted `option` or
 * `bond` whose required structured attributes can't be derived from the symbol
 * (e.g. an option symbol that isn't OCC-parseable) falls back to symbol-shape
 * inference rather than emitting an invalid attributes shape.
 *
 * With no usable hint, the assetType is inferred from the symbol shape in a FIXED
 * priority order (first match wins) — see the rule list in the body. OCC-option
 * is checked before CUSIP because both contain digits.
 */
export function classifyInstrument(
  symbol: string,
  opts?: { price?: number | null; assetTypeHint?: AssetType | null },
): Classification {
  const normalized = symbol.trim().toUpperCase();
  // The carried statement mark, threaded into the bond/option attributes (a bond
  // / option has no live quote, so this import-carried price is its value).
  const markPrice = opts?.price;

  // A hint wins when it is a valid AssetType AND its required attributes are
  // derivable. `bond` derives `{ kind: "bond", cusip: symbol, ...nulls }` from any
  // symbol; `option` needs an OCC-parseable symbol or it falls back to inference;
  // every other type carries `{ kind: "none" }`.
  const hint = opts?.assetTypeHint;
  if (hint !== null && hint !== undefined && assetTypeSchema.safeParse(hint).success) {
    if (hint === "bond") return bondClassification(normalized, markPrice);
    if (hint === "money_market") return CASH_EQUIVALENT;
    if (hint === "option") {
      const parsed = parseOccOption(normalized, markPrice);
      if (parsed !== null) return { assetClass: "equity", assetType: "option", attributes: parsed };
      // Not OCC-parseable → fall through to symbol-shape inference.
    } else if (hint === "crypto") {
      return { assetClass: "crypto", assetType: "crypto", attributes: { kind: "none" } };
    } else {
      // equity / etf / mutual_fund / other — equity-class display types.
      const assetClass: AssetClass = hint === "other" ? "alternative" : "equity";
      return { assetClass, assetType: hint, attributes: { kind: "none" } };
    }
  }

  // Symbol-shape inference, fixed priority order (first match wins).

  // 1. Literal cash placeholder.
  if (CASH_LIKE_SYMBOLS.has(normalized)) return CASH_EQUIVALENT;

  // 2. Money-market fund (XX suffix + ~$1.00 price).
  if (looksLikeMoneyMarket(normalized, opts?.price)) return CASH_EQUIVALENT;

  // 3. OCC-shaped option (before CUSIP — both contain digits).
  const option = parseOccOption(normalized, markPrice);
  if (option !== null) return { assetClass: "equity", assetType: "option", attributes: option };

  // 4. CUSIP → bond.
  if (looksLikeCusip(normalized)) return bondClassification(normalized, markPrice);

  // 5. Crypto USD pair.
  if (looksLikeCryptoPair(normalized)) {
    return { assetClass: "crypto", assetType: "crypto", attributes: { kind: "none" } };
  }

  // 6. Valid equity ticker.
  if (looksLikeEquityTicker(normalized)) {
    return { assetClass: "equity", assetType: "equity", attributes: { kind: "none" } };
  }

  // 7. Anything else non-empty → a visible other/alternative row.
  return { assetClass: "alternative", assetType: "other", attributes: { kind: "none" } };
}
