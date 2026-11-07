export type {
  BlockContext,
  BlockDefinition,
  BlockInput,
  BlockKind,
  BlockOutput,
  BlockResult,
  DeclaredResources,
  FlowContextView,
  FlowStateSettings,
  InferFlowConfigFromSchema,
  LooseBlockContext,
} from "./types/block";
export type {
  HistoryTurn,
  OrgScopeHandle,
  RequestScopeHandle,
  SessionHistoryWindow,
  SessionScopeHandle,
  StopRequestOutcome,
  UserScopeHandle,
} from "./types/scope";
export type { ScopeStateOps } from "./types/state";
export type { ItemVisibility } from "./items/types";
export {
  whenAnyItem,
  whenResourceChanged,
  whenResourceMatching
} from "./items/predicates";
// `ClientDataOf` covers both DefinedResource and DefinedResourceCollection — one import for either.
export type { ClientDataOf, ContextOf, DefinedResource, ResourceContext, StateOf } from "./types/resource";
export type { ResourceVisibility, ResourceVisibilityRule, ResourceVisibilityTarget } from "./types/resource-visibility";
export type {
  CollectionHookContext,
  DefinedResourceCollection,
  EvictionPolicy,
  ResourceCollectionConfig,
  ResourceCollectionRef,
} from "./types/resource-collection";
export type {
  ResourceIndexDeclaration,
  ResourceIndexFunction,
  ResourceIndexValue,
} from "./types/resource-index";
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaybePromise
} from "./schema/common";

export { DEFAULT_ORG_ID, isValidOrgId } from "./types/auth";
export { defineResource } from "./types/resource";
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
export {
  defineResourceCollection,
  isDefinedResourceCollection,
  ownerSegment,
} from "./types/resource-collection";
export { defineFacetedCollection } from "./types/faceted-collection";
export type {
  FacetedClientConfig,
  FacetedCollection,
  FacetedCollectionConfig,
  FacetedState,
  FacetReindexInput,
  FacetReindexOutput,
  FacetSearchInput,
  FacetSearchOutput,
  FacetsOf,
} from "./types/faceted-collection";
export {
  defineProjectedResourceCollection,
} from "./types/projected-resource-collection";
export type {
  DefinedProjectedResourceCollection,
  ProjectedRecordHit,
  ProjectedReactiveBindings,
  ProjectedResourceCollectionConfig,
  ProjectedResourceContext,
  ResourceQuery,
  ResourceSearchResult,
} from "./types/projected-resource-collection";
export {
  resourceChangeSchema,
  resourceContentChangeSchema,
} from "./types/resource-change";
export type {
  ReactiveBinding,
  ReactiveContentBinding,
  ReactiveBindings,
  ResourceChange,
  ResourceContentChange,
  ResourceChangeKind,
} from "./types/resource-change";

export { defineCapability } from "./capability";

/**
 * One dispatch protocol — typed entries addressed `(type, name)`, and the
 * `dispatcher()` block that sends to one.
 */
export {
  DISPATCH_TYPES,
  DispatchRefusedError,
  bindTaskDispatcher,
  markDispatcher,
  taskBindingOf,
  resolveTaskFlowKind,
  resolveTaskState,
  taskDispatchInputSchema,
  taskSessionKeyFor
} from "./types/dispatch";
export type {
  BlockDispatchType,
  DispatchAddress,
  DispatchOutcome,
  DispatchRefusal,
  DispatchSpec,
  DispatchType,
  InternalEntry,
  SessionTarget,
  TaskBinding,
  TaskDispatchInput,
  TaskEntry,
  TaskEntryChoice,
  TaskFlowTarget,
  TaskStateTarget,
  KeyedTaskSessionPolicy,
  TaskSessionChoice,
  TaskSessionPolicy,
  TaskTargetQuery
} from "./types/dispatch";
export type {
  CapabilityPresetCtx,
  CapabilityRef,
  ConfigArgOf,
  ConfiguredCapability,
  DefinedCapability,
  InferCapabilities,
  PresetContextEntry,
  PresetDef,
  PresetOverrides,
  UsesEntry,
  UsesSlot,
  WithArg,
} from "./capability";
export { contextFn } from "./context";
export type { ContextFunction } from "./context";
export { mapLimit } from "./helpers/concurrency";
export { lifecycleSchema } from "./helpers/lifecycle-schema";
export type { TracingLevel } from "./helpers/tracing-level";
export { transientSlot } from "./helpers/transient-slot";
export { firstInProcess } from "./helpers/once-per-process";
export { FlowConfigRefusalError } from "./helpers/flow-config";
export type { FlowConfigIssue, FlowConfigPath } from "./helpers/flow-config";
export {
  __resetDeprecationWarningsForTests,
} from "./helpers/deprecation";
// Canonical item-log view (FIX-811): collapse a resumed request's superseded
// re-emissions for the read paths (GET history, useSession, SSE replay seed).
export { collapseToCanonicalLog } from "./items/canonical-log";
export {
  dispatcher,
  dispatchHandleSchema,
  dispatchWaitResultSchema,
  boolean,
  choice,
  evaluator,
  generator,
  score,
  type EvaluatorConfig,
  type EvaluatorDefinition,
  type EvaluatorOutputSchema,
  type EvaluatorQuestionsSlot,
  handler,
  providerTool,
  router,
  sequencer,
  type DispatchHandle,
  type DispatchWaitResult,
  type DispatcherConfig,
  type DispatcherSession,
  type InternalDispatcherConfig,
  type TaskDispatcherConfig
} from "./blocks";
// Exported for a seam that dispatches a worker WITHOUT going through the
// sequencer kernel, so it composes a subtree's background signal by the same
// rule the kernel uses rather than a second copy of it.
export { composeSideChainSignal } from "./blocks/sequencer";
export {
  defineFlow,
  resolveEntry,
  type EntryCoordinate,
  type EntryMaps,
} from "./flow";
export { readResourceContentTool, writeResourceContentTool } from "./tools/resource-content-tools";
export { resolveResourceByPath, resolveResourceByUri } from "./tools/resource-tools";
export { resourceTools } from "./tools/resource-tools";
export { resourceSearchTools } from "./tools/resource-search-tools";
// Agent discovery (FIX-817): the manifest-entry shape, the per-scope source
// registry, the door over it, and the resources domain's projection.
export { MANIFEST_DOMAINS } from "@flow-state-dev/contracts";
export type { ManifestDomain, ManifestEntry, ManifestSource } from "@flow-state-dev/contracts";
export { createManifestRegistry } from "./manifest/registry";
// Change notices (FIX-2426): the wire topics a client watches.
export { topic } from "@flow-state-dev/contracts";
export type { TopicOptions, WireTopic } from "@flow-state-dev/contracts";
export type { BlockManifestSource, ManifestRegistry } from "./manifest/registry";
export { discoveryTools } from "./manifest/discovery-tools";
export { resourcesManifestSource } from "./manifest/resources-source";
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
  SequencerDefinition,
  StepOptions,
  StepOutcome
} from "./blocks";
export type {
  CostEstimate,
  CostEstimator,
  ActionConfig,
  ReadConfig,
  ActionCore,
  UserMessageEcho,
  ActionMcpConfig,
  FlowConfigInput,
  FlowConfigValue,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  InstanceOwnerPin,
  FlowType,
  FlowCardinality,
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

export { defineScheduleBinding } from "./types/schedules";

export type {
  ConcurrencyConfig,
  ConcurrencyKey,
  ConcurrencyKeyContext,
  ConcurrencyPolicyName
} from "./types/concurrency";

export { validateConcurrencyConfig } from "./types/concurrency";

export type {
  WebhookConfig,
  WebhookEventBinding,
  WebhookInboundEvent,
  WebhookSubscriptionConfig
} from "./types/webhooks";
export { defineWebhookBinding } from "./types/webhooks";
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
export type {
  BooleanAnswer,
  BooleanQuestion,
  ChoiceAnswer,
  ChoiceQuestion,
  EvaluationInput,
  EvaluationModel,
  EvaluationQuestionType,
  EvaluatorAnswer,
  EvaluatorAnswers,
  EvaluatorOutput,
  EvaluatorQuestion,
  EvaluatorQuestions,
  ScoreAnswer,
  ScoreQuestion
} from "./types/evaluation";

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

// Model infrastructure (AI SDK adapters, provider detection, fallback)
export {
  createModelResolver,
  selectModel,
  makeSchemaStrict,
  assertStrictCompatible
} from "./models";
export type {
  CreateModelResolverOptions,
  IntentDefaults,
  ModelRule,
  PreferProviderRule,
  WhenRule,
  ModelSelection,
  ProviderPreference,
  MakeSchemaStrictOptions,
  StrictViolation
} from "./models";

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
  RecordedValueOmittedError,
  RECORDED_VALUE_OMITTED,
  isAbortLike
} from "./errors";
export type {
  FlowErrorOptions,
  FlowErrorScope,
  OutputValidationDetails,
  RouteUnavailableDetails,
  RecordedValueOmittedDetails,
  SequencerOutputSchemaErrorDetails,
  SequencerSchemaMismatchErrorDetails,
  SuspendOptions
} from "./errors";
// The skip sentinel returned by ctx.suspend() lives alongside SuspensionError on
// the top-level surface so flow authors import both from one place.
export { SUSPENSION_SKIPPED } from "./types/suspension";
export type { ResumeAction, SuspendForUserKind } from "./types/suspension";
