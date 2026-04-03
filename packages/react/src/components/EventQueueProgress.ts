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
import type { OutputItem } from "@flow-state-dev/core/items";

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
      const eventType =
        item.type === "block_output" && "output" in item
          ? ((item as Record<string, unknown>).output as { event?: { type?: string } })
              ?.event?.type ?? "unknown"
          : "unknown";
      return createElement("div", { key: i }, createElement("code", null, eventType));
    })
  );
}
