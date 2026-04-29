/**
 * Adapter wiring `BlockContext` → `task_change` emission.
 *
 * Splits the runtime concerns (requestId, provenance) out of the
 * collection backings so the backings stay testable without a full
 * `BlockContext`. Tests can pass their own `emit` + `frame` directly.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type {
  TaskChangeEmissionFrame,
  TaskChangeItem,
} from "./task-change";

/**
 * Build the emission frame from a `BlockContext`.
 *
 * Note on `nextItemIndex`: the server's response emitter reassigns
 * `itemIndex` from its own monotonic counter when items go through
 * `emit({ type: "item.added", ... })` — so the local counter here
 * exists only to satisfy the structural `isOutputItem` check and
 * doesn't need to coordinate with the runtime stream order.
 */
export function buildEmissionFrame(ctx: BlockContext): TaskChangeEmissionFrame {
  const requestId = ctx.request?.identity.id ?? "";
  const identity = ctx._blockIdentity;
  const ownedBy = identity?.ownedBy;

  let localCounter = 0;
  return {
    requestId,
    nextItemIndex: () => ++localCounter,
    ownedBy,
    provenance: () => ({
      blockName: identity?.blockName ?? "tasks",
      blockInstanceId: identity?.blockInstanceId ?? "tasks",
      parentBlockInstanceId: identity?.parentBlockInstanceId,
      phase: identity?.phase ?? "main",
      attempt: identity?.attempt,
    }),
  };
}

/**
 * Build the emit function from a `BlockContext`. Pushes the item
 * through `ctx.response.emit` as `item.added` followed by `item.done` —
 * the stream consumer treats these as a single completed item.
 */
export function buildEmitter(ctx: BlockContext): (item: TaskChangeItem) => void {
  const response = ctx.response;
  return (item: TaskChangeItem) => {
    void response.emit({ type: "item.added", item });
    void response.emit({ type: "item.done", item });
  };
}
