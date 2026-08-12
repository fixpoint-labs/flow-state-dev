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
 * The payloads on this resource that carry provider figures.
 *
 * This names the RESOURCE's own shape, not any payload's field list. An earlier
 * version also hand-listed every numeric field per payload, which duplicated
 * `tools/schemas.ts` and drifted SILENTLY: a numeric field added to one of those
 * schemas kept its legacy zero forever, with nothing to say so.
 *
 * Naming the fields turned out to be unnecessary rather than merely risky. The
 * walk below runs ONLY on a payload tagged `source: "unavailable"`, and on such
 * a payload the empty-payload builder is provably the only producer — so every
 * numeric on it is unobserved by construction and there is no live value an
 * "over-broad" walk could damage. The four payloads are flat records of strings
 * and nullable numbers, so testing `=== 0` selects exactly the numeric fields
 * and never a `source` / `ticker` / `asOf` / `unit` string.
 *
 * The three statement payloads already emitted `null` before this issue, so they
 * matter only for records old enough to predate THAT change; they are visited
 * because the same records are still readable and the cost is a lookup.
 */
const PAYLOAD_KEYS = [
  "fundamentals",
  "balanceSheet",
  "incomeStatement",
  "cashflow",
] as const;

type NormalizablePayload = Record<string, unknown> & { source?: unknown };

/**
 * Convert the provably-filled zeros in one `unavailable`-tagged payload to
 * null. Returns the payload UNCHANGED (same reference) when its source is
 * anything else, or when it carries no legacy zero — so a caller can hand the
 * result straight on without a defensive copy.
 */
function normalizePayload(payload: unknown): unknown {
  if (payload === null || typeof payload !== "object") return payload;
  const record = payload as NormalizablePayload;
  // The early return that keeps this off every live record. Everything below
  // is therefore operating on a payload whose every figure is unobserved.
  if (record.source !== "unavailable") return payload;

  let patch: Record<string, unknown> | null = null;
  for (const field of Object.keys(record)) {
    // Strict `=== 0` selects the numeric fields and only those: the string
    // metadata on these payloads can never match, so no key list is needed.
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
  for (const key of PAYLOAD_KEYS) {
    const original = (state as Record<string, unknown>)[key];
    const normalized = normalizePayload(original);
    if (normalized !== original) {
      patch ??= {};
      patch[key] = normalized;
    }
  }
  return patch === null ? state : ({ ...state, ...patch } as T);
}
