/**
 * React context provider and legacy singleton for shared flow defaults.
 *
 * Canonical app usage: wrap your tree in `<FlowProvider>`.
 * Legacy/non-React usage: `setFlowContext()` / `getFlowContext()` still work
 * but are non-canonical and unsafe for SSR/concurrent rendering.
 */
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactNode
} from "react";
import {
  normalizeRendererKey,
  type BlockComponentType,
  type BlockRendererMap
} from "../registry/block-renderers";

/**
 * Shared context value used by React hooks.
 */
export type FlowContextValue = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  baseUrl?: string;
  blockRenderers?: BlockRendererMap;
};

/**
 * Props for the canonical FlowProvider component.
 */
export type FlowProviderProps = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  baseUrl?: string;
  blockRenderers?: Record<string, BlockComponentType>;
  children: ReactNode;
};

const FlowCtx = createContext<FlowContextValue>({});

function normalizeRendererMap(
  renderers: Record<string, BlockComponentType> | undefined
): BlockRendererMap {
  if (renderers === undefined) {
    return {};
  }

  const normalized: BlockRendererMap = {};
  for (const [rawKey, component] of Object.entries(renderers)) {
    normalized[normalizeRendererKey(rawKey)] = component;
  }

  return normalized;
}

/**
 * Canonical React context provider for flow defaults and block renderers.
 */
export function FlowProvider(props: FlowProviderProps): ReactNode {
  const parent = useContext(FlowCtx);

  const contextValue = useMemo<FlowContextValue>(() => {
    const parentRenderers = parent.blockRenderers ?? {};
    const ownRenderers = normalizeRendererMap(props.blockRenderers);

    return {
      flowKind: props.flowKind ?? parent.flowKind,
      sessionId: props.sessionId ?? parent.sessionId,
      userId: props.userId ?? parent.userId,
      baseUrl: props.baseUrl ?? parent.baseUrl,
      blockRenderers: {
        ...parentRenderers,
        ...ownRenderers
      }
    };
  }, [
    parent.baseUrl,
    parent.blockRenderers,
    parent.flowKind,
    parent.sessionId,
    parent.userId,
    props.baseUrl,
    props.blockRenderers,
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

// ---------------------------------------------------------------------------
// Legacy module-singleton API (deprecated, non-canonical for app usage)
// ---------------------------------------------------------------------------

let currentFlowContext: FlowContextValue = {};

/**
 * @deprecated Use `<FlowProvider>` instead. Module-singleton context is unsafe
 * for SSR and concurrent rendering.
 */
export function setFlowContext(value: FlowContextValue): void {
  currentFlowContext = { ...value };
}

/**
 * @deprecated Use `useFlowContext()` inside a `<FlowProvider>` tree instead.
 */
export function getFlowContext(): FlowContextValue {
  return { ...currentFlowContext };
}

/**
 * @deprecated Use `<FlowProvider>` instead.
 */
export function withFlowContext<TValue>(
  value: FlowContextValue,
  run: () => TValue
): TValue {
  const previous = currentFlowContext;
  currentFlowContext = { ...value };

  try {
    return run();
  } finally {
    currentFlowContext = previous;
  }
}
