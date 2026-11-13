/**
 * React context provider for shared flow defaults.
 *
 * Wrap your tree in `<FlowProvider>` and read defaults with `useFlowContext()`.
 */
import { createContext, createElement, useContext, useMemo, useRef } from "react";
const FlowCtx = createContext({});
function mergeRenderers(parent, child) {
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
export function FlowProvider(props) {
    const parent = useContext(FlowCtx);
    // This provider's own client cache: never shared with another provider.
    const clients = useRef(undefined);
    clients.current ??= new Map();
    const cache = clients.current;
    const contextValue = useMemo(() => {
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
export function useFlowContext() {
    return useContext(FlowCtx);
}
//# sourceMappingURL=FlowContext.js.map