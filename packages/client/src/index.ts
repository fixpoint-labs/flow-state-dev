/**
 * Public API surface: the one client (`createClient`) and the pure stream
 * helpers that read a stream it returned.
 */
export {
  createClient,
  type ActionInputOf,
  type ActionNameOf,
  type Client,
  type CreateClientOptions,
  type CreateCollectionItemOptions,
  type CreateSessionOptions,
  type FlowHandle,
  type GetSessionStateOptions,
  type InterruptedRequest,
  type ListChildSessionsOptions,
  type ListCollectionItemsOptions,
  type ListSessionRequestsOptions,
  type ListSessionsOptions,
  type RequestHandle,
  type RequestStreamOptions,
  type ResourceContentResponse,
  type ResourcesApi,
  type ResumeSuspensionBody,
  type AnswerSuspensionBody,
  type SendOptions,
  type SentRequest,
  type SessionsApi,
  type StreamOption,
  type TranscribeRequest,
  type TranscribeResponse,
  type TypedFlow,
  type UntypedFlow,
  type UpdateResourceContentOptions,
  type UpdateSessionMetadataOptions,
  type UserStreamOptions
} from "./client";

export { sessionQueryFor } from "./session-client/session-query";
export {
  harnessLines,
  sendHarnessLine,
  steerRunningTurn,
  type HarnessLines,
  type HarnessLineOutcome,
  type HarnessLineSender,
  type SteerRunningTurnOptions
} from "./harness-line";

export {
  createSSEClientFromResponse,
  type CreateSSEClientFromResponseOptions,
  type SessionStreamOptions,
  type StreamResumeOptions
} from "./stream-client/streams";

export {
  createRequestStreamStore,
  compareItemOrder,
  type RequestStreamStore,
  type RequestStreamStoreOptions
} from "./stream-client/request-stream-store";

export {
  bindStoreToCallbacks,
  type BindStoreToCallbacksOptions,
  type RequestStreamChangeKind
} from "./stream-client/bind-store-to-callbacks";

export {
  readEveryCollectionPage,
  CollectionReadStoppedError,
  COLLECTION_READ_MAX_PAGES,
  type CollectionReadStopReason,
  type ReadEveryCollectionPageOptions
} from "./resource-client/read-every-page";

export type {
  ClientFetch,
  CollectionSnapshotEntry,
  DebugClientView,
  DebugCollectionItem,
  DebugCollectionItemsResponse,
  DebugResourceClientConfig,
  DebugResourceEntry,
  DebugResourcesResponse,
  DebugSuspensionsResponse,
  ListDebugCollectionItemsOptions,
  ListDebugSuspensionsOptions,
  SuspensionRecord,
  SuspensionStatus,
  CollectionSnapshotPrefetchedItem,
  CollectionListPage,
  CollectionItemState,
  CollectionItemHandle,
  ResourceManifest,
  ResourceManifestEntry,
  ExecuteActionRequestBody,
  ExecuteActionResponse,
  FlowCapabilities,
  FlowListEntry,
  ActionInputSchema,
  ActionFieldSchema,
  ActionFieldType,
  QueryValue,
  RequestSSECallbacks,
  RequestStreamHandle,
  ResourceSnapshotEntry,
  SessionDetail,
  SessionRequestResult,
  SessionRequestSummary,
  SessionSSECallbacks,
  SessionStreamHandle,
  SessionStateSnapshotResponse,
  SessionSummary,
  UserSSECallbacks,
  UserStreamHandle,
  ChildSessionStatus,
  ChildSessionSummary
} from "./types";

export { ClientHttpError } from "./types";

export const clientPackageMarker = "@flow-state-dev/client";
