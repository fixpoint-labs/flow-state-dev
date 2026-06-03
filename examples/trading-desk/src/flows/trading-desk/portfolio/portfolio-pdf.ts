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

/** Ticker validity mirrors the CSV parser EXACTLY (`portfolio-csv.ts`): trimmed,
 *  upper-cased, `/^[A-Z0-9.\-]{1,12}$/`. A contra-CUSIP like "436CVR021" is 9
 *  chars of A-Z0-9 and WOULD pass this regex — so a CUSIP heuristic is applied
 *  on top (see `looksLikeCusip`). The combination is what keeps junk rows out. */
function isValidTicker(raw: string): boolean {
  return /^[A-Z0-9.\-]{1,12}$/.test(raw);
}

/**
 * A CUSIP is 9 alphanumeric characters with at least one digit, typically a mix
 * of letters and digits and no separators. Real exchange tickers are short
 * (<= 5–6 chars) and contra/placeholder CUSIPs surface in the Symbol column
 * when a security has no listed symbol. We treat a 9-character all-alphanumeric
 * token that contains digits as a CUSIP, not a ticker, so it is skipped.
 *
 * This is deliberately conservative: a real 1–6 char symbol (even one with
 * digits, like a warrant) is never caught, and an 8/9-char money-market symbol
 * is short of the 9-with-digits CUSIP signature only if it has no digits — money
 * markets (TIMXX) are handled by the cash/MMF branch below before we get here.
 */
function looksLikeCusip(ticker: string): boolean {
  return /^[A-Z0-9]{9}$/.test(ticker) && /[0-9]/.test(ticker);
}

/** Tokens that indicate a pure cash/sweep placeholder row we treat as not a
 *  holding. Compared case-insensitively against the ticker token. */
const CASH_LIKE_TICKERS = new Set(["CASH", "USD"]);

/**
 * Money-market-fund detection (broker-agnostic). MMF tickers conventionally end
 * in "XX" (TIMXX, SPAXX, SWVXX, VMFXX, FZFXX, ...) and a stable MMF holds a $1.00
 * NAV. We treat a row as an MMF — and therefore a cash-equivalent, not an equity
 * holding — when the symbol ends in "XX" AND the per-share price sits at ~$1.00.
 *
 * The DUAL signal matters: the suffix alone could (rarely) catch a real equity
 * with an XX ticker, and a $1.00 price alone could be a genuine penny stock.
 * Requiring both keeps the heuristic conservative. A row with no price still
 * imports as a normal holding (no false MMF skip on missing data).
 *
 * Why skip MMFs: they are account-level cash equivalents, not equity positions.
 * Importing one as a holding pollutes the holdings table and would double-count
 * against the account `cashBalance`. We skip + report; the user enters cash via
 * the account's cash field. (A future seam could fold a detected MMF balance
 * INTO the account cash automatically; v1 keeps it explicit and visible.)
 */
function looksLikeMoneyMarket(ticker: string, price: number | null): boolean {
  if (!/XX$/.test(ticker)) return false;
  if (price === null) return false;
  return Math.abs(price - 1) <= 0.02;
}

/** Within-tolerance comparison: |a - b| <= max(abs, rel * |b|). */
function withinTolerance(
  a: number,
  b: number,
  absTol: number,
  relTol: number,
): boolean {
  return Math.abs(a - b) <= Math.max(absTol, relTol * Math.abs(b));
}

/** Classify whether an extracted row is importable, and why not if it isn't.
 *  Pure — drives both the reconciliation report and `toCanonicalRows`. */
function classifyRow(row: ExtractedRow): { importable: boolean; reason: string | null } {
  const ticker = (row.ticker ?? "").trim().toUpperCase();
  if (ticker.length === 0) {
    return { importable: false, reason: "no symbol (cash, contra, or blank row)" };
  }
  if (CASH_LIKE_TICKERS.has(ticker)) {
    return { importable: false, reason: "cash/sweep line, not a holding" };
  }
  if (looksLikeMoneyMarket(ticker, row.price)) {
    return { importable: false, reason: "money-market fund (cash equivalent), not a holding" };
  }
  if (looksLikeCusip(ticker)) {
    return { importable: false, reason: "contra-CUSIP / unlisted security, no real ticker" };
  }
  if (!isValidTicker(ticker)) {
    return { importable: false, reason: "unrecognizable ticker" };
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
    const computedValue =
      row.quantity !== null && row.price !== null
        ? row.quantity * row.price
        : null;

    let status: RowReconciliation["status"];
    if (computedValue === null || row.value === null) {
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
    rows.push({
      ticker: (row.ticker as string).trim().toUpperCase(),
      quantity: row.quantity as number,
      // A holdings snapshot has no cost basis. Never derive it from the
      // current price — that is the mark, not what the user paid.
      costBasis: null,
      acquiredDate: null,
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
 */
export function canonicalRowsToCsv(rows: CanonicalRow[]): string {
  const header = "ticker,quantity,costBasis";
  const lines = rows.map((r) => `${r.ticker},${r.quantity},`);
  return [header, ...lines].join("\n");
}
