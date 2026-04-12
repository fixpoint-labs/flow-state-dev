export { createExecutionContext } from "./context/createExecutionContext";
export type {
  CreateExecutionContextOptions,
  ExecutionContext,
  RequestRuntime
} from "./context/types";
export {
  ConcurrentModificationError,
  createFilesystemProjectStore,
  createFilesystemRequestStore,
  createFilesystemSessionStore,
  createFilesystemStores,
  createFilesystemUserStore,
  createInMemoryProjectStore,
  createInMemoryRequestStore,
  createInMemorySessionStore,
  createInMemoryStores,
  createInMemoryUserStore,
  createScopeStateOps,
  createStateContainer,
  runWithCAS
} from "./stores";
export type {
  ActiveRequestEntry,
  ActiveRequestRegistry,
  ProjectListOptions,
  ProjectRecord,
  ProjectStore,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  RequestStore,
  SessionListOptions,
  SessionRecord,
  SessionStore,
  StoreRegistry,
  UserListOptions,
  UserRecord,
  UserStore
} from "./stores";
export * from "./streaming";
export * from "./execution";
export * from "./registry";
export * from "./routes";
// Model infrastructure — re-exported from core.
// Prefer importing from @flow-state-dev/core or @flow-state-dev/core/models.
export {
  createAiSdkModelResolver,
  wrapAiSdkModel,
  createModelResolver,
  createFSDProvider,
  defaultGroups,
  detectAvailableProviders,
  parseModelString,
  DEFAULT_PRESETS,
  createFallbackModel,
  isRetryableError,
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
  PresetConfig,
  FallbackModelEntry,
  ResolveAiSdkSpeechModel,
  ResolveAiSdkTranscriptionModel
} from "@flow-state-dev/core/models";
export {
  FlowError,
  ModelError,
  NetworkError,
  RateLimitError,
  SuspensionRejectedError,
  SuspensionTimeoutError,
  TimeoutError,
  ToolExecutionError,
  ValidationError,
  AmbiguousBlockNameError
} from "./errors/flow-error";

export {
  cleanupRequestSuspensions,
  getRequestSuspensions,
  getSuspension,
  registerSuspension,
  removeSuspension,
  resetSuspensionRegistry,
  type PendingSuspension
} from "./suspension";
export { normalizeError } from "./errors/normalize-error";

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
