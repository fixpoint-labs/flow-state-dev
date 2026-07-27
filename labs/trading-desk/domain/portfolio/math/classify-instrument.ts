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
} from "../schema/portfolio-schema";
import { assetTypeSchema } from "../schema/portfolio-schema";

/** The classifier result — the three taxonomy fields a `CanonicalRow` carries. */
export type Classification = {
  assetClass: AssetClass;
  assetType: AssetType;
  attributes: HoldingAttributes;
};

/** Pure cash placeholders (compared against the normalized symbol). Mirrors the
 *  `CASH_LIKE_TICKERS` set the PDF importer dropped on before this slice. */
const CASH_LIKE_SYMBOLS = new Set(["CASH", "USD"]);

/**
 * Curated set of well-known US bond ETFs (normalized upper-case tickers). These
 * trade like equities (ticker-shaped, live-quoted) but their exposure is fixed
 * income — a distinction symbol shape cannot carry (`BND` looks like `AAPL`), so
 * a curated list is the only cheap signal. INTENTIONALLY INCOMPLETE: the failure
 * mode is under-coverage (an unlisted bond ETF stays `equity`), never noise.
 *
 * FIX-801 landed a real holdings provider (ETF look-through), and its own
 * profile even carries a per-fund asset-type field — but that does NOT replace
 * this set, deliberately (spec §12 open question 2, decided "no, twice over"):
 * first, the field is absent from live Alpha Vantage responses despite being
 * documented, so it can't be relied on; second, even present it would feed
 * CLASSIFICATION, which feeds VALUATION and asset-class allocation — coupling a
 * holding's asset class to whether anyone had opened the Health view (a
 * lazily-filled, per-user-triggered table) is the wrong dependency direction
 * for a fact valuation needs unconditionally. The look-through leaf instead
 * CONSUMES this list as one of its fund-detection oracle's evidence layers
 * (`resolveTickerIsFund`, `etf-look-through.ts`) — reading it, not sourcing it.
 * The fetched profile's own allocation field is a cross-check at best. Fully
 * superseding this curated list is a separate issue, if a real security master
 * ever lands. Extend by adding tickers here.
 */
const KNOWN_BOND_ETFS = new Set([
  // Aggregate / core
  "BND", "AGG", "BNDW", "IUSB", "FBND", "SPAB", "SCHZ", "AGGY", "GVI",
  // Treasury (short → long) + ultra-short
  "TLT", "IEF", "SHY", "IEI", "SHV", "GOVT", "GOVZ", "VGIT", "VGSH", "VGLT",
  "SCHO", "SCHR", "SPTL", "SPTI", "SPTS", "GBIL", "SGOV", "BILS", "TBIL",
  "TLH", "EDV", "ZROZ", "TBT",
  // TIPS / inflation
  "TIP", "TIPS", "VTIP", "SCHP", "STIP", "TIPX", "SPIP", "LTPZ",
  // Corporate — investment grade
  "LQD", "VCIT", "VCSH", "VCLT", "IGSB", "IGIB", "IGLB", "USIG", "SPIB", "SPLB",
  "SPSB", "SLQD", "QLTA",
  // Corporate — high yield
  "HYG", "JNK", "USHY", "SHYG", "SJNK", "HYLB", "ANGL", "FALN", "HYLS", "SHYL",
  "HYS", "GHYG",
  // Floating rate
  "FLRN", "FLTR", "FLOT", "TFLO", "FLRT", "USFR",
  // Mortgage-backed
  "MBB", "VMBS", "SPMB",
  // Municipal
  "MUB", "VTEB", "TFI", "SUB", "SHM", "HYD", "PZA", "SMB",
  // International / emerging markets
  "BNDX", "EMB", "VWOB", "EMLC", "PCY", "IGOV", "BWX", "EBND", "EMHY",
  // Broad / multisector / active
  "BOND", "TOTL", "FTSM", "NEAR", "JPST", "MINT", "ICSH", "GSY", "VRIG", "FLDR",
]);

/** Whether a (raw) symbol is a known bond ETF. The single source of truth for
 *  the bond-ETF classification, normalizing case/whitespace before the lookup. */
export function isKnownBondEtf(symbol: string): boolean {
  return KNOWN_BOND_ETFS.has(symbol.trim().toUpperCase());
}

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
 *  cost-basis import already applies. Exported so the PDF import can re-derive a
 *  bond/option mark from `value ÷ quantity` under the same guard. */
export function validMarkPrice(price: number | null | undefined): number | null {
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
  const expiry = `20${yy}-${mm}-${dd}`;
  // Reject an impossible calendar date (an OCR/CSV typo like `...0231...` →
  // `2024-02-31`). Bounding day 1–31 isn't enough — `Date` coerces `2024-02-31`
  // to March 2, so require the constructed date to ROUND-TRIP (the `parseIsoDate`
  // discipline). A malformed symbol falls through rather than persisting a bad
  // expiry on the option attributes.
  const dt = new Date(`${expiry}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== expiry) {
    return null;
  }
  const strike = Number(strikeRaw) / 1000;
  return {
    kind: "option",
    underlying,
    strike,
    expiry,
    right: rightChar === "C" ? "call" : "put",
    multiplier: 100,
    // The carried per-UNIT statement value (FIX-773 Slice C): a finite positive
    // number → stamped, else null. An option is valued at `quantity × markPrice`
    // (no quote); the multiplier is descriptive only — the per-unit value already
    // incorporates it, so valuation never re-multiplies (see value-holding.ts).
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

/** Canonicalize a symbol for use as the import / dedup / storage key. An OCC
 *  option has two equivalent spellings — compact (`AAPL240621C00190000`) and the
 *  21-char space-padded form (`AAPL  240621C00190000`) — which MUST collapse to
 *  one key, or the same contract imports as two holdings and double-counts in NAV
 *  and position counts. The compact form is canonical (internal padding removed);
 *  every non-OCC symbol is returned trimmed/upper-cased unchanged (a normal
 *  ticker/CUSIP carries no internal spaces). */
export function canonicalTickerKey(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  return isOccOptionSymbol(normalized) ? normalized.replace(/ /g, "") : normalized;
}

/** Whether a symbol can transit the CSV import transport — the shape
 *  `parsePortfolioCsv` accepts: a normal exchange / CUSIP / crypto-pair ticker
 *  (`[A-Z0-9.-]{1,12}`) OR an OCC option symbol. The SINGLE source of truth for
 *  that gate, shared by the CSV parser's ticker check and the PDF import's
 *  reconciliation. A row is shown importable in the PDF review ONLY when the
 *  commit path (`importHoldings` → `parsePortfolioCsv`) will actually accept its
 *  symbol — so a classifier-`other` symbol with spaces / >12 chars / special
 *  characters (a fund name like `PRIVATE FUND`, or `@@@`) is reported skipped up
 *  front rather than shown importable and then rejected as an invalid ticker at
 *  commit. */
export function isImportableSymbol(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return looksLikeEquityTicker(normalized) || parseOccOption(normalized, null) !== null;
}

/** The cash-equivalent classification (CASH lines + money-market funds). */
const CASH_EQUIVALENT: Classification = {
  assetClass: "cash",
  assetType: "money_market",
  attributes: { kind: "cash_equivalent" },
};

/** A known bond ETF: fixed-income EXPOSURE but an `etf` TYPE — the type keeps it
 *  on the live-quote valuation path (`usesLiveQuote`), only the class is corrected
 *  (a `bond` type would wrongly value it off a statement mark and show "—"). */
const BOND_ETF: Classification = {
  assetClass: "fixed_income",
  assetType: "etf",
  attributes: { kind: "none" },
};

/** The bond classification for a given symbol (the CUSIP becomes the bond's
 *  recorded cusip). `markPrice` is the carried per-UNIT statement value passed by
 *  the importer (see `classifyInstrument`) — a bond has no live quote, so this
 *  mark is the only value it ever carries; null when the import had none. */
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

  // Known bond ETFs are classified BEFORE the hint block: an `etf`/`equity` hint
  // conveys the type but not the fixed-income class, so the curated set is
  // authoritative for its tickers. Bond-ETF tickers never collide with the
  // CUSIP / OCC-option / money-market / crypto shapes below, so this early return
  // is safe.
  if (KNOWN_BOND_ETFS.has(normalized)) return BOND_ETF;

  // The carried per-UNIT statement value (statement value ÷ quantity), threaded
  // into the bond/option attributes. A bond/option has no live quote, so this is
  // its value; using value÷quantity (not a raw quoted price) keeps valuation
  // convention-proof — see `holdingAttributesSchema.markPrice`.
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
      // equity / etf / mutual_fund / other — equity-class display types. NOTE: a
      // bond mutual fund also rolls up to `equity` asset class here (v1); precise
      // fund asset-class tagging is the FIX-762/801 classification-source concern.
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
