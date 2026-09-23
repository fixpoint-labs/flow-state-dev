/**
 * Session item list for nested stream-aware renderers.
 *
 * Container and HITL cards (EventedActors, Debate, RoutedSpecialists,
 * TaskPlan, Approval) read the current stream via {@link useSessionItems}.
 * {@link ItemsRenderer} mounts {@link SessionItemsProvider} with the list it
 * is rendering when no provider is already in scope, so the documented
 * FlowProvider + ItemsRenderer composition supplies the items without a
 * second provider. An ancestor provider is left in place: a caller such as
 * RequestGroup passes a filtered subset, and TaskPlan still needs the
 * fuller list above it.
 *
 * Mount {@link SessionItemsProvider} yourself when rendering those cards
 * outside {@link ItemsRenderer} (tests, replayed snapshots). TaskPlan also
 * accepts an explicit `items` prop for that case.
 */
import {
  createContext,
  createElement,
  useContext,
  type ReactNode
} from "react";
import type { OutputItem } from "@flow-state-dev/core/items";

const SessionItemsContext = createContext<OutputItem[] | null>(null);

/**
 * Props for {@link SessionItemsProvider}.
 */
export type SessionItemsProviderProps = {
  /** Session item list nested renderers should read. */
  value: OutputItem[];
  children?: ReactNode;
};

/**
 * Provides the session item list to {@link useSessionItems} consumers.
 *
 * {@link ItemsRenderer} mounts this automatically. Wrap a subtree yourself
 * only when rendering stream-aware cards outside that helper.
 */
export function SessionItemsProvider(
  props: SessionItemsProviderProps
): ReactNode {
  return createElement(
    SessionItemsContext.Provider,
    { value: props.value },
    props.children
  );
}

/**
 * Reads the nearest session item list, or `[]` when no provider is mounted.
 */
export function useSessionItems(): OutputItem[] {
  return useContext(SessionItemsContext) ?? [];
}

/**
 * Mounts {@link SessionItemsProvider} only when none is already in scope.
 *
 * Used by {@link ItemsRenderer}. A filtered `items` prop must not hide a
 * fuller list an ancestor already provided.
 */
export function SessionItemsGate(props: {
  value: OutputItem[];
  children?: ReactNode;
}): ReactNode {
  const mounted = useContext(SessionItemsContext) !== null;
  if (mounted) return props.children ?? null;
  return createElement(
    SessionItemsProvider,
    { value: props.value },
    props.children
  );
}
