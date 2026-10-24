/**
 * The one client a hook calls through, built from the hook's user and
 * `baseUrl` (or the provider's) and the provider's `apiPath` and `fetcher`.
 *
 * Memoized on those inputs, so a re-render keeps the same client and the
 * streams opened through it stay open.
 */
import { useMemo } from "react";
import { createClient, type Client } from "@flow-state-dev/client";
import { useFlowContext } from "../context/FlowContext";

/** The user a hook acts as when neither it nor its provider names one. */
const DEFAULT_HOOK_USER_ID = "devuser";

/** A hook's client. `userId`, `baseUrl` and `apiPath` override the provider's. */
export function useClient(overrides: { userId?: string; baseUrl?: string; apiPath?: string } = {}): Client {
  const context = useFlowContext();
  const userId = overrides.userId ?? context.userId ?? DEFAULT_HOOK_USER_ID;
  const baseUrl = overrides.baseUrl ?? context.baseUrl;
  const apiPath = overrides.apiPath ?? context.apiPath;
  const { fetcher } = context;
  return useMemo(
    () =>
      createClient({
        userId,
        // No base URL means the page's own origin, with or without a fetcher.
        baseUrl: baseUrl ?? "",
        apiPath,
        fetcher
      }),
    [userId, baseUrl, apiPath, fetcher]
  );
}
