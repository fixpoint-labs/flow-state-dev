/**
 * Hook for accessing a single resource's clientData and content from the session snapshot.
 *
 * The resource must have `client` config declared in its definition to be visible.
 * Content is not loaded until `fetchContent()` is called — lazy by default.
 */
import { useCallback, useMemo } from "react";
import {
  createResourceClient,
  type ResourceSnapshotEntry
} from "@flow-state-dev/client";
import type { SessionView } from "./useSession";
import { useFlowContext } from "../context/FlowContext";

/**
 * Return type for useResource — metadata available immediately, content fetched on demand.
 *
 * `TClient` (FIX-741) is the resource's projected client-data type; pass it via
 * the hook generic, e.g. `useResource<ClientDataOf<typeof doc>>(...)`. Defaults
 * to `unknown` so existing untyped call sites are unchanged.
 */
export type UseResourceResult<TClient = unknown> = {
  /** Client data derived from the resource's state. Available immediately from the snapshot. */
  clientData: TClient;
  /** Fetches the rendered content body on demand. Returns null if no content exists. */
  fetchContent: () => Promise<string | null>;
};

/**
 * Reads a single resource's clientData from the session snapshot and provides
 * a `fetchContent()` function for lazy content loading.
 */
export function useResource<TClient = unknown>(
  session: SessionView,
  ref: string
): UseResourceResult<TClient> {
  const context = useFlowContext();
  const baseUrl = context.baseUrl;

  const entry = useMemo(() => {
    const resources = session.snapshot?.resources;
    if (!resources) return undefined;

    // Search across scopes — session first, then user, then org.
    // Distinguish single resource from collection: collection entries (FIX-427)
    // carry `count` and/or `prefetched`; single resources carry `clientData`/
    // `content`/`internal`. Skip the candidate when it looks like a collection.
    for (const scope of ["session", "user", "org"] as const) {
      const scopeResources = resources[scope];
      if (scopeResources && ref in scopeResources) {
        const candidate = scopeResources[ref] as ResourceSnapshotEntry & {
          count?: unknown;
          prefetched?: unknown;
        };
        if ("count" in candidate || "prefetched" in candidate) continue;
        return candidate;
      }
    }
    return undefined;
  }, [session.snapshot?.resources, ref]);

  // Runtime payload is the server's JsonValue projection; the cast threads the
  // declared TClient (FIX-741). Absent clientData coalesces to null, matching
  // the prior behaviour.
  const clientData = (entry?.clientData ?? null) as TClient;

  const fetchContent = useCallback(async (): Promise<string | null> => {
    const sessionId = session.sessionId;
    if (!sessionId) return null;

    // If content was prefetched in the snapshot, return it directly
    if (entry?.content !== undefined) {
      return entry.content;
    }

    const client = createResourceClient({ baseUrl });
    const result = await client.getResourceContent(sessionId, ref);
    return result.content;
  }, [session.sessionId, ref, baseUrl, entry?.content]);

  return { clientData, fetchContent };
}
