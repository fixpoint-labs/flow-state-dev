/**
 * What every screen under `AppProvider` reads through: the calls (`useApp()`), and the client a package
 * hook reads with and how often it reads where push can miss a change (`useAppClient()`). `main.tsx`
 * hands it the page's client; a test, a double (`test/fake-app.ts`) or the in-process host's.
 */
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import type { Client } from "@flow-state-dev/client";
import type { AppCalls } from "./calls";
import { POLL_MS } from "./reads";

const AppContext = createContext<{ calls: AppCalls; client: Client; pollIntervalMs: number } | null>(null);
const useAppContext = () => useContext(AppContext) ?? (() => { throw new Error("An app hook ran outside <AppProvider>."); })();

/** The app's calls and client, for everything under it. Pass stable values. */
export function AppProvider({ calls, client, pollIntervalMs = POLL_MS, children }: { calls: AppCalls; client: Client; pollIntervalMs?: number; children?: ReactNode }) {
  return createElement(AppContext.Provider, { value: useMemo(() => ({ calls, client, pollIntervalMs }), [calls, client, pollIntervalMs]) }, children);
}
/** Everything the screen writes, and the reads not yet on a package hook. */
export const useApp = (): AppCalls => useAppContext().calls;
/** The client and the poll pace a package hook (`useView`, `useSessionFeed`) reads with. */
export const useAppClient = () => useAppContext();
