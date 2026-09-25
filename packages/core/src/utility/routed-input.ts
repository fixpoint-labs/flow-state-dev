/**
 * The input adapter a routing utility puts on each block it routes to.
 *
 * `intentRouter` and `cascadingRouter` both hand their routes an envelope
 * (the original input plus the decision) and route to the author's blocks,
 * which expect the original input. Each route block therefore gets a
 * `connectInput` that picks the input out of the envelope.
 *
 * Two things every such adapter must get right, kept here once:
 *
 * - **Compose with the block's own connector.** A non-sequencer block holds a
 *   single `connectInput`, and calling `connectInput` again replaces it. So a
 *   route block that already adapts its input (`billing.connectInput(toCase)`)
 *   would silently lose that adapter. The pick runs first, then the block's
 *   own connector. A sequencer's `connectInput` prepends a step, so it
 *   composes on its own.
 * - **One wrapper per distinct block.** `router()` refuses two different
 *   definitions sharing a name, so a block routed under two keys (or also
 *   used as the fallback) must be wrapped once and reused.
 */
import type { BlockContext, BlockDefinition, ConnectorFn } from "../types/block";

/**
 * Build a memoized adapter: `adapt(block)` returns `block` with `pick`
 * applied to its input before the block's own `connectInput`, the same
 * wrapper for the same block every time.
 *
 * @param pick - Extracts the original input from the router's envelope.
 */
export function routedInputAdapter<TEnvelope>(
  pick: (envelope: TEnvelope) => unknown
): (block: BlockDefinition) => BlockDefinition {
  const wrappers = new Map<BlockDefinition, BlockDefinition>();
  return (block) => {
    let wrapped = wrappers.get(block);
    if (wrapped === undefined) {
      const own = block.kind === "sequencer" ? undefined : (block.config.connectInput as ConnectorFn<unknown, unknown> | undefined);
      wrapped =
        own === undefined
          ? block.connectInput((envelope: TEnvelope) => pick(envelope))
          : block.connectInput((envelope: TEnvelope, ctx: BlockContext) => own(pick(envelope), ctx));
      wrappers.set(block, wrapped);
    }
    return wrapped;
  };
}
