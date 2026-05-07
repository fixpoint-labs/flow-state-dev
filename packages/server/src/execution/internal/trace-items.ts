/**
 * Block trace item helpers (FIX-573).
 *
 * Replaces the prior split between `block_output` (terminal) and `block_debug`
 * (start-time) with a single `block_trace` item that's emitted at block start
 * (status: "in_progress") and patched in place as more becomes known. The
 * helpers in this file own:
 *   - emitting the initial in_progress trace for nested blocks (called from
 *     `_withExecutionScope` so every block in the chain gets a trace row),
 *   - bookkeeping the per-request `Map<blockInstanceId, BlockTraceItem>` so
 *     subsequent phase patches can look up the row to update.
 *
 * Emission is gated by `isTraceObservabilityEnabled()` — the same gate used
 * by sequencer state snapshots so a single env var toggles all observability
 * output.
 */
import type {
  BlockTraceItem,
  ItemProvenance,
} from "@flow-state-dev/core/items";
import type { ExecutionParent } from "@flow-state-dev/core/types";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";

/**
 * Construct the initial `in_progress` block_trace item for a nested block.
 * Caller is responsible for emitting `item.added` and stashing the item in
 * the per-request trace map so phase patches can locate it.
 */
export function buildInitialBlockTraceItem(args: {
  parent: ExecutionParent;
  startedAt: number;
  requestId: string;
  itemIndex: number;
  ownedBy?: string;
  inputSource?: BlockTraceItem["input"] extends { source: infer S } | undefined ? S : never;
}): BlockTraceItem {
  const provenance: ItemProvenance = {
    blockName: args.parent.name,
    blockInstanceId: args.parent.instanceId,
    parentBlockInstanceId: args.parent.parentInstanceId,
    phase: args.parent.phase ?? "main",
  };
  return {
    id: `item_block_trace_${args.itemIndex}_${Math.random().toString(16).slice(2)}`,
    type: "block_trace",
    status: "in_progress",
    transient: args.parent.transient || undefined,
    requestId: args.requestId,
    itemIndex: args.itemIndex,
    provenance,
    ts: args.startedAt,
    ownedBy: args.ownedBy,
    agentType: "trace",
    blockName: args.parent.name,
    blockKind: args.parent.kind,
    blockInstanceId: args.parent.instanceId,
    input:
      args.inputSource === undefined
        ? undefined
        : { source: args.inputSource as never },
    startedAt: args.startedAt,
  };
}

/**
 * Emit the initial in_progress block_trace item for a nested block. Wired by
 * the server when trace observability is enabled; no-op otherwise. Used as
 * the `_runtimeHooks.emitNestedBlockTrace` adapter when we need to seed the
 * trace map ahead of the block's own `added` capture.
 *
 * Implementation note: the runtime preferentially fires the `added`-phase
 * `onBlockTraceCapture` from build-block.ts; this helper is retained as the
 * named entry point the spec requires and as a hook used by adapters that
 * compose around block execution.
 */
export function emitNestedBlockTrace(
  parent: ExecutionParent,
  args: {
    startedAt: number;
    requestId: string;
    itemIndex: number;
    ownedBy?: string;
  },
  emit: (item: BlockTraceItem) => void
): BlockTraceItem | undefined {
  if (!isTraceObservabilityEnabled()) return undefined;
  const item = buildInitialBlockTraceItem({
    parent,
    startedAt: args.startedAt,
    requestId: args.requestId,
    itemIndex: args.itemIndex,
    ownedBy: args.ownedBy,
  });
  emit(item);
  return item;
}
