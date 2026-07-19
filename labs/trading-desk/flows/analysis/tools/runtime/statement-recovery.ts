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
 */
import { emptyPayload } from "../empty-payloads";
import type { ToolInput, ToolName, ToolOutput } from "../schemas";
import {
  recoverCriticalFinancials,
  type RecoveryCtx,
} from "./critical-financials-recovery";

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

/**
 * Run the EDGAR → Yahoo → recovery → empty chain for one statement tool. The
 * caller (the tool handler) owns the fixture-mode branch and the record-mode
 * capture; this is the live/record load body.
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

  // A provider payload short-circuits only when it is COMPLETE on the
  // valuation-critical fields; an incomplete one (e.g. companyfacts revenue but
  // no operating income) falls through so recovery can try to fill the gap —
  // without losing the field it DID supply (see the partial-preserve tail).
  let edgar: ToolOutput<S["tool"]> | null = null;
  try {
    edgar = await opts.fetchEdgar();
  } catch {}
  if (edgar && !lacksAnyCritical(spec.field, edgar)) return edgar;

  let yahoo: ToolOutput<S["tool"]> | null = null;
  try {
    yahoo = await opts.fetchYahoo();
  } catch {}
  if (yahoo && !lacksAnyCritical(spec.field, yahoo)) return yahoo;

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
    if (recovered && !isCriticallySparse(spec.field, recovered as { source?: string })) {
      return recovered as ToolOutput<S["tool"]>;
    }
    // Recovery did not supply usable data. Keep the best PARTIAL provider payload
    // (so a companyfacts revenue is not discarded); honest `unavailable` only
    // when both providers were fully void — a critically-sparse `source: "edgar"`
    // would read downstream as "the authoritative provider answered". The
    // `recoveryAudit` carries the exhaustion trail (no-candidates / rejected).
    return bestPartial() ?? empty();
  }

  // Non-subject probe (no recovery): keep the best partial, else honest empty.
  return bestPartial() ?? empty();
}
