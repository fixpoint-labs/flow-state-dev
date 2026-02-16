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
 * Options for creating the generic action client.
 */
export type CreateActionClientOptions = {
  flowKind: string;
  userId: string;
  baseUrl?: string;
  fetcher?: ClientFetch;
};

/**
 * Generic action client contract used for dynamic flow execution.
 */
export type ActionClient = {
  readonly flowKind: string;
  readonly userId: string;
  listFlows: () => Promise<FlowListEntry[]>;
  getCapabilities: () => Promise<FlowCapabilities>;
  sendAction: (
    action: string,
    input: unknown,
    options?: SendActionOptions
  ) => Promise<ExecuteActionResponse>;
};

/**
 * Options for creating the typed flow-bound client.
 */
export type CreateFlowClientOptions<TFlow extends FlowLike> = {
  flow: TFlow;
  userId: string;
} & CreateSessionClientOptions;

/**
 * Alias for typed flow-client options with explicit naming intent.
 */
export type CreateTypedFlowClientOptions<TFlow extends FlowLike> =
  CreateFlowClientOptions<TFlow>;

/**
 * Creates a generic action client scoped to one flow kind.
 */
export function createActionClient(options: CreateActionClientOptions): ActionClient {
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

  return {
    flowKind,
    userId,
    listFlows,
    getCapabilities,
    sendAction
  };
}

/**
 * Creates a typed flow client with `actions.<actionName>(input)` helpers.
 */
export function createFlowClient<TFlow extends FlowLike>(
  options: CreateFlowClientOptions<TFlow>
): FlowClient<TFlow> {
  const flowKind = ensureRequired(options.flow.kind, "flow.kind");
  const actionClient = createActionClient({
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
      ) => actionClient.sendAction(actionName, input, actionOptions)
    ])
  ) as TypedActionMethods<TFlow>;

  return {
    flowKind,
    userId: actionClient.userId,
    sendAction: actionClient.sendAction,
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

/**
 * Alias for `createFlowClient` with explicit typed-client naming.
 */
export function createTypedFlowClient<TFlow extends FlowLike>(
  options: CreateTypedFlowClientOptions<TFlow>
): FlowClient<TFlow> {
  return createFlowClient(options);
}

function ensureRequired(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`createActionClient requires non-empty ${name}`);
  }

  return trimmed;
}
