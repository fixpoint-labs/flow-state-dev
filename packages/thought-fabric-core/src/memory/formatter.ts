/**
 * Simplified `mem.contextFormatter` ([FIX-407]).
 *
 * Emits the rolling digest ([FIX-408]) and working-memory entries ([FIX-199]).
 * Semantic facts and episodic memories are intentionally absent — the agent
 * retrieves those on demand via the recall tool ([FIX-409]). The combined
 * output is naturally bounded by the digest's `maxTokens` (default 400) and
 * the working-memory capacity (default 7), so no separate budget contract is
 * needed.
 *
 * The framework wraps this entry in a `<memory>` tag automatically based on
 * the key it's registered under (e.g. `context: { memory: contextFormatter }`),
 * so this function returns only the inner content.
 */
import { formatForContext } from './working-memory-helpers.js'
import type { Digest } from './digest-memory.js'

/** Object-shaped return type understood by the context aggregator. */
type MemoryContextValue =
  | { digest?: string; working?: string }
  | undefined

/**
 * Build the simplified context formatter.
 *
 * Returns an object whose keys become nested XML tags under the parent key
 * the formatter is registered against. With `context: { memory: fn }` and a
 * return of `{ digest, working }`, the framework renders
 * `<memory><digest>…</digest><working>…</working></memory>`. Returning an
 * object (rather than a pre-formatted string with embedded tags) is what
 * lets the framework treat each tag as structure — string-leaf values are
 * XML-escaped before rendering, which would garble nested tags in the
 * combined system message.
 *
 * Possible return shapes:
 * - `{ digest, working }` when both are present
 * - `{ digest }` when only the digest has content
 * - `{ working }` when only working memory is non-empty
 * - `undefined` when both are empty (the framework signal to skip the section)
 *
 * `hasDigest` reflects whether the system was configured with a digest tier;
 * the formatter still reads defensively so missing/empty digest content never
 * produces an empty section.
 */
export function createContextFormatter(hasDigest: boolean) {
  return function contextFormatter(_input: unknown, ctx: any): MemoryContextValue {
    const wmRef = ctx.resources?.workingMemory
    const workingText = wmRef ? formatForContext(wmRef) : ''

    let digestText = ''
    if (hasDigest) {
      try {
        const digestRef = ctx.resources?.digestMemory
        const stored = digestRef?.state?.digest as Digest | undefined
        digestText = stored?.content?.trim() ?? ''
      } catch {
        // Digest resource not available in this scope; treat as absent.
      }
    }

    if (!digestText && !workingText) return undefined

    const out: { digest?: string; working?: string } = {}
    if (digestText) out.digest = digestText
    if (workingText) out.working = workingText
    return out
  }
}
