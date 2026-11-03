/**
 * React context provider for shared flow defaults.
 *
 * Wrap your tree in `<FlowProvider>` and read defaults with `useFlowContext()`.
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
  type ReactNode
} from "react";
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

const FlowCtx = createContext<FlowContextValue>({});

function mergeRenderers(
  parent: RendererRegistry | undefined,
  child: RendererRegistry | undefined
): RendererRegistry {
  if (parent === undefined) {
    return child ?? {};
  }

  if (child === undefined) {
    return parent;
  }

  // Use explicit undefined checks (not ??) so that `false` (suppress) wins
  // over a parent renderer. `??` would skip `false` since it's falsy.
  return {
    message: child.message !== undefined ? child.message : parent.message,
    reasoning: child.reasoning !== undefined ? child.reasoning : parent.reasoning,
    block_trace: child.block_trace !== undefined ? child.block_trace : parent.block_trace,
    tool_output: child.tool_output !== undefined ? child.tool_output : parent.tool_output,
    status: child.status !== undefined ? child.status : parent.status,
    source: child.source !== undefined ? child.source : parent.source,
    error: child.error !== undefined ? child.error : parent.error,
    suspension: child.suspension !== undefined ? child.suspension : parent.suspension,
    component: {
      ...parent.component,
      ...child.component
    },
    container: {
      ...parent.container,
      ...child.container
    }
  };
}

/**
 * Canonical React context provider for flow defaults and renderers.
 */
export function FlowProvider(props: FlowProviderProps): ReactNode {
  const parent = useContext(FlowCtx);
  // This provider's own client cache: never shared with another provider.
  const clients = useRef<ClientCache | undefined>(undefined);
  clients.current ??= new Map();
  const cache = clients.current;

  const contextValue = useMemo<FlowContextValue>(() => {
    return {
      flowKind: props.flowKind ?? parent.flowKind,
      sessionId: props.sessionId ?? parent.sessionId,
      userId: props.userId ?? parent.userId,
      baseUrl: props.baseUrl ?? parent.baseUrl,
      apiPath: props.apiPath ?? parent.apiPath,
      fetcher: props.fetcher ?? parent.fetcher,
      renderers: mergeRenderers(parent.renderers, props.renderers),
      clients: cache
    };
  }, [
    cache,
    parent.baseUrl,
    parent.apiPath,
    parent.fetcher,
    parent.renderers,
    parent.flowKind,
    parent.sessionId,
    parent.userId,
    props.baseUrl,
    props.apiPath,
    props.fetcher,
    props.renderers,
    props.flowKind,
    props.sessionId,
    props.userId
  ]);

  return createElement(FlowCtx.Provider, { value: contextValue }, props.children);
}

/**
 * Reads flow defaults from the nearest FlowProvider.
 */
export function useFlowContext(): FlowContextValue {
  return useContext(FlowCtx);
}
