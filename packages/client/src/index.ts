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
  type CreateCollectionResourceOptions,
  type CreateSessionOptions,
  type FlowHandle,
  type GetSessionStateOptions,
  type InterruptedRequest,
  type ListChildSessionsOptions,
  type ListCollectionResourcesOptions,
  type ListSessionRequestsOptions,
  type ListSessionsOptions,
  type SessionListInclude,
  type RequestHandle,
  type RequestResult,
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
  type UploadRequest,
  type TypedFlow,
  type UntypedFlow,
  type UpdateResourceContentOptions,
  type UpdateSessionMetadataOptions,
  type WaitOptions
} from "./client";

export type { SubscribeOptions, Subscription } from "./subscribe/push-hub";
export type { LiveRead, LivePaths, LiveReadOptions, LiveReadWithTopicsOptions, LiveResult } from "./live/live-read";
export {
  viewRef,
  type ViewCallOptions,
  type ViewInputOf,
  type ViewRef,
  type ViewResult,
  type ViewValueOf
} from "./view/view";
// The wire topics `subscribe` takes, and the notice `onChange` gets.
export { topic } from "@flow-state-dev/contracts";
export type { ChangeKind, PushCapability, TopicOptions, WireNotice, WireTopic } from "@flow-state-dev/contracts";

export { sessionQueryFor } from "./session-client/session-query";
export { interruptedBySession, type InterruptedBySessionOptions } from "./interrupted-by-session";
export type { SessionConnectionStatus } from "./session-client/follow-session";
export {
  sessionFeed,
  type SessionFeed,
  type SessionFeedOptions,
  type SessionFeedSnapshot
} from "./session-client/session-feed";
export {
  readSessionTail,
  readSessionEarlier,
  refreshSessionWindow,
  SESSION_WINDOW_PAGE,
  type ReadSessionEarlierOptions,
  type ReadSessionTailOptions,
  type SessionItemsSource,
  type SessionItemsWindow
} from "./session-client/session-window";
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
export {
  ResourceWriteError,
  type ScopeCollectionHandle,
  type ScopeEntry,
  type ScopeEntryHandle,
  type ScopeEntryPage,
  type ScopeHandleOf,
  type ScopeResourceDef,
  type ScopeResourceHandle,
  type ScopeResourceRead
} from "./resource-client/scope-resource";

export type {
  ClientFetch,
  CollectionSnapshotEntry,
  DebugClientView,
  DebugCollectionResource,
  DebugCollectionResourcesResponse,
  DebugResourceClientConfig,
  DebugResourceEntry,
  DebugResourcesResponse,
  DebugSuspensionsResponse,
  ListDebugCollectionResourcesOptions,
  ListDebugSuspensionsOptions,
  SuspensionRecord,
  SuspensionStatus,
  CollectionSnapshotPrefetchedItem,
  CollectionListPage,
  CollectionResourceState,
  CollectionResourceHandle,
  ResourceManifest,
  ResourceManifestEntry,
  ExecuteActionResponse,
  FlowCapabilities,
  FlowListEntry,
  ActionInputSchema,
  ActionFieldSchema,
  ActionFieldType,
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
  ChildSessionStatus,
  ChildSessionSummary
} from "./types";

export { ClientHttpError } from "./types";
