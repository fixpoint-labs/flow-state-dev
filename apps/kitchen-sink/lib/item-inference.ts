/**
 * Item inference helpers for deriving thinking style from the session item stream.
 */
import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import type { ThinkingStyle } from "@/components/thinking-style-selector";

type ComponentItem = OutputItem & {
  type: "component";
  component: string;
  key?: string;
  data?: { collectionId?: string };
};
type ContainerItem = OutputItem & { type: "container"; container?: string };

/**
 * Infers the thinking style from a set of items.
 *
 * Priority order:
 * 1. routedSpecialists container → routed-specialists
 * 2. evented-actors container → evented-actors
 * 3. task-board-meta with collectionId starting with `eventActors:` →
 *    evented-actors (the pattern wraps a taskBoard internally and that
 *    inner board emits its own meta items)
 * 4. task-board-meta with key including "supervisor" → supervisor
 * 5. supervisor block_output → supervisor
 * 6. any task-board-meta → plan-and-execute (catch-all for the other
 *    taskBoard-backed pattern)
 */
export function inferThinkingStyle(items: OutputItem[]): ThinkingStyle | null {
  for (const i of items) {
    if (i.type === "container") {
      const c = (i as ContainerItem).container;
      if (c === "routedSpecialists") return "routed-specialists";
      if (c === "evented-actors") return "evented-actors";
    }
  }

  const boardMetaItems = items.filter(
    (i) =>
      i.type === "component" &&
      (i as ComponentItem).component === "task-board-meta",
  ) as ComponentItem[];

  if (boardMetaItems.length > 0) {
    const isEventedActors = boardMetaItems.some((i) =>
      i.data?.collectionId?.startsWith("eventActors:"),
    );
    if (isEventedActors) return "evented-actors";

    const isSupervisor = boardMetaItems.some((i) => i.key?.includes("supervisor"));
    return isSupervisor ? "supervisor" : "plan-and-execute";
  }

  const hasSupervisor = items.some(
    (i) =>
      (i as { type: string }).type === "block_output" &&
      (i as unknown as BlockOutputItem).blockName.includes("supervisor"),
  );
  if (hasSupervisor) return "supervisor";

  return null;
}
