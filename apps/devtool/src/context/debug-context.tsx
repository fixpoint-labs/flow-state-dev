import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { readDebugMode } from "@/config";

type DebugState = {
  isDebugMode: boolean;
  toggleDebugMode: () => void;
};

const DebugContext = createContext<DebugState | null>(null);

export function DebugProvider({ children }: { children: ReactNode }) {
  const [isDebugMode, setIsDebugMode] = useState(readDebugMode);

  const toggleDebugMode = useCallback(() => {
    setIsDebugMode((prev) => {
      const next = !prev;
      window.localStorage.setItem("fsd.devtool.debugMode", String(next));
      return next;
    });
  }, []);

  return (
    <DebugContext.Provider value={{ isDebugMode, toggleDebugMode }}>
      {children}
    </DebugContext.Provider>
  );
}

export function useDebug(): DebugState {
  const ctx = useContext(DebugContext);
  if (!ctx) throw new Error("useDebug must be used within DebugProvider");
  return ctx;
}
