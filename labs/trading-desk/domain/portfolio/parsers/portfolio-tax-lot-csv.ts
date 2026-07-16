/**
 * Pure, browser-safe tax-lot CSV parser (FIX-895).
 *
 * Brokerages export **tax-lot CSVs** — an *unrealized* file (every currently-open
 * lot) and a *realized* file (every closed lot, paired with the exact acquisition
 * it was matched against). These are neither holdings snapshots nor OFX: the
 * unrealized `costBasis` is the lot **total** (not per-share average cost, the
 * Holdings-CSV convention), and a realized row is a **specific-lot disposal** the
 * broker already matched. This module maps both families onto the shared
 * `FileLedgerEvent` contract so `importTransactionFile` → `ingestLedgerEvents`
 * ingests them and `deriveLots` reconstructs open positions AND realized gains
 * that match the broker's own lot attribution (via the FIX-895 lot-identity
 * fields), not a FIFO guess.
 *
 * Like the OFX parser it is deterministic, side-effect-free, imports no
 * `@flow-state-dev/core` and no `node:*`, and runs identically in the dialog
 * preview and the server route. It reuses the holdings-CSV pure helpers
 * (`splitCsvLine` / `normalizeHeader` / `parseLooseNumber` / `parseIsoDate`) and
 * the shared instrument helpers (`canonicalTickerKey` / `isImportableSymbol` /
 * `isOccOptionSymbol`) rather than re-implementing them (BP-029).
 *
 * What this module does NOT do (deliberately, per the spec's step boundaries):
 * it never sets `accountId` or `source` (the action injects them, the OFX
 * precedent), and it never hard-codes a currency. A synthesized event carries a
 * `currency` ONLY when the file supplied a currency column for that row; when the
 * file has no currency column the field is left **unset** so the server boundary
 * (`importTransactionFile`) can inject the target account's currency — falling
 * through to the ledger's `"USD"` default would mislabel a foreign lot's basis as
 * taxable USD (§0 D3).
 */
import type { FileLedgerEvent } from "./portfolio-ofx";
import {
  normalizeHeader,
  parseIsoDate,
  parseLooseNumber,
  splitCsvLine,
} from "./csv-utils";
import {
  canonicalTickerKey,
  isImportableSymbol,
  isOccOptionSymbol,
} from "../math/classify-instrument";

/** The two tax-lot file families, used as the dispatcher's format label. */
export type TaxLotFormat = "tax-lot-unrealized" | "tax-lot-realized";

/**
 * A synthesized tax-lot ledger event. It is a `FileLedgerEvent` with `currency`
 * made OPTIONAL: the parser sets it only from a file currency column, leaving it
 * unset when the file carries none so the server boundary injects the target
 * account's currency (never the USD default — §0 D3). Everything else matches the
 * OFX parser's `FileLedgerEvent` fields exactly.
 */
export type TaxLotFileLedgerEvent = Omit<FileLedgerEvent, "currency"> & {
  currency?: string;
};

/** A per-row parse rejection, carrying the 1-based CSV line number (header =
 *  line 1) the user sees in a spreadsheet — the holdings-CSV `RowError` shape,
 *  flattened to the dispatcher's `{ line, reason }`. */
export type TaxLotParseError = { line: number | null; reason: string };

/**
 * The parse result: the detected format label (null when the file was refused as
 * not-a-tax-lot), the synthesized events, per-row parse errors, and import-level
 * warnings. Maps directly into the dispatcher's `ParseDiagnostics`
 * (`unresolvedSecurities`/`skipped` are always empty for this format).
 */
export type TaxLotParseResult = {
  format: TaxLotFormat | null;
  events: TaxLotFileLedgerEvent[];
  parseErrors: TaxLotParseError[];
  warnings: string[];
};

/** Options for {@link parseTaxLotCsv}. `expectedCurrency` is the target account's
 *  currency; when passed, a row whose file currency differs is rejected (§0 D3).
 *  Omitted for a pure preview parse (no rejection — carry the file currency
 *  through). */
export type TaxLotParseOptions = { expectedCurrency?: string };

/** The header→canonical-column map. Every tax-lot column keys on this subset. */
type TaxLotColumn =
  | "symbol"
  | "cusip"
  | "quantity"
  | "costBasis"
  | "unitCost"
  | "openDate"
  | "closeDate"
  | "proceeds"
  | "unitProceeds"
  | "currency"
  | "washSale";

/** Canonical column → accepted header synonyms (normalized: lower-case,
 *  non-alphanumerics stripped). First match wins, in array order. `costBasis`
 *  (the lot TOTAL) and `unitCost` (per-share) are kept as DISTINCT columns — the
 *  discrimination cross-check depends on reading both, so their synonyms never
 *  overlap. */
const COLUMN_SYNONYMS: Record<TaxLotColumn, string[]> = {
  symbol: ["symbol", "ticker", "sym", "security", "securityid"],
  cusip: ["cusip"],
  quantity: ["quantity", "qty", "shares", "units", "quantityopen"],
  costBasis: ["costbasis", "totalcost", "costbasistotal", "cost"],
  unitCost: ["unitcost", "costpershare", "priceperunit", "unitprice"],
  openDate: [
    "opendate",
    "dateacquired",
    "acquireddate",
    "acquisitiondate",
    "purchasedate",
    "dateopened",
  ],
  closeDate: ["closedate", "datesold", "dateclosed", "saledate", "dispositiondate"],
  proceeds: ["proceeds", "totalproceeds", "proceedstotal", "salesproceeds"],
  unitProceeds: ["proceedspershare", "saleprice", "priceperunitsold"],
  currency: ["currency", "ccy", "currencycode"],
  washSale: ["washsale", "iswashsale", "washsaleindicator"],
};

/** Resolve header cells to canonical columns; -1 when a column is absent. */
function resolveColumns(headerCells: string[]): Record<TaxLotColumn, number> {
  const normalized = headerCells.map(normalizeHeader);
  const indices = {} as Record<TaxLotColumn, number>;
  for (const column of Object.keys(COLUMN_SYNONYMS) as TaxLotColumn[]) {
    indices[column] = -1;
    for (const synonym of COLUMN_SYNONYMS[column]) {
      const idx = normalized.indexOf(synonym);
      if (idx !== -1) {
        indices[column] = idx;
        break;
      }
    }
  }
  return indices;
}

/**
 * Header-only detection: what family (if any) a non-OFX CSV belongs to. Step 4's
 * dispatcher calls this to route — `not-tax-lot` falls through to the
 * unrecognized-format error; `reject` is a tax-lot-shaped file with invalid
 * headers (an intended realized export whose counterpart column is unrecognized).
 * The deeper holdings-snapshot discrimination needs row DATA, so it lives in
 * {@link parseTaxLotCsv}, not here.
 */
export type TaxLotDetection =
  | { kind: TaxLotFormat }
  | { kind: "not-tax-lot" }
  | { kind: "reject"; reason: string };

/** Detect the tax-lot family from headers alone. The unrealized signature is
 *  `symbol` (or synonym) + `quantity` + `costBasis` + `openDate` + `unitCost`
 *  (all required). `closeDate` AND `proceeds` select realized; exactly one of
 *  them is a hard reject (an intended realized export with an unrecognized
 *  counterpart column — never parsed as unrealized, which would synthesize
 *  phantom open buys for already-closed lots). */
export function detectTaxLotCsv(csvText: string): TaxLotDetection {
  const headerLine = firstNonEmptyLine(csvText);
  if (headerLine === null) return { kind: "not-tax-lot" };
  const cols = resolveColumns(splitCsvLine(headerLine));

  const hasBase =
    cols.symbol !== -1 &&
    cols.quantity !== -1 &&
    cols.costBasis !== -1 &&
    cols.openDate !== -1 &&
    cols.unitCost !== -1;
  if (!hasBase) return { kind: "not-tax-lot" };

  const hasClose = cols.closeDate !== -1;
  const hasProceeds = cols.proceeds !== -1;
  if (hasClose && hasProceeds) return { kind: "tax-lot-realized" };
  if (hasClose !== hasProceeds) {
    return {
      kind: "reject",
      reason:
        "Tax-lot realized file is missing a required column — a realized export needs BOTH a closeDate and a proceeds column. Re-export a complete realized file, or import the unrealized file instead.",
    };
  }
  return { kind: "tax-lot-unrealized" };
}

/** The first non-blank line, trimmed of a leading blank prefix; null if none. */
function firstNonEmptyLine(csvText: string): string | null {
  for (const line of csvText.split(/\r?\n/)) {
    if (line.trim().length > 0) return line;
  }
  return null;
}

/** A row that survived per-cell parsing, ready for seq assignment + synthesis. */
type ParsedRow = {
  line: number;
  ticker: string;
  openDate: string;
  quantity: number; // > 0 (absolute)
  costBasis: number | null; // lot TOTAL; null ⇒ basis unknown
  unitCost: number | null; // per-share (discrimination only)
  closeDate: string | null; // realized
  proceeds: number | null; // realized; null ⇒ proceeds unknown
  unitProceeds: number | null; // realized sell unitPrice when present
  currency: string | undefined; // from the file column only
  seq: number; // assigned in canonical content order
};

const MISSING_BASIS_REASON = "import-missing-basis";
const MISSING_PROCEEDS_REASON =
  "import-missing-proceeds: realized tax-lot row had no proceeds in the file";

/** Strip a trailing `-BOND` marker some brokers append to a bond CUSIP row
 *  (e.g. `71654QBR2-BOND` → `71654QBR2`). Case-insensitive. */
function stripBondSuffix(symbol: string): string {
  return symbol.replace(/-BOND$/i, "");
}

/** Resolve a row's symbol to a canonical, importable ticker. Prefers `symbol`
 *  (with `-BOND` stripped), falls back to `cusip`; an OCC option symbol is a hard
 *  reject (options are a Non-Goal — unmodeled multipliers/semantics, like OFX);
 *  a symbol that can't transit the import transport is unrecognized. */
function resolveTicker(
  symbolCell: string,
  cusipCell: string,
): { ticker: string } | { error: "missing-symbol" | "option" | "unrecognized-symbol" } {
  const candidates = [stripBondSuffix(symbolCell.trim()), stripBondSuffix(cusipCell.trim())];
  let sawAny = false;
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    sawAny = true;
    const canonical = canonicalTickerKey(candidate);
    // OCC options are a Non-Goal — reject before the importable check (which
    // otherwise ACCEPTS option symbols), never feed one to the share-lot engine.
    if (isOccOptionSymbol(canonical)) return { error: "option" };
    if (isImportableSymbol(canonical)) return { ticker: canonical };
  }
  return { error: sawAny ? "unrecognized-symbol" : "missing-symbol" };
}

/**
 * Parse + synthesize a tax-lot CSV into lot-identity-bearing ledger events.
 *
 * Detection (§4): the unrealized signature is `symbol` + `quantity` + `costBasis`
 * + `openDate` + `unitCost`; `closeDate` + `proceeds` selects realized. A file
 * that isn't tax-lot-shaped, or whose realized headers are incomplete, returns
 * `format: null` with a warning/parse error (the dispatcher keeps the
 * unrecognized-format error). A holdings snapshot that satisfies the loose
 * signature is refused after a per-share-vs-lot-total cross-check.
 *
 * Synthesis (§4): an unrealized row → one `buy` (`+qty`, `−|costBasis|`,
 * `unitPrice = |costBasis|/qty`, `lotKey`); a realized row → a `buy` on `openDate`
 * + a `sell` on `closeDate` (`−qty`, `+|proceeds|`, `closesLotKey = the buy's
 * lotKey`). `seq` is the 1-based rank within the `(symbol, openDate[, closeDate])`
 * group in canonical content order (`quantity, costBasis, proceeds`), so a
 * reordered re-export yields identical keys. Honesty markers (`basisUnknown` /
 * `proceedsUnknown`) preserve rows with missing money rather than dropping them;
 * only a missing symbol/qty/own-date makes a row unrepresentable.
 */
export function parseTaxLotCsv(
  csvText: string,
  options: TaxLotParseOptions = {},
): TaxLotParseResult {
  const warnings: string[] = [];
  const parseErrors: TaxLotParseError[] = [];
  const expectedCurrency = options.expectedCurrency?.trim().toUpperCase();

  const detection = detectTaxLotCsv(csvText);
  if (detection.kind === "not-tax-lot") {
    return { format: null, events: [], parseErrors, warnings };
  }
  if (detection.kind === "reject") {
    return {
      format: null,
      events: [],
      parseErrors: [{ line: 1, reason: detection.reason }],
      warnings,
    };
  }
  const format = detection.kind;
  const realized = format === "tax-lot-realized";

  const lines = csvText.split(/\r?\n/);
  // The header is the first non-blank line; remember its index so data-row line
  // numbers stay 1-based to what the user sees in a spreadsheet.
  const headerIdx = lines.findIndex((l) => l.trim().length > 0);
  if (headerIdx === -1) {
    return { format: null, events: [], parseErrors, warnings: ["empty CSV"] };
  }
  const cols = resolveColumns(splitCsvLine(lines[headerIdx]));

  const cell = (cells: string[], idx: number): string =>
    idx === -1 ? "" : (cells[idx] ?? "").trim();

  const parsed: ParsedRow[] = [];

  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;
    const line = i + 1; // 1-based
    const cells = splitCsvLine(raw);

    // Symbol first: canonicalization drives BOTH the event ticker and the lotKey.
    const resolved = resolveTicker(cell(cells, cols.symbol), cell(cells, cols.cusip));
    if ("error" in resolved) {
      if (resolved.error === "missing-symbol") {
        parseErrors.push({ line, reason: "missing symbol — row is unrepresentable" });
      } else if (resolved.error === "option") {
        parseErrors.push({
          line,
          reason: "option tax-lot rows are not supported (contract multipliers unmodeled) — skipped",
        });
      } else {
        parseErrors.push({ line, reason: "unrecognized symbol" });
      }
      continue;
    }
    const ticker = resolved.ticker;

    const quantity = parseLooseNumber(cell(cells, cols.quantity));
    if (quantity === null) {
      parseErrors.push({ line, reason: "missing quantity — row is unrepresentable" });
      continue;
    }
    if (quantity <= 0) {
      parseErrors.push({ line, reason: "non-positive quantity — shorts are out of scope, skipped" });
      continue;
    }

    const openDate = parseIsoDate(cell(cells, cols.openDate));
    if (openDate === null) {
      parseErrors.push({ line, reason: "missing or invalid openDate — row is unrepresentable" });
      continue;
    }

    let closeDate: string | null = null;
    if (realized) {
      closeDate = parseIsoDate(cell(cells, cols.closeDate));
      if (closeDate === null) {
        parseErrors.push({ line, reason: "missing or invalid closeDate — row is unrepresentable" });
        continue;
      }
      // A close-before-open row would sort the synthetic sell AHEAD of its paired
      // buy in `deriveLots`, orphaning the disposal and leaving a phantom open
      // holding. Same-day acquire+sell is allowed.
      if (closeDate < openDate) {
        parseErrors.push({ line, reason: "closeDate is before openDate — rejected" });
        continue;
      }
    }

    // Currency: read the file column when present; reject on a mismatch with the
    // target account (§0 D3), never the silent USD default. No column ⇒ unset
    // (server injects the account currency).
    let currency: string | undefined;
    const rawCurrency = cell(cells, cols.currency);
    if (rawCurrency.length > 0) {
      const fileCurrency = rawCurrency.toUpperCase();
      if (expectedCurrency !== undefined && fileCurrency !== expectedCurrency) {
        parseErrors.push({
          line,
          reason: `currency ${fileCurrency} does not match the account currency ${expectedCurrency} — row skipped (single-currency accounts in v1)`,
        });
        continue;
      }
      currency = fileCurrency;
    }

    // Money fields are represented-not-dropped: a blank costBasis / proceeds is a
    // real lot with an honestly-unknown amount, kept via the marker machinery.
    const costBasis = parseLooseNumber(cell(cells, cols.costBasis));
    const unitCost = parseLooseNumber(cell(cells, cols.unitCost));
    const proceeds = realized ? parseLooseNumber(cell(cells, cols.proceeds)) : null;
    const unitProceeds = realized ? parseLooseNumber(cell(cells, cols.unitProceeds)) : null;

    // A wash sale is ingested (no basis math in v1) with a warning.
    const washSale = /^(true|yes|y|1|w)$/i.test(cell(cells, cols.washSale));
    if (washSale) {
      warnings.push(`Row ${line} (${ticker}): wash sale flagged — ingested without basis adjustment (v1).`);
    }

    parsed.push({
      line,
      ticker,
      openDate,
      quantity,
      costBasis,
      unitCost,
      closeDate,
      proceeds,
      unitProceeds,
      currency,
      seq: 0,
    });
  }

  // Holdings-snapshot discrimination: a holdings file (per-share avg cost) can
  // satisfy the loose signature; misreading its per-share basis as a lot total is
  // exactly the corruption this format guards against. On multi-share rows a
  // tax-lot file reads `costBasis ≈ unitCost × quantity`; a holdings file reads
  // `costBasis ≈ unitCost`. When the majority of discriminating rows look
  // per-share, refuse the whole file and point at Holdings CSV import.
  if (looksLikeHoldingsSnapshot(parsed)) {
    return {
      format: null,
      events: [],
      parseErrors,
      warnings: [
        "This looks like a holdings snapshot (its costBasis reads as per-share average cost, not a lot total). Import it via Holdings CSV import instead — importing it here would inflate cost basis.",
      ],
    };
  }

  assignSeq(parsed, realized);

  const events: TaxLotFileLedgerEvent[] = [];
  for (const row of parsed) {
    const lotKey = buildLotKey(row, realized);
    events.push(buildBuy(row, lotKey));
    if (realized) events.push(buildSell(row, lotKey));
  }

  return { format, events, parseErrors, warnings };
}

/** Assign `seq` per `(symbol, openDate[, closeDate])` group in canonical content
 *  order — sort by `(quantity, costBasis, proceeds)` and number 1..n, INCLUDING
 *  exact duplicates (two identical lots get seq 1 and 2, both persist). Sorting
 *  by content (not file order) makes the key a function of the row SET, so a
 *  reordered re-export yields identical `seq`/`lotKey` (§0 D4). */
function assignSeq(rows: ParsedRow[], realized: boolean): void {
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    const key = realized
      ? `${row.ticker} ${row.openDate} ${row.closeDate}`
      : `${row.ticker} ${row.openDate}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  for (const bucket of groups.values()) {
    bucket.sort(contentOrder);
    bucket.forEach((row, idx) => {
      row.seq = idx + 1;
    });
  }
}

/** Canonical content ordering: `(quantity, costBasis, proceeds)` ascending, a
 *  null money field sorting first (deterministically). Order-independent: a
 *  different file arrangement of the same rows sorts identically. */
function contentOrder(a: ParsedRow, b: ParsedRow): number {
  return (
    a.quantity - b.quantity ||
    nullLow(a.costBasis) - nullLow(b.costBasis) ||
    nullLow(a.proceeds) - nullLow(b.proceeds)
  );
}

/** Map a nullable money field to a sortable number, nulls sorting first. */
function nullLow(value: number | null): number {
  return value === null ? Number.NEGATIVE_INFINITY : value;
}

/** Build the lot key: `taxlot:u:{symbol}:{openDate}:{seq}` (unrealized) or
 *  `taxlot:r:{symbol}:{openDate}:{closeDate}:{seq}` (realized). The ticker is
 *  already canonical (upper-case) here, so the key is too (§4 Shared rules). */
function buildLotKey(row: ParsedRow, realized: boolean): string {
  return realized
    ? `taxlot:r:${row.ticker}:${row.openDate}:${row.closeDate}:${row.seq}`
    : `taxlot:u:${row.ticker}:${row.openDate}:${row.seq}`;
}

/** The acquisition leg. `amount = −|costBasis|` (the lot total is authoritative);
 *  `unitPrice = |costBasis|/qty` (NOT the broker `unitCost` — `deriveLots` prefers
 *  `unitPrice`, so a rounded/adjusted `unitCost` would drift basis off the total
 *  this format treats as truth). A blank basis still lands the position:
 *  `amount = 0`, `unitPrice = null`, `basisUnknown` set. */
function buildBuy(row: ParsedRow, lotKey: string): TaxLotFileLedgerEvent {
  const hasBasis = row.costBasis !== null;
  const cost = hasBasis ? Math.abs(row.costBasis as number) : 0;
  return withCurrency(
    {
      type: "buy",
      tradeDate: row.openDate,
      settleDate: null,
      ticker: row.ticker,
      quantity: row.quantity,
      unitPrice: hasBasis ? cost / row.quantity : null,
      amount: hasBasis ? -cost : 0,
      fee: null,
      externalId: lotKey,
      description: null,
      basisUnknown: hasBasis ? null : MISSING_BASIS_REASON,
      proceedsUnknown: null,
      lotKey,
      closesLotKey: null,
    },
    row.currency,
  );
}

/** The disposal leg (realized only). `quantity = −|qty|`, `amount = +|proceeds|`,
 *  `closesLotKey = the paired buy's lotKey`, `externalId = {lotKey}#d`. A blank
 *  proceeds records the sell with `proceedsUnknown` (disposal + basis + term
 *  kept, gain nulled downstream) rather than dropping it. */
function buildSell(row: ParsedRow, lotKey: string): TaxLotFileLedgerEvent {
  const hasProceeds = row.proceeds !== null;
  return withCurrency(
    {
      type: "sell",
      tradeDate: row.closeDate as string,
      settleDate: null,
      ticker: row.ticker,
      quantity: -row.quantity,
      unitPrice: row.unitProceeds === null ? null : Math.abs(row.unitProceeds),
      amount: hasProceeds ? Math.abs(row.proceeds as number) : 0,
      fee: null,
      externalId: `${lotKey}#d`,
      description: null,
      basisUnknown: null,
      proceedsUnknown: hasProceeds ? null : MISSING_PROCEEDS_REASON,
      lotKey: null,
      closesLotKey: lotKey,
    },
    row.currency,
  );
}

/** Attach `currency` ONLY when the file supplied one (server injects otherwise —
 *  never the USD default, §0 D3). Keeping the key absent when unknown is the
 *  whole reason {@link TaxLotFileLedgerEvent} widens `currency` to optional. */
function withCurrency(
  event: Omit<TaxLotFileLedgerEvent, "currency">,
  currency: string | undefined,
): TaxLotFileLedgerEvent {
  return currency === undefined ? event : { ...event, currency };
}

/** Discriminate a tax-lot file from a holdings snapshot on the collected rows: on
 *  rows where `unitCost × qty` is meaningfully distinct from `unitCost` (qty
 *  materially > 1), does `costBasis` read as the lot total (tax-lot) or per-share
 *  (holdings)? True when the majority of discriminating rows look per-share. */
function looksLikeHoldingsSnapshot(rows: ParsedRow[]): boolean {
  let holdingsLike = 0;
  let taxLotLike = 0;
  for (const row of rows) {
    if (row.costBasis === null || row.unitCost === null) continue;
    const perShare = Math.abs(row.unitCost);
    const total = perShare * row.quantity;
    // Skip rows where the two hypotheses aren't meaningfully distinct (qty ≈ 1).
    if (Math.abs(total - perShare) <= 0.01 * Math.max(total, 1)) continue;
    const cb = Math.abs(row.costBasis);
    const matchesTotal = Math.abs(cb - total) <= 0.02 * total;
    const matchesPerShare = Math.abs(cb - perShare) <= 0.02 * perShare;
    if (matchesPerShare && !matchesTotal) holdingsLike += 1;
    else if (matchesTotal) taxLotLike += 1;
  }
  return holdingsLike > 0 && holdingsLike > taxLotLike;
}
