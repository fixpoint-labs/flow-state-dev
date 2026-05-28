/**
 * Resource content and CRUD API client for canonical `/api/flows` resource endpoints.
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type {
  ClientFetch,
  CollectionListPage,
  CollectionItemState,
  ResourceManifest
} from "../types";

/**
 * Shared options for the resource API client.
 */
export type CreateResourceClientOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
};

/**
 * Response shape for resource content fetch.
 */
export type ResourceContentResponse = {
  ref: string;
  topic?: string;
  content: string;
};

/**
 * Payload for creating a new collection item.
 */
export type CreateCollectionItemOptions = {
  topic: string;
  content?: string;
};

/**
 * Payload for updating a collection item's content.
 */
export type UpdateResourceContentOptions = {
  content: string;
};

/**
 * Resource API client contract.
 */
export type ResourceClient = {
  /**
   * Fetch the rendered content body for a single resource.
   * GET /sessions/:sessionId/resources/:ref/content
   */
  getResourceContent: (
    sessionId: string,
    ref: string
  ) => Promise<ResourceContentResponse>;

  /**
   * Fetch the rendered content body for a collection item.
   * GET /sessions/:sessionId/resources/:ref/:topic/content
   */
  getCollectionItemContent: (
    sessionId: string,
    ref: string,
    topic: string
  ) => Promise<ResourceContentResponse>;

  /**
   * Create a new collection item.
   * POST /sessions/:sessionId/resources/:ref
   */
  createCollectionItem: (
    sessionId: string,
    ref: string,
    options: CreateCollectionItemOptions
  ) => Promise<{ topic: string }>;

  /**
   * Update a resource or collection item's content.
   * PATCH /sessions/:sessionId/resources/:ref/:topic/content
   */
  updateResourceContent: (
    sessionId: string,
    ref: string,
    topic: string,
    options: UpdateResourceContentOptions
  ) => Promise<void>;

  /**
   * Delete a collection item.
   * DELETE /sessions/:sessionId/resources/:ref/:topic
   */
  deleteCollectionItem: (
    sessionId: string,
    ref: string,
    topic: string
  ) => Promise<void>;

  /**
   * List a keyset-paginated page of collection item state.
   * GET /sessions/:sessionId/resources/:ref?limit=&cursor=&topicPrefix=
   *
   * Gated by `client.state.read` on the server. Items are ordered by
   * lexicographic storage key. Pass the prior page's `pagination.nextCursor`
   * as `cursor` to fetch the next page; `nextCursor === null` means the end.
   */
  listCollectionItems: (
    sessionId: string,
    ref: string,
    options?: { limit?: number; cursor?: string | null; topicPrefix?: string }
  ) => Promise<CollectionListPage>;

  /**
   * Fetch a single collection item's state.
   * GET /sessions/:sessionId/resources/:ref/:topic
   *
   * Returns `null` when the topic is not present in the collection (the
   * server returns 200 with a null body in that case).
   */
  getCollectionItemState: (
    sessionId: string,
    ref: string,
    topic: string
  ) => Promise<CollectionItemState | null>;

  /**
   * Fetch the static manifest of public resources for a session's flow.
   * GET /sessions/:sessionId/manifest
   *
   * The response is deterministic per `flowKind`; clients should cache by
   * `flowKind` rather than `sessionId`.
   */
  getResourceManifest: (sessionId: string) => Promise<ResourceManifest>;
};

/**
 * Creates a resource API client for canonical flow resource endpoints.
 */
export function createResourceClient(
  options: CreateResourceClientOptions = {}
): ResourceClient {
  const fetcher = resolveFetch(options.fetcher);

  const getResourceContent = async (
    sessionId: string,
    ref: string
  ): Promise<ResourceContentResponse> => {
    return requestJson<ResourceContentResponse>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}/content`
      })
    });
  };

  const getCollectionItemContent = async (
    sessionId: string,
    ref: string,
    topic: string
  ): Promise<ResourceContentResponse> => {
    return requestJson<ResourceContentResponse>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}/${enc(topic)}/content`
      })
    });
  };

  const createCollectionItem = async (
    sessionId: string,
    ref: string,
    createOptions: CreateCollectionItemOptions
  ): Promise<{ topic: string }> => {
    return requestJson<{ topic: string }>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}`
      }),
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createOptions)
      }
    });
  };

  const updateResourceContent = async (
    sessionId: string,
    ref: string,
    topic: string,
    updateOptions: UpdateResourceContentOptions
  ): Promise<void> => {
    await requestJson<void>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}/${enc(topic)}/content`
      }),
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateOptions)
      }
    });
  };

  const deleteCollectionItem = async (
    sessionId: string,
    ref: string,
    topic: string
  ): Promise<void> => {
    await requestJson<void>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}/${enc(topic)}`
      }),
      init: {
        method: "DELETE"
      }
    });
  };

  const listCollectionItems = async (
    sessionId: string,
    ref: string,
    listOptions: { limit?: number; cursor?: string | null; topicPrefix?: string } = {}
  ): Promise<CollectionListPage> => {
    const query: string[] = [];
    if (listOptions.limit !== undefined) {
      query.push(`limit=${encodeURIComponent(String(listOptions.limit))}`);
    }
    if (listOptions.cursor !== undefined && listOptions.cursor !== null) {
      query.push(`cursor=${encodeURIComponent(listOptions.cursor)}`);
    }
    if (listOptions.topicPrefix !== undefined) {
      query.push(`topicPrefix=${encodeURIComponent(listOptions.topicPrefix)}`);
    }
    const suffix = query.length > 0 ? `?${query.join("&")}` : "";
    return requestJson<CollectionListPage>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}${suffix}`
      })
    });
  };

  const getCollectionItemState = async (
    sessionId: string,
    ref: string,
    topic: string
  ): Promise<CollectionItemState | null> => {
    return requestJson<CollectionItemState | null>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/resources/${enc(ref)}/${enc(topic)}`
      })
    });
  };

  const getResourceManifest = async (
    sessionId: string
  ): Promise<ResourceManifest> => {
    return requestJson<ResourceManifest>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${enc(sessionId)}/manifest`
      })
    });
  };

  return {
    getResourceContent,
    getCollectionItemContent,
    createCollectionItem,
    updateResourceContent,
    deleteCollectionItem,
    listCollectionItems,
    getCollectionItemState,
    getResourceManifest
  };
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
