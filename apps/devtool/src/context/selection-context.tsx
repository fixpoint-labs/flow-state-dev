import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

type SelectionState = {
  selectedItemId: string | null;
  selectedItem: OutputItem | null;
  selectItem: (itemId: string, item: OutputItem) => void;
  clearSelection: () => void;
};

const SelectionContext = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedItem, setSelectedItem] = useState<OutputItem | null>(null);

  const selectItem = useCallback((_itemId: string, item: OutputItem) => {
    setSelectedItem(item);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const value = useMemo(
    () => ({
      selectedItemId: selectedItem?.id ?? null,
      selectedItem,
      selectItem,
      clearSelection,
    }),
    [selectedItem, selectItem, clearSelection],
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
