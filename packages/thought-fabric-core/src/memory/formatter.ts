/**
 * Simplified `mem.contextFormatter` ([FIX-407]).
 *
 * Emits a bounded `<memory>` block containing only the rolling digest
 * ([FIX-408]) and working-memory entries ([FIX-199]). Semantic facts and
 * episodic memories are intentionally absent — the agent retrieves those on
 * demand via the recall tool ([FIX-409]). The combined output is naturally
 * bounded by the digest's `maxTokens` (default 400) and the working-memory
 * capacity (default 7), so no separate budget contract is needed.
 */
import { formatForContext } from './working-memory-helpers.js'
import type { Digest } from './digest-memory.js'

/**
 * Build the simplified context formatter.
 *
 * The returned function reads working memory and (when configured) the digest
 * resource from `ctx.resources`, then emits one of:
 * - `<memory>{digest}\n<working>{wm}</working></memory>` when both are present
 * - `<memory>{digest}</memory>` when only the digest has content
 * - `<memory><working>{wm}</working></memory>` when only working memory is non-empty
 * - `undefined` when both are empty (the framework signal to skip the section)
 *
 * `hasDigest` reflects whether the system was configured with a digest tier;
 * the formatter still reads defensively so missing/empty digest content never
 * produces an empty `<memory>` shell.
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

    const parts: string[] = ['<memory>']
    if (digestText) parts.push(digestText)
    if (workingText) parts.push('<working>', workingText, '</working>')
    parts.push('</memory>')

    return parts.join('\n')
  }
}
