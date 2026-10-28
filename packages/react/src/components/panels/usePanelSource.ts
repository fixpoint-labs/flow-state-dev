/**
 * The client a workforce panel reads through: the host's own when it passes
 * one, else the hooks' client, built from the nearest `FlowProvider`'s user,
 * `baseUrl`, `apiPath` and `fetcher`. Internal to the panels and not exported.
 */
import type { Client } from "@flow-state-dev/client";
import { useClient } from "../../internal/useClient";

/**
 * The host's client, else the provider's. The provider's is built every
 * render the hooks build one, even when the host's is the one read through: a
 * host with an authenticating deployment passes its own, and this default is
 * the unauthenticated case.
 */
export function usePanelSource<TSource>(client: TSource | undefined): TSource | Client {
  const built = useClient();
  return client ?? built;
}
