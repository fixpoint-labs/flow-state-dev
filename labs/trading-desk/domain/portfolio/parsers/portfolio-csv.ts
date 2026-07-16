/**
 * Pure, browser-safe CSV parser for portfolio imports.
 *
 * No `@flow-state-dev/core` import — runs identically in the import dialog's
 * live preview (client) and in the server-side `importHoldings` action, and is
 * unit-testable without a runtime. The action re-parses server-side (never
 * trusts the client preview) and applies merge semantics on the output.
 *
 * Design tenets (real-money trust gates):
 *  - Deterministic and side-effect-free. It never touches resources.
 *  - Tolerant: it maps real brokerage headers via a synonym table rather than
 *    demanding the canonical format.
 *  - Honest: bad rows are REPORTED with row numbers + reasons, never thrown —
 *    a single malformed row never crashes an import of 200 good rows.
 *  - Conservative on cost: a bare `price` column (often a CURRENT price, not
 *    cost) maps to costBasis only as a last resort, and emits a warning.
 */
import type { AssetType, CanonicalRow } from "../schema/portfolio-schema";
import { assetTypeSchema } from "../schema/portfolio-schema";
import {
  canonicalTickerKey,
  classifyInstrument,
  isImportableSymbol,
  validMarkPrice,
} from "../math/classify-instrument";
import { normalizeHeader, parseIsoDate, parseLooseNumber, splitCsvLine } from "./csv-utils";
import { detectTaxLotCsv } from "./portfolio-tax-lot-csv";

/** The CSV-mappable canonical columns. The taxonomy fields `assetClass` /
 *  `attributes` are NOT parsed from CSV (they are re-derived by the classifier);
 *  the optional `assetType` column (FIX-773 Slice B) is the only taxonomy hint —
 *  present → it WINS over symbol-shape inference, absent → the classifier infers
 *  from the symbol. The synonym table and column-index map key on this subset. */
type CsvColumn =
  | "ticker"
  | "quantity"
  | "costBasis"
  | "acquiredDate"
  | "assetType"
  | "markPrice";

/** One row that failed validation, surfaced to the user with its 1-based row
 *  number (matching what they see in a spreadsheet, header = row 1). */
export type RowError = { rowNumber: number; raw: string; reason: string };

/**
 * The parser result. `rows` are validated + normalized + duplicate-merged and
 * ready to upsert; `errors` are per-row rejections; `warnings` are import-level
 * notes (column ambiguity, duplicate merges, bad dates); `mapping` is the
 * resolved header→canonical-field map for the dialog's "Detected columns"
 * preview.
 */
export type ParsedCsv = {
  rows: CanonicalRow[];
  errors: RowError[];
  warnings: string[];
  mapping: Record<string, string>;
};

/** Canonical field → accepted header synonyms (normalized: lower-case,
 *  non-alphanumerics stripped). First match wins, in array order.
 *
 *  `price` is intentionally LAST in `costBasis`: many exports use `price` for
 *  the CURRENT price, not cost. An explicit `costBasis`/`avgCost` column wins;
 *  a bare `price` maps to costBasis only when nothing better exists, and emits
 *  a warning (never a silent guess). */
const COLUMN_SYNONYMS: Record<CsvColumn, string[]> = {
  ticker: ["ticker", "symbol", "sym", "security", "securityid"],
  quantity: ["quantity", "qty", "shares", "sharesheld", "units"],
  costBasis: [
    "costbasis",
    "avgcost",
    "averagecost",
    "costpershare",
    "unitcost",
    "purchaseprice",
    "price",
  ],
  acquiredDate: [
    "acquireddate",
    "dateacquired",
    "purchasedate",
    "opendate",
    "date",
  ],
  // The hint is the instrument TYPE (validated against assetTypeSchema). A column
  // literally named `assetClass` carries class-level values (`fixed_income`, …)
  // that aren't valid asset TYPES, so it is intentionally NOT a synonym here —
  // mapping it would silently drop those values to shape inference.
  assetType: ["assettype", "type"],
  // FIX-773 Slice C: the carried statement mark for a bond/option, emitted by the
  // PDF round-trip (`canonicalRowsToCsv`). Deliberately a distinct name — NOT a
  // costBasis synonym — so it never collides with cost. A direct CSV import
  // without this column just yields a null mark (a bond then shows "—").
  markPrice: ["markprice"],
};


/** Resolve header columns to canonical fields. Returns the column index per
 *  canonical field (or -1 if absent) plus the display mapping. */
function resolveColumns(headerCells: string[]): {
  indices: Record<CsvColumn, number>;
  mapping: Record<string, string>;
} {
  const normalized = headerCells.map(normalizeHeader);
  const indices: Record<CsvColumn, number> = {
    ticker: -1,
    quantity: -1,
    costBasis: -1,
    acquiredDate: -1,
    assetType: -1,
    markPrice: -1,
  };
  const mapping: Record<string, string> = {};
  for (const field of Object.keys(COLUMN_SYNONYMS) as CsvColumn[]) {
    for (const synonym of COLUMN_SYNONYMS[field]) {
      const idx = normalized.indexOf(synonym);
      if (idx !== -1) {
        indices[field] = idx;
        mapping[headerCells[idx]] = field;
        break;
      }
    }
  }
  return { indices, mapping };
}

/**
 * Parse + validate + duplicate-merge a CSV string into canonical rows.
 *
 * Validation (per spec §3.3):
 *  - ticker: trimmed, upper-cased, must match `/^[A-Z0-9.\-]{1,12}$/`.
 *  - quantity: loose-parsed, must be finite and `!= 0`.
 *  - costBasis: optional; if non-empty must parse to finite `>= 0`.
 *  - acquiredDate: optional; bad date → warning + null (row still imported).
 *  - duplicate ticker within the file → merged with a quantity-weighted average
 *    cost, plus a warning (the per-lot brokerage export is the common case).
 */
export function parsePortfolioCsv(csvText: string): ParsedCsv {
  const errors: RowError[] = [];
  const warnings: string[] = [];

  const lines = csvText
    .split(/\r?\n/)
    .filter((l, idx) => !(idx > 0 && l.trim().length === 0));

  // Drop a leading blank header line if present, then require a header.
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) {
    return { rows: [], errors, warnings: ["empty CSV"], mapping: {} };
  }

  const headerCells = splitCsvLine(nonEmpty[0]);
  const { indices, mapping } = resolveColumns(headerCells);

  // Soft gate (FIX-895): a tax-lot CSV (open/close dates + per-lot cost/proceeds)
  // mis-uploaded here would have its per-LOT total basis read as a per-SHARE
  // holdings cost — the exact corruption the tax-lot path exists to avoid. Detect
  // it with the authoritative sniff and WARN (never silently reinterpret); the
  // file still parses so a genuine holdings file with an overlapping header is
  // unaffected. A tax-lot file belongs on the Import transactions path.
  const taxLotSniff = detectTaxLotCsv(csvText);
  if (taxLotSniff.kind === "tax-lot-unrealized" || taxLotSniff.kind === "tax-lot-realized") {
    warnings.push(
      "This looks like a tax-lot CSV (per-lot cost basis, open/close dates). Use " +
        "Import transactions, not Holdings CSV — here the per-lot basis would be " +
        "misread as a per-share holding cost.",
    );
  }

  if (indices.ticker === -1) {
    return {
      rows: [],
      errors,
      warnings: [
        'no recognizable ticker column found (expected one of: ticker, symbol, sym)',
      ],
      mapping,
    };
  }
  if (indices.quantity === -1) {
    return {
      rows: [],
      errors,
      warnings: [
        'no recognizable quantity column found (expected one of: quantity, qty, shares, units)',
      ],
      mapping,
    };
  }

  // Warn once if cost basis was resolved from a bare `price` column — it may be
  // a current price, not cost (spec §3.2 ambiguity).
  const costHeader =
    indices.costBasis === -1 ? undefined : headerCells[indices.costBasis];
  if (costHeader !== undefined && normalizeHeader(costHeader) === "price") {
    warnings.push(
      `mapped 'price' column to cost basis — verify this is cost, not the current price`,
    );
  }

  // Accumulate by ticker so duplicate rows merge into one quantity-weighted
  // average-cost holding.
  type Acc = {
    ticker: string;
    quantity: number;
    costWeightedSum: number; // Σ(qty_i * cost_i) over rows that supplied a cost
    costWeightQty: number; // Σ(qty_i) over rows that supplied a cost
    acquiredDate: string | null;
    /** First valid `type`-column hint seen for this ticker (a later slice's
     *  duplicate rows share a ticker ⇒ share a classification). Null → the
     *  classifier infers from the symbol shape. */
    assetTypeHint: AssetType | null;
    /** Quantity-weighted carried mark (FIX-773 Slice C): Σ(qty_i × mark_i) and
     *  Σ(qty_i) over rows that supplied a `markPrice`. The merged mark is their
     *  ratio, so `mergedQuantity × mark` reconstructs the summed statement value
     *  even when duplicate lots of the same bond/option carry slightly different
     *  marks (rounding / per-lot value÷quantity). Null when no row had a mark. */
    markWeightedSum: number;
    markWeightQty: number;
    rowCount: number;
  };
  const byTicker = new Map<string, Acc>();

  // Data rows are 1-based to the user with the header as row 1.
  for (let r = 1; r < nonEmpty.length; r += 1) {
    const rowNumber = r + 1; // header is row 1
    const raw = nonEmpty[r];
    const cells = splitCsvLine(raw);

    // Canonicalize before keying: an OCC option's compact and space-padded
    // spellings collapse to one key, so the same contract can't import as two
    // holdings and double-count (a normal ticker/CUSIP is unchanged).
    const rawTicker = canonicalTickerKey(cells[indices.ticker] ?? "");
    // Accept a normal exchange ticker OR an OCC option symbol (18–21 chars, which
    // the equity regex rejects) so an option row reaches the classifier instead of
    // being dropped as "invalid ticker" — the PDF confirm path serializes option
    // rows through this same gate, so rejecting here would lose them despite the
    // classifier supporting options. `isImportableSymbol` is the SINGLE source of
    // truth for this gate, shared with the PDF import's `classifyRow` so review and
    // commit agree on which symbols can transit.
    if (!isImportableSymbol(rawTicker)) {
      errors.push({ rowNumber, raw, reason: "invalid ticker" });
      continue;
    }

    const quantity = parseLooseNumber(cells[indices.quantity] ?? "");
    if (quantity === null || quantity === 0) {
      errors.push({ rowNumber, raw, reason: "invalid quantity" });
      continue;
    }

    let costBasis: number | null = null;
    if (indices.costBasis !== -1) {
      const rawCost = (cells[indices.costBasis] ?? "").trim();
      if (rawCost.length > 0) {
        const parsed = parseLooseNumber(rawCost);
        if (parsed === null || parsed < 0) {
          errors.push({ rowNumber, raw, reason: "invalid cost basis" });
          continue;
        }
        costBasis = parsed;
      }
    }

    let acquiredDate: string | null = null;
    if (indices.acquiredDate !== -1) {
      const rawDate = (cells[indices.acquiredDate] ?? "").trim();
      if (rawDate.length > 0) {
        const parsed = parseIsoDate(rawDate);
        if (parsed === null) {
          warnings.push(
            `row ${rowNumber}: unparseable acquired date ("${rawDate}") — stored as blank`,
          );
        } else {
          acquiredDate = parsed;
        }
      }
    }

    // Optional `type` column → an assetType hint for the classifier (a valid
    // AssetType wins over symbol-shape inference; anything else is ignored).
    let assetTypeHint: AssetType | null = null;
    if (indices.assetType !== -1) {
      const rawType = (cells[indices.assetType] ?? "").trim().toLowerCase();
      const parsed = assetTypeSchema.safeParse(rawType);
      if (parsed.success) assetTypeHint = parsed.data;
    }

    // Optional `markPrice` column → the carried statement mark (FIX-773 Slice C),
    // loose-parsed (currency/thousands tolerated); blank → null.
    let markPrice: number | null = null;
    if (indices.markPrice !== -1) {
      markPrice = parseLooseNumber((cells[indices.markPrice] ?? "").trim());
    }

    const existing = byTicker.get(rawTicker);
    if (existing === undefined) {
      byTicker.set(rawTicker, {
        ticker: rawTicker,
        quantity,
        costWeightedSum: costBasis === null ? 0 : quantity * costBasis,
        costWeightQty: costBasis === null ? 0 : quantity,
        acquiredDate,
        assetTypeHint,
        markWeightedSum: markPrice === null ? 0 : quantity * markPrice,
        markWeightQty: markPrice === null ? 0 : quantity,
        rowCount: 1,
      });
    } else {
      existing.quantity += quantity;
      if (costBasis !== null) {
        existing.costWeightedSum += quantity * costBasis;
        existing.costWeightQty += quantity;
      }
      // Keep the earliest acquisition date across merged lots.
      if (
        acquiredDate !== null &&
        (existing.acquiredDate === null || acquiredDate < existing.acquiredDate)
      ) {
        existing.acquiredDate = acquiredDate;
      }
      // First non-null type hint wins (duplicate rows share a ticker).
      if (existing.assetTypeHint === null && assetTypeHint !== null) {
        existing.assetTypeHint = assetTypeHint;
      }
      // Quantity-weight the carried mark across merged lots (same discipline as
      // cost basis) so the summed statement value survives differing per-lot marks.
      if (markPrice !== null) {
        existing.markWeightedSum += quantity * markPrice;
        existing.markWeightQty += quantity;
      }
      existing.rowCount += 1;
    }
  }

  const rows: CanonicalRow[] = [];
  for (const acc of byTicker.values()) {
    if (acc.rowCount > 1) {
      warnings.push(`merged ${acc.rowCount} duplicate rows for ${acc.ticker}`);
    }
    const costBasis =
      acc.costWeightQty > 0 ? acc.costWeightedSum / acc.costWeightQty : null;
    const mark =
      acc.markWeightQty > 0 ? acc.markWeightedSum / acc.markWeightQty : null;
    // Detection price for shape inference: the carried mark, else the cost basis.
    // A brokerage CSV rarely has the nonstandard `markPrice` column, so a sweep /
    // money-market fund (SPAXX) whose ~$1.00 price landed in the cost column is
    // still detected as money_market (the XX + ~$1 rule). Cost is used ONLY as a
    // detection signal — it is NEVER persisted as a bond/option mark (overridden
    // below), so it can't masquerade as a current mark.
    const detectionPrice = mark ?? costBasis;
    // FIX-773 Slice B: classify the merged row once from its ticker (+ the
    // optional type-column hint). Same ticker ⇒ same classification, so a single
    // classify call covers the merged accumulator.
    const { assetClass, assetType, attributes } = classifyInstrument(acc.ticker, {
      assetTypeHint: acc.assetTypeHint,
      price: detectionPrice,
    });
    // A bond/option mark comes ONLY from the `markPrice` column (the quantity-
    // weighted mark), never the cost basis — mirror the PDF path so cost can't be
    // stored as a current mark.
    const markedAttributes =
      attributes.kind === "bond" || attributes.kind === "option"
        ? { ...attributes, markPrice: validMarkPrice(mark) }
        : attributes;
    rows.push({
      ticker: acc.ticker,
      quantity: acc.quantity,
      costBasis,
      acquiredDate: acc.acquiredDate,
      assetClass,
      assetType,
      attributes: markedAttributes,
    });
  }

  return { rows, errors, warnings, mapping };
}
