/**
 * React context provider for shared flow defaults.
 *
 * Wrap your tree in `<FlowProvider>` and read defaults with `useFlowContext()`.
 */
import { type ReactNode } from "react";
import type { Client, ClientFetch } from "@flow-state-dev/client";
import type { RendererRegistry } from "../registry/block-renderers";
/**
 * Shared context value used by React hooks.
 */
export type FlowContextValue = {
    flowKind?: string;
    sessionId?: string;
    userId?: string;
    baseUrl?: string;
    apiPath?: string;
    fetcher?: ClientFetch;
    renderers?: RendererRegistry;
    /**
     * The clients this provider's hooks share, by transport, so hooks with the
     * same user and transport hold one client (and so one push socket). Owned
     * by the provider; absent outside one.
     */
    clients?: ClientCache;
};
/** A provider's clients: by fetcher, then by user, base URL and API path. */
export type ClientCache = Map<ClientFetch | undefined, Map<string, Client>>;
/**
 * Props for the canonical FlowProvider component.
 */
export type FlowProviderProps = {
    flowKind?: string;
    sessionId?: string;
    userId?: string;
    baseUrl?: string;
    /**
     * Where the server mounts the flow API, after `baseUrl`. Default
     * `"/api/flows"`. Set it to the server's mount when that differs, such as
     * the Node host's `basePath`. A nested provider inherits its parent's.
     */
    apiPath?: string;
    /**
     * The fetch every hook's calls and streams go through, such as the engine's
     * `createInProcessFetch(flowState)` for an engine in this process, or a
     * wrapper that adds credentials. Default: the global `fetch`. A nested
     * provider inherits its parent's.
     */
    fetcher?: ClientFetch;
    renderers?: RendererRegistry;
    children: ReactNode;
};
/**
 * Canonical React context provider for flow defaults and renderers.
 */
export declare function FlowProvider(props: FlowProviderProps): ReactNode;
/**
 * Reads flow defaults from the nearest FlowProvider.
 */
export declare function useFlowContext(): FlowContextValue;
//# sourceMappingURL=FlowContext.d.ts.map