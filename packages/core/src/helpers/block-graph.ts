/**
 * Walking a block graph — every block reachable from a set of roots.
 *
 * Two callers on opposite sides of an import edge need the SAME walk.
 * `defineFlow` walks the action roots to resolve dispatch targets and to
 * collect the flow-config requirements a mint must check; `generator` walks
 * the blocks a function-valued `tools` slot returns, which `defineFlow`'s walk
 * cannot see. `defineFlow` already imports `generator`, so the walk cannot
 * live in either.
 *
 * It lives here rather than being written twice on purpose: a check that
 * traverses one level shallower than the walk it mirrors is invisible — it
 * type-checks, it runs, and it silently passes the case it was meant to catch.
 */
import type { BlockDefinition } from "../types/block";

/**
 * A generator's **statically declared** tools, or nothing (FIX-1074).
 *
 * `tools` is a `ToolsSlot` — an array, or a function resolved per call with the
 * input and context in hand. Only the array is knowable at definition time, and
 * the function form is genuinely unknowable rather than merely inconvenient:
 * what it returns depends on runtime values that do not exist yet. That is why
 * `generator` re-walks what the function returned, once it has.
 */
function staticTools(block: BlockDefinition): readonly BlockDefinition[] {
  const tools = (block.config as { tools?: unknown }).tools;
  return Array.isArray(tools) ? (tools as BlockDefinition[]) : [];
}

/**
 * Every block reachable from the roots, through composition AND through a
 * generator's static `tools` array.
 *
 * **The tool edge is here because a board can be handed to a model as a tool**
 * (`tools: [board.drain]`, the shape FIX-925 shipped). Without it a board
 * reached only that way was invisible to the walk: its dispatcher seats went
 * unresolved, so the first time the model called the tool the board failed on
 * a configuration the author had every reason to think was supported
 * (FIX-1074).
 *
 * Only the dispatch walk needs the tool edge. Resources and `requiresOrg` are
 * collected off the action roots, and a handed-off board's ledger reaches the
 * flow through the task entry its seat addresses — an action root of its own —
 * so a board reached only as a tool still lands its declarations.
 *
 * A block is visited once: blocks are shared freely (one handler across several
 * actions) and a router route may point back up the tree, so revisits and cycles
 * are ordinary rather than exceptional.
 */
export function walkBlockGraph(roots: readonly BlockDefinition[]): BlockDefinition[] {
  const seen = new Set<BlockDefinition>();
  const queue: BlockDefinition[] = [...roots];
  while (queue.length > 0) {
    const block = queue.pop()!;
    if (seen.has(block)) continue;
    seen.add(block);
    // Rescue handlers installed via `config.rescue` are already folded into
    // `childBlocks` by `buildBlock`.
    queue.push(...(block.childBlocks ?? []));
    queue.push(...staticTools(block));
  }
  return [...seen];
}
