/**
 * Shared statement-tool load path with critical-source recovery (FIX-898).
 *
 * The three statement tools (`get_income_statement` / `get_balance_sheet` /
 * `get_cashflow`) share one live-load shape: EDGAR companyfacts → Yahoo →
 * (subject only) prospectus recovery → empty. This helper owns it so the wiring
 * lives in one place instead of being copy-pasted three ways (BP-024).
 *
 * The load-bearing new branch is `isCriticallySparse`: an HTTP-success
 * companyfacts payload with null valuation-critical fields used to STICK as a
 * terminal `source: "edgar"` result. For a newly listed issuer that has audited
 * financials only in its IPO prospectus, that mislabels a recoverable void as
 * "the authoritative source answered". Treating a sparse companyfacts/Yahoo
 * payload as a MISS is what lets the recovery ladder run at all.
 *
 * Recovery is single-flight (`recoverCriticalFinancials`) and gated on the
 * subject ticker (`toSpine`) — a peer/benchmark probe never triggers a subject
 * spine write. The recovered payload is tagged `source: "edgar-prospectus"`.
 *
 * OBSERVATION REPORTING IS ADDITIVE, NOT SELECTION (FIX-1113). This module now
 * records, per statement, the newest annual period end among the payloads it
 * ACTUALLY FETCHED alongside the period it settled on. That record is what lets
 * the set-level check catch UNIFORM STALENESS — three statements that all fell
 * back to the same older year agree perfectly, so "do the periods match" passes
 * the exact case the guard exists for.
 *
 * WHICH PROVIDER WINS IS UNCHANGED. The order, the fallback conditions, and the
 * short-circuit below are all exactly as they were. Do NOT turn this into
 * preference logic ("prefer the statement at the anchor") — the three statements
 * resolve in a CONCURRENT fan-out (`define-analyst.ts` `.parallel`), each
 * returning its own winner before any set-level view exists, so one call can
 * observe the anchor after another has committed to an older fallback. Making
 * the anchor-year statement win needs a deterministic barrier and two-phase
 * re-resolution, which is a separate change.
 *
 * A ROUTE THIS CANNOT SEE, BY CONSTRUCTION: a complete provider payload returns
 * BEFORE the next provider is fetched, so a newer annual period sitting at a
 * later provider is never observed. Nothing here is wrong in that case and
 * nothing detects it — closing it costs a provider request per statement per
 * run. Do not "fix" it by adding a fetch.
 */
import { emptyPayload } from "../empty-payloads";
import type { ToolInput, ToolName, ToolOutput } from "../schemas";
import {
  recoverCriticalFinancials,
  type RecoveryCtx,
} from "./critical-financials-recovery";
import type { PeriodObservation } from "@/lib/providers/financial-period";

/** The statement field on `financialsData` a tool writes, and the tool name. */
type StatementSpec =
  | { field: "incomeStatement"; tool: "get_income_statement" }
  | { field: "balanceSheet"; tool: "get_balance_sheet" }
  | { field: "cashflow"; tool: "get_cashflow" };

/**
 * True when a statement payload is FULLY void of its valuation-critical fields —
 * an explicit `unavailable`, or an HTTP-success payload whose critical fields
 * are ALL null (the sparse-companyfacts case). Used to decide honest
 * `unavailable` vs. keeping a partial payload: a fully-void payload is dropped,
 * a partial one is preserved.
 */
export function isCriticallySparse(
  field: StatementSpec["field"],
  payload: { source?: string } & Record<string, unknown>,
): boolean {
  if (!payload) return true;
  if (payload.source === "unavailable") return true;
  switch (field) {
    case "incomeStatement":
      return payload.revenue == null && payload.operatingIncome == null;
    case "cashflow":
      return payload.operating == null && payload.freeCashFlow == null;
    case "balanceSheet":
      return payload.cashAndEquivalents == null && payload.totalDebt == null;
  }
}

/**
 * True when a payload LACKS ANY valuation-critical field — so the provider chain
 * should keep looking (recovery could supply the missing one). Stricter than
 * `isCriticallySparse`: a companyfacts income with revenue but no
 * `operatingIncome` is incomplete here (recovery may fill it) yet not fully
 * sparse (its revenue is preserved if recovery can't). The balance sheet's
 * cash/debt are "when disclosed", so it only counts as incomplete when BOTH are
 * absent — a partial balance is not worth a recovery attempt.
 */
function lacksAnyCritical(
  field: StatementSpec["field"],
  payload: ({ source?: string } & Record<string, unknown>) | null,
): boolean {
  if (!payload) return true;
  if (payload.source === "unavailable") return true;
  switch (field) {
    case "incomeStatement":
      return payload.revenue == null || payload.operatingIncome == null;
    case "cashflow":
      return payload.operating == null || payload.freeCashFlow == null;
    case "balanceSheet":
      return payload.cashAndEquivalents == null && payload.totalDebt == null;
  }
}

/** The period a payload declares, or `null` when it declares none. Reads the
 *  statement's own `periodEnd`, never `asOf` — `asOf` still falls back to the
 *  request date, which is not a period. */
function declaredPeriod(payload: unknown): string | null {
  if (payload === null || typeof payload !== "object") return null;
  const end = (payload as { periodEnd?: unknown }).periodEnd;
  return typeof end === "string" && end !== "" ? end : null;
}

/** The newer of two period ends, ignoring nulls. */
function newer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Run the EDGAR → Yahoo → recovery → empty chain for one statement tool. The
 * caller (the tool handler) owns the fixture-mode branch and the record-mode
 * capture; this is the live/record load body.
 *
 * Alongside the payload it records a `PeriodObservation` on the subject's
 * financials spine — see the file header. Additive: the return value, the
 * provider order, and the fallback conditions are unchanged.
 */
export async function loadStatementWithRecovery<S extends StatementSpec>(opts: {
  spec: S;
  input: ToolInput<S["tool"]>;
  ctx: RecoveryCtx;
  toSpine: boolean;
  fetchEdgar: () => Promise<ToolOutput<S["tool"]>>;
  fetchYahoo: () => Promise<ToolOutput<S["tool"]>>;
}): Promise<ToolOutput<S["tool"]>> {
  const { spec, input, ctx, toSpine } = opts;

  // Everything the chain below actually fetched. A provider it never called
  // contributes nothing — that is what makes `observedNewest` an honest claim
  // about what this resolution SAW rather than about what exists.
  let observedNewest: string | null = null;
  const observe = (payload: unknown) => {
    observedNewest = newer(observedNewest, declaredPeriod(payload));
  };

  // Only the SUBJECT's resolutions feed the set-level check; a peer probe never
  // touches the spine (the `toSpine` gate the recovery audit already uses).
  const settle = async (
    payload: ToolOutput<S["tool"]>,
  ): Promise<ToolOutput<S["tool"]>> => {
    if (toSpine) {
      const observation: PeriodObservation = {
        observedNewest,
        returned: declaredPeriod(payload),
      };
      // A DISTINCT TOP-LEVEL FIELD per statement, not one nested record.
      // `patchState` shallow-merges, and the three statements resolve
      // concurrently — a shared nested object would be whole-value replaced by
      // whichever call wrote last, silently losing the other two observations
      // and disarming part (a) of the check. Distinct fields, distinct writers,
      // which is the same reason the payloads themselves are named fields.
      await ctx.resources.financialsData.patchState({
        [`${spec.field}PeriodObservation`]: observation,
      });
    }
    return payload;
  };

  // A provider payload short-circuits only when it is COMPLETE on the
  // valuation-critical fields; an incomplete one (e.g. companyfacts revenue but
  // no operating income) falls through so recovery can try to fill the gap —
  // without losing the field it DID supply (see the partial-preserve tail).
  let edgar: ToolOutput<S["tool"]> | null = null;
  try {
    edgar = await opts.fetchEdgar();
  } catch {}
  observe(edgar);
  if (edgar && !lacksAnyCritical(spec.field, edgar)) return settle(edgar);

  let yahoo: ToolOutput<S["tool"]> | null = null;
  try {
    yahoo = await opts.fetchYahoo();
  } catch {}
  observe(yahoo);
  if (yahoo && !lacksAnyCritical(spec.field, yahoo)) return settle(yahoo);

  const empty = () =>
    emptyPayload(spec.tool as ToolName, input as ToolInput<ToolName>) as ToolOutput<S["tool"]>;
  // Best PARTIAL provider payload — one that still carries SOME critical data
  // (not fully void). Preserves what a provider supplied when recovery can't
  // complete the statement.
  const bestPartial = (): ToolOutput<S["tool"]> | null => {
    if (edgar && !isCriticallySparse(spec.field, edgar as { source?: string })) return edgar;
    if (yahoo && !isCriticallySparse(spec.field, yahoo as { source?: string })) return yahoo;
    return null;
  };

  // Critical miss on the subject → one bounded, single-flight recovery attempt.
  if (toSpine) {
    const recovery = await recoverCriticalFinancials(ctx, {
      ticker: input.ticker,
      date: input.date,
    });
    const recovered = recovery.statements?.[spec.field];
    // Only take a recovered field that actually carries its critical data. A
    // promoted candidate can pass validation on income+cashflow yet leave the
    // balance sheet's cash/debt undisclosed — that `edgar-prospectus` shell is
    // still critically sparse and must not be read as authoritative.
    observe(recovered);
    if (recovered && !isCriticallySparse(spec.field, recovered as { source?: string })) {
      return settle(recovered as ToolOutput<S["tool"]>);
    }
    // Recovery did not supply usable data. Keep the best PARTIAL provider payload
    // (so a companyfacts revenue is not discarded); honest `unavailable` only
    // when both providers were fully void — a critically-sparse `source: "edgar"`
    // would read downstream as "the authoritative provider answered". The
    // `recoveryAudit` carries the exhaustion trail (no-candidates / rejected).
    return settle(bestPartial() ?? empty());
  }

  // Non-subject probe (no recovery): keep the best partial, else honest empty.
  return settle(bestPartial() ?? empty());
}
