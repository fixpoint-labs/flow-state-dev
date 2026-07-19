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
  scale: z.enum(["ones", "thousands", "millions", "billions"]),
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

const SCALE_MULTIPLIER: Record<ProspectusExtract["scale"], CandidateScale> = {
  ones: 1,
  thousands: 1_000,
  millions: 1_000_000,
  billions: 1_000_000_000,
};

/** Per-document text cap fed to the model (keeps the prompt bounded). */
const DOC_CHAR_CAP = 24_000;

const SYSTEM_PROMPT = [
  "You transcribe audited financial statements from a company's SEC",
  "registration statement / IPO prospectus (Form S-1 or 424B) into a strict",
  "structured shape. You are a TRANSCRIBER, not an analyst.",
  "",
  "<rules>",
  "- Read ONLY the document text provided below. Never recall from training,",
  "  never estimate, never fabricate a number the document does not print.",
  "- Emit numbers EXACTLY as printed in the primary financial statements table",
  "  (do not rescale) and report the table's stated units in `scale`",
  "  (\"in thousands\" -> thousands, \"in millions\" -> millions, etc.). If the",
  "  table states no units, use \"ones\".",
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
    .map((d, i) => `<document index="${i}" url="${d.url}">\n${d.text.slice(0, DOC_CHAR_CAP)}\n</document>`)
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
