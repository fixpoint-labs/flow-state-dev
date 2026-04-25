export type { BlockInput, BlockOutput, DeclaredResources } from "./types/block";
export type { AgentType, ItemVisibility } from "./items/types";
export type { ContextOf, DefinedResource, ResourceContext, StateOf } from "./types/resource";
export type {
  CollectionHookContext,
  DefinedResourceCollection,
  EvictionPolicy,
  ResourceCollectionConfig,
  ResourceCollectionRef,
  ResourceCollectionHandle,
  // Deprecated aliases
  NamespaceHookContext,
  DefinedResourceNamespace,
  ResourceNamespaceConfig,
  ResourceNamespaceHandle,
  ResourceNamespaceRef,
} from "./types/resource-collection";
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaybePromise,
  SchemaInput,
  SchemaOutput
} from "./schema/common";

export { defineResource, resource } from "./types/resource";
export { defineResourceCollection, isDefinedResourceCollection, defineResourceNamespace, isDefinedResourceNamespace } from "./types/resource-collection";
export type {
  InitialSkill,
  RunSkillInput,
  RunSkillOutput,
  Skill,
  SkillContextMode,
  SkillFile,
  SkillState,
  SkillsCollectionMeta,
  ToolCatalog,
} from "./types/skill";
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
export { isTraceObservabilityEnabled } from "./utils/trace-observability";
export {
  buildBlockInstanceId,
  blockPathBranch,
  blockPathIteration,
  blockPathRescue,
  blockPathSegment,
  blockPathTool,
  extendBlockPath,
  parseBlockInstanceId,
  ROOT_BLOCK_PATH
} from "./blocks/internal/block-instance-id";
export { resolveActiveStatusMessage } from "./blocks/internal/resolve-active-status-message";
export {
  generator,
  handler,
  providerTool,
  router,
  sequencer
} from "./blocks";
export { defineFlow } from "./flow";
export { readResourceContentTool, writeResourceContentTool } from "./tools/resource-content-tools";
export { resourceTools } from "./tools/resource-tools";
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
  ClientDataComputeFn,
  ClientDataContext,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  FlowType,
  ModelUsageEntry,
  TokenLedger,
  ToolLifecycleEvent,
  ToolsConfig
} from "./types/flow";
export type {
  TokenCounter,
} from "./types/tokens";
export type {
  CachingBreakpointMode,
  CachingConfig,
  CachingTtl,
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorModelUsage,
  GeneratorSearchConfig,
  ModelResolver,
  PrepareStepFn,
  PrepareStepResult,
  ProviderTool
} from "./types/model";

export type {
  SpeechModel,
  SpeechResolver,
  SpeechResult,
  TranscriptionModel,
  TranscriptionResolver,
  TranscriptionResult,
  TTSConfig,
  VoiceConfig
} from "./types/speech";

export type { BindingCacheOptions, BindingProvider } from "./types/binding";

// Model infrastructure (AI SDK adapters, provider detection, fallback)
export {
  createAiSdkModelResolver,
  wrapAiSdkModel,
  createModelResolver,
  createAiSdkSpeechResolver,
  wrapAiSdkSpeechModel,
  createAiSdkTranscriptionResolver,
  wrapAiSdkTranscriptionModel,
  createFSDProvider,
  defaultGroups,
  createFallbackModel,
  isRetryableError,
  detectAvailableProviders,
  parseModelString,
  DEFAULT_PRESETS,
  selectModel,
  applyCaching,
  DEFAULT_CACHING_CONFIG
} from "./models";
export type {
  ResolveAiSdkLanguageModel,
  ResolveAiSdkSpeechModel,
  ResolveAiSdkTranscriptionModel,
  CreateModelResolverOptions,
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  ModelGroupDefaults,
  GatewayConfig,
  GatewayType,
  ProviderName,
  ProviderAvailability,
  ParsedModelString,
  PresetConfig,
  FallbackModelEntry,
  ModelRule,
  PreferRule,
  WhenRule,
  ProviderPreference,
  ResolveOptions,
  ExplainCandidate,
  ExplainResult
} from "./models";
