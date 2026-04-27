/**
 * Public API surface for framework transport clients and stream utilities.
 */
export {
  createClient,
  createTypedClient,
  type Client,
  type CreateClientOptions,
  type CreateTypedClientOptions
} from "./action-client/executeAction";

export {
  createSessionClient,
  type CreateSessionClientOptions,
  type CreateSessionOptions,
  type GetSessionStateOptions,
  type ListSessionRequestsOptions,
  type ListSessionsOptions,
  type SessionClient,
  type UpdateSessionMetadataOptions
} from "./session-client/sessions";

export {
  createSSEClient,
  createSSEClientFromResponse,
  createUserSSEClient,
  type CreateSSEClientOptions,
  type CreateSSEClientFromResponseOptions,
  type CreateUserSSEClientOptions
} from "./stream-client/createSSEClient";

export {
  createResourceClient,
  type CreateResourceClientOptions,
  type ResourceClient,
  type ResourceContentResponse,
  type CreateCollectionItemOptions,
  type UpdateResourceContentOptions
} from "./resource-client/resources";

export type {
  ClientFetch,
  ClientTransportOptions,
  CollectionSnapshotEntry,
  ExecuteActionRequestBody,
  ExecuteActionResponse,
  FlowCapabilities,
  FlowClient,
  FlowLike,
  FlowListEntry,
  ActionInputSchema,
  ActionFieldSchema,
  ActionFieldType,
  QueryValue,
  RequestSSECallbacks,
  RequestStreamHandle,
  ResourceSnapshotEntry,
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

export {
  transcribe,
  type TranscribeOptions,
  type TranscribeRequest,
  type TranscribeResponse
} from "./transcription/transcribe";

export const clientPackageMarker = "@flow-state-dev/client";
