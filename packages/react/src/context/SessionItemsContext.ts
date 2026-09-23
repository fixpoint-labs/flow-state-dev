/** Shared item source for nested renderers, supplied automatically by ItemsRenderer. */
import { createContext, useContext } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

/** Undefined distinguishes a missing provider from an explicitly empty item source. */
export const SessionItemsContext = createContext<OutputItem[] | undefined>(undefined);

/** Supplies items to standalone renderers or overrides an enclosing item source. */
export const SessionItemsProvider = SessionItemsContext.Provider;

const EMPTY_ITEMS: OutputItem[] = [];

/** Reads the nearest item source; returns an empty array outside an item provider. */
export function useSessionItems(): OutputItem[] {
  return useContext(SessionItemsContext) ?? EMPTY_ITEMS;
}
