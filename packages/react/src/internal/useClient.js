/**
 * The one client a hook calls through, built from the hook's user and
 * `baseUrl` (or the provider's) and the provider's `apiPath` and `fetcher`.
 *
 * Memoized on those inputs, so a re-render keeps the same client and the
 * streams opened through it stay open. Under a provider, hooks with the same
 * user and transport share one client from the provider's cache, so they
 * share one push socket too.
 */
import { useMemo } from "react";
import { createClient } from "@flow-state-dev/client";
import { useFlowContext } from "../context/FlowContext";
/** The user a hook acts as when neither it nor its provider names one. */
const DEFAULT_HOOK_USER_ID = "devuser";
/** A hook's client. `userId`, `baseUrl` and `apiPath` override the provider's. */
export function useClient(overrides = {}) {
    const context = useFlowContext();
    const userId = overrides.userId ?? context.userId ?? DEFAULT_HOOK_USER_ID;
    const baseUrl = overrides.baseUrl ?? context.baseUrl;
    const apiPath = overrides.apiPath ?? context.apiPath;
    const { fetcher, clients } = context;
    return useMemo(() => {
        const build = () => createClient({
            userId,
            // No base URL means the page's own origin, with or without a fetcher.
            baseUrl: baseUrl ?? "",
            apiPath,
            fetcher
        });
        if (clients === undefined)
            return build();
        let byTransport = clients.get(fetcher);
        if (byTransport === undefined)
            clients.set(fetcher, (byTransport = new Map()));
        const key = `${userId}\u0000${baseUrl ?? ""}\u0000${apiPath ?? ""}`;
        let client = byTransport.get(key);
        if (client === undefined)
            byTransport.set(key, (client = build()));
        return client;
    }, [userId, baseUrl, apiPath, fetcher, clients]);
}
//# sourceMappingURL=useClient.js.map