/**
 * Detached worker bindings, and how they reach the flow (FIX-982 P2).
 *
 * A task board can declare that a worker runs **outside** the request that
 * claimed its task. Something then has to be able to answer, from strings alone
 * after a restart, "which block runs assignee `implement` on board
 * `issue-work`?" — because the request that made the original routing decision
 * is long gone.
 *
 * The answer is a flow-level map that **nobody authors**. Bindings accumulate
 * the way resource declarations already do: a board stamps them on its drain
 * sequencer, each enclosing sequencer merges its children's up, and `defineFlow`
 * reads the union off each action root. So the binding is re-resolvable from
 * strings, and because it lives outside `flow.actions` it is not reachable from
 * any HTTP or MCP caller.
 *
 * **This module carries no execution.** It declares what a binding is and how
 * two sets of them merge. Assembling the workstream core that routes over them
 * — the thing `flow.workstream` holds and a detached dispatch resolves — is a
 * later step.
 *
 * **Why `core` may name this at all.** A binding's worker is a
 * {@link BlockDefinition}, which `core` already owns. Nothing here names a task,
 * a board, or a collection, so the package graph is untouched: `orchestration`
 * produces bindings, `core` carries them, and neither has to know the other's
 * types.
 */
import type { BlockDefinition } from "./block";

/**
 * One detached worker, addressed by the two strings that survive a restart.
 *
 * Both coordinates are **derived server-side** — `boardId` is authored on the
 * board and `coordinateKey` is computed from the board's own worker
 * declarations. Neither is ever read off a task, a payload, or request metadata
 * (BP-031): a task author names an assignee, and the framework decides what that
 * resolves to.
 */
export type WorkstreamBinding = {
  /**
   * The declaring board's explicit, stable `boardId`.
   *
   * Required rather than derived because it lands in a persisted routing key: a
   * board's `name` is unique per flow rather than per session, and a factory
   * board's `collectionId` is the literal `"factory-supplied"` for every such
   * board, so neither can stand in.
   */
  readonly boardId: string;
  /**
   * Which worker on that board, as an unambiguous string — the encoded form of
   * the board's assignee / uniform / floor coordinate.
   *
   * A plain assignee name would not do: assignee names are unrestricted, so a
   * board may legally declare one that collides with the spelling of the uniform
   * or floor slot. The encoding is the declaring package's to produce; this type
   * only requires that it be stable across restarts.
   */
  readonly coordinateKey: string;
  /** The block that runs this coordinate's work. */
  readonly worker: BlockDefinition<never, never>;
};

/**
 * A flow's detached bindings, keyed by `boardId` + `coordinateKey`.
 *
 * A `Map` rather than a list because merging has to detect a collision, and a
 * list would let the same coordinate appear twice with two different workers —
 * which is not a duplicate, it is an unanswerable routing question.
 */
export type WorkstreamBindings = ReadonlyMap<string, WorkstreamBinding>;

/**
 * The map key for a binding. Length-framed so field boundaries cannot migrate:
 * without it, board `"a"` + coordinate `"b:c"` and board `"a:b"` + coordinate
 * `"c"` produce the same key, and two unrelated workers silently become one.
 */
export function workstreamBindingKey(boardId: string, coordinateKey: string): string {
  return `${boardId.length}:${boardId}|${coordinateKey.length}:${coordinateKey}`;
}

/**
 * Merge two binding sets, returning a new map (never mutating either input).
 *
 * The same binding arriving twice is the ordinary case, not an error: one board
 * drained from two actions bubbles its bindings up both paths. Identity is the
 * **binding object**, which a board creates once when it stamps its drain, so
 * every path that re-encounters that board carries the very same object and
 * deduplicates silently.
 *
 * Identity is deliberately NOT the worker reference. A worker block declared
 * once and reused by two boards is ordinary composition, and under worker
 * identity two such boards sharing a `boardId` would merge into one entry
 * without a word — even though they hold **separate ledgers**. Nothing downstream
 * could then tell the two apart: `workstreamRoutingSeed` frames only
 * `(boardId, coordinate)`, so both boards derive the same child session and
 * interleave two unrelated bodies of work in one history. Framing `boardId` into
 * the seed exists precisely to keep boards apart; letting a shared worker
 * reference collapse them here would hand that guarantee back.
 *
 * Two *distinct* declarations at one coordinate are therefore a build-time throw,
 * whether or not they name the same worker. It cannot be resolved by picking one
 * — a detached dispatch carrying that coordinate would run whichever binding
 * merged last, against whichever ledger came with it. Failing at flow definition
 * is the only point where the author can still see both declarations.
 *
 * @throws {Error} when one coordinate carries two distinct binding declarations.
 */
export function mergeWorkstreamBindings(
  target: WorkstreamBindings | undefined,
  source: WorkstreamBindings | undefined
): WorkstreamBindings | undefined {
  if (source === undefined || source.size === 0) return target;
  if (target === undefined || target.size === 0) return source;

  const merged = new Map(target);
  for (const [key, binding] of source) {
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, binding);
      continue;
    }
    if (existing === binding) continue;
    throw new Error(
      existing.worker === binding.worker
        ? `[workstream] two separate boards share boardId "${binding.boardId}" and both bind ` +
            `coordinate "${binding.coordinateKey}" (to worker "${binding.worker.name}"). Sharing ` +
            `a worker block is fine; sharing a boardId is not — the routing seed is derived from ` +
            `(boardId, coordinate) alone, so the two boards address the same child session and ` +
            `tasks from their separate ledgers would interleave in one history. Give the boards ` +
            `distinct boardIds.`
        : `[workstream] board "${binding.boardId}" declares two different detached workers at ` +
            `coordinate "${binding.coordinateKey}" ("${existing.worker.name}" and ` +
            `"${binding.worker.name}"). A detached dispatch names only the coordinate, so this ` +
            `flow cannot say which block it should run. Give the boards distinct boardIds, or ` +
            `the workers distinct coordinates.`
    );
  }
  return merged;
}

/**
 * Stamp a block's own detached bindings onto it, so they bubble to the flow.
 *
 * **Framework-internal, not an app-author surface.** Nothing an app declares
 * calls this — a board calls it on the drain sequencer it just built, which is
 * the one place that knows both the `boardId` and which workers asked to be
 * detached. It is exported because the board lives in another package, not
 * because it is a public extension point.
 *
 * Assigns in place. The caller owns the block it just constructed, and the
 * sequencer builder already patches its own definition post-construction for the
 * same reason (a tracked output schema); copying instead would hand back an
 * object whose chaining methods still close over the unstamped original.
 *
 * The duplicate check below tests the **worker reference**, where
 * `mergeWorkstreamBindings` tests the binding object — not an inconsistency. The
 * bindings handed here are one board's own, freshly built in a single `.map()`,
 * so no two are ever the same object and object identity could only ever throw.
 * What it is worth catching at this altitude is one board putting two different
 * workers behind coordinate spellings that encode alike. Across boards, where
 * `mergeWorkstreamBindings` runs, a shared worker no longer implies a shared
 * declaration, and object identity is the only test that separates them.
 */
export function declareWorkstreamBindings<
  TBlock extends {
    workstreamBindings?: WorkstreamBindings;
    ownWorkstreamBindings?: WorkstreamBindings;
  }
>(
  block: TBlock,
  bindings: readonly WorkstreamBinding[]
): TBlock {
  if (bindings.length === 0) return block;

  const map = new Map<string, WorkstreamBinding>();
  for (const binding of bindings) {
    const key = workstreamBindingKey(binding.boardId, binding.coordinateKey);
    const existing = map.get(key);
    if (existing !== undefined && existing.worker !== binding.worker) {
      throw new Error(
        `[workstream] board "${binding.boardId}" declares two different detached workers at ` +
          `coordinate "${binding.coordinateKey}" ("${existing.worker.name}" and ` +
          `"${binding.worker.name}").`
      );
    }
    map.set(key, binding);
  }

  // Recorded on BOTH rails. `workstreamBindings` is what every consumer reads;
  // `ownWorkstreamBindings` is what a rebuild carries over, and a stamp is by
  // definition the block's own contribution rather than a child's. Without the
  // second assignment a stamp would survive only until the next `.tap()` or
  // `.rescue()`, which re-derive the bubble-up set from the retained children.
  block.workstreamBindings = mergeWorkstreamBindings(block.workstreamBindings, map);
  block.ownWorkstreamBindings = mergeWorkstreamBindings(block.ownWorkstreamBindings, map);
  return block;
}
