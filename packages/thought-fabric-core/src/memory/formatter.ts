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

/**
 * Build the simplified context formatter.
 *
 * The returned function reads working memory and (when configured) the digest
 * resource from `ctx.resources`, then emits one of:
 * - `<digest>{digest}</digest>\n<working>{wm}</working>` when both are present
 * - `<digest>{digest}</digest>` when only the digest has content
 * - `<working>{wm}</working>` when only working memory is non-empty
 * - `undefined` when both are empty (the framework signal to skip the section)
 *
 * `hasDigest` reflects whether the system was configured with a digest tier;
 * the formatter still reads defensively so missing/empty digest content never
 * produces an empty section.
 */
export function createContextFormatter(hasDigest: boolean) {
  return function contextFormatter(_input: unknown, ctx: any): string | undefined {
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

    const parts: string[] = []
    if (digestText) parts.push('<digest>', digestText, '</digest>')
    if (workingText) parts.push('<working>', workingText, '</working>')

    return parts.join('\n')
  }
}
