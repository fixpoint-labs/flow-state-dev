/**
 * Bounded LLM prospectus extractor — the second tier of the critical-financials
 * recovery ladder (FIX-898), used only when the deterministic extractor
 * (`lib/providers/prospectus-financials.ts`) could not parse a candidate.
 *
 * This is a PLAIN model+schema helper, NOT a `generator` block: the recovery
 * runtime is invoked from statement-tool handlers, and a handler must not
 * `block.run()` a generator (BP-011). So it borrows the same DISCIPLINE as
 * `extract-holdings-generator` (transcribe strictly, validate deterministically
 * afterward) without the block wrapper — it takes an already-resolved model
 * (`ctx.resolveModel(...)`) and does one structured call. It reads only the
 * document text it is handed; it never searches the open web (the caller
 * bounds the document set to SEC candidate URLs, cap ≤3).
 *
 * The model transcribes numbers AS PRINTED in the table's own units; this
 * module applies the reported `scale` to reach raw USD. Everything the model
 * emits is still gated by `validateFinancialCandidate` before it can touch the
 * spine — the model is a transcriber, not a source of truth.
 */
import { z } from "zod";
import type { FinancialCandidate, CandidateScale } from "../../lib/financial-candidate";

/** Structural model interface — matches `GeneratorModel` from core without a
 *  hard type import, so this helper stays trivially mockable in tests. */
export interface ExtractModel {
  generate(options: {
    messages: unknown[];
    outputSchema?: unknown;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ structuredOutput?: unknown }>;
}

/** Flat, provider-friendly transcription shape. Numbers are AS PRINTED in the
 *  table (the `scale` field says which units); `null` for any line the document
 *  does not disclose. */
const prospectusExtractSchema = z.object({
  currency: z.string(),
  // `unspecified` when the table states no explicit units — the caller REJECTS
  // it rather than guessing whole-dollars, matching the deterministic tier's
  // explicit-scale gate. No `ones` guess (a face-value read of a "in thousands"
  // table mis-states every figure 1000x).
  scale: z.enum(["unspecified", "thousands", "millions", "billions"]),
  periodEnd: z.string(),
  revenue: z.number().nullable(),
  operatingIncome: z.number().nullable(),
  operatingCashFlow: z.number().nullable(),
  capitalExpenditure: z.number().nullable(),
  freeCashFlow: z.number().nullable(),
  cashAndEquivalents: z.number().nullable(),
  totalDebt: z.number().nullable(),
});
type ProspectusExtract = z.infer<typeof prospectusExtractSchema>;

const SCALE_MULTIPLIER: Record<Exclude<ProspectusExtract["scale"], "unspecified">, CandidateScale> = {
  thousands: 1_000,
  millions: 1_000_000,
  billions: 1_000_000_000,
};

/** Per-document text cap fed to the model (keeps the prompt bounded). */
const DOC_CHAR_CAP = 24_000;

/** Headings that mark the audited financial-statement section of a filing. */
const STATEMENT_ANCHOR =
  /consolidated statements?\s+of\s+operations|consolidated balance sheets?|consolidated statements?\s+of\s+cash\s+flows?|index to (?:consolidated )?financial statements|report of independent registered public accounting/i;

/** Strip HTML tags/entities to plain text so a heading split across tags
 *  ("Consolidated <span>Statements</span> of Operations") is contiguous for the
 *  anchor search — and the model gets cleaner, denser text. */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Window the doc around its financial-statement section before the cap. In a
 * large S-1/424B the audited tables often start well past the first 24k chars
 * (cover / TOC / summary / risk factors first) — feeding only the head would
 * hand the model no statements. The doc is first flattened to plain text (so
 * a tag-split heading still matches); the cap is then centered a little before
 * the first statement heading, falling back to the head when none is found.
 */
function sliceAroundStatements(text: string): string {
  const plain = htmlToText(text);
  if (plain.length <= DOC_CHAR_CAP) return plain;
  const m = STATEMENT_ANCHOR.exec(plain);
  if (!m) return plain.slice(0, DOC_CHAR_CAP);
  const start = Math.max(0, m.index - 500);
  return plain.slice(start, start + DOC_CHAR_CAP);
}

const SYSTEM_PROMPT = [
  "You transcribe audited financial statements from a company's SEC",
  "registration statement / IPO prospectus (Form S-1 or 424B) into a strict",
  "structured shape. You are a TRANSCRIBER, not an analyst.",
  "",
  "<rules>",
  "- Read ONLY the document text provided below. Never recall from training,",
  "  never estimate, never fabricate a number the document does not print.",
  "- Emit numbers EXACTLY as printed in the primary financial statements table",
  "  (do not rescale) and report the table's EXPLICITLY stated units in `scale`",
  "  (\"in thousands\" -> thousands, \"in millions\" -> millions, etc.). If the",
  "  table does NOT explicitly state its units, use \"unspecified\" — do NOT",
  "  guess whole dollars.",
  "- Prefer the MOST RECENT audited full-fiscal-year column.",
  "- `currency`: the reporting currency (usually USD).",
  "- `periodEnd`: the fiscal period end as YYYY-MM-DD.",
  "- capitalExpenditure: report as a POSITIVE outflow (purchases of property /",
  "  equipment). freeCashFlow: only if the document states it explicitly.",
  "- Any line item the document does not disclose: emit null. Never emit 0 for",
  "  a missing line.",
  "</rules>",
].join("\n");

/**
 * Run one bounded structured extraction over the provided prospectus documents.
 * Returns a `FinancialCandidate` in raw USD (unvalidated — the caller validates)
 * or `null` when the model returns nothing usable (no revenue and no operating
 * income). Throws only if the model call itself throws; the recovery runtime
 * turns that into an `extract-failed` audit.
 */
export async function recoverFinancialsExtract(
  model: ExtractModel,
  docs: Array<{ url: string; text: string }>,
  meta: { ticker: string; cik: number; form: string; filingDate: string; sourceUrl: string; companyName: string },
  options: { signal?: AbortSignal } = {},
): Promise<FinancialCandidate | null> {
  const corpus = docs
    .map((d, i) => `<document index="${i}" url="${d.url}">\n${sliceAroundStatements(d.text)}\n</document>`)
    .join("\n\n");

  const result = await model.generate({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Transcribe the audited financial statements for ${meta.ticker} (${meta.companyName}) from the ${meta.form} below.\n\n${corpus}`,
      },
    ],
    outputSchema: prospectusExtractSchema,
    maxTokens: 1500,
    signal: options.signal,
  });

  const parsed = prospectusExtractSchema.safeParse(result.structuredOutput);
  if (!parsed.success) return null;
  const e = parsed.data;
  if (e.revenue == null && e.operatingIncome == null) return null;
  // No explicit units → reject (do not guess whole-dollars): the same
  // explicit-scale bar the deterministic tier enforces.
  if (e.scale === "unspecified") return null;

  const scale = SCALE_MULTIPLIER[e.scale];
  const s = (n: number | null): number | null => (n == null ? null : n * scale);

  return {
    ticker: meta.ticker,
    cik: meta.cik,
    companyName: meta.companyName,
    form: meta.form,
    filingDate: meta.filingDate,
    periodEnd: e.periodEnd,
    scale,
    currency: e.currency,
    sourceUrl: meta.sourceUrl,
    income: { revenue: s(e.revenue), operatingIncome: s(e.operatingIncome) },
    cashflow: {
      operating: s(e.operatingCashFlow),
      capitalExpenditure: s(e.capitalExpenditure),
      freeCashFlow: s(e.freeCashFlow),
    },
    balance: { cashAndEquivalents: s(e.cashAndEquivalents), totalDebt: s(e.totalDebt) },
  };
}
