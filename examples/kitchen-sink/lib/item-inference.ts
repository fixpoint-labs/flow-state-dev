/**
 * Item inference helpers for deriving resolved model and thinking style
 * from the session item stream.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { ThinkingStyle } from "@/components/thinking-style-selector";

type ComponentItem = OutputItem & { type: "component"; component: string; key?: string };
type BlockOutputItem = OutputItem & {
  type: "block_output";
  blockName: string;
  modelUsage?: { model: string };
};

/**
 * Infers the thinking style from a set of items by looking for plan-meta
 * component items or supervisor block outputs.
 */
export function inferThinkingStyle(items: OutputItem[]): ThinkingStyle | null {
  const planMetaItems = items.filter(
    (i) => i.type === "component" && (i as ComponentItem).component === "plan-meta",
  ) as ComponentItem[];

  if (planMetaItems.length > 0) {
    const isSupervisor = planMetaItems.some((i) => i.key?.includes("supervisor"));
    return isSupervisor ? "supervisor" : "plan-and-execute";
  }

  const hasSupervisor = items.some(
    (i) =>
      i.type === "block_output" &&
      (i as BlockOutputItem).blockName.includes("supervisor"),
  );
  if (hasSupervisor) return "supervisor";

  return null;
}

/**
 * Returns the resolved model string from the most recent block_output item
 * that has modelUsage metadata.
 */
export function inferResolvedModel(items: OutputItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type === "block_output") {
      const blockItem = item as BlockOutputItem;
      if (blockItem.modelUsage?.model) {
        return blockItem.modelUsage.model;
      }
    }
  }
  return undefined;
}
