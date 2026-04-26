/**
 * Hook for accessing a collection resource's items and performing CRUD operations.
 *
 * Items with clientData are available immediately from the snapshot.
 * Content for individual items is fetched on demand via `fetchContent()`.
 * Actions (create, update, delete) are shaped by the declared permissions
 * at runtime — missing methods throw clear errors.
 */
import { useCallback, useMemo } from "react";
import {
  createResourceClient,
  type CollectionSnapshotEntry
} from "@flow-state-dev/client";
import type { SessionView } from "./useSession";
import { useFlowContext } from "../context/FlowContext";

/**
 * A single item in the collection, with metadata and a content fetch method.
 */
export type CollectionItem = {
  /** Client data derived from this item's state. */
  clientData: unknown;
  /** Fetches the rendered content body for this item on demand. */
  fetchContent: () => Promise<string | null>;
};

/**
 * Mutation actions available on the collection, shaped by declared permissions.
 */
export type CollectionActions = {
  /** Create a new item in the collection. Only present if `client.content.create` is declared. */
  create?: (options: { topic: string; content?: string }) => Promise<{ topic: string }>;
  /** Update an existing item's content. Only present if `client.content.update` is declared. */
  update?: (options: { topic: string; content: string }) => Promise<void>;
  /** Delete an item from the collection. Only present if `client.content.delete` is declared. */
  delete?: (options: { topic: string }) => Promise<void>;
};

/**
 * Return type for useResourceCollection.
 */
export type UseResourceCollectionResult = {
  /** Map of topic key to item metadata and content accessor. */
  items: Record<string, CollectionItem>;
  /** Mutation actions shaped by the collection's declared permissions. */
  actions: CollectionActions;
};

/**
 * Reads a collection resource's items from the session snapshot and provides
 * CRUD actions and per-item content fetch methods.
 */
export function useResourceCollection(
  session: SessionView,
  ref: string
): UseResourceCollectionResult {
  const context = useFlowContext();
  const baseUrl = context.baseUrl;

  const collectionEntry = useMemo(() => {
    const resources = session.snapshot?.resources;
    if (!resources) return undefined;

    for (const scope of ["session", "user", "org"] as const) {
      const scopeResources = resources[scope];
      if (scopeResources && ref in scopeResources) {
        const candidate = scopeResources[ref];
        if (candidate && typeof candidate === "object" && "items" in candidate) {
          return candidate as CollectionSnapshotEntry;
        }
      }
    }
    return undefined;
  }, [session.snapshot?.resources, ref]);

  const items = useMemo((): Record<string, CollectionItem> => {
    if (!collectionEntry?.items) return {};

    const result: Record<string, CollectionItem> = {};
    for (const [key, entry] of Object.entries(collectionEntry.items)) {
      result[key] = {
        clientData: entry.clientData ?? null,
        fetchContent: async () => {
          const sessionId = session.sessionId;
          if (!sessionId) return null;

          // If content was prefetched, return directly
          if (entry.content !== undefined) {
            return entry.content;
          }

          const client = createResourceClient({ baseUrl });
          const result = await client.getCollectionItemContent(sessionId, ref, key);
          return result.content;
        },
      };
    }
    return result;
  }, [collectionEntry, session.sessionId, ref, baseUrl]);

  const actions = useMemo((): CollectionActions => {
    const sessionId = session.sessionId;
    const client = createResourceClient({ baseUrl });

    return {
      create: async (options: { topic: string; content?: string }) => {
        if (!sessionId) throw new Error("No active session");
        return client.createCollectionItem(sessionId, ref, options);
      },
      update: async (options: { topic: string; content: string }) => {
        if (!sessionId) throw new Error("No active session");
        await client.updateResourceContent(sessionId, ref, options.topic, {
          content: options.content,
        });
      },
      delete: async (options: { topic: string }) => {
        if (!sessionId) throw new Error("No active session");
        await client.deleteCollectionItem(sessionId, ref, options.topic);
      },
    };
  }, [session.sessionId, ref, baseUrl]);

  return { items, actions };
}
