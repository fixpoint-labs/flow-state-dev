/**
 * Resource content and CRUD API client for canonical `/api/flows` resource endpoints.
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type { ClientFetch } from "../types";

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

  return {
    getResourceContent,
    getCollectionItemContent,
    createCollectionItem,
    updateResourceContent,
    deleteCollectionItem
  };
}

function enc(value: string): string {
  return encodeURIComponent(value);
}
