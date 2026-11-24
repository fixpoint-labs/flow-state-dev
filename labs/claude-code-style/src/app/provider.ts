/**
 * The one client the app's hooks call through, and the calls over it:
 * `AppProvider` holds them (`main.tsx` builds the client; a test builds one
 * over the in-process host), `useApp()` hands a screen the calls, and every
 * hook in `src/app/` reads the client from here.
 */
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import type { Client } from "@flow-state-dev/client";
import { appCalls, type AppCalls, type AppConnection } from "./calls";
import type { ThreadFeeds } from "./feed";
import { Stops } from "./stops";

/** How often a live read reads where push can miss a change, in ms. */
const READ_EVERY_MS = 3000;

interface AppContextValue {
  client: Client;
  /** How often a read reads where push can miss a change, in ms. */
  pollIntervalMs: number;
  calls: AppCalls;
  stops: Stops;
  /** Where each thread open on screen keeps a send's streamed answer, so a send there shows it as it is written. */
  threadFeeds: ThreadFeeds;
}

const AppContext = createContext<AppContextValue | null>(null);

/** What `AppProvider` holds, for the hooks under it. */
export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error("An app hook ran outside <AppProvider>.");
  return value;
}

/** The app's client and its calls, for everything under it. Pass a stable client. */
export function AppProvider({
  client,
  connection,
  pollIntervalMs = READ_EVERY_MS,
  children,
}: {
  client: Client;
  connection?: AppConnection;
  /** How often a read reads where push can miss a change, in ms; a host with no push socket (in process) reads on it. */
  pollIntervalMs?: number;
  children?: ReactNode;
}) {
  const value = useMemo(() => {
    const stops = new Stops();
    const threadFeeds: ThreadFeeds = new Map();
    return { client, pollIntervalMs, stops, threadFeeds, calls: appCalls(client, connection, stops, threadFeeds) };
    // The connection is read once, with the client.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, pollIntervalMs]);
  return createElement(AppContext.Provider, { value }, children);
}

/** The app's writes and one-off reads. */
export function useApp(): AppCalls {
  return useAppContext().calls;
}
