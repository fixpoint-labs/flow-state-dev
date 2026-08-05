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
  createFilesystemResourceStateStore,
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemStores,
  createFilesystemTraceStore,
  createFilesystemUserStore,
  createInMemoryContentStore,
  createInMemoryResourceStateStore,
  toState,
  toStates,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryStores,
  createInMemoryTraceStore,
  createInMemoryUserStore,
  createInMemorySuspensionStore,
  createInMemoryLeaseStore,
  createScopeStateOps,
  createStateContainer,
  filesystemStores,
  inMemoryStores,
  resolveOrgStorageKey,
  resolveTraceMaxRequests,
  resolveUserStorageKey,
  runWithCAS
} from "./stores";
export type {
  CapabilitySlot,
  CapabilitySlotMap,
  StoreAdapter,
  StoresConfig
} from "./stores";
export { createFlowState, isFlowState } from "./flowstate/createFlowState";
export type {
  CreateFlowStateOptions,
  DevToolConnectionConfig,
  FlowState,
  FlowStateModelsConfig,
  FlowStateRuntime,
  FlowStateVoiceConfig,
  WorkerAdapter,
  WorkerHandle,
  WorkerMode
} from "./flowstate/types";
export type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  CheckpointStore,
  ContentScopeType,
  ContentStore,
  LeaseStore,
  ResourceStateStore,
  VersionedResourceState,
  ExpectedVersion,
  OrgListOptions,
  OrgRecord,
  OrgStore,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  PersistErrorHandler,
  PersistErrorInfo,
  RequestStore,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  SetResult,
  StoreRegistry,
  SuspensionStore,
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
// Internal runtime-config bundle (type only — see runtime-config.ts). The
// factory stays unexported; sibling packages construct the bundle inline.
export type { RuntimeConfig } from "./runtime-config";
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
  detectAvailableProviders,
  parseModelString,
  createFallbackModel
} from "@flow-state-dev/core/models";
export type {
  ResolveAiSdkLanguageModel,
  CreateModelResolverOptions,
  IntentDefaults,
  ModelGroupDefaults,
  GatewayConfig,
  RetryPolicy,
  GatewayType,
  ProviderName,
  ProviderAvailability,
  ParsedModelString,
  FallbackModelEntry,
  ProviderPreference
} from "@flow-state-dev/core/models";
export {
  FlowError,
  ModelError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  ContextLengthError,
  ProviderUnavailableError,
  ToolExecutionError,
  ValidationError,
  AmbiguousBlockNameError,
  FlowStateConfigError,
  FlowStateDisposedError
} from "./errors/flow-error";
export { normalizeError } from "./errors/normalize-error";
export type {
  ErrorCaptureEvent,
  ErrorCaptureHandler
} from "./errors/error-capture";
export {
  StoreSubscriptionError,
  STORE_SUBSCRIPTION_ERROR_CODES,
  type StoreSubscriptionErrorCode
} from "./errors/store-subscription-error";
export { BoundedQueue } from "./utils/bounded-queue";
export type { BoundedQueuePushResult } from "./utils/bounded-queue";
export {
  isTerminalRequestStreamEvent,
  endsRequestStream,
  isTerminalRequestStatus,
  synthesizeRequestInterrupted,
  pollEvents,
  abortableSleep,
  type ReadEventsFn
} from "./stores/subscribe-helpers";
export {
  OrgBindingMismatchError,
  TenantBindingMismatchError,
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

export { createCheckpointDurabilityProvider } from "./durability/checkpoint-durability-provider";
export type { DurabilityProvider, Lease, LeaseOptions } from "./durability/types";
export {
  createDurabilitySweeper
} from "./durability/durability-sweeper";
export type {
  DurabilityRetentionConfig,
  CreateDurabilitySweeperOptions,
  DurabilitySweeper
} from "./durability/durability-sweeper";

export const enginePackageMarker = "@flow-state-dev/engine";

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
