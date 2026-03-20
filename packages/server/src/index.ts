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
  ProjectRecord,
  ProjectStore,
  RequestRecord,
  RequestStatus,
  RequestStore,
  SessionRecord,
  SessionStore,
  StoreRegistry,
  UserRecord,
  UserStore
} from "./stores";
export * from "./streaming";
export * from "./execution";
export * from "./registry";
export * from "./routes";
// Model infrastructure — re-exported from core for backward compatibility.
// Prefer importing from @flow-state-dev/core or @flow-state-dev/core/models.
export {
  createAiSdkModelResolver,
  wrapAiSdkModel,
  createDefaultModelResolver,
  createFSDProvider,
  defaultGroups,
  detectAvailableProviders,
  parseModelId,
  toGatewayModelId,
  createFallbackModel,
  isRetryableError,
  createAiSdkSpeechResolver,
  wrapAiSdkSpeechModel,
  createAiSdkTranscriptionResolver,
  wrapAiSdkTranscriptionModel
} from "@flow-state-dev/core/models";
export type {
  ResolveAiSdkLanguageModel,
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  ModelGroupDefaults,
  GatewayConfig,
  RetryPolicy,
  GatewayType,
  ProviderName,
  ProviderAvailability,
  FallbackModelEntry,
  ResolveAiSdkSpeechModel,
  ResolveAiSdkTranscriptionModel
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
  createSentenceBuffer,
  createTTSPipeline,
  createTTSEmitterHook,
  type SentenceBuffer,
  type TTSPipeline,
  type TTSPipelineOptions,
  type TTSEmitterHook
} from "./voice";

export { createBindingCache, type CachedBindingProvider } from "./bindings";
export * from "./middleware";

export const serverPackageMarker = "@flow-state-dev/server";

export { renderTemplate } from "./utils/renderTemplate";
