/**
 * Session and state snapshot API client for canonical `/api/flows` endpoints.
 */
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import type {
  ClientFetch,
  QueryValue,
  SessionDetail,
  SessionRequestSummary,
  SessionStateSnapshotResponse,
  SessionSummary
} from "../types";

/**
 * Shared options for session API clients.
 */
export type CreateSessionClientOptions = {
  baseUrl?: string;
  fetcher?: ClientFetch;
};

/**
 * Query options for listing sessions.
 */
export type ListSessionsOptions = {
  flowKind?: string;
  userId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Query options for listing requests in one session.
 */
export type ListSessionRequestsOptions = {
  status?: SessionRequestSummary["status"];
  limit?: number;
  offset?: number;
};

/**
 * Query options for reading a session state snapshot.
 */
export type GetSessionStateOptions = {
  includeItems?: boolean;
  projections?: string[];
  itemTypes?: string[];
  offset?: number;
  limit?: number;
};

/**
 * Payload used when creating a new session.
 */
export type CreateSessionOptions = {
  flowKind: string;
  userId: string;
  sessionId?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

/**
 * Session API client contract.
 */
export type SessionClient = {
  listSessions: (options?: ListSessionsOptions) => Promise<SessionSummary[]>;
  getSession: (sessionId: string) => Promise<SessionDetail>;
  listSessionRequests: (
    sessionId: string,
    options?: ListSessionRequestsOptions
  ) => Promise<SessionRequestSummary[]>;
  getSessionState: (
    sessionId: string,
    options?: GetSessionStateOptions
  ) => Promise<SessionStateSnapshotResponse>;
  createSession: (options: CreateSessionOptions) => Promise<SessionDetail>;
  deleteSession: (sessionId: string) => Promise<void>;
};

/**
 * Creates a session API client for canonical flow session routes.
 */
export function createSessionClient(options: CreateSessionClientOptions = {}): SessionClient {
  const fetcher = resolveFetch(options.fetcher);

  const listSessions = async (
    listOptions?: ListSessionsOptions
  ): Promise<SessionSummary[]> => {
    const payload = await requestJson<{ sessions: SessionSummary[] }>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: "/api/flows/sessions",
        query: asQuery(listOptions)
      })
    });

    return payload.sessions;
  };

  const getSession = async (sessionId: string): Promise<SessionDetail> => {
    const payload = await requestJson<{ session: SessionDetail }>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${encodeURIComponent(requireId(sessionId, "sessionId"))}`
      })
    });

    return payload.session;
  };

  const listSessionRequests = async (
    sessionId: string,
    listOptions?: ListSessionRequestsOptions
  ): Promise<SessionRequestSummary[]> => {
    const payload = await requestJson<{ requests: SessionRequestSummary[] }>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${encodeURIComponent(requireId(sessionId, "sessionId"))}/requests`,
        query: asQuery(listOptions)
      })
    });

    return payload.requests;
  };

  const getSessionState = async (
    sessionId: string,
    stateOptions?: GetSessionStateOptions
  ): Promise<SessionStateSnapshotResponse> => {
    return requestJson<SessionStateSnapshotResponse>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${encodeURIComponent(requireId(sessionId, "sessionId"))}/state`,
        query: asQuery({
          include_items: stateOptions?.includeItems,
          projections:
            stateOptions?.projections === undefined ||
            stateOptions.projections.length === 0
              ? undefined
              : stateOptions.projections.join(","),
          item_types:
            stateOptions?.itemTypes === undefined ||
            stateOptions.itemTypes.length === 0
              ? undefined
              : stateOptions.itemTypes.join(","),
          offset: stateOptions?.offset,
          limit: stateOptions?.limit
        })
      })
    });
  };

  const createSession = async (
    createOptions: CreateSessionOptions
  ): Promise<SessionDetail> => {
    const flowKind = requireId(createOptions.flowKind, "flowKind");
    const userId = requireId(createOptions.userId, "userId");
    const payload = await requestJson<{ session: SessionDetail }>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/${encodeURIComponent(flowKind)}/sessions`
      }),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          userId,
          sessionId: createOptions.sessionId,
          projectId: createOptions.projectId,
          metadata: createOptions.metadata,
          state: createOptions.state
        })
      }
    });

    return payload.session;
  };

  const deleteSession = async (sessionId: string): Promise<void> => {
    await requestJson<undefined>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: `/api/flows/sessions/${encodeURIComponent(requireId(sessionId, "sessionId"))}`
      }),
      init: {
        method: "DELETE"
      }
    });
  };

  return {
    listSessions,
    getSession,
    listSessionRequests,
    getSessionState,
    createSession,
    deleteSession
  };
}

function requireId(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`createSessionClient requires non-empty ${name}`);
  }

  return trimmed;
}

function asQuery(
  value: Record<string, QueryValue> | undefined
): Record<string, QueryValue> | undefined {
  if (value === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  );
}
