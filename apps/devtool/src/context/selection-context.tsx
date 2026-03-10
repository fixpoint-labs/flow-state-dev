import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

type SelectionState = {
  selectedItemId: string | null;
  selectedItem: OutputItem | null;
  selectItem: (itemId: string, item: OutputItem) => void;
  clearSelection: () => void;
};

const SelectionContext = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<OutputItem | null>(null);

  const selectItem = useCallback((itemId: string, item: OutputItem) => {
    setSelectedItemId(itemId);
    setSelectedItem(item);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedItemId(null);
    setSelectedItem(null);
  }, []);

  return (
    <SelectionContext.Provider value={{ selectedItemId, selectedItem, selectItem, clearSelection }}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionState {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within SelectionProvider");
  return ctx;
}
