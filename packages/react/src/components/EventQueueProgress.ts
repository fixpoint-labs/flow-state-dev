/**
 * Kitchen-sink visualization component for the Event Queue pattern.
 *
 * Renders from emitted `block_output` items where `blockName` matches the
 * dispatch block (`${queueName}-dispatch`). Shows events processed — not live
 * queue depth (sequencer state is not accessible from clientData).
 *
 * For live queue depth, add a `.tap()` step that mirrors `queue.length` to
 * session state. See the Event Queue pattern docs for that workaround.
 */
import { createElement, type ReactNode } from "react";
import type { BlockOutputItem, BlockValue, OutputItem } from "@flow-state-dev/core/items";

/**
 * Inline BlockValue resolver (FIX-413). See AuditAnnotationProgress.ts for
 * rationale — the react package cannot import runtime values from core.
 */
function resolveValue(value: BlockValue<unknown> | undefined, items: readonly OutputItem[]): unknown {
  if (value === undefined) return undefined;
  if (value.kind === "inline") return value.value;
  if (value.kind === "ref") {
    const target = items.find((i) => i.id === value.sourceItemId && i.type === "block_output") as BlockOutputItem | undefined;
    return target === undefined ? undefined : resolveValue(target.output, items);
  }
  if (value.shape.container === "array") {
    return value.shape.entries.map((entry) => resolveValue(entry, items));
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value.shape.entries)) {
    result[k] = resolveValue(v, items);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EventQueueProgressProps {
  /** Stream items from the request (e.g., from useSession or useRequestStream). */
  items: OutputItem[];
  /** The `name` value passed to the `eventQueue()` factory config. */
  queueName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a summary of events dispatched by an event queue sequencer.
 * Filters `block_output` items for the dispatch block and shows each
 * event type processed.
 */
export function EventQueueProgress({
  items,
  queueName,
}: EventQueueProgressProps): ReactNode {
  const dispatchBlockName = `${queueName}-dispatch`;

  const dispatched = items.filter(
    (item) =>
      item.type === "block_output" &&
      "blockName" in item &&
      item.blockName === dispatchBlockName
  );

  if (dispatched.length === 0) {
    return createElement("div", null, "No events processed yet.");
  }

  return createElement(
    "div",
    null,
    createElement("span", null, `${dispatched.length} events processed`),
    ...dispatched.map((item, i) => {
      // Resolve BlockValue union to its typed payload (FIX-413).
      const resolved = resolveValue(
        (item as BlockOutputItem).output,
        items,
      ) as { event?: { type?: string } } | undefined;
      const eventType = resolved?.event?.type ?? "unknown";
      return createElement("div", { key: i }, createElement("code", null, eventType));
    })
  );
}
