/**
 * The calls the screen runs on, for everything under `AppProvider`:
 * `main.tsx` hands it the calls over the page's client, and a test hands it a
 * double (`test/fake-app.ts`) or the calls over the in-process host.
 * `useApp()` reads them.
 */
import { createContext, createElement, useContext, type ReactNode } from "react";
import type { AppCalls } from "./calls";

const AppContext = createContext<AppCalls | null>(null);

/** The app's calls, for everything under it. Pass a stable value. */
export function AppProvider({ calls, children }: { calls: AppCalls; children?: ReactNode }) {
  return createElement(AppContext.Provider, { value: calls }, children);
}

/** Everything the screen reads and writes, from the nearest `AppProvider`. */
export function useApp(): AppCalls {
  const calls = useContext(AppContext);
  if (calls === null) throw new Error("An app hook ran outside <AppProvider>.");
  return calls;
}
