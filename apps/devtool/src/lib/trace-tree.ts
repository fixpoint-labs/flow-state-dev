import type { BlockOutputItem, OutputItem } from "@flow-state-dev/core/items";
import type { RequestGroup } from "@/components/workspace/stream-view";

export type TraceNode = {
  type: "request" | "block" | "item";
  id: string;
  requestId?: string;
  action?: string;
  status?: string;
  duration?: number;
  blockName?: string;
  blockKind?: string;
  blockInstanceId?: string;
  blockStatus?: string;
  blockDuration?: number;
  blockStartedAt?: number;
  blockCompletedAt?: number;
  item?: OutputItem;
  children: TraceNode[];
  isExpanded: boolean;
};

export function buildTraceTree(requestGroups: RequestGroup[]): TraceNode[] {
  return requestGroups.map((group, groupIndex) => {
    const isLast = groupIndex === requestGroups.length - 1;
    const blockMap = new Map<string, TraceNode>();
    const rootBlocks: TraceNode[] = [];
    const orphanItems: TraceNode[] = [];

    for (const item of group.items) {
      const prov = item.provenance;
      if (!prov) {
        orphanItems.push({
          type: "item",
          id: item.id,
          item,
          children: [],
          isExpanded: false,
        });
        continue;
      }

      let blockNode = blockMap.get(prov.blockInstanceId);
      if (!blockNode) {
        blockNode = {
          type: "block",
          id: `block-${prov.blockInstanceId}`,
          blockName: prov.blockName,
          blockKind: undefined,
          blockInstanceId: prov.blockInstanceId,
          blockStatus: "in_progress",
          children: [],
          isExpanded: isLast,
        };
        blockMap.set(prov.blockInstanceId, blockNode);
      }

      blockNode.children.push({
        type: "item",
        id: item.id,
        item,
        children: [],
        isExpanded: false,
      });

      if (item.type === "block_output") {
        const bo = item as BlockOutputItem;
        // Prefer explicit blockKind from lifecycle metadata over inference.
        blockNode.blockKind = blockNode.blockKind ?? bo.blockKind ?? inferBlockKind(item);
        // Use precise timing from lifecycle items when available.
        if (bo.startedAt !== undefined) {
          blockNode.blockStartedAt = bo.startedAt;
        }
        if (bo.completedAt !== undefined) {
          blockNode.blockCompletedAt = bo.completedAt;
        }
        if (bo.duration !== undefined) {
          blockNode.blockDuration = bo.duration;
        }
        if (item.status === "completed") blockNode.blockStatus = "completed";
        if (item.status === "failed") blockNode.blockStatus = "failed";
      }
      if (item.type === "block_tool_output") {
        blockNode.blockKind = blockNode.blockKind ?? "generator";
      }
      if (item.type === "router_decision") {
        blockNode.blockKind = blockNode.blockKind ?? "router";
      }
      if (item.type === "error") blockNode.blockStatus = "failed";
    }

    for (const [instanceId, blockNode] of blockMap) {
      const firstItem = group.items.find((i) => i.provenance?.blockInstanceId === instanceId);
      const parentId = firstItem?.provenance?.parentBlockInstanceId;

      if (parentId && blockMap.has(parentId)) {
        const parent = blockMap.get(parentId)!;
        const insertIndex = parent.children.findIndex((c) => c.type === "item");
        if (insertIndex >= 0) {
          parent.children.splice(insertIndex, 0, blockNode);
        } else {
          parent.children.push(blockNode);
        }
      } else {
        rootBlocks.push(blockNode);
      }
    }

    // Fall back to timestamp-based duration when lifecycle metadata is not available.
    for (const blockNode of blockMap.values()) {
      if (blockNode.blockDuration !== undefined) {
        continue;
      }
      const blockItems = group.items.filter(
        (i) => i.provenance?.blockInstanceId === blockNode.blockInstanceId,
      );
      const blockTs = blockItems.map((i) => i.ts).filter(Boolean);
      if (blockTs.length >= 2) {
        blockNode.blockDuration = Math.max(...blockTs) - Math.min(...blockTs);
      }
    }

    return {
      type: "request" as const,
      id: `req-${group.requestId}`,
      requestId: group.requestId,
      action: group.action,
      status: group.status,
      duration: group.duration,
      children: [...rootBlocks, ...orphanItems],
      isExpanded: isLast,
    };
  });
}

function inferBlockKind(item: OutputItem): string | undefined {
  if (item.type === "block_output" && (item as BlockOutputItem).toolCall) return "generator";
  return undefined;
}
