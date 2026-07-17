/**
 * Pure, browser-safe transaction-file dispatcher (FIX-775).
 *
 * One entry point for the import dialog (client preview) and the
 * `importTransactions` action (server, authoritative): sniff the file, route to
 * the right parser, and return a uniform shape the import report is built from.
 * Content is authoritative; the filename is only a hint for the format label.
 *
 * It handles the OFX family (QFX / QBO / raw OFX) first; a non-OFX file is then
 * sniffed for the tax-lot CSV family (FIX-895 — unrealized / realized). Anything
 * that is neither returns a clear "unrecognized format" parse error.
 */
import {
  parseOfxTransactions,
  type FileLedgerEvent,
  type SkippedAggregate,
  type UnresolvedSecurity,
} from "@/domain/portfolio/parsers/portfolio-ofx";
import {
  detectTaxLotCsv,
  parseTaxLotCsv,
} from "@/domain/portfolio/parsers/portfolio-tax-lot-csv";

/** The non-count diagnostics a parse produces, merged into the import report
 *  beside the ledger ingest counts. `line` is populated when the source format
 *  has line numbers (CSV, PR2); OFX errors are document-level (`null`). */
export type ParseDiagnostics = {
  parseErrors: { line: number | null; reason: string }[];
  warnings: string[];
  unresolvedSecurities: UnresolvedSecurity[];
  skipped: SkippedAggregate[];
};

/** The dispatcher result: the detected format label, the canonical events to
 *  ingest (minus `accountId`/`source`, which the action injects), and the
 *  diagnostics. */
export type TransactionFileParse = {
  format: string;
  events: FileLedgerEvent[];
  diagnostics: ParseDiagnostics;
};

/** Does the content look like an OFX-family document? (Header line, the 2.x XML
 *  processing instruction, or a bare `<OFX>` root.) Content beats extension. */
function looksLikeOfx(content: string): boolean {
  const head = content.trimStart().slice(0, 512);
  // `<OFX[\s>]` matches a bare `<OFX>` AND a 2.x root carrying whitespace /
  // namespace attributes (`<OFX xmlns=...>`), which the parser handles but a
  // literal `<OFX>` check would reject as "unrecognized".
  return /^OFXHEADER\s*:/i.test(head) || /<\?OFX[\s?]/i.test(head) || /<OFX[\s>]/i.test(head);
}

/** The format label from the filename extension, defaulting to `ofx`. */
function ofxLabel(filename?: string): string {
  const ext = filename?.toLowerCase().match(/\.(qfx|qbo|ofx)$/)?.[1];
  return ext ?? "ofx";
}

/**
 * Detect the file format and parse it into canonical events + diagnostics. A
 * thrown OFX parse becomes a document-level parse error (never propagates); a
 * non-OFX file is sniffed for the tax-lot CSV family, else it returns an
 * "unrecognized format" error. Every refusal is rendered (0 events + a
 * diagnostic), never thrown.
 */
export async function detectAndParseTransactionFile(
  content: string,
  filename?: string,
): Promise<TransactionFileParse> {
  if (looksLikeOfx(content)) {
    const format = ofxLabel(filename);
    try {
      const result = await parseOfxTransactions(content);
      return {
        format,
        events: result.events,
        diagnostics: {
          parseErrors: [],
          warnings: result.warnings,
          unresolvedSecurities: result.unresolvedSecurities,
          skipped: result.skipped,
        },
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        format,
        events: [],
        diagnostics: {
          parseErrors: [{ line: null, reason }],
          warnings: [],
          unresolvedSecurities: [],
          skipped: [],
        },
      };
    }
  }

  // Non-OFX: sniff the tax-lot CSV family (FIX-895). Detection is header-only —
  // the deeper holdings-snapshot discrimination needs row data and surfaces as a
  // `format: null` + warning from `parseTaxLotCsv` below.
  const detection = detectTaxLotCsv(content);

  if (detection.kind === "not-tax-lot") {
    // Neither OFX nor tax-lot — the unrecognized-format error, now naming both.
    return {
      format: "unknown",
      events: [],
      diagnostics: {
        parseErrors: [
          {
            line: null,
            reason:
              "Unrecognized file — only OFX-family files (.ofx / .qfx / .qbo) and tax-lot CSVs are supported.",
          },
        ],
        warnings: [],
        unresolvedSecurities: [],
        skipped: [],
      },
    };
  }

  if (detection.kind === "reject") {
    // A tax-lot-shaped file with invalid headers (e.g. an intended realized export
    // missing a counterpart column) — the refusal reason is surfaced as a
    // document-level parse error, not thrown.
    return {
      format: "unknown",
      events: [],
      diagnostics: {
        parseErrors: [{ line: null, reason: detection.reason }],
        warnings: [],
        unresolvedSecurities: [],
        skipped: [],
      },
    };
  }

  // A tax-lot CSV (unrealized | realized). Parse WITHOUT `expectedCurrency`: the
  // dispatcher has no account context, so currency injection and the D3
  // currency-mismatch reject happen at the server boundary (`importTransactionFile`,
  // Step 5). A holdings snapshot that satisfies the loose header signature comes
  // back `format: null` + a warning (0 events) — a rendered refusal, mapped through
  // unchanged rather than crashing.
  const result = parseTaxLotCsv(content);
  return {
    // A refused holdings snapshot has `format: null` → the unknown label.
    format: result.format ?? "unknown",
    // A row whose file carried no currency column leaves `currency` unset; the
    // server boundary injects the account currency before ingest (Step 5). The
    // cast marks that seam — the dispatcher's return contract fills currency there.
    events: result.events as FileLedgerEvent[],
    diagnostics: {
      parseErrors: result.parseErrors,
      warnings: result.warnings,
      unresolvedSecurities: [],
      skipped: [],
    },
  };
}
