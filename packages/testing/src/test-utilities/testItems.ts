import type { BlockTraceItem, ItemVisibility, OutputItem } from "@flow-state-dev/core/items";
import { resolveItemVisibility } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";

/**
 * Builds item-focused query helpers for deterministic test assertions.
 * Selectors that don't filter by type (`all`, `sideChain`, `main`, `byAgent`,
 * `byVisibility`) return every matching row, trace rows included, so they are
 * typed `RuntimeItem[]`.
 */
export function testItems(items: readonly RuntimeItem[]) {
  const allItems = [...items].sort((left, right) => left.itemIndex - right.itemIndex);

  return {
    all(): RuntimeItem[] {
      return allItems;
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
    sideChain(): RuntimeItem[] {
      return allItems.filter((item) => item.provenance.phase === "sideChain");
    },
    main(): RuntimeItem[] {
      return allItems.filter((item) => item.provenance.phase === "main");
    },
    byAgent(agentName: string): RuntimeItem[] {
      return allItems.filter((item) => item.agentName === agentName);
    },
    byVisibility(predicate: Partial<ItemVisibility>): RuntimeItem[] {
      return allItems.filter((item) => {
        const vis = resolveItemVisibility(item);
        if (predicate.client !== undefined && vis.client !== predicate.client) return false;
        if (predicate.history !== undefined && vis.history !== predicate.history) return false;
        return true;
      });
    }
  };
}
