import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { StateSnapshot, TraceNode } from "@/lib/trace-tree";

/**
 * Selection is either an inline stream item (message, error, etc.) or a
 * block node whose detail panel composes all observability data attached
 * to that block (debug payload, state snapshots, output).
 */
export type Selection =
  | { kind: "item"; id: string; item: OutputItem; stateSnapshots: StateSnapshot[] | null }
  | { kind: "block"; id: string; node: TraceNode };

type SelectionState = {
  selection: Selection | null;

  /** Convenience accessors — kept so existing item-selection consumers don't
   *  all have to branch on `selection.kind`. */
  selectedItemId: string | null;
  selectedItem: OutputItem | null;
  selectedStateSnapshots: StateSnapshot[] | null;
  selectedBlockNode: TraceNode | null;

  selectItem: (itemId: string, item: OutputItem, stateSnapshots?: StateSnapshot[]) => void;
  selectBlock: (node: TraceNode) => void;
  clearSelection: () => void;
};

const SelectionContext = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const selectItem = useCallback((itemId: string, item: OutputItem, stateSnapshots?: StateSnapshot[]) => {
    setSelection({
      kind: "item",
      id: itemId,
      item,
      stateSnapshots: stateSnapshots ?? null,
    });
  }, []);

  const selectBlock = useCallback((node: TraceNode) => {
    setSelection({ kind: "block", id: node.id, node });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const value = useMemo<SelectionState>(() => {
    const isItem = selection?.kind === "item";
    const isBlock = selection?.kind === "block";
    return {
      selection,
      selectedItemId: selection?.id ?? null,
      selectedItem: isItem ? selection.item : null,
      selectedStateSnapshots: isItem
        ? selection.stateSnapshots
        : isBlock
          ? selection.node.stateSnapshots ?? null
          : null,
      selectedBlockNode: isBlock ? selection.node : null,
      selectItem,
      selectBlock,
      clearSelection,
    };
  }, [selection, selectItem, selectBlock, clearSelection]);

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
