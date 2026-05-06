/**
 * Trace lookup context — exposes the item registry and trace-node registry
 * derived from the live request groups so deep-tree consumers (e.g. the
 * BlockValueView's ref renderer) can resolve a `sourceItemId` to its
 * producing block without prop-drilling the entire trace.
 *
 * Built once at the panel level using the same sortedTree that the trace
 * view renders, so clicking a ref reuses the exact `TraceNode` the trace
 * tree already has — selection lights the right row up immediately.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { TraceNode } from "../lib/trace-tree";
import type { DevtoolItem } from "../lib/item-types";
import type { RequestGroup } from "../components/workspace/stream-view";
import { buildTraceTree } from "../lib/trace-tree";

type TraceLookup = {
  getItem: (itemId: string) => DevtoolItem | undefined;
  getBlockNode: (blockInstanceId: string) => TraceNode | undefined;
};

const TraceContext = createContext<TraceLookup | null>(null);

export function TraceLookupProvider({
  requestGroups,
  children,
}: {
  requestGroups: RequestGroup[];
  children: ReactNode;
}) {
  const value = useMemo<TraceLookup>(() => {
    const itemMap = new Map<string, DevtoolItem>();
    for (const group of requestGroups) {
      for (const item of group.items) {
        itemMap.set(item.id, item);
      }
    }

    const blockMap = new Map<string, TraceNode>();
    const tree = buildTraceTree(requestGroups);
    const walk = (node: TraceNode) => {
      if (node.type === "block" && node.blockInstanceId) {
        blockMap.set(node.blockInstanceId, node);
      }
      for (const child of node.children) walk(child);
    };
    for (const root of tree) walk(root);

    return {
      getItem: (id) => itemMap.get(id),
      getBlockNode: (id) => blockMap.get(id),
    };
  }, [requestGroups]);

  return <TraceContext.Provider value={value}>{children}</TraceContext.Provider>;
}

export function useTraceLookup(): TraceLookup {
  const ctx = useContext(TraceContext);
  if (!ctx) {
    // Defensive fallback — if a renderer ends up outside the provider,
    // return empty lookups so refs degrade to "(not retained)" rather
    // than crashing.
    return { getItem: () => undefined, getBlockNode: () => undefined };
  }
  return ctx;
}
