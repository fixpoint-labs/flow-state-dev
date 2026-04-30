/**
 * Item inference helpers for deriving thinking style from the session item stream.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { ThinkingStyle } from "@/components/thinking-style-selector";

type ComponentItem = OutputItem & { type: "component"; component: string; key?: string };
type BlockOutputItem = OutputItem & {
  type: "block_output";
  blockName: string;
};

/**
 * Infers the thinking style from a set of items by looking for task-board-meta
 * component items or supervisor block outputs.
 */
export function inferThinkingStyle(items: OutputItem[]): ThinkingStyle | null {
  const boardMetaItems = items.filter(
    (i) => i.type === "component" && (i as ComponentItem).component === "task-board-meta",
  ) as ComponentItem[];

  if (boardMetaItems.length > 0) {
    const isSupervisor = boardMetaItems.some((i) => i.key?.includes("supervisor"));
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
