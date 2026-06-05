/**
 * `extractHoldingsGenerator` — the broker-agnostic PDF holdings extractor.
 *
 * Reads the raw text of a brokerage statement (already extracted server-side
 * from the PDF bytes — see `extract-pdf-text.server.ts`) and TRANSCRIBES the
 * holdings table into a strict, structured shape. It is the only LLM step in
 * the PDF import path. It does NO
 * arithmetic verification and NO importing — the deterministic `reconcile()` and
 * `toCanonicalRows()` (in `portfolio-pdf.ts`) do that. The model's single job is
 * to read columns off the page accurately, broker-agnostically.
 *
 * Why a generator (LLM) and not a text parser: every broker lays the table out
 * differently — Wealthfront's "Security | Symbol/CUSIP | Shares | Share Price |
 * Value" is not Schwab's nor Fidelity's column order, and pdfjs text extraction
 * reorders/merges cells unpredictably. A per-broker parser would be a
 * maintenance treadmill and silently wrong on an unseen layout. The model reads
 * the human-meaningful columns regardless of layout; the strict schema + the
 * deterministic reconciliation are the safety net that catches its mistakes.
 *
 * BP-016: `outputSchema` is `pdfExtractionSchema` — every field required at the
 * object level, absence expressed only via `nullable` (no optional/default/
 * record/union). Added to the strict walker in
 * `test/output-schemas-strict.spec.ts`.
 *
 * BP-011: this is a generator, composed into the `extractHoldingsFromPdf` action
 * as a sequencer step — never a handler calling `block.run()`.
 *
 * `uses: [tradingDesk]` supplies the model (`intent/${costPreset}`) and the
 * shared grounding clause. It deliberately does NOT opt into ticker/date memo
 * context — extraction is about the document in front of it, not the analyzed
 * ticker. (The `core` preset's `<ticker>`/`<date>` tags ride along harmlessly;
 * the prompt tells the model to ignore them and read only the statement.)
 */
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { AGENTS } from "../analysis/registry";
import { tradingDesk } from "../analysis/capability";
import { pdfExtractionSchema } from "./portfolio-pdf";

/** The statement text, supplied by the action from the client extraction. */
export const extractHoldingsInputSchema = z.object({
  statementText: z.string(),
});

const EXTRACTION_PROMPT = [
  "You transcribe a brokerage account statement's HOLDINGS into structured rows.",
  "You are broker-agnostic: the statement may be from Wealthfront, Schwab,",
  "Fidelity, Vanguard, or any other broker, with any column order or labeling.",
  "",
  "<task>",
  "Read the holdings / positions table from the statement text and emit one row",
  "per security position. A holdings table row typically carries: a security",
  "name, a symbol or CUSIP, a share quantity, a per-share price, and a position",
  "value. Column order and headers vary by broker — map by meaning, not by",
  "position. Fractional share quantities are normal (e.g. 5.44149).",
  "</task>",
  "",
  "<fields>",
  "For each row emit:",
  "  - ticker: the exchange symbol exactly as printed (e.g. \"AAPL\"). If the row",
  "    shows only a CUSIP / contra-CUSIP / a security with no listed symbol, emit",
  "    null for ticker. Do NOT invent a symbol from the company name.",
  "  - quantity: the share count as a number (strip commas). null if none shown.",
  "  - costBasis: ALWAYS null. A holdings snapshot does not state cost basis;",
  "    the price column is the CURRENT mark, not what was paid. Never put the",
  "    price in costBasis.",
  "  - price: the per-share price as a number (strip $ and commas). null if none.",
  "  - value: the position value as a number (strip $ and commas). null if none.",
  "Also emit statedTotal: the single overall holdings total the statement prints",
  "(e.g. \"Total Holdings $24,387.26\") as a number, or null if the statement",
  "shows no such line.",
  "</fields>",
  "",
  "<scope>",
  "  - Include money-market funds and cash/sweep lines AS ROWS (transcribe them",
  "    faithfully) — downstream code decides how to treat them. Do not silently",
  "    drop a row because it is cash; transcribe what is printed.",
  "  - Include contra-CUSIP / $0.00 placeholder rows faithfully with ticker null",
  "    — downstream code skips them; your job is an honest transcription.",
  "  - Transcribe ONLY what the statement shows. Never fabricate a row, a price,",
  "    or a total. If a number is illegible or absent, emit null for that field.",
  "  - Ignore the <ticker>/<date> context tags — they describe an unrelated",
  "    analysis, not this statement. Read only the statement text below.",
  "</scope>",
].join("\n");

export const extractHoldingsGenerator = generator({
  name: "extract-holdings-generator",
  // Client-visible (the dialog shows extraction is running) but kept off the
  // conversation history — it is a utility transcription, not analysis.
  itemVisibility: { client: true, history: false },
  agentName: "statementParser" satisfies keyof typeof AGENTS,
  uses: [tradingDesk],
  inputSchema: extractHoldingsInputSchema,
  prompt: EXTRACTION_PROMPT,
  user: (input) =>
    [
      "Transcribe the holdings table from the statement below into structured",
      "rows. Emit null for any field the statement does not show. costBasis is",
      "always null.",
      "",
      "<statement>",
      input.statementText,
      "</statement>",
    ].join("\n"),
  outputSchema: pdfExtractionSchema,
});
