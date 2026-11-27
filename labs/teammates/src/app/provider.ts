/**
 * What every screen under `AppProvider` reads and writes through: the client, workforce's client over it, the
 * poll pace where push can miss a change, the page's connection (a line's files, and react's own hooks under
 * `FlowProvider`), and each conversation's shared reads and Stop. `main.tsx` hands it the page's; a test, a stand-in's.
 */
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import type { Client } from "@flow-state-dev/client";
import { FlowProvider } from "@flow-state-dev/react";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { conversationStore } from "../lib/conversation-store";
import type { AppConnection } from "../lib/files";

const shared = (client: Client, pollIntervalMs: number, connection: AppConnection) => ({ client, pollIntervalMs, connection, workforce: createWorkforceClient(client), conversations: conversationStore() });
const AppContext = createContext<ReturnType<typeof shared> | null>(null);
const PAGE: AppConnection = {};
/** The app's client and what its screens share over it, for everything under it. Pass a stable client and connection. */
export function AppProvider({ client, connection = PAGE, pollIntervalMs = 1_500, children }: { client: Client; connection?: AppConnection; pollIntervalMs?: number; children?: ReactNode }) {
  return createElement(AppContext.Provider, { value: useMemo(() => shared(client, pollIntervalMs, connection), [client, pollIntervalMs, connection]) }, createElement(FlowProvider, { userId: client.userId, baseUrl: connection.basePath, fetcher: connection.fetcher, children }));
}
/** What `AppProvider` holds: the client and poll pace a package hook reads with, workforce's client, and the conversations. */
export const useAppClient = () => useContext(AppContext) ?? (() => { throw new Error("An app hook ran outside <AppProvider>."); })();
