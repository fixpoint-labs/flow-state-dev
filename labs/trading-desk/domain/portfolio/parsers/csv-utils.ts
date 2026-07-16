/**
 * Shared, browser-safe CSV primitives used by every portfolio CSV parser
 * (holdings `portfolio-csv.ts` and tax-lot `portfolio-tax-lot-csv.ts`). Kept in
 * one leaf so the two parsers reuse identical header normalization, number/date
 * parsing, and line splitting rather than each carrying a copy — and so neither
 * parser has to import the other for them (the acyclic-import rule, BP-019).
 * Pure functions, no IO.
 */

/** Normalize a header cell for synonym matching: lower-case, strip everything
 *  that isn't a letter or digit (so "Avg Cost" and "avg_cost" both match). */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip currency symbols, thousands separators, and surrounding whitespace,
 *  then parse a finite number. Returns null on any non-finite result so the
 *  caller can decide whether the field is required. */
export function parseLooseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned.length === 0) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Validate an ISO `YYYY-MM-DD` date. Returns the normalized string or null. */
export function parseIsoDate(raw: string): string | null {
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
 *  escaping (`""` inside quotes) — brokerage exports don't need it and the
 *  format doc declares the limitation. */
export function splitCsvLine(line: string): string[] {
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
