"use client";

import { createContext, useContext } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

const SessionItemsContext = createContext<OutputItem[]>([]);

export const SessionItemsProvider = SessionItemsContext.Provider;

export function useSessionItems(): OutputItem[] {
  return useContext(SessionItemsContext);
}
