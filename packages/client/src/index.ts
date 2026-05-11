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

export {
  createRecoveryClient,
  type CreateRecoveryClientOptions,
  type CheckInterruptedOptions,
  type InterruptedRequestSummary,
  type RetryRequestOptions,
  type RetryRequestResult,
  type RecoveryClient
} from "./recovery-client/recovery";

export type {
  ClientFetch,
  ClientTransportOptions,
  CollectionSnapshotEntry,
  DebugClientView,
  DebugCollectionItem,
  DebugCollectionItemsResponse,
  DebugResourceClientConfig,
  DebugResourceEntry,
  DebugResourcesResponse,
  ListDebugCollectionItemsOptions,
  CollectionSnapshotPrefetchedItem,
  CollectionListPage,
  CollectionItemState,
  CollectionItemHandle,
  ResourceManifest,
  ResourceManifestEntry,
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
