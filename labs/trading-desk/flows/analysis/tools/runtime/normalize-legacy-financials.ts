/**
 * Legacy-zero normalization for the persisted `financialsData` spine (FIX-1063).
 *
 * THE PROBLEM. Sessions written before the honesty contract stored `0` where
 * the desk had observed nothing. Those records are still on disk and are still
 * read back — by the valuation-spine ingest and by the PM commit — so without
 * this the fix would only cover runs started after it landed, and a resumed
 * session would go on computing enterprise values off a fabricated market cap.
 *
 * WHY IT ONLY TOUCHES `unavailable`-TAGGED PAYLOADS. This is the load-bearing
 * constraint, and it is a restriction rather than a shortcut. On a payload the
 * desk itself tagged `source: "unavailable"`, the empty-payload builder is
 * PROVABLY the only producer, so every zero in it is provably a fill and
 * converting it invents nothing. On a payload tagged with a live provider a
 * zero may be a real measurement — a company that genuinely pays no dividend,
 * a break-even operating margin — and flipping it would fabricate a GAP where
 * there was a fact. That is the same defect in mirror image, so a live-tagged
 * record keeps its ambiguous zeros and the remedy for those is re-recording,
 * not coercion.
 *
 * IT IS A NO-OP ON POST-FIX DATA BY CONSTRUCTION: an `unavailable` payload
 * written after the fix already carries nulls, so `0 → null` finds nothing to
 * do. It costs nothing once the stored corpus turns over.
 *
 * SHALLOW AND SCHEMA-KEYED, NEVER A RECURSIVE WALK. It reads a fixed list of
 * known numeric fields per payload and returns early on any source that is not
 * `unavailable`. A generic deep walk over the resource would descend into
 * `bars[]` and news arrays for no benefit, and — worse — would rewrite zeros in
 * shapes nobody enumerated.
 *
 * ONE FUNCTION, APPLIED AT THE TWO READ BOUNDARIES. Both `compute-spine.ts` and
 * the PM commit read this resource directly (a resumed pre-fix session reaches
 * the second without passing the first), so both apply it. Anything downstream
 * is entitled to assume normalized, honestly-null inputs and should NOT write
 * its own `if (x === 0)` check — a consumer that finds itself needing one has
 * hit a gap here and should say so rather than build a second copy.
 */
import type { FinancialsDataState } from "../../financials-data-resource";

/**
 * The numeric fields per payload, keyed by the resource field that holds it.
 * Deliberately explicit: a field added to one of these schemas later does not
 * get normalized until it is named here, which is the safe direction — a
 * missed field keeps a legacy zero (visible, and only on already-untrusted
 * records), whereas an over-broad walk would silently rewrite live data.
 *
 * The three statement payloads already emitted `null` before this issue, so
 * their entries cover only records old enough to predate THAT change; they are
 * listed because the same records are still readable and the cost is a lookup.
 */
const NUMERIC_FIELDS = {
  fundamentals: [
    "marketCap",
    "forwardPE",
    "trailingPE",
    "priceToSales",
    "returnOnEquity",
    "operatingMargin",
    "grossMargin",
    "dividendYield",
  ],
  balanceSheet: [
    "totalAssets",
    "totalLiabilities",
    "totalEquity",
    "cashAndEquivalents",
    "totalDebt",
  ],
  incomeStatement: [
    "revenue",
    "grossProfit",
    "operatingIncome",
    "netIncome",
    "yoyRevenueGrowth",
  ],
  cashflow: ["operating", "investing", "financing", "freeCashFlow"],
} as const satisfies Record<string, readonly string[]>;

type NormalizablePayload = Record<string, unknown> & { source?: unknown };

/**
 * Convert the provably-filled zeros in one `unavailable`-tagged payload to
 * null. Returns the payload UNCHANGED (same reference) when its source is
 * anything else, or when it carries no legacy zero — so a caller can hand the
 * result straight on without a defensive copy.
 */
function normalizePayload(
  payload: unknown,
  fields: readonly string[],
): unknown {
  if (payload === null || typeof payload !== "object") return payload;
  const record = payload as NormalizablePayload;
  // The early return that keeps this off every live record.
  if (record.source !== "unavailable") return payload;

  let patch: Record<string, unknown> | null = null;
  for (const field of fields) {
    if (record[field] === 0) {
      patch ??= {};
      patch[field] = null;
    }
  }
  return patch === null ? payload : { ...record, ...patch };
}

/**
 * Normalize a persisted `financialsData` resource state read back from storage.
 *
 * Apply at every boundary where that resource is read — currently the
 * valuation-spine ingest and the PM commit. Returns the same object when there
 * is nothing to normalize (the post-fix case), so it is safe to call
 * unconditionally on a hot path.
 */
export function normalizeLegacyFinancials<T extends FinancialsDataState | null | undefined>(
  state: T,
): T {
  if (state === null || state === undefined) return state;

  let patch: Record<string, unknown> | null = null;
  for (const [key, fields] of Object.entries(NUMERIC_FIELDS)) {
    const original = (state as Record<string, unknown>)[key];
    const normalized = normalizePayload(original, fields);
    if (normalized !== original) {
      patch ??= {};
      patch[key] = normalized;
    }
  }
  return patch === null ? state : ({ ...state, ...patch } as T);
}
