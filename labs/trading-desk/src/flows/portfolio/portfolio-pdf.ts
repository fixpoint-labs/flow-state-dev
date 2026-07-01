/**
 * Pure, browser-safe core for PDF holdings import.
 *
 * This is the load-bearing leaf for Slice 4b (PDF import). It imports ONLY
 * `zod` — no `@flow-state-dev/core`, no `pdfjs-dist` — so it runs identically
 * in the client (the import dialog's reconciliation preview) and in the server
 * action's commit handler, and is unit-testable without a runtime or a browser
 * (BP-019: leaf module, no cycles).
 *
 * What lives here, and why it is deterministic TS and NOT the LLM:
 *
 *  1. `extractedRowSchema` / `pdfExtractionSchema` — the STRICT output shape the
 *     extraction generator emits (BP-016: no `.optional()` / `.default()` /
 *     `.record()` / `.union()` of differing shapes; `nullable` is the only way
 *     a field is absent). These are added to the strict walker.
 *
 *  2. `reconcile()` — the trust gate. A holdings statement carries shares AND
 *     price AND value for every row, plus a stated total. We re-derive the
 *     arithmetic OURSELVES and flag any row where `shares * price` disagrees
 *     with the stated `value`, and flag the import where `sum(value)` disagrees
 *     with the stated total. The LLM transcribes; the math is checked in code.
 *     Real money: never trust the model's arithmetic.
 *
 *  3. `toCanonicalRows()` — maps the reviewed, confirmed extracted rows onto the
 *     EXISTING `CanonicalRow` shape so they feed the SAME `importHoldings`
 *     action the CSV path uses (re-validation + merge + keying reused, no
 *     duplicate import logic). Rows without a valid ticker (contra-CUSIP, blank,
 *     cash placeholders) are skipped and reported, never imported.
 *
 * HONESTY (real money): a holdings snapshot has NO cost basis — only shares,
 * current price, and current value. So every imported row gets `costBasis:
 * null`; we never invent a cost from the snapshot price (that price is the
 * CURRENT mark, not what the user paid). The UI must say so.
 */
import { z } from "zod";
import type { CanonicalRow } from "./portfolio-schema";
import { classifyInstrument } from "./classify-instrument";

/**
 * One holding row as transcribed by the extraction generator from the statement
 * text. STRICT (BP-016): every field is required at the object level; absence is
 * expressed with `nullable`, never `optional`/`default`.
 *
 *  - `ticker`: the exchange symbol as printed (e.g. "AAPL"). For contra-CUSIP /
 *    placeholder / cash rows with no real symbol the model emits `null` — those
 *    rows are reported and skipped, never imported.
 *  - `quantity`: shares held (fractional allowed). `null` when the row carries
 *    no share count (e.g. a cash line).
 *  - `costBasis`: ALWAYS `null` from a holdings snapshot — the field exists so
 *    the shape is honest about what a snapshot can carry. The generator is
 *    instructed to emit `null`; even if it doesn't, `toCanonicalRows` forces it.
 *  - `price`: the per-share Share Price column.
 *  - `value`: the Value column (shares * price as the statement reports it).
 */
export const extractedRowSchema = z.object({
  ticker: z.string().nullable(),
  quantity: z.number().nullable(),
  costBasis: z.number().nullable(),
  price: z.number().nullable(),
  value: z.number().nullable(),
});
export type ExtractedRow = z.infer<typeof extractedRowSchema>;

/**
 * The extraction generator's full output: the transcribed rows plus the single
 * stated portfolio total the statement prints (e.g. "Total Holdings
 * $24,387.26"). `statedTotal` is `null` when the statement has no such line.
 * STRICT — see `extractedRowSchema`.
 */
export const pdfExtractionSchema = z.object({
  rows: z.array(extractedRowSchema),
  statedTotal: z.number().nullable(),
});
export type PdfExtraction = z.infer<typeof pdfExtractionSchema>;

/** Default per-row tolerance for the `shares * price ~= value` check. A
 *  statement rounds each column independently, so a fractional-share line can
 *  be off by up to ~half a cent per side; $0.02 absolute OR 0.5% relative
 *  (whichever is larger) absorbs that rounding without masking a real
 *  transcription error (a dropped digit moves value by >> a cent). */
const ROW_ABS_TOLERANCE = 0.02;
const ROW_REL_TOLERANCE = 0.005;

/** Default total tolerance: a portfolio of N rows accumulates N roundings, so
 *  the total check is looser — $1 absolute OR 0.5% relative. */
const TOTAL_ABS_TOLERANCE = 1;
const TOTAL_REL_TOLERANCE = 0.005;

/** A row-level reconciliation outcome, surfaced per row in the review UI. */
export type RowReconciliation = {
  /** 1-based index into the extracted rows, as the user sees them listed. */
  rowNumber: number;
  ticker: string | null;
  quantity: number | null;
  price: number | null;
  /** The value the statement printed for this row. */
  statedValue: number | null;
  /** `quantity * price`, or null when either input is missing. */
  computedValue: number | null;
  /** `"ok"` when computed ~= stated within tolerance; `"mismatch"` when both
   *  exist and disagree; `"unchecked"` when an input was missing so no check
   *  was possible (not a failure — just nothing to verify). */
  status: "ok" | "mismatch" | "unchecked";
  /** Will this row be imported? False for contra-CUSIP / blank / cash rows. */
  importable: boolean;
  /** Why a row is not importable, for the report. */
  skipReason: string | null;
};

/** The import-level total reconciliation outcome. */
export type TotalReconciliation = {
  /** Σ of every row's stated value (rows with a null value contribute 0). */
  sumOfValues: number;
  /** The statement's printed total, or null when absent. */
  statedTotal: number | null;
  /** `"ok"` within tolerance; `"mismatch"` when both exist and disagree;
   *  `"unchecked"` when the statement printed no total to check against. */
  status: "ok" | "mismatch" | "unchecked";
};

export type Reconciliation = {
  rows: RowReconciliation[];
  total: TotalReconciliation;
  /** Convenience rollups for the dialog header. */
  importableCount: number;
  skippedCount: number;
  mismatchCount: number;
};

/** Within-tolerance comparison: |a - b| <= max(abs, rel * |b|). */
function withinTolerance(
  a: number,
  b: number,
  absTol: number,
  relTol: number,
): boolean {
  return Math.abs(a - b) <= Math.max(absTol, relTol * Math.abs(b));
}

/**
 * Classify whether an extracted row is importable, and why not if it isn't.
 * Pure — drives both the reconciliation report and `toCanonicalRows`.
 *
 * FIX-773 Slice B turned import from a FILTER into a CLASSIFIER: bond CUSIPs,
 * money-market funds, and cash lines are no longer DROPPED — `classifyInstrument`
 * preserves them as typed holdings. The only genuinely non-position rows that
 * stay skipped are a row with NO symbol at all and a row with null/zero quantity.
 */
function classifyRow(row: ExtractedRow): { importable: boolean; reason: string | null } {
  const ticker = (row.ticker ?? "").trim().toUpperCase();
  if (ticker.length === 0) {
    return { importable: false, reason: "no symbol (cash, contra, or blank row)" };
  }
  if (row.quantity === null || row.quantity === 0) {
    return { importable: false, reason: "no share quantity" };
  }
  return { importable: true, reason: null };
}

/**
 * DETERMINISTIC reconciliation of an extraction (NEVER the LLM).
 *
 * Per row: if both `quantity` and `price` are present, compute `quantity *
 * price` and compare to the stated `value`. Within tolerance → `ok`; both
 * present and out of tolerance → `mismatch`; an input missing → `unchecked`.
 *
 * Total: sum every row's stated value and compare to `statedTotal`. The sum uses
 * the STATED values (what the statement printed), not the computed ones, because
 * the statement's own total is the sum of its own printed values — that is the
 * arithmetic the user is reconciling against.
 *
 * @param tolerances Optional override (tests pin exact boundaries). Production
 *   uses the module defaults tuned for fractional-share statements.
 */
export function reconcile(
  extraction: PdfExtraction,
  tolerances?: {
    rowAbs?: number;
    rowRel?: number;
    totalAbs?: number;
    totalRel?: number;
  },
): Reconciliation {
  const rowAbs = tolerances?.rowAbs ?? ROW_ABS_TOLERANCE;
  const rowRel = tolerances?.rowRel ?? ROW_REL_TOLERANCE;
  const totalAbs = tolerances?.totalAbs ?? TOTAL_ABS_TOLERANCE;
  const totalRel = tolerances?.totalRel ?? TOTAL_REL_TOLERANCE;

  const rows: RowReconciliation[] = extraction.rows.map((row, i) => {
    const { importable, reason } = classifyRow(row);
    // Bond and option quoting conventions vary (percent-of-par bonds with a
    // face-amount quantity; per-share vs per-contract option premiums), so
    // `quantity × price = value` is NOT a valid arithmetic check for them — it
    // would false-flag a correctly transcribed row (or false-pass a 100×-off one).
    // Mark those rows `unchecked` rather than compute a misleading `computedValue`;
    // the persisted position value comes from the statement's own `value ÷
    // quantity` (see `toCanonicalRows`), which is convention-proof.
    const assetType =
      row.ticker !== null
        ? classifyInstrument(row.ticker, { price: row.price }).assetType
        : "other";
    const conventionDependent = assetType === "bond" || assetType === "option";

    const computedValue =
      !conventionDependent && row.quantity !== null && row.price !== null
        ? row.quantity * row.price
        : null;

    let status: RowReconciliation["status"];
    if (conventionDependent || computedValue === null || row.value === null) {
      status = "unchecked";
    } else if (withinTolerance(computedValue, row.value, rowAbs, rowRel)) {
      status = "ok";
    } else {
      status = "mismatch";
    }

    return {
      rowNumber: i + 1,
      ticker: row.ticker,
      quantity: row.quantity,
      price: row.price,
      statedValue: row.value,
      computedValue,
      status,
      importable,
      skipReason: reason,
    };
  });

  const sumOfValues = extraction.rows.reduce(
    (acc, r) => acc + (r.value ?? 0),
    0,
  );

  let totalStatus: TotalReconciliation["status"];
  if (extraction.statedTotal === null) {
    totalStatus = "unchecked";
  } else if (
    withinTolerance(sumOfValues, extraction.statedTotal, totalAbs, totalRel)
  ) {
    totalStatus = "ok";
  } else {
    totalStatus = "mismatch";
  }

  return {
    rows,
    total: {
      sumOfValues,
      statedTotal: extraction.statedTotal,
      status: totalStatus,
    },
    importableCount: rows.filter((r) => r.importable).length,
    skippedCount: rows.filter((r) => !r.importable).length,
    mismatchCount: rows.filter((r) => r.status === "mismatch").length,
  };
}

/** One skipped row, surfaced to the user with its 1-based index + reason. */
export type SkippedRow = { rowNumber: number; ticker: string | null; reason: string };

/** The result of mapping a confirmed extraction onto canonical import rows. */
export type CanonicalMapping = {
  rows: CanonicalRow[];
  skipped: SkippedRow[];
};

/**
 * Map a confirmed extraction onto `CanonicalRow[]` for the EXISTING
 * `importHoldings` action.
 *
 * Every importable row becomes a `CanonicalRow` with `costBasis: null` and
 * `acquiredDate: null` — a holdings snapshot carries NEITHER. `quantity` is the
 * extracted share count (asserted non-null by `classifyRow`). Non-importable
 * rows (contra-CUSIP, cash/MMF, blank, zero-quantity) are dropped and returned
 * in `skipped` with their reason — they never reach the import.
 *
 * Duplicate-ticker merge, ticker normalization, and `(account, ticker)` keying
 * all happen DOWNSTREAM in `parsePortfolioCsv` / `importHoldings` — we do NOT
 * re-implement them here. The canonical rows are serialized to CSV by the caller
 * and fed through the same server-side parse the CSV path uses.
 */
export function toCanonicalRows(extraction: PdfExtraction): CanonicalMapping {
  const rows: CanonicalRow[] = [];
  const skipped: SkippedRow[] = [];

  extraction.rows.forEach((row, i) => {
    const { importable, reason } = classifyRow(row);
    if (!importable) {
      skipped.push({
        rowNumber: i + 1,
        ticker: row.ticker,
        reason: reason ?? "skipped",
      });
      return;
    }
    const ticker = (row.ticker as string).trim().toUpperCase();
    // FIX-773 Slice C: the carried mark is the statement's per-UNIT VALUE
    // (`value ÷ quantity`), NOT the raw quoted `price` column — so
    // `quantity × mark` reconstructs the statement's position value regardless of
    // quoting convention (percent-of-par bonds, per-share vs per-contract
    // options). Falls back to the price column only when the statement printed no
    // value. MMF detection still needs the raw price (the XX + ~$1.00 rule), so
    // that is passed separately.
    const perUnitValue =
      row.value !== null && row.quantity !== null && row.quantity !== 0
        ? row.value / row.quantity
        : row.price;
    // FIX-773 Slice B: classify the preserved row. The per-unit value doubles as
    // the MMF signal — a money-market fund's value ÷ quantity is ~$1.00, the same
    // ~$1.00 the XX-suffix rule checks — so one value serves both the mark and the
    // detection.
    const { assetClass, assetType, attributes } = classifyInstrument(ticker, {
      price: perUnitValue,
    });
    rows.push({
      ticker,
      quantity: row.quantity as number,
      // A holdings snapshot has no cost basis. Never derive it from the
      // current price — that is the mark, not what the user paid.
      costBasis: null,
      acquiredDate: null,
      assetClass,
      assetType,
      attributes,
    });
  });

  return { rows, skipped };
}

/**
 * Serialize canonical rows to the exact CSV the `importHoldings` action parses.
 * Keeping the PDF path on the SAME server-side parser (rather than a second
 * write path into the resource collection) means dedupe-merge, ticker
 * validation, and keying are reused verbatim — the canonical-import contract is
 * exercised once. Header columns match `parsePortfolioCsv`'s synonym table.
 *
 * `costBasis` is emitted empty (a holdings snapshot has none); the parser maps a
 * blank cost to `null`. We deliberately do NOT emit a `price` column — the CSV
 * parser would map a bare `price` to cost basis (its documented last-resort
 * synonym), which is exactly the wrong thing for a current mark.
 *
 * FIX-773 Slice B: ONE extra column, `assetType`, carries the classification
 * across the CSV seam so a bond stays a bond and an MMF stays a money_market
 * after the round-trip. We do NOT serialize `assetClass`/`attributes` as JSON —
 * `splitCsvLine` has no RFC-4180 escaping, so embedded JSON would be fragile;
 * `parsePortfolioCsv` re-derives those from the symbol + this `assetType` hint.
 *
 * FIX-773 Slice C: a SECOND extra column, `markPrice`, carries a bond/option
 * row's per-unit statement value as ONE flat number (`attributes.markPrice`,
 * blank for any non-bond/option row). It is deliberately NOT named `price` — the
 * CSV parser maps a bare `price` to costBasis (its documented last-resort
 * synonym), which is exactly wrong for a current mark; `markPrice` is in NO
 * costBasis synonym list, so it round-trips back into the bond/option attributes
 * only.
 */
export function canonicalRowsToCsv(rows: CanonicalRow[]): string {
  const header = "ticker,quantity,costBasis,assetType,markPrice";
  const lines = rows.map((r) => {
    const markPrice =
      r.attributes.kind === "bond" || r.attributes.kind === "option"
        ? r.attributes.markPrice ?? ""
        : "";
    return `${r.ticker},${r.quantity},,${r.assetType},${markPrice}`;
  });
  return [header, ...lines].join("\n");
}
