import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { StateSnapshot } from "@/lib/trace-tree";

type SelectionState = {
  selectedItemId: string | null;
  selectedItem: OutputItem | null;
  /** State snapshots for the selected sequencer block, if applicable. */
  selectedStateSnapshots: StateSnapshot[] | null;
  selectItem: (itemId: string, item: OutputItem, stateSnapshots?: StateSnapshot[]) => void;
  clearSelection: () => void;
};

const SelectionContext = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedItem, setSelectedItem] = useState<OutputItem | null>(null);
  const [selectedStateSnapshots, setSelectedStateSnapshots] = useState<StateSnapshot[] | null>(null);

  const selectItem = useCallback((_itemId: string, item: OutputItem, stateSnapshots?: StateSnapshot[]) => {
    setSelectedItem(item);
    setSelectedStateSnapshots(stateSnapshots ?? null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItem(null);
    setSelectedStateSnapshots(null);
  }, []);

  const value = useMemo(
    () => ({
      selectedItemId: selectedItem?.id ?? null,
      selectedItem,
      selectedStateSnapshots,
      selectItem,
      clearSelection,
    }),
    [selectedItem, selectedStateSnapshots, selectItem, clearSelection],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionState {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
