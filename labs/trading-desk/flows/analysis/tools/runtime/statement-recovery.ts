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
 * True when a statement payload lacks its valuation-critical fields — either an
 * explicit `unavailable`, or an HTTP-success provider payload whose critical
 * fields are all null (the sparse-companyfacts case). A sparse payload is a
 * MISS: the provider chain must fall through rather than let it stick.
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

  let edgar: ToolOutput<S["tool"]> | null = null;
  try {
    edgar = await opts.fetchEdgar();
  } catch {}
  if (edgar && !isCriticallySparse(spec.field, edgar)) return edgar;

  let yahoo: ToolOutput<S["tool"]> | null = null;
  try {
    yahoo = await opts.fetchYahoo();
  } catch {}
  if (yahoo && !isCriticallySparse(spec.field, yahoo)) return yahoo;

  const empty = () =>
    emptyPayload(spec.tool as ToolName, input as ToolInput<ToolName>) as ToolOutput<S["tool"]>;

  // Critical miss on the subject → one bounded, single-flight recovery attempt.
  if (toSpine) {
    const recovery = await recoverCriticalFinancials(ctx, {
      ticker: input.ticker,
      date: input.date,
    });
    const recovered = recovery.statements?.[spec.field];
    if (recovered) return recovered as ToolOutput<S["tool"]>;
    // Recovery RAN and did not promote this field: the subject's critical
    // fields are a genuine void. Return an honest `source: "unavailable"` rather
    // than the sparse provider shell — a critically-sparse `source: "edgar"`
    // would read downstream as "the authoritative provider answered". The
    // `recoveryAudit` carries the exhaustion trail (no-candidates / rejected).
    return empty();
  }

  // Non-subject probe (no recovery): return the best-available payload; a sparse
  // edgar/Yahoo shell over an empty one preserves any partial fields.
  return edgar ?? yahoo ?? empty();
}
