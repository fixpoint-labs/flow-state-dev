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
import type { RendererRegistry } from "../registry/block-renderers";

/**
 * Shared context value used by React hooks.
 */
export type FlowContextValue = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  baseUrl?: string;
  renderers?: RendererRegistry;
};

/**
 * Props for the canonical FlowProvider component.
 */
export type FlowProviderProps = {
  flowKind?: string;
  sessionId?: string;
  userId?: string;
  baseUrl?: string;
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
    error: child.error !== undefined ? child.error : parent.error,
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

  const contextValue = useMemo<FlowContextValue>(() => {
    return {
      flowKind: props.flowKind ?? parent.flowKind,
      sessionId: props.sessionId ?? parent.sessionId,
      userId: props.userId ?? parent.userId,
      baseUrl: props.baseUrl ?? parent.baseUrl,
      renderers: mergeRenderers(parent.renderers, props.renderers)
    };
  }, [
    parent.baseUrl,
    parent.renderers,
    parent.flowKind,
    parent.sessionId,
    parent.userId,
    props.baseUrl,
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
