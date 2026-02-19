import type { OutputItem } from "@flow-state-dev/core/items";

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
    functionCalls(): Array<Extract<OutputItem, { type: "function_call" }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: "function_call" }> => item.type === "function_call"
      );
    },
    functionCallOutputs(): Array<Extract<OutputItem, { type: "function_call_output" }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: "function_call_output" }> =>
          item.type === "function_call_output"
      );
    },
    errors(): Array<Extract<OutputItem, { type: "fsd:error" | "fsd:step_error" }>> {
      return allItems.filter(
        (
          item
        ): item is Extract<OutputItem, { type: "fsd:error" | "fsd:step_error" }> =>
          item.type === "fsd:error" || item.type === "fsd:step_error"
      );
    },
    blockOutputs(blockName?: string): Array<Extract<OutputItem, { type: "fsd:block_output" }>> {
      return allItems.filter(
        (item): item is Extract<OutputItem, { type: "fsd:block_output" }> => {
          if (item.type !== "fsd:block_output") {
            return false;
          }

          if (blockName === undefined) {
            return true;
          }

          return item.blockName === blockName;
        }
      );
    },
    work(): OutputItem[] {
      return allItems.filter((item) => item.provenance.phase === "work");
    },
    main(): OutputItem[] {
      return allItems.filter((item) => item.provenance.phase === "main");
    }
  };
}
