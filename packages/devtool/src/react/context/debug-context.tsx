import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { readDebugMode, readTraceItemsVisible, writeTraceItemsVisible } from "../config";

type DebugState = {
  isDebugMode: boolean;
  toggleDebugMode: () => void;
  /** Whether raw trace item rows (block_debug, state_*, router_decision,
   *  nested block_output) are rendered in the trace tree. Default off —
   *  trace data lives on the block detail sidebar via composed sections. */
  traceItemsVisible: boolean;
  toggleTraceItemsVisible: () => void;
};

const DebugContext = createContext<DebugState | null>(null);

export function DebugProvider({ children }: { children: ReactNode }) {
  const [isDebugMode, setIsDebugMode] = useState(readDebugMode);
  const [traceItemsVisible, setTraceItemsVisible] = useState(readTraceItemsVisible);

  const toggleDebugMode = useCallback(() => {
    setIsDebugMode((prev) => {
      const next = !prev;
      window.localStorage.setItem("fsd.devtool.debugMode", String(next));
      return next;
    });
  }, []);

  const toggleTraceItemsVisible = useCallback(() => {
    setTraceItemsVisible((prev) => {
      const next = !prev;
      writeTraceItemsVisible(next);
      return next;
    });
  }, []);

  return (
    <DebugContext.Provider
      value={{ isDebugMode, toggleDebugMode, traceItemsVisible, toggleTraceItemsVisible }}
    >
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug(): DebugState {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error("useDebug must be used within DebugProvider");
  return ctx;
}
