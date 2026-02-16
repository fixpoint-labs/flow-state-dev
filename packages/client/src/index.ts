/**
 * Public API surface for framework transport clients and stream utilities.
 */
export {
  createActionClient,
  createFlowClient,
  createTypedFlowClient,
  type ActionClient,
  type CreateActionClientOptions,
  type CreateFlowClientOptions,
  type CreateTypedFlowClientOptions
} from "./action-client/executeAction";

export {
  createSessionClient,
  type CreateSessionClientOptions,
  type CreateSessionOptions,
  type ListSessionRequestsOptions,
  type ListSessionsOptions,
  type SessionClient
} from "./session-client/sessions";

export {
  createSSEClient,
  createUserSSEClient,
  type CreateSSEClientOptions,
  type CreateUserSSEClientOptions
} from "./stream-client/createSSEClient";

export type {
  ClientFetch,
  ClientTransportOptions,
  ExecuteActionRequestBody,
  ExecuteActionResponse,
  FlowCapabilities,
  FlowClient,
  FlowLike,
  FlowListEntry,
  QueryValue,
  RequestSSECallbacks,
  RequestStreamHandle,
  SendActionOptions,
  SessionDetail,
  SessionRequestSummary,
  SessionStateSnapshotResponse,
  SessionSummary,
  TypedActionMethods,
  UserSSECallbacks,
  UserStreamHandle
} from "./types";

export { ClientHttpError } from "./types";

export const clientPackageMarker = "@flow-state-dev/client";
