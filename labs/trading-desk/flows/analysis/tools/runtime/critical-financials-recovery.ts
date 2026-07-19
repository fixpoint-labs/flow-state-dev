/**
 * Single-flight critical-financials recovery (FIX-898) — the runtime that turns
 * an SEC registration/prospectus filing into a validated spine write when
 * companyfacts + Yahoo miss the valuation-critical statements for a newly
 * listed issuer (the SPCX failure mode).
 *
 * Invoked from the three statement-tool handlers (`get_income_statement` /
 * `get_balance_sheet` / `get_cashflow`) once they observe that BOTH structured
 * providers missed the subject's critical fields. The three tools run in
 * parallel, so this runs ONCE per (session, ticker, date): a run-local in-flight
 * Promise map collapses the concurrent callers onto one attempt, and the entry
 * is deleted when it settles — a failed attempt does NOT stick across a
 * subsequent run (that is why this is a run-local map, not the process-TTL
 * `getOrFetch`).
 *
 * The recovery ladder is deterministic-first, then one bounded model call:
 *   1. Discover S-1 / 424B* / F-1 candidates (≤3), fetch their primary HTML.
 *   2. Deterministic table extract → validate → promote (zero model spend).
 *   3. On a deterministic miss, ONE bounded LLM transcription over the same
 *      docs → validate → promote.
 *   4. Otherwise keep `unavailable`.
 * Every outcome is recorded on `financialsData.recoveryAudit` — this runtime is
 * the SOLE writer of that field, so the tools never race-patch the audit. A
 * promoted result is normalized to USD billions (`promoteCandidate`); nothing
 * that fails `validateFinancialCandidate` ever reaches the spine (no zero-fill,
 * no magnitude guessing). Correctness path: NOT cost-gated — it may spend one
 * model call on the `fast` preset after the deterministic tier misses.
 */
import { resolveCik } from "@/lib/providers/edgar";
import {
  fetchProspectusPrimaryHtml,
  fetchRegistrationCandidates,
  type RegistrationCandidate,
} from "@/lib/providers/edgar-registration";
import { extractProspectusFinancials } from "@/lib/providers/prospectus-financials";
import { promoteCandidate, type FinancialCandidate } from "../../lib/financial-candidate";
import { validateFinancialCandidate } from "../../lib/validate-financial-candidate";
import { recoverFinancialsExtract, type ExtractModel } from "./recover-financials-extract";
import type { RecoveryAudit } from "../schemas";
import type {
  balanceSheetSchema,
  cashflowSchema,
  incomeStatementSchema,
} from "../schemas";
import type { z } from "zod";

type IncomeStatement = z.infer<typeof incomeStatementSchema>;
type BalanceSheet = z.infer<typeof balanceSheetSchema>;
type Cashflow = z.infer<typeof cashflowSchema>;

/** The promoted statements (source `edgar-prospectus`, USD billions), or null
 *  when recovery did not promote. Each statement tool reads its own field. */
export type RecoveryStatements = {
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashflow: Cashflow;
};

export type RecoveryResult = {
  statements: RecoveryStatements | null;
  audit: RecoveryAudit;
};

/** The minimal execution context the recovery needs from a statement tool. */
export interface RecoveryCtx {
  session: {
    identity: { id: string };
    state: { costPreset?: string };
  };
  resolveModel: (modelId: string, blockName?: string) => ExtractModel;
  resources: {
    financialsData: {
      patchState(updates: { recoveryAudit: RecoveryAudit }): Promise<void>;
    };
  };
}

/** Caps (spec §4.4): ≤3 document fetches, ≤1 LLM invocation, SEC-first URLs. */
const MAX_DOCS = 3;

// Run-local single-flight: concurrent statement tools share one attempt.
const inflight = new Map<string, Promise<RecoveryResult>>();

/**
 * Recover the subject's critical statements from IPO/registration filings, or
 * return an honest `unavailable` audit. Single-flight per (session, ticker,
 * date); writes `recoveryAudit` exactly once via `ctx.resources.financialsData`.
 */
export function recoverCriticalFinancials(
  ctx: RecoveryCtx,
  args: { ticker: string; date: string },
): Promise<RecoveryResult> {
  const key = `${ctx.session.identity.id}:${args.ticker}:${args.date}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const run = runRecovery(ctx, args).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function runRecovery(
  ctx: RecoveryCtx,
  args: { ticker: string; date: string },
): Promise<RecoveryResult> {
  const rejectionReasons: string[] = [];
  const urls: string[] = [];
  let formsTried: string[] = [];

  const finish = async (
    statements: RecoveryStatements | null,
    outcome: RecoveryAudit["outcome"],
  ): Promise<RecoveryResult> => {
    const audit: RecoveryAudit = {
      attempted: true,
      outcome,
      formsTried,
      urls,
      rejectionReasons,
      ...(outcome === "promoted" ? { recoveredSource: "edgar-prospectus" as const } : {}),
    };
    await ctx.resources.financialsData.patchState({ recoveryAudit: audit });
    return { statements, audit };
  };

  // Identity: a ticker with no SEC CIK (non-US, not a filer) has no registration
  // candidates to recover from.
  let cik: number;
  try {
    cik = Number(await resolveCik(args.ticker));
  } catch {
    rejectionReasons.push("no-sec-cik");
    return finish(null, "no-candidates");
  }

  let candidates: RegistrationCandidate[];
  try {
    candidates = await fetchRegistrationCandidates(args.ticker, args.date, MAX_DOCS);
  } catch (err) {
    rejectionReasons.push(`submissions-fetch-failed: ${(err as Error).message}`);
    return finish(null, "no-candidates");
  }
  if (candidates.length === 0) return finish(null, "no-candidates");
  formsTried = [...new Set(candidates.map((c) => c.form))];

  const expectedName = candidates[0]?.companyName ?? null;
  const validateCtx = {
    ticker: args.ticker,
    expectedCik: cik,
    asOfDate: args.date,
    expectedName,
  };

  const docs: Array<{ url: string; text: string; candidate: RegistrationCandidate }> = [];
  let producedCandidate = false;

  const tryPromote = async (
    candidate: FinancialCandidate,
  ): Promise<RecoveryResult | null> => {
    producedCandidate = true;
    const verdict = validateFinancialCandidate(candidate, validateCtx);
    if (verdict.ok) return finish(promoteCandidate(candidate), "promoted");
    rejectionReasons.push(...verdict.reasons.map((r) => `${candidate.form}: ${r}`));
    return null;
  };

  // Tier 1: deterministic extract, doc by doc (stop at the first that promotes).
  for (const candidate of candidates) {
    let html: string;
    try {
      html = await fetchProspectusPrimaryHtml(candidate.url);
    } catch (err) {
      rejectionReasons.push(`fetch-failed ${candidate.url}: ${(err as Error).message}`);
      continue;
    }
    urls.push(candidate.url);
    docs.push({ url: candidate.url, text: html, candidate });

    const deterministic = extractProspectusFinancials(html, {
      ticker: args.ticker,
      cik,
      form: candidate.form,
      filingDate: candidate.filingDate,
      sourceUrl: candidate.url,
      companyName: candidate.companyName,
    });
    if (deterministic) {
      const promoted = await tryPromote(deterministic);
      if (promoted) return promoted;
    }
  }

  if (docs.length === 0) return finish(null, "extract-failed");

  // Tier 2: one bounded LLM transcription over the fetched docs.
  const lead = docs[0].candidate;
  try {
    const model = ctx.resolveModel(
      `intent/${ctx.session.state.costPreset ?? "fast"}`,
      "recover-financials-extract",
    );
    const llmCandidate = await recoverFinancialsExtract(
      model,
      docs.map((d) => ({ url: d.url, text: d.text })),
      {
        ticker: args.ticker,
        cik,
        form: lead.form,
        filingDate: lead.filingDate,
        sourceUrl: lead.url,
        companyName: lead.companyName,
      },
    );
    if (llmCandidate) {
      const promoted = await tryPromote(llmCandidate);
      if (promoted) return promoted;
    } else {
      rejectionReasons.push("llm-extract-empty");
    }
  } catch (err) {
    rejectionReasons.push(`llm-extract-error: ${(err as Error).message}`);
    // If deterministic candidates were already produced and rejected by the
    // gates, that is a `rejected` outcome — a model/transport failure on top of
    // it must not overwrite the gate verdict downstream consumers rely on.
    return finish(null, producedCandidate ? "rejected" : "extract-failed");
  }

  // Docs fetched, but nothing validated: rejected if a candidate was produced
  // and failed the gates, otherwise the extract yielded nothing usable.
  return finish(null, producedCandidate ? "rejected" : "extract-failed");
}

/** Test seam: clear the run-local single-flight map between cases. */
export function _resetRecoveryInflight(): void {
  inflight.clear();
}
