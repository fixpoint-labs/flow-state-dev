/**
 * Hook for consuming items owned by a container scope.
 *
 * When a sequencer or router declares a `container` config, all items emitted
 * during its execution carry an `ownedBy` field linking them to the container's
 * `blockInstanceId`. This hook resolves those owned items and extracts the
 * latest component state for the container's component key, providing a
 * structured view without manual item correlation.
 */
import { useMemo } from "react";
import type { ComponentItem, ContainerItem, OutputItem } from "@flow-state-dev/core/items";
import type { SessionView } from "./useSession";

export type ContainerItemsResult<TState = Record<string, unknown>> = {
  /** Latest component state for this container, or undefined if no component item found. */
  state: TState | undefined;
  /** All items owned by this container scope, sorted chronologically. */
  items: OutputItem[];
  /** Latest component data for each unique key, scanning owned items in reverse. */
  componentsByKey: Map<string, Record<string, unknown>>;
};

/**
 * Returns the component state, owned items, and per-key component map for a
 * given container item.
 *
 * Accepts either a `SessionView` (uses indexed O(1) lookups) or a raw items
 * array (filters by `ownedBy` — works with any items source such as a context
 * provider).
 *
 * @param containerItem - The ContainerItem emitted by a sequencer/router with container config.
 * @param source - SessionView from useSession, or an OutputItem[] to filter.
 */
export function useContainerItems<TState = Record<string, unknown>>(
  containerItem: ContainerItem,
  source: SessionView | OutputItem[]
): ContainerItemsResult<TState> {
  const ownedBy = containerItem.provenance.blockInstanceId;

  const ownedItems = useMemo(() => {
    if (Array.isArray(source)) {
      return source.filter(
        (item) =>
          (item as OutputItem & { ownedBy?: string }).ownedBy === ownedBy
      );
    }
    return source.getOwnedItems(ownedBy);
  }, [source, ownedBy]);

  const state = useMemo(() => {
    if (containerItem.component === undefined) return undefined;
    const componentKey = containerItem.component;

    // Find the latest ComponentItem matching this container's component key.
    let latest: ComponentItem | undefined;
    for (let i = ownedItems.length - 1; i >= 0; i--) {
      const item = ownedItems[i];
      if (
        item.type === "component" &&
        (item as ComponentItem).component === componentKey
      ) {
        latest = item as ComponentItem;
        break;
      }
    }

    return latest?.data as TState | undefined;
  }, [containerItem.component, ownedItems]);

  const componentsByKey = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    // Scan in reverse so the first match per key is the latest emission.
    for (let i = ownedItems.length - 1; i >= 0; i--) {
      const item = ownedItems[i];
      if (item.type !== "component") continue;
      const comp = item as ComponentItem;
      if (comp.key && !map.has(comp.key)) {
        map.set(comp.key, comp.data);
      }
    }
    return map;
  }, [ownedItems]);

  return { state, items: ownedItems, componentsByKey };
}
