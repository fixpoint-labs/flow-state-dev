/**
 * The client a workforce panel reads through: the host's own when it passes
 * one, else one built from an address and a transport. Internal to the panels
 * and not exported; the flow navigator takes its clients as props and builds
 * none.
 */
import { useMemo } from "react";
import { createResourceClient, type ClientFetch, type ResourceClient } from "@flow-state-dev/client";
import { useFlowContext } from "../../context/FlowContext";

/** Where a panel's own client reads, when the host passes no client. */
type PanelSourceFallback = {
  /** Defaults to the nearest `FlowProvider`'s. */
  readonly baseUrl?: string;
  /** Defaults to the plain `fetch`. */
  readonly fetcher?: ClientFetch;
};

/**
 * The host's client, else a fallback built from `baseUrl` (the provider's
 * unless given) and `fetcher`, memoised on both. The fallback is built every
 * time either changes, even when the host's client is the one read through: a
 * host with an authenticating deployment passes its own, and this default is
 * the unauthenticated case.
 */
export function usePanelSource<TSource>(
  resourceClient: TSource | undefined,
  fallback: PanelSourceFallback = {}
): TSource | ResourceClient {
  const providerBaseUrl = useFlowContext().baseUrl;
  const baseUrl = fallback.baseUrl ?? providerBaseUrl;
  const fetcher = fallback.fetcher;
  const built = useMemo(() => createResourceClient({ baseUrl, fetcher }), [baseUrl, fetcher]);
  return resourceClient ?? built;
}
