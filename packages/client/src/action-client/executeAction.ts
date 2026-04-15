/**
 * Action execution client and typed flow-bound client builders.
 */
import type { ActionConfig, FlowActionInput } from "@flow-state-dev/core/types";
import { buildFlowApiUrl, requestJson, resolveFetch } from "../internal/http";
import {
  type ClientFetch,
  type ExecuteActionRequestBody,
  type ExecuteActionResponse,
  type FlowCapabilities,
  type FlowClient,
  type FlowLike,
  type FlowListEntry,
  type SendActionOptions,
  type TypedActionMethods
} from "../types";
import {
  createSessionClient,
  type CreateSessionClientOptions
} from "../session-client/sessions";

/**
 * Options for creating the generic client.
 */
export type CreateClientOptions = {
  flowKind: string;
  userId: string;
  baseUrl?: string;
  fetcher?: ClientFetch;
};

/**
 * Generic client contract used for dynamic flow execution.
 */
export type Client = {
  readonly flowKind: string;
  readonly userId: string;
  listFlows: () => Promise<FlowListEntry[]>;
  getCapabilities: () => Promise<FlowCapabilities>;
  sendAction: (
    action: string,
    input: unknown,
    options?: SendActionOptions
  ) => Promise<ExecuteActionResponse>;
  /**
   * Sends an action with `Accept: text/event-stream` so the server returns
   * the SSE stream directly from the POST response. Returns the raw Response
   * whose body is the event stream. Falls back to a 202 JSON response when
   * the server does not support inline streaming.
   */
  sendActionStream: (
    action: string,
    input: unknown,
    options?: SendActionOptions
  ) => Promise<Response>;
};

/**
 * Options for creating the typed client.
 */
export type CreateTypedClientOptions<TFlow extends FlowLike> = {
  flow: TFlow;
  userId: string;
} & CreateSessionClientOptions;

/**
 * Creates a generic client scoped to one flow kind.
 */
export function createClient(options: CreateClientOptions): Client {
  const flowKind = ensureRequired(options.flowKind, "flowKind");
  const userId = ensureRequired(options.userId, "userId");
  const fetcher = resolveFetch(options.fetcher);

  const listFlows = async (): Promise<FlowListEntry[]> => {
    const payload = await requestJson<{ flows: FlowListEntry[] }>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: "/api/flows"
      })
    });

    return payload.flows;
  };

  const getCapabilities = async (): Promise<FlowCapabilities> => {
    return requestJson<FlowCapabilities>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path: "/api/flows/capabilities"
      })
    });
  };

  const sendAction = async (
    action: string,
    input: unknown,
    sendOptions?: SendActionOptions
  ): Promise<ExecuteActionResponse> => {
    const actionName = ensureRequired(action, "action");
    const requestBody: ExecuteActionRequestBody = {
      input,
      userId,
      sessionId: sendOptions?.sessionId,
      requestId: sendOptions?.requestId,
      projectId: sendOptions?.projectId,
      metadata: sendOptions?.metadata
    };

    const path =
      sendOptions?.sessionId === undefined
        ? `/api/flows/${encodeURIComponent(flowKind)}/actions/${encodeURIComponent(actionName)}`
        : `/api/flows/${encodeURIComponent(flowKind)}/${encodeURIComponent(sendOptions.sessionId)}/actions/${encodeURIComponent(actionName)}`;

    return requestJson<ExecuteActionResponse>({
      fetcher,
      url: buildFlowApiUrl({
        baseUrl: options.baseUrl,
        path
      }),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    });
  };

  const sendActionStream = async (
    action: string,
    input: unknown,
    sendOptions?: SendActionOptions
  ): Promise<Response> => {
    const actionName = ensureRequired(action, "action");
    const requestBody: ExecuteActionRequestBody = {
      input,
      userId,
      sessionId: sendOptions?.sessionId,
      requestId: sendOptions?.requestId,
      projectId: sendOptions?.projectId,
      metadata: sendOptions?.metadata
    };

    const path =
      sendOptions?.sessionId === undefined
        ? `/api/flows/${encodeURIComponent(flowKind)}/actions/${encodeURIComponent(actionName)}`
        : `/api/flows/${encodeURIComponent(flowKind)}/${encodeURIComponent(sendOptions.sessionId)}/actions/${encodeURIComponent(actionName)}`;

    const url = buildFlowApiUrl({ baseUrl: options.baseUrl, path });

    const response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "text/event-stream"
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Action request failed (${response.status}): ${text}`);
    }

    return response;
  };

  return {
    flowKind,
    userId,
    listFlows,
    getCapabilities,
    sendAction,
    sendActionStream
  };
}

/**
 * Creates a typed client with `actions.<actionName>(input)` helpers.
 */
export function createTypedClient<TFlow extends FlowLike>(
  options: CreateTypedClientOptions<TFlow>
): FlowClient<TFlow> {
  const flowKind = ensureRequired(options.flow.kind, "flow.kind");
  const client = createClient({
    flowKind,
    userId: options.userId,
    baseUrl: options.baseUrl,
    fetcher: options.fetcher
  });
  const sessions = createSessionClient({
    baseUrl: options.baseUrl,
    fetcher: options.fetcher
  });

  const actions = Object.fromEntries(
    Object.keys(options.flow.actions).map((actionName) => [
      actionName,
      (
        input: FlowActionInput<ActionConfig>,
        actionOptions?: SendActionOptions
      ) => client.sendAction(actionName, input, actionOptions)
    ])
  ) as TypedActionMethods<TFlow>;

  return {
    flowKind,
    userId: client.userId,
    sendAction: client.sendAction,
    actions,
    state: {
      getSnapshot: (sessionId: string) =>
        sessions.getSessionState(sessionId),
      getSessionState: async (sessionId: string) => {
        const snapshot = await sessions.getSessionState(sessionId);
        return snapshot.state.session as
          | Awaited<ReturnType<FlowClient<TFlow>["state"]["getSessionState"]>>
          | undefined;
      },
      getUserState: async (sessionId: string) => {
        const snapshot = await sessions.getSessionState(sessionId);
        return snapshot.state.user as
          | Awaited<ReturnType<FlowClient<TFlow>["state"]["getUserState"]>>
          | undefined;
      },
      getProjectState: async (sessionId: string) => {
        const snapshot = await sessions.getSessionState(sessionId);
        return snapshot.state.project as
          | Awaited<ReturnType<FlowClient<TFlow>["state"]["getProjectState"]>>
          | undefined;
      }
    }
  };
}

function ensureRequired(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`createClient requires non-empty ${name}`);
  }

  return trimmed;
}
