export type {
  BlockCacheableConfig,
  BlockContext,
  BlockDefinition,
  BlockInput,
  BlockKind,
  BlockOutput,
  BlockResult,
  DeclaredResources,
  FlowStateSettings,
  LooseBlockContext,
} from "./types/block";
export type {
  OrgScopeHandle,
  RequestScopeHandle,
  SessionScopeHandle,
  UserScopeHandle,
} from "./types/scope";
export type { ScopeStateOps } from "./types/state";
export type { AgentType, ItemVisibility } from "./items/types";
export {
  whenAnyItem,
  whenResourceChanged,
  whenResourceMatching
} from "./items/predicates";
// `ClientDataOf` covers both DefinedResource and DefinedResourceCollection — one import for either.
export type { ClientDataOf, ContextOf, DefinedResource, ResourceContext, StateOf } from "./types/resource";
export type {
  CollectionHookContext,
  DefinedResourceCollection,
  EvictionPolicy,
  ResourceCollectionConfig,
  ResourceCollectionRef,
} from "./types/resource-collection";
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaybePromise,
  SchemaInput,
  SchemaOutput
} from "./schema/common";

export { applyGetOrPatchState, defineResource, resource } from "./types/resource";
export { canonicalize as canonicalizeToolArgs } from "./blocks/internal/cache-tool-call";
export {
  bindToolCacheStore,
  createInMemoryToolCacheStore,
  createToolCacheCapability,
} from "./blocks/tool-cache";
export type {
  CreateToolCacheCapabilityOptions,
  ToolCacheAccessor,
  ToolCacheEntry,
  ToolCacheStore,
} from "./blocks/tool-cache";
export { defineResourceCollection, isDefinedResourceCollection } from "./types/resource-collection";
export {
  normalizeReactiveBinding,
  resourceChangeSchema,
  resourceContentChangeSchema,
} from "./types/resource-change";
export type {
  ReactiveBinding,
  ReactiveContentBinding,
  ReactiveBindings,
  ReactiveBindingKind,
  ResourceChange,
  ResourceContentChange,
  ResourceChangeKind,
} from "./types/resource-change";
export type {
  InitialSkill,
  MatchedSkill,
  PatternBinding,
  RunSkillInput,
  RunSkillOutput,
  Skill,
  SkillActivationSource,
  SkillContextMode,
  SkillFile,
  SkillState,
  SkillsCollectionMeta,
  TaskInitYaml,
  ToolCatalog,
  WorkerSpec,
} from "./types/skill";

export type {
  Agent,
  AgentOverrides,
  AgentRegistry,
  MaterializeAgentFn,
  MaterializeAgentOptions,
  PersonaInlineConfig,
  PersonaSource,
} from "./types/agent";
export { defineCapability, getBaseCapability } from "./capability";
export type {
  CapabilityPresetCtx,
  CapabilityRef,
  ConfiguredCapability,
  DefinedCapability,
  InferCapabilities,
  PresetContextEntry,
  PresetDef,
  PresetOverrides,
  UsesEntry,
  UsesSlot,
} from "./capability";
export { contextFn } from "./context";
export type { ContextFunction } from "./context";
export { mapLimit } from "./helpers/concurrency";
export { SLASH_COMMAND_PATTERN } from "./helpers/slash-command";
export { lifecycleSchema } from "./helpers/lifecycle-schema";
export { isTraceObservabilityEnabled } from "./helpers/trace-observability";
export { resolveTracingLevel } from "./helpers/tracing-level";
export type { TracingLevel } from "./helpers/tracing-level";
export { transientSlot } from "./helpers/transient-slot";
export {
  buildBlockInstanceId,
  blockPathBranch,
  blockPathIteration,
  blockPathLoop,
  blockPathRescue,
  blockPathSegment,
  blockPathTool,
  extendBlockPath,
  parseBlockInstanceId,
  ROOT_BLOCK_PATH
} from "./blocks/internal/block-instance-id";
export { resolveActiveStatusMessage } from "./blocks/internal/resolve-active-status-message";
// Log-as-source-of-truth resume read model (FIX-811). Exported so the server
// can build a ReplayLog from a request's persisted items at re-entry and assign
// it to `ctx._replayLog`; the core `executeBlock` seam consumes the interface.
export { buildReplayLog } from "./blocks/internal/replay-log";
export type { ReplayLog } from "./blocks/internal/replay-log";
// Canonical item-log view (FIX-811): collapse a resumed request's superseded
// re-emissions for the read paths (GET history, useSession, SSE replay seed).
export { collapseToCanonicalLog } from "./items/canonical-log";
export {
  generator,
  handler,
  providerTool,
  router,
  sequencer
} from "./blocks";
// Block-level rescue resolution (FIX-742). Exported so the server's top-level
// `executeBlock` can honor `config.rescue` on a bare action-root block; in-flow
// children are rescued by the core `executeBlock` seam.
export { runRescue } from "./blocks/sequencer";
export { defineFlow } from "./flow";
export { readResourceContentTool, writeResourceContentTool } from "./tools/resource-content-tools";
export { resolveResourceByPath, resolveResourceByUri } from "./tools/resource-tools";
export { resourceTools } from "./tools/resource-tools";
export { resourceSearchTools } from "./tools/resource-search-tools";
export {
  DEFAULT_MODEL_LOOKUP,
  findModelEntry,
  modelPricingEstimator,
  type ModelLookupEntry
} from "./adapters/model-lookup";
export { createEstimateTokenCounter, estimateTokenCounter } from "./adapters/token-counter";
export { createTiktokenCounter } from "./adapters/tiktoken";
export * as utility from "./utility";
export type {
  BranchStep,
  BranchStepOutput,
  FactoryConfig,
  GeneratorCompletedMeta,
  GeneratorConfig,
  GeneratorHistoryConfig,
  GeneratorLoopConfig,
  GeneratorLoopState,
  GeneratorRepairConfig,
  GeneratorRepairMode,
  GeneratorSlot,
  GeneratorSlotEntry,
  GeneratorSlotRefOptions,
  GeneratorSlotReference,
  ContextObject,
  GeneratorTool,
  GeneratorToolResult,
  ToolsSlot,
  InstructionsSlot,
  PromptSlot,
  HandlerConfig,
  InlineBlockFactory,
  InlineConfig,
  InlineTapConfig,
  ParallelStep,
  ParallelStepOutput,
  RouterConfig,
  SequencerConfig,
  SequencerDefinition
} from "./blocks";
export type {
  CostEstimate,
  CostEstimator,
  ActionConfig,
  ActionCore,
  ActionMcpConfig,
  ClientDataComputeFn,
  ClientDataContext,
  ScopeClientConfig,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  FlowType,
  McpConfig,
  ModelUsageEntry,
  TokenLedger,
  ToolLifecycleEvent,
  ToolsConfig
} from "./types/flow";

export type {
  ScheduleConfig,
  ScheduleInputContext,
  ScheduleInputFn,
  ScheduleResolutionContext,
  ScheduleResolutionStores,
  SchedulesConfig
} from "./types/schedules";

export {
  defineScheduleBinding,
  validateScheduleConfig,
  validateSchedulesConfig
} from "./types/schedules";

export type {
  ConcurrencyConfig,
  ConcurrencyKey,
  ConcurrencyKeyContext,
  ConcurrencyPolicyName
} from "./types/concurrency";

export { validateConcurrencyConfig } from "./types/concurrency";

export type { ChatConfig, ChatEventBinding } from "./types/chat";
export { validateChatConfig } from "./types/chat";
export type {
  WebhookConfig,
  WebhookEventBinding,
  WebhookInboundEvent,
  WebhookSubscriptionConfig
} from "./types/webhooks";
export { defineWebhookBinding, validateWebhookConfig } from "./types/webhooks";
export type {
  TokenCounter,
} from "./types/tokens";
export type {
  CachingBreakpointMode,
  CachingConfig,
  CachingTtl,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelLoopOptions,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorModelUsage,
  GeneratorSearchConfig,
  ModelIdentity,
  ModelResolver,
  ResolveModelCallOptions,
  PrepareStepFn,
  PrepareStepResult,
  ProviderTool
} from "./types/model";

// Cross-pattern benchmark contract types (shared by patterns + testing engine)
export type {
  BenchmarkCategory,
  BenchmarkTask,
  BenchmarkSubject,
  BenchmarkAdapterOptions,
  BenchmarkAdapter,
  BenchmarkRegistry
} from "./benchmark/types";

export type { TTSConfig, VoiceConfig } from "./types/speech";

export type {
  CompositeVoiceProviderConfig,
  ListVoicesCapable,
  SpeakCapable,
  SpeakChunk,
  SpeakOptions,
  SpeakResult,
  SpeakStreamCapable,
  TranscribeCapable,
  TranscribeOptions,
  TranscribeResult,
  VoiceAbilities,
  VoiceInfo,
  VoiceProvider
} from "./types/voice-provider";

export {
  canListVoices,
  canSpeak,
  canSpeakStream,
  canTranscribe,
  createCompositeVoiceProvider
} from "./types/voice-provider";

export type { VoiceErrorKind, VoiceErrorOptions } from "./types/voice-error";
export { VoiceError } from "./types/voice-error";

export type { BindingCacheOptions, BindingProvider } from "./types/binding";
export { createBindingCache } from "./bindings";
export type { CachedBindingProvider } from "./bindings";

// Model infrastructure (AI SDK adapters, provider detection, fallback)
export {
  createAiSdkModelResolver,
  wrapAiSdkModel,
  createModelResolver,
  createFallbackModel,
  isRetryableError,
  detectAvailableProviders,
  parseModelString,
  extractProviderName,
  selectModel,
  isModelSelection,
  applyCaching,
  DEFAULT_CACHING_CONFIG,
  makeSchemaStrict,
  assertStrictCompatible
} from "./models";
export type {
  ResolveAiSdkLanguageModel,
  CreateModelResolverOptions,
  IntentDefaults,
  ModelGroupDefaults,
  GatewayConfig,
  GatewayType,
  ProviderName,
  ProviderAvailability,
  ParsedModelString,
  FallbackModelEntry,
  ModelRule,
  PreferProviderRule,
  WhenRule,
  ModelSelection,
  ProviderPreference,
  MakeSchemaStrictOptions,
  StrictViolation
} from "./models";
export type {
  RequestWorkPool,
  RequestWorkPoolResult,
  RequestWorkPoolDrainOptions,
  RequestWorkPoolDrainAllOptions,
  RequestWorkTaskMeta
} from "./execution/request-work-pool";
export { getRequestWorkPool } from "./execution/request-work-pool";

export {
  FlowError,
  OutputValidationError,
  StrictSchemaError,
  SequencerOutputSchemaError,
  SequencerSchemaMismatchError,
  SuspensionError,
  SuspensionRejectedError,
  SuspensionTimeoutError,
  RouteUnavailableError,
  rootCause,
  isAbortLike,
  serializeError,
  errorDetailsWithCause
} from "./errors";
export type {
  FlowErrorOptions,
  FlowErrorScope,
  OutputValidationDetails,
  RouteUnavailableDetails,
  SequencerOutputSchemaErrorDetails,
  SequencerSchemaMismatchErrorDetails,
  SuspendOptions,
  SerializedError
} from "./errors";
// The skip sentinel returned by ctx.suspend() lives alongside SuspensionError on
// the top-level surface so flow authors import both from one place.
export { SUSPENSION_SKIPPED } from "./types/suspension";
export type { ResumeAction, SuspensionSkipped } from "./types/suspension";
