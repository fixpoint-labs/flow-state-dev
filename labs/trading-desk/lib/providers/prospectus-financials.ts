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
/** A BARE note reference (`Revenue 1 8,500` — a Notes column or superscript that
 *  normalized to a plain number): a 1–2 digit integer with no `$`, comma,
 *  decimal, or sign. */
const BARE_NOTE_MARKER = /^\d{1,2}$/;
/** A clearly-FORMATTED financial amount: a thousands separator, a decimal, or
 *  3+ digits. A bare leading 1–2 digit token is only treated as a note marker
 *  when the FOLLOWING value looks like this — otherwise a genuine small
 *  current-year cell (`Revenue 8 5` in a millions table, comparative columns)
 *  would be dropped and the prior-year column promoted as current. */
const FORMATTED_AMOUNT = /[,.]|\d{3,}/;

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
  // Rejoin an accounting-negative whose parentheses/`$` were split into separate
  // table cells and space-collapsed ("( $ 1,200 )" / "( 1,200 )") into
  // "($1,200)" — otherwise the leading `(` is dropped and the loss reads as a
  // positive value.
  const normalized = line.replace(/\(\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*\)/g, "($1)");
  const tokens: Array<{ tok: string; index: number }> = [];
  NUMBER_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_TOKEN.exec(normalized)) !== null) {
    tokens.push({ tok: m[0].trim(), index: m.index });
  }
  for (let i = 0; i < tokens.length; i++) {
    const { tok, index } = tokens[i];
    if (FOOTNOTE_MARKER.test(tok)) continue;
    // A leading bare note number (`Revenue 1 8,500`) is a Notes-column /
    // superscript reference — but ONLY when the following token is a clearly
    // formatted amount. A bare 1–2 digit followed by another bare small integer
    // is an ambiguous comparative-columns cell (`Revenue 8 5`, millions), so
    // keep the first value rather than promote the older column.
    const next = tokens[i + 1]?.tok;
    if (BARE_NOTE_MARKER.test(tok) && next != null && FORMATTED_AMOUNT.test(next)) continue;
    const value = parseNumber(tok);
    if (value == null) continue;
    const label = normalized.slice(0, index).trim();
    if (!label) return null;
    return { label, value };
  }
  return null;
}

/** First row whose label matches `pattern` (and does not match `exclude`). */
function findRow(rows: Row[], pattern: RegExp, exclude?: RegExp): Row | null {
  for (const row of rows) {
    if (exclude && exclude.test(row.label)) continue;
    if (pattern.test(row.label)) return row;
  }
  return null;
}

/** The numeric value of the first matching row, or null. */
function findMetric(rows: Row[], pattern: RegExp, exclude?: RegExp): number | null {
  return findRow(rows, pattern, exclude)?.value ?? null;
}

/**
 * Value of the first matching row, negated when the label ASSERTS a loss/outflow
 * but the cell was printed as a positive magnitude. Statements often print
 * "Operating loss 1,200" or "Net cash used in ... 500" as positive numbers; the
 * validator's FCF reconciliation and completeness gates don't catch a
 * sign-flipped operating income, so a real loss would promote as positive.
 * A parenthesized cell is already negative (authoritative) and is left alone; a
 * neutral "(loss)" header (`Income (loss) from operations`) is NOT treated as a
 * loss assertion — its cell sign decides. `signalPattern` matches only the
 * unambiguous loss/used-in wording.
 */
function findSignedMetric(
  rows: Row[],
  pattern: RegExp,
  signalPattern: RegExp,
  exclude?: RegExp,
): number | null {
  const row = findRow(rows, pattern, exclude);
  if (!row) return null;
  if (row.value > 0 && signalPattern.test(row.label)) return -row.value;
  return row.value;
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

/** Non-U.S. currency names/codes an F-1 might report in. */
const FOREIGN_CURRENCY =
  "renminbi|rmb|yuan|cny|euros?|eur|pounds?\\s+sterling|sterling|gbp|yen|jpy|won|krw|rupees?|inr|reais|real|brl|pesos?|mxn|francs?|chf|kron[oa]r|kroner|sek|nok|dkk|ringgit|myr|baht|thb|rand|zar|shekels?|ils|dirhams?|aed|riyals?|sar|lira|try|z[łl]oty|pln|rupiah|idr|dong|vnd|hryvnia|rubles?|rub|new taiwan|ntd|twd";

/** Reject a non-U.S. reporting currency; default to USD otherwise.
 *  A QUALIFIED "dollars" note (Canadian / Australian / Hong Kong / … dollars) or
 *  a foreign reporting currency stated in the units note or a
 *  "reporting/presentation currency" clause (a common F-1 case, e.g. Renminbi)
 *  is surfaced as non-USD so the validator rejects it, rather than silently
 *  promoting local-currency figures as USD billions. A subsidiary's FUNCTIONAL
 *  currency does not count — a USD table stays USD. */
function parseCurrency(html: string): string {
  if (/\b(canadian|australian|new zealand|singapore|hong ?kong|hk|taiwan|nt|jamaican|caribbean)\s+dollars?\b/i.test(html)) {
    return "NON-USD";
  }
  // Units note or reporting-currency clause naming a foreign currency.
  if (new RegExp(`\\bin\\s+(?:thousands|millions|billions)\\s+of\\s+(?:${FOREIGN_CURRENCY})\\b`, "i").test(html)) {
    return "NON-USD";
  }
  // Presentation/reporting-currency clause only — NOT "functional currency": a
  // USD-reporting F-1 routinely discloses a subsidiary's functional currency
  // (RMB/EUR/…) while presenting the consolidated statements in U.S. dollars, so
  // a `functional` mention must not flip an otherwise-USD table to non-USD.
  if (new RegExp(`\\b(?:reporting|presentation|reported|expressed|presented)\\b[^.]{0,60}\\b(?:${FOREIGN_CURRENCY})\\b`, "i").test(html)) {
    return "NON-USD";
  }
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

  // Interim/unaudited columns (a stub period) are commonly laid out to the LEFT
  // of the audited full-year column, and this "first number on the row"
  // extractor would pick the interim figure. That column selection needs table
  // structure the LLM tier reads — so when interim-period language is present,
  // defer to it rather than risk promoting a 3/6/9-month value as the annual
  // statement.
  if (/\b(three|six|nine)\s+months?\s+ended\b/i.test(html) || /\bunaudited\b/i.test(html)) {
    return null;
  }

  const rows = rowsFromHtml(html).map(toRow).filter((r): r is Row => r !== null);
  if (rows.length === 0) return null;

  // Exclude non-statement rows that begin with "revenue": the "Revenue
  // Recognition" accounting-policy note / index entry (whose trailing page or
  // ASC reference — "Revenue Recognition F-12", "Revenue recognition ASC 606" —
  // would otherwise be read as a tiny revenue and promoted, since the validator
  // does not magnitude-check revenue), plus cost-of-revenue and per-share rows.
  const revenue = findMetric(
    rows,
    /^(total\s+)?(net\s+)?(revenues?|net\s+sales|total\s+revenue)\b/i,
    /cost of|per share|recognition|polic/i,
  );
  // A "loss"-asserting label ("Loss from operations", "Operating loss") printed
  // as a positive magnitude is a negative operating income. A neutral "(loss)"
  // header keeps its cell sign, so the loss signal excludes the "(loss)" form.
  const operatingIncome = findSignedMetric(
    rows,
    /^(income|loss|profit)\s+(from|\(loss\)\s+from)?\s*operations\b|^operating (income|loss)\b/i,
    /^(operating\s+loss|loss\s+from\s+operations)\b/i,
  );
  // No revenue AND no operating income → not a usable statement table.
  if (revenue == null && operatingIncome == null) return null;

  // Anchored on "net cash provided by / used in … operating activities" — the
  // statement TOTAL — so a narrative or reconciliation row that merely mentions
  // "operating activities" cannot be picked as operating cash flow. "used in"
  // printed as a positive magnitude is a negative operating cash flow.
  const operating = findSignedMetric(
    rows,
    /^net cash (provided by|used in)[^.]*operating activities/i,
    /^net cash used in/i,
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
  // Require an explicit TOTAL debt/borrowings line — NOT "Total long-term debt",
  // which still excludes the current portion of debt and understates the total
  // whenever short-term debt is listed separately. A bare "long-term debt" and a
  // "Total long-term debt" both understate; the validator doesn't reconcile
  // balance totals, so leave it null (honest — cash/debt are "when disclosed")
  // rather than promote an understated value.
  const totalDebt = findMetric(
    rows,
    /^total\s+(debt|borrowings|indebtedness)\b/i,
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
