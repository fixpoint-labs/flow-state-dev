/**
 * Collection renderer for a conversation: its lines, from the conversation
 * model ({@link conversationLines}), drawn in order through the renderer
 * registry.
 *
 * Lines are rendered in the order provided — callers (useSession, etc.)
 * are responsible for sorting the items they come from.
 */
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useFlowContext } from "../context/FlowContext";
import { resolveRenderer } from "../registry/block-renderers";
import { conversationLines, type ActivityItem, type ItemLine } from "./conversation-lines";
import { ItemRenderer } from "./ItemRenderer";

/**
 * Props for rendering a conversation: its lines, or its items.
 */
export type ItemsRendererProps = {
  /**
   * The lines to draw, from {@link conversationLines}, computed where the
   * items and turns change. Given these, `items` and the filters are ignored.
   */
  lines?: readonly ItemLine[];
  /** The items to draw when no `lines` are given: read as `conversationLines(items)`, with no turns. */
  items?: OutputItem[];
  /**
   * With `items`: when true (default), data items that carry a stable `key`
   * are deduplicated: only the latest snapshot per key is rendered, replacing
   * earlier ones in-place. Set to false to render all snapshots.
   */
  deduplicateByKey?: boolean;
  /**
   * With `items`: when true, items with `history: false` visibility
   * (sub-agent output) are rendered inline with the rest of the stream.
   * Default: false — those items are filtered out of the default
   * conversation view. The data still flows through `useSession().items`;
   * use a custom renderer (e.g., a per-agent panel) to surface it explicitly.
   */
  showSubAgents?: boolean;
  /**
   * Draws a `steps` line (one turn's tool calls and the thinking between
   * them) as one unit: it receives the line's items, in order, and the line
   * itself (`ended` once its turn is over). Without it,
   * each of a steps line's items renders through the registry on its own.
   */
  toolGroupRenderer?: ComponentType<{ items: ActivityItem[]; live?: boolean; line: Extract<ItemLine, { kind: "steps" }> }>;
  /**
   * The stream is still open after the last of these lines. The steps
   * renderer is then told, as `live`, which steps line is the trailing one:
   * the agent's working that no message has yet ended.
   */
  live?: boolean;
};

/** A stopped turn's line when the registry has no `stopped` renderer. */
function renderStoppedFallback(): ReactNode {
  return createElement("div", { "data-line": "stopped", style: { opacity: 0.7, fontSize: 13 } }, "Stopped");
}

/**
 * Renders a conversation's lines in the order given.
 *
 * Each line draws through the renderer registry: a message, an error, a
 * suspension or a `data` item by its own slot, as `ItemRenderer` resolves it,
 * with the line handed to a registered renderer beside the item (`line`), so
 * it can read what the model decided (a failed line's `retryable`, an
 * assistant line's `streaming`). A `steps` line draws through
 * `toolGroupRenderer`, else item by item; a `stopped` line through the
 * registry's `stopped` slot, else a plain "Stopped".
 *
 * Given `items` and no `lines`, it draws `conversationLines(items)`.
 */
export function ItemsRenderer(props: ItemsRendererProps): ReactNode[] {
  const { deduplicateByKey = true, showSubAgents = false, toolGroupRenderer } = props;
  const { renderers } = useFlowContext();

  const lines = props.lines ?? conversationLines(props.items ?? [], [], { renderers, deduplicateByKey, showSubAgents });

  return lines.map((line, index) => {
    switch (line.kind) {
      case "steps": {
        if (toolGroupRenderer === undefined) {
          return createElement(Fragment, { key: line.id }, ...line.items.map((item) => createElement(ItemRenderer, { item, key: item.id })));
        }
        return createElement(
          Fragment,
          { key: `tool-group-${line.id}` },
          createElement(toolGroupRenderer, { items: line.items, live: props.live === true && index === lines.length - 1, line })
        );
      }
      case "stopped": {
        const stopped = resolveRenderer(renderers, "stopped");
        if (stopped === false) return null;
        return createElement(Fragment, { key: line.id }, stopped === undefined ? renderStoppedFallback() : createElement(stopped, { line }));
      }
      case "suspension":
        return createElement(ItemRenderer, { item: line.item, key: line.id, line, isResolved: line.resolution !== undefined, resolution: line.resolution });
      default:
        return createElement(ItemRenderer, { item: line.item, key: line.id, line });
    }
  });
}
