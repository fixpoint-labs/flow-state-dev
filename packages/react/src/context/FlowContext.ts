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
