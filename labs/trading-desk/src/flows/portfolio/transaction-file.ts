/**
 * Pure, browser-safe transaction-file dispatcher (FIX-775).
 *
 * One entry point for the import dialog (client preview) and the
 * `importTransactions` action (server, authoritative): sniff the file, route to
 * the right parser, and return a uniform shape the import report is built from.
 * Content is authoritative; the filename is only a hint for the format label.
 *
 * PR1 handles the OFX family (QFX / QBO / raw OFX). A non-OFX file (a broker
 * transaction CSV) returns a clear "not yet supported" parse error — the
 * per-broker CSV adapter layer is the follow-up (PR2), wired into the CSV branch
 * here.
 */
import {
  parseOfxTransactions,
  type FileLedgerEvent,
  type SkippedAggregate,
  type UnresolvedSecurity,
} from "./portfolio-ofx";

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
 * non-OFX file returns a "not yet supported" error pointing at the PR2 follow-up.
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

  // Non-OFX: the per-broker transaction-CSV adapters are the PR2 follow-up.
  return {
    format: "unknown",
    events: [],
    diagnostics: {
      parseErrors: [
        {
          line: null,
          reason:
            "Unrecognized file — only OFX-family files (.ofx / .qfx / .qbo) are supported. Broker transaction-CSV import is a follow-up.",
        },
      ],
      warnings: [],
      unresolvedSecurities: [],
      skipped: [],
    },
  };
}
