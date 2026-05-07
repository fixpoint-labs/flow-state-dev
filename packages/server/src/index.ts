export { createExecutionContext } from "./context/createExecutionContext";
export type {
  CreateExecutionContextOptions,
  ExecutionContext,
  RequestRuntime
} from "./context/types";
export {
  ConcurrentModificationError,
  ScopeMutationTimeoutError,
  createFilesystemContentStore,
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemStores,
  createFilesystemTraceStore,
  createFilesystemUserStore,
  createInMemoryContentStore,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryStores,
  createInMemoryTraceStore,
  createInMemoryUserStore,
  createScopeStateOps,
  createStateContainer,
  resolveOrgStorageKey,
  resolveTraceMaxRequests,
  resolveUserStorageKey,
  runWithCAS
} from "./stores";
export type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  CheckpointStore,
  ContentScopeType,
  ContentStore,
  ExpectedVersion,
  OrgListOptions,
  OrgRecord,
  OrgStore,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  RequestStore,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  SetResult,
  StoreRegistry,
  SubscribeToEventsOptions,
  TraceEvent,
  TraceStore,
  UserListOptions,
  UserRecord,
  UserStore
} from "./stores";
export * from "./streaming";
export * from "./execution";
export * from "./registry";
export * from "./routes";
export * from "./transports";
// Model infrastructure — re-exported from core.
// Prefer importing from @flow-state-dev/core or @flow-state-dev/core/models.
// Note: core's `isRetryableError` is intentionally NOT re-exported here — it
// would collide with the policy-aware `isRetryableError` from `./execution`,
// which has a different signature (`(error, policy)`) and serves a different
// purpose. Import core's helper from `@flow-state-dev/core/models` directly.
export {
  createAiSdkModelResolver,
  wrapAiSdkModel,
  createModelResolver,
  createFSDProvider,
  defaultGroups,
  detectAvailableProviders,
  parseModelString,
  createFallbackModel,
  createAiSdkSpeechResolver,
  wrapAiSdkSpeechModel,
  createAiSdkTranscriptionResolver,
  wrapAiSdkTranscriptionModel
} from "@flow-state-dev/core/models";
export type {
  ResolveAiSdkLanguageModel,
  CreateModelResolverOptions,
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  ModelGroupDefaults,
  GatewayConfig,
  RetryPolicy,
  GatewayType,
  ProviderName,
  ProviderAvailability,
  ParsedModelString,
  FallbackModelEntry,
  ResolveAiSdkSpeechModel,
  ResolveAiSdkTranscriptionModel,
  ProviderPreference,
  ResolveOptions,
  ExplainCandidate,
  ExplainResult
} from "@flow-state-dev/core/models";
export {
  FlowError,
  ModelError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ToolExecutionError,
  ValidationError,
  AmbiguousBlockNameError
} from "./errors/flow-error";
export { normalizeError } from "./errors/normalize-error";
export {
  StoreSubscriptionError,
  STORE_SUBSCRIPTION_ERROR_CODES,
  type StoreSubscriptionErrorCode
} from "./errors/store-subscription-error";
export { BoundedQueue } from "./utils/bounded-queue";
export type { BoundedQueuePushResult } from "./utils/bounded-queue";
export {
  isTerminalRequestStreamEvent,
  synthesizeRequestInterrupted,
  pollEvents,
  abortableSleep,
  type ReadEventsFn
} from "./stores/subscribe-helpers";
export {
  OrgBindingMismatchError,
  UserBindingMismatchError
} from "./context/binding-errors";

export {
  createSentenceBuffer,
  createTTSPipeline,
  createTTSEmitterHook,
  voiceContext,
  type SentenceBuffer,
  type TTSPipeline,
  type TTSPipelineOptions,
  type TTSEmitterHook
} from "./voice";

export { createBindingCache, type CachedBindingProvider } from "./bindings";
export * from "./middleware";

export const serverPackageMarker = "@flow-state-dev/server";

export { renderTemplate } from "./utils/renderTemplate";

// ---------------------------------------------------------------------------
// Internal resource helpers exposed for sibling-package consumption
// (e.g. @flow-state-dev/mcp). Prefixed `unstable_` — not part of the
// long-term public API.
// ---------------------------------------------------------------------------
export {
  findResourceConfig as unstable_findResourceConfig,
  getPersistedData as unstable_getPersistedData,
  isCollectionConfig as unstable_isCollectionConfig,
  listExposedResources as unstable_listExposedResources,
  renderContent as unstable_renderContent
} from "./resources/internal";
export type {
  ExposedResourceEntry as unstable_ExposedResourceEntry,
  ResolvedResourceScope as unstable_ResolvedResourceScope,
  ResourceFlowLike as unstable_ResourceFlowLike,
  ResourcePersistenceContext as unstable_ResourcePersistenceContext
} from "./resources/internal";
