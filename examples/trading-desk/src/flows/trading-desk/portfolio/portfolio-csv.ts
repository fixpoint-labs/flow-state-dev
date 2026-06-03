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
import type { CanonicalRow } from "./portfolio-schema";

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
const COLUMN_SYNONYMS: Record<keyof CanonicalRow, string[]> = {
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
};

/** Normalize a header cell for synonym matching: lower-case, strip everything
 *  that isn't a letter or digit (so "Avg Cost" and "avg_cost" both match). */
function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip currency symbols, thousands separators, and surrounding whitespace,
 *  then parse a finite number. Returns null on any non-finite result so the
 *  caller can decide whether the field is required. */
function parseLooseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Validate an ISO `YYYY-MM-DD` date. Returns the normalized string or null. */
function parseIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  // Reject impossible calendar dates (e.g. 2024-13-40) — `Date` would coerce.
  const dt = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.toISOString().slice(0, 10) !== trimmed) return null;
  return trimmed;
}

/** Split one CSV line into trimmed fields. Handles simple double-quoted fields
 *  (a quoted field may contain commas); does NOT implement full RFC 4180
 *  escaping (`""` inside quotes) — brokerage holdings exports don't need it and
 *  the format doc declares the limitation. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

/** Resolve header columns to canonical fields. Returns the column index per
 *  canonical field (or -1 if absent) plus the display mapping. */
function resolveColumns(headerCells: string[]): {
  indices: Record<keyof CanonicalRow, number>;
  mapping: Record<string, string>;
} {
  const normalized = headerCells.map(normalizeHeader);
  const indices: Record<keyof CanonicalRow, number> = {
    ticker: -1,
    quantity: -1,
    costBasis: -1,
    acquiredDate: -1,
  };
  const mapping: Record<string, string> = {};
  for (const field of Object.keys(COLUMN_SYNONYMS) as (keyof CanonicalRow)[]) {
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
    rowCount: number;
  };
  const byTicker = new Map<string, Acc>();

  // Data rows are 1-based to the user with the header as row 1.
  for (let r = 1; r < nonEmpty.length; r += 1) {
    const rowNumber = r + 1; // header is row 1
    const raw = nonEmpty[r];
    const cells = splitCsvLine(raw);

    const rawTicker = (cells[indices.ticker] ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,12}$/.test(rawTicker)) {
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

    const existing = byTicker.get(rawTicker);
    if (existing === undefined) {
      byTicker.set(rawTicker, {
        ticker: rawTicker,
        quantity,
        costWeightedSum: costBasis === null ? 0 : quantity * costBasis,
        costWeightQty: costBasis === null ? 0 : quantity,
        acquiredDate,
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
    rows.push({
      ticker: acc.ticker,
      quantity: acc.quantity,
      costBasis,
      acquiredDate: acc.acquiredDate,
    });
  }

  return { rows, errors, warnings, mapping };
}
