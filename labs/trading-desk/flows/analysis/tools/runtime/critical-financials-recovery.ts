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

/** The identity fields the recovery single-flight keys on. `tenantId` is the
 *  `ScopeIdentity` tenant (FIX-682): when present it namespaces session STORAGE
 *  (session record, session-scoped resource state) while `id` stays the bare
 *  caller-supplied session id. So the in-process single-flight/generation maps
 *  must key on the tenant-qualified scope too — otherwise two tenants sharing a
 *  session id + ticker + date collide: one awaits the other's recovery Promise
 *  (and never gets its own `financialsData.recoveryAudit` patch), or one
 *  tenant's `seedSession` bumps the shared generation and supersedes the other's
 *  in-flight run. Undefined tenant (single-tenant apps) → the bare session id,
 *  behavior unchanged. */
export type RecoveryIdentity = { id: string; tenantId?: string };

/** The minimal execution context the recovery needs from a statement tool. */
export interface RecoveryCtx {
  session: {
    identity: RecoveryIdentity;
    state: { costPreset?: string };
  };
  resolveModel: (modelId: string, blockName?: string) => ExtractModel;
  resources: {
    financialsData: {
      patchState(updates: { recoveryAudit: RecoveryAudit }): Promise<void>;
    };
  };
  /** The request abort signal. Threaded into the SEC discovery/prospectus
   *  fetches AND the bounded model call, and re-checked before any audit write,
   *  so a cancelled run stops network + token spend and never promotes
   *  statements — matching generator-block cancellation behavior. */
  signal?: AbortSignal;
}

/** Caps (spec §4.4): ≤3 document fetches, ≤1 LLM invocation, SEC-first URLs. */
const MAX_DOCS = 3;

/** Thrown by a recovery attempt that a concurrent re-run SUPERSEDED mid-flight
 *  (its session generation was bumped by `clearRecoveryForSession`). The
 *  statement tool lets it propagate so `getOrPatchState` writes NOTHING into the
 *  freshly-reset spine — a superseded run must not repopulate it with a stale
 *  audit, promoted statements, or a fallback partial/empty payload. */
export class RecoverySupersededError extends Error {
  constructor() {
    super("critical-financials recovery superseded by a re-run");
    this.name = "RecoverySupersededError";
  }
}

// Run-scoped single-flight, keyed by session+ticker+date. `inflight` collapses
// CONCURRENT statement tools onto one attempt; `settled` keeps the resolved
// result so a SEQUENTIAL later statement call (income first, cashflow later)
// reuses it rather than re-fetching/re-modelling — the ≤1 recovery/model-call
// cap holds for the whole run, not just the parallel fan-out.
const inflight = new Map<string, Promise<RecoveryResult>>();
const settled = new Map<string, RecoveryResult>();
// SESSION-level run generation, bumped by `clearRecoveryForSession` at
// `seedSession`. Keyed by session (NOT session+ticker+date) so a re-run for ANY
// ticker/date supersedes EVERY in-flight recovery on that session — an earlier
// run's recovery for a different ticker can't patch the reset spine either. An
// attempt captures its session's generation at start; if the generation changes
// before it writes, it is superseded (throws, caches nothing).
const generation = new Map<string, number>();

/** Tenant-qualified session scope. The NUL separator can't appear in a session
 *  id or tenant id, so it can't collide with the `:` that `recoveryKey` uses to
 *  split scope from ticker/date. Undefined tenant → the bare session id. */
const scopeKey = (identity: RecoveryIdentity): string =>
  identity.tenantId ? `${identity.tenantId}\u0000${identity.id}` : identity.id;

const recoveryKey = (scope: string, ticker: string, date: string): string =>
  `${scope}:${ticker}:${date}`;
const currentGen = (scope: string): number => generation.get(scope) ?? 0;

// Bound module-cache growth on a long-lived, multi-tenant server (BP-035): every
// analyze run seeds a `generation` entry for its session and recovery may leave a
// `settled` result, and a session that never re-runs is never cleared — so both
// maps would grow without bound. Cap each and evict oldest (insertion order)
// beyond it, skipping any key with a recovery still in flight. A dropped `settled`
// re-fetches on next use; a dropped `generation` resets to 0 (a fresh start).
const MAX_CACHE_ENTRIES = 512;

function evictOldest<V>(m: Map<string, V>, isBusy: (key: string) => boolean): void {
  if (m.size <= MAX_CACHE_ENTRIES) return;
  for (const key of [...m.keys()]) {
    if (m.size <= MAX_CACHE_ENTRIES) break;
    if (!isBusy(key)) m.delete(key);
  }
}

/** A session (generation key) is busy if any of its ticker/date recoveries is
 *  still in flight; a settled key is busy if that exact recovery is in flight. */
const sessionBusy = (sessionId: string): boolean => {
  const prefix = `${sessionId}:`;
  for (const k of inflight.keys()) if (k.startsWith(prefix)) return true;
  return false;
};
const keyBusy = (key: string): boolean => inflight.has(key);

/**
 * Recover the subject's critical statements from IPO/registration filings, or
 * return an honest `unavailable` audit. Single-flight per (session, ticker,
 * date); writes `recoveryAudit` exactly once via `ctx.resources.financialsData`.
 * Rejects with `RecoverySupersededError` if a concurrent re-run cleared the
 * session before this attempt could write.
 */
export function recoverCriticalFinancials(
  ctx: RecoveryCtx,
  args: { ticker: string; date: string },
): Promise<RecoveryResult> {
  const scope = scopeKey(ctx.session.identity);
  const key = recoveryKey(scope, args.ticker, args.date);
  const done = settled.get(key);
  if (done) return Promise.resolve(done);
  const existing = inflight.get(key);
  if (existing) return existing;
  const gen = currentGen(scope);
  const run = runRecovery(ctx, args, scope, gen)
    .then((result) => {
      // Only cache if this run's session was not cleared (a re-run seeded) while
      // in flight — a superseded run rejects before reaching here.
      if (currentGen(scope) === gen) {
        settled.set(key, result);
        evictOldest(settled, keyBusy);
      }
      return result;
    })
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}

/** Supersede + drop every recovery attempt/result for a SESSION — called at
 *  `seedSession` before the spine reset. Bumping the session generation makes any
 *  in-flight attempt (for ANY ticker/date on this session) throw
 *  `RecoverySupersededError` at its write instead of patching the reset spine;
 *  clearing the caches makes the re-run re-attempt from scratch. Takes the
 *  identity (not a bare id) so it namespaces by the same tenant-qualified scope
 *  the recovery keyed on — a tenant's re-run supersedes only its own runs. */
export function clearRecoveryForSession(identity: RecoveryIdentity): void {
  const scope = scopeKey(identity);
  generation.set(scope, currentGen(scope) + 1);
  const prefix = `${scope}:`;
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
  for (const k of [...settled.keys()]) if (k.startsWith(prefix)) settled.delete(k);
  evictOldest(generation, sessionBusy);
}

async function runRecovery(
  ctx: RecoveryCtx,
  args: { ticker: string; date: string },
  scope: string,
  gen: number,
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
    // A run SUPERSEDED mid-flight (a concurrent re-run bumped this session's
    // generation via `clearRecoveryForSession` and reset the spine) must not
    // mutate the new run's `financialsData` at all. THROW rather than return: the
    // statement tool writes through `getOrPatchState(field, load)`, so a returned
    // fallback (partial/empty) would still land on the reset spine and the new
    // run would read it as a cache hit and skip recovery. A throw writes nothing.
    if (currentGen(scope) !== gen) throw new RecoverySupersededError();
    // A run cancelled mid-recovery must not write an audit or promote statements
    // — even if a deterministic SEC fetch already resolved. Rethrow the abort
    // before any spine write, matching the model-call cancellation semantics.
    ctx.signal?.throwIfAborted();
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
    // Stop promptly if the run was cancelled between document fetches.
    ctx.signal?.throwIfAborted();
    let html: string;
    try {
      html = await fetchProspectusPrimaryHtml(candidate.url, ctx.signal);
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

  // Tier 2: one bounded LLM transcription over the fetched docs. Each doc carries
  // its OWN form/filingDate/url so the model can cite the exact primary it read
  // (via `sourceDocumentIndex`) instead of always the lead — the extractor stamps
  // provenance from that document. Issuer identity (ticker/cik/companyName) is
  // shared across candidates (same CIK).
  try {
    const model = ctx.resolveModel(
      `intent/${ctx.session.state.costPreset ?? "fast"}`,
      "recover-financials-extract",
    );
    const llmCandidate = await recoverFinancialsExtract(
      model,
      docs.map((d) => ({
        url: d.url,
        text: d.text,
        form: d.candidate.form,
        filingDate: d.candidate.filingDate,
      })),
      { ticker: args.ticker, cik, companyName: docs[0].candidate.companyName },
      { signal: ctx.signal },
    );
    if (llmCandidate) {
      const promoted = await tryPromote(llmCandidate);
      if (promoted) return promoted;
    } else {
      rejectionReasons.push("llm-extract-empty");
    }
  } catch (err) {
    // A cancellation is not an extraction failure: rethrow so the run stops
    // (no audit write, no unavailable payload) — matching generator-block
    // cancellation semantics.
    if (ctx.signal?.aborted) throw err;
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

/** Test seam: clear the run-scoped recovery caches between cases. */
export function _resetRecoveryInflight(): void {
  inflight.clear();
  settled.clear();
  generation.clear();
}

/** Test seam: current module-cache sizes (to assert the bound holds). */
export function _recoveryCacheSizes(): { generation: number; settled: number; inflight: number } {
  return { generation: generation.size, settled: settled.size, inflight: inflight.size };
}

/** Test seam: the module-cache cap (so a bound test doesn't hardcode it). */
export const _MAX_RECOVERY_CACHE_ENTRIES = MAX_CACHE_ENTRIES;
