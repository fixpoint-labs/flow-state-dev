import type { AgentType, BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";

/**
 * Builds item-focused query helpers for deterministic test assertions.
 */
export function testItems(items: OutputItem[]) {
  const allItems = [...items].sort((left, right) => left.itemIndex - right.itemIndex);

  return {
    all(): OutputItem[] {
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
    blockOutputs(blockName?: string): BlockOutputItem[] {
      return (allItems as Array<OutputItem | BlockOutputItem>).filter(
        (item): item is BlockOutputItem => {
          if ((item as { type: string }).type !== "block_output") {
            return false;
          }
          if (blockName === undefined) {
            return true;
          }
          return (item as BlockOutputItem).blockName === blockName;
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
    work(): OutputItem[] {
      return allItems.filter((item) => item.provenance.phase === "work");
    },
    main(): OutputItem[] {
      return allItems.filter((item) => item.provenance.phase === "main");
    },
    byAgent(agentName: string): OutputItem[] {
      return allItems.filter((item) => item.agentName === agentName);
    },
    byAgentType(agentType: AgentType): OutputItem[] {
      return allItems.filter((item) => item.agentType === agentType);
    }
  };
}
