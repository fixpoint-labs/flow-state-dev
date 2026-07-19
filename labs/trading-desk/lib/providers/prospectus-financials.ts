/**
 * Deterministic prospectus statement extractor — the zero-model tier of the
 * critical-financials recovery ladder (FIX-898).
 *
 * Given the HTML of an SEC registration primary document (S-1 / 424B*), pull
 * the valuation-critical line items out of its financial tables into a typed
 * `FinancialCandidate` (raw USD, scale applied). This is preferred over the
 * bounded LLM extractor because it is free and reproducible; when a filing's
 * layout defeats it (no parseable scale, a critical line missing) it returns
 * `null` and the recovery runtime escalates to the model.
 *
 * It is deliberately conservative: it never GUESSES scale from magnitude and
 * never fabricates a line it cannot find (both would be rejected by
 * `validateFinancialCandidate` anyway, but failing early keeps the audit
 * honest). Table structure across issuers varies, so extraction works on
 * normalized "label → first number" rows rather than fixed column positions.
 */
import type {
  CandidateScale,
  FinancialCandidate,
} from "../../flows/analysis/lib/financial-candidate";

/** One normalized statement row: the leading label and its first numeric cell
 *  (raw, pre-scale, sign applied for parenthesized negatives). */
type Row = { label: string; value: number };

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05",
  june: "06", july: "07", august: "08", september: "09", october: "10",
  november: "11", december: "12",
};

/** Normalize prospectus HTML into single-line rows. Row-ending tags become
 *  line breaks; cell separators collapse to spaces; remaining tags and a few
 *  common entities are stripped. */
function rowsFromHtml(html: string): string[] {
  const text = html
    .replace(/<\s*(\/tr|\/p|br\s*\/?|\/div|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&[a-z]+;/gi, " ");
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/** A numeric cell token: optional `$`, thousands-separated digits, optional
 *  decimals, optionally parenthesized (accounting negative). */
const NUMBER_TOKEN = /\(?-?\$?\s?\d[\d,]*(?:\.\d+)?\)?/g;
/** A footnote reference like `(1)` / `(12)` — a parenthesized 1–2 digit integer
 *  with no separators. Skipped so a note marker before the amount is not read as
 *  the financial value (`Revenue (1) 8,500` → 8,500, not −1). */
const FOOTNOTE_MARKER = /^\(\d{1,2}\)$/;

/** Parse a numeric token (strip `$`/commas; parentheses → negative). */
function parseNumber(token: string): number | null {
  const negative = /^\(.*\)$/.test(token.trim());
  const cleaned = token.replace(/[(),$\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/** Split a row into its leading label and first FINANCIAL numeric value,
 *  skipping any leading footnote markers. */
function toRow(line: string): Row | null {
  NUMBER_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_TOKEN.exec(line)) !== null) {
    const tok = m[0].trim();
    if (FOOTNOTE_MARKER.test(tok)) continue;
    const value = parseNumber(tok);
    if (value == null) continue;
    const label = line.slice(0, m.index).trim();
    if (!label) return null;
    return { label, value };
  }
  return null;
}

/** First row whose label matches `pattern` (and does not match `exclude`). */
function findMetric(
  rows: Row[],
  pattern: RegExp,
  exclude?: RegExp,
): number | null {
  for (const row of rows) {
    if (exclude && exclude.test(row.label)) continue;
    if (pattern.test(row.label)) return row.value;
  }
  return null;
}

/** Accounting-units note: the unit word must be followed by an accounting
 *  context (`,` / `)` / "of … dollars" / "except"), so a NARRATIVE
 *  "in millions of users" cannot set the table scale. Global so ALL notes are
 *  collected. */
const SCALE_NOTE_RE = /\bin\s+(thousands|millions|billions)\b(?=\s*(?:,|\)|\s+of\s+(?:u\.?\s?s\.?\s+)?dollars|\s+except))/gi;

function scaleWord(word: string): CandidateScale {
  return word === "thousands" ? 1_000 : word === "millions" ? 1_000_000 : 1_000_000_000;
}

/** Parse the ONE reporting scale from the document's accounting-units notes.
 *  Returns null when there is none (nothing to key on) OR when the document
 *  carries CONFLICTING notes (e.g. a capitalization table "in millions" and the
 *  audited statements "in thousands") — an ambiguous scale must fall back to the
 *  LLM extractor, never be guessed, since a wrong multiplier mis-scales every
 *  row by 1000x while still reconciling internally. */
function parseScale(html: string): CandidateScale | null {
  const found = new Set<CandidateScale>();
  for (const m of html.matchAll(SCALE_NOTE_RE)) found.add(scaleWord(m[1].toLowerCase()));
  return found.size === 1 ? [...found][0] : null;
}

const MONTH_NAMES = "(january|february|march|april|may|june|july|august|september|october|november|december)";

/** Latest ISO date matching `Month DD, YYYY` with the given `prefix` context. */
function latestDate(html: string, prefix: string): string | null {
  const re = new RegExp(`${prefix}${MONTH_NAMES}\\s+(\\d{1,2}),\\s+(\\d{4})`, "gi");
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const iso = `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
    if (best == null || iso > best) best = iso;
  }
  return best;
}

/** Fiscal period end. Prefer a date in a statement-header context ("year ended
 *  …", "as of …") over a global max-date scan, so a footnote/comparative date
 *  cannot become the period the validator checks. */
function parsePeriodEnd(html: string): string | null {
  return latestDate(html, "(?:ended|as\\s+of)\\s+") ?? latestDate(html, "");
}

/** Reject an explicit non-USD reporting currency; default to USD otherwise. */
function parseCurrency(html: string): string {
  if (/\bin\s+(thousands|millions|billions)\s+of\s+euros?\b/i.test(html)) return "EUR";
  const m = /\breporting currency[^.]{0,40}\b(EUR|GBP|JPY|CNY|CAD)\b/i.exec(html);
  if (m) return m[1].toUpperCase();
  return "USD";
}

/**
 * Extract a `FinancialCandidate` from prospectus HTML, or `null` when the
 * layout defeats deterministic parsing (no explicit scale, or no revenue/
 * operating-income line found). The CIK is carried on `meta` (the recovery
 * runtime resolves it once from the ticker) so the candidate holds the
 * authoritative identity the validator checks — a mismatch there is what
 * rejects a wrong-company document. Pure: no network, fully unit-testable.
 */
export function extractProspectusFinancials(
  html: string,
  meta: {
    ticker: string;
    cik: number;
    form: string;
    filingDate: string;
    sourceUrl: string;
    companyName: string;
  },
): FinancialCandidate | null {
  const scale = parseScale(html);
  if (scale == null) return null;

  const rows = rowsFromHtml(html).map(toRow).filter((r): r is Row => r !== null);
  if (rows.length === 0) return null;

  const revenue = findMetric(
    rows,
    /^(total\s+)?(net\s+)?(revenues?|net\s+sales|total\s+revenue)\b/i,
    /cost of|per share/i,
  );
  const operatingIncome = findMetric(
    rows,
    /^(income|loss|profit)\s+(from|\(loss\)\s+from)?\s*operations\b|^operating (income|loss)\b/i,
  );
  // No revenue AND no operating income → not a usable statement table.
  if (revenue == null && operatingIncome == null) return null;

  // Anchored on "net cash provided by / used in … operating activities" — the
  // statement TOTAL — so a narrative or reconciliation row that merely mentions
  // "operating activities" cannot be picked as operating cash flow.
  const operating = findMetric(
    rows,
    /^net cash (provided by|used in)[^.]*operating activities/i,
  );
  const capitalExpenditure = findMetric(
    rows,
    /^(purchases? of property|capital expenditures?|purchase of property)/i,
  );
  const freeCashFlow = findMetric(rows, /^free cash flow\b/i);
  const cashAndEquivalents = findMetric(
    rows,
    /^cash and cash equivalents\b/i,
    /restricted/i,
  );
  const totalDebt = findMetric(
    rows,
    /^total debt\b|^(total )?long-term debt\b/i,
    /current portion/i,
  );

  // Require an actual audited period end. Falling back to the filing date would
  // let a document with no parseable period pass validation dated to the filing
  // instead of the audited period — misleading spine data. No period → defer to
  // the LLM extractor (which reads the statement context directly).
  const periodEnd = parsePeriodEnd(html);
  if (!periodEnd) return null;

  const applyScale = (n: number | null): number | null => (n == null ? null : n * scale);

  return {
    ticker: meta.ticker,
    cik: meta.cik,
    companyName: meta.companyName,
    form: meta.form,
    filingDate: meta.filingDate,
    periodEnd,
    scale,
    currency: parseCurrency(html),
    sourceUrl: meta.sourceUrl,
    income: {
      revenue: applyScale(revenue),
      operatingIncome: applyScale(operatingIncome),
    },
    cashflow: {
      operating: applyScale(operating),
      capitalExpenditure: applyScale(capitalExpenditure),
      freeCashFlow: applyScale(freeCashFlow),
    },
    balance: {
      cashAndEquivalents: applyScale(cashAndEquivalents),
      totalDebt: applyScale(totalDebt),
    },
  };
}
