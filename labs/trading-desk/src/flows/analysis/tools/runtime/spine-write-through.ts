/**
 * Subject-scoped tool write-through: the session data spine for the subject,
 * the process cache for everyone else.
 *
 * A session is keyed to one subject ticker, and the data spine holds that
 * subject's payloads addressed by field name. Every Phase 1 data tool whose
 * result a cross-phase consumer (compute-spine, store-price-history) re-reads
 * routes through here, so that read is a stable per-session copy rather than a
 * warm process cache that can age out between phases.
 *
 *  - `toSpine: true` → fetch once into `resource[field]` via `getOrPatchState`.
 *    The field is declared `.optional()` on the resource (absent until first
 *    fetched), so `getOrPatchState` is typed `… | undefined`; the loader always
 *    resolves to a payload, so narrowing the result to `T` is sound.
 *  - `toSpine: false` → bypass the spine and use the args-keyed process cache
 *    (`getOrFetch`). A peer / benchmark / off-range probe must NOT land on the
 *    single named spine field — it would mislabel or clobber the subject's copy
 *    (real-money gate) — but is still deduped within the run by its args.
 *
 * `toSpine` is the per-tool gate: the eight valuation tools pass
 * `input.ticker === sessionTicker`; the price tool also requires the canonical
 * summary range, since `priceBars` can hold only one series.
 */
import { getOrFetch } from "@/src/lib/cache";
import type { ToolName } from "../schemas";

/** The slice of a resource ref this helper needs — a single named-field writer. */
interface SpineFieldWriter {
  getOrPatchState(key: string, compute: () => Promise<unknown>): Promise<unknown>;
}

/** Route a subject tool payload to the spine or the cache. See the file header. */
export function writeSubjectSpine<T>(opts: {
  toSpine: boolean;
  resource: SpineFieldWriter;
  field: string;
  tool: ToolName;
  input: unknown;
  load: () => Promise<T>;
}): Promise<T> {
  const { toSpine, resource, field, tool, input, load } = opts;
  if (!toSpine) return getOrFetch(tool, input, load);
  return resource.getOrPatchState(field, load as () => Promise<unknown>) as Promise<T>;
}
