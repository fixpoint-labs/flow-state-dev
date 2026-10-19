import type { BlockTraceItem, ItemVisibility, OutputItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";

/**
 * Builds item-focused query helpers for deterministic test assertions.
 *
 * Takes the runtime item log (`RuntimeItem[]`), trace rows included, since
 * `blockOutputs()` reads the `block_trace` rows. The helpers that return a
 * plain item list keep the public `OutputItem` type; trace rows are reached
 * through `blockOutputs()`.
 */
export function testItems(items: readonly RuntimeItem[]) {
  const allItems = [...items].sort((left, right) => left.itemIndex - right.itemIndex);
  const listed = allItems as OutputItem[];

  return {
    all(): OutputItem[] {
      return listed;
    },
    byType<TType extends OutputItem["type"]>(
      type: TType
    ): Array<Extract<OutputItem, { type: TType }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: TType }> => item.type === type
      );
    },
    messages(): Array<Extract<OutputItem, { type: "message" }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: "message" }> => item.type === "message"
      );
    },
    errors(): Array<Extract<OutputItem, { type: "error" }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: "error" }> => item.type === "error"
      );
    },
    blockOutputs(blockName?: string): BlockTraceItem[] {
      return allItems.filter(
        (item): item is BlockTraceItem => {
          if (item.type !== "block_trace") {
            return false;
          }
          if (blockName === undefined) {
            return true;
          }
          return item.blockName === blockName;
        }
      );
    },
    components(componentName?: string): Array<Extract<OutputItem, { type: "component" }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: "component" }> => {
          if (item.type !== "component") {
            return false;
          }

          if (componentName === undefined) {
            return true;
          }

          return item.component === componentName;
        }
      );
    },
    sideChain(): OutputItem[] {
      return listed.filter((item) => item.provenance.phase === "sideChain");
    },
    main(): OutputItem[] {
      return listed.filter((item) => item.provenance.phase === "main");
    },
    byAgent(agentName: string): OutputItem[] {
      return listed.filter((item) => item.agentName === agentName);
    },
    byVisibility(predicate: Partial<ItemVisibility>): OutputItem[] {
      return listed.filter((item) => {
        const vis = resolveItemVisibility(item);
        if (predicate.client !== undefined && vis.client !== predicate.client) return false;
        if (predicate.history !== undefined && vis.history !== predicate.history) return false;
        return true;
      });
    }
  };
}
