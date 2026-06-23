/**
 * Optional React context that bridges a session's streaming suspension resolver
 * to the inline default approval card.
 *
 * The default `<ApprovalRenderer>` is rendered deep inside the item stream and
 * has no reference to the `useSession` instance that owns the live SSE stream.
 * Without a bridge it can only fire a non-streaming resume (fire-and-forget),
 * so the resumed continuation streams to nobody and the chat view only updates
 * on a page refresh.
 *
 * An app wraps its item list with `<SuspensionResolverProvider resolve={...}>`,
 * passing `useSession(...).resumeSuspension`. The default card then resolves
 * through the session, so the continuation streams straight into `session.items`
 * and renders live. When no provider is present the card falls back to its
 * self-contained (non-streaming) recovery client.
 */
import {
  createContext,
  createElement,
  useContext,
  type ReactNode
} from "react";

/**
 * Streaming suspension resolver. Matches the shape of
 * `SessionView.resumeSuspension` so an app can pass it through verbatim.
 */
export type SuspensionResolver = (args: {
  suspensionId: string;
  requestId: string;
  action: "approve" | "reject";
  data?: unknown;
  resumedBy?: string;
}) => Promise<void>;

const SuspensionResolverContext = createContext<SuspensionResolver | null>(null);

/**
 * Props for {@link SuspensionResolverProvider}.
 */
export type SuspensionResolverProviderProps = {
  /** The session-bound streaming resolver, typically `session.resumeSuspension`. */
  resolve: SuspensionResolver;
  children: ReactNode;
};

/**
 * Provides a session's streaming suspension resolver to the inline default
 * approval card. Wrap the subtree that renders `session.items`.
 */
export function SuspensionResolverProvider(
  props: SuspensionResolverProviderProps
): ReactNode {
  return createElement(
    SuspensionResolverContext.Provider,
    { value: props.resolve },
    props.children
  );
}

/**
 * Reads the streaming suspension resolver from the nearest provider, or `null`
 * when none is mounted (the default card then uses its self-contained fallback).
 */
export function useSuspensionResolver(): SuspensionResolver | null {
  return useContext(SuspensionResolverContext);
}
