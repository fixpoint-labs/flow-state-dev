export type { BlockInput, BlockOutput, DeclaredResources } from "./types/block";
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
export { defineCapability, getBaseCapability } from "./capability";
export type {
  CapabilityPresetCtx,
  CapabilityRef,
  ConfiguredCapability,
  DefinedCapability,
  InferCapabilities,
  PresetDef,
  PresetOverrides,
  UsesEntry,
  UsesSlot,
} from "./capability";
export { contextFn } from "./context";
export type { ContextFunction } from "./context";
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
  GeneratorLoopConfig,
  GeneratorLoopState,
  GeneratorRepairConfig,
  GeneratorRepairMode,
  GeneratorSlot,
  GeneratorSlotEntry,
  GeneratorSlotRefOptions,
  GeneratorSlotReference,
  GeneratorTool,
  GeneratorToolResult,
  ToolsSlot,
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
  selectModel
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
  WhenRule
} from "./models";
