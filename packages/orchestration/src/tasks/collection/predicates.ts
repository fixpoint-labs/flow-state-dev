/**
 * Wake filters for callers waiting on a task collection (FIX-660).
 *
 * Pair these with `.waitForCondition`'s `wakeOn` option so the predicate
 * is only re-evaluated when an item that could plausibly change its
 * truth value fans out. Without a wake filter, every item event
 * (`resource_change`, `block_trace`, sibling `task-change` for other
 * collections) wakes every subscribed worker — at `eventActors`
 * default `concurrency: 16` and an actor body that patches the
 * workspace on every entry, the per-event scan cost compounds into
 * visible multi-second idle gaps between actor invocations.
 */
import type { OutputItem, ComponentItem } from "@flow-state-dev/core/items";
import type { TaskChangeEvent } from "./change-event";
import { TASK_CHANGE_COMPONENT_TYPE } from "./get-or-create";

/**
 * Wake filter matching `task-change` component items for a specific
 * collection. Returns false for every other item type and for
 * `task-change` items targeting a different collection. Cheap: two
 * equality checks plus a single field read.
 *
 * @example
 *   .waitForCondition(
 *     whenBoardClaimable(collection),
 *     {
 *       timeoutMs: Math.max(idlePollMs * 100, 50),
 *       wakeOn: onTaskChangeFor(collection.collectionId),
 *     }
 *   )
 */
export function onTaskChangeFor(
  collectionId: string
): (item: OutputItem) => boolean {
  return (item) => {
    if (item.type !== "component") return false;
    const c = item as ComponentItem;
    if (c.component !== TASK_CHANGE_COMPONENT_TYPE) return false;
    return (c.data as unknown as TaskChangeEvent).collectionId === collectionId;
  };
}
