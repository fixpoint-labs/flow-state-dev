export type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  BlockInput,
  BlockKind,
  BlockOutput,
  BlockResult,
  ChunkValidation,
  ConnectorFn,
  DeclaredResourceEntry,
  EmitAudience,
  ExecutionParent,
  RescueHandlerSpec,
  ResponseEmitterHandle,
  RetryPolicy,
  StateRef,
  StateHandle,
  TargetRef,
  TargetHandle
} from "./block";

export type {
  ActionConfig,
  CostEstimator,
  ClientDataComputeFn,
  ClientDataContext,
  FlowActionBlock,
  FlowActionInput,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  FlowToolContext,
  FlowType,
  HookHandler,
  InferFlowBlockContext,
  CostEstimate,
  InferFlowStateMap,
  InferScopeStateFromConfig,
  ProjectConfig,
  RequestConfig,
  RetentionPolicy,
  ScopeResourceConfig,
  SessionConfig,
  ToolLifecycleEvent,
  ToolsConfig,
  UserConfig,
  WorkConfig
} from "./flow";

export type {
  SpeechModel,
  SpeechResolver,
  SpeechResult,
  TranscriptionModel,
  TranscriptionResolver,
  TranscriptionResult,
  TTSConfig,
  VoiceConfig
} from "./speech";
export type {
  GeneratorModel,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorModelUsage,
  GeneratorSearchConfig,
  GeneratorStepResult,
  ModelResolver,
  PrepareStepFn,
  PrepareStepResult,
  ProviderTool
} from "./model";

export type {
  CollectionClientConfig,
  CollectionClientContentConfig,
  ContextOf,
  DefinedResource,
  MessageLike,
  ResourceClientConfig,
  ResourceClientContentConfig,
  ResourceClientDataFn,
  ResourceConfig,
  ResourceContext,
  AnyResourceRef,
  ResourceRef,
  ResourceHandle,
  ResourceRefOptions,
  ResourceRegistry,
  StateOf
} from "./resource";

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
} from "./resource-collection";

export {
  defineResourceCollection,
  isDefinedResourceCollection,
  resolveCollectionKey,
  normalizeResourcePath,
  matchesPattern,
  getPatternPrefix,
  extractPatternParams,
  // Deprecated aliases
  defineResourceNamespace,
  isDefinedResourceNamespace,
  resolveNamespaceKey,
} from "./resource-collection";

export type {
  JournalEntry,
  JournalEntryInput,
  ItemQuery,
  LLMMessage,
  Message,
  MessageLimit,
  MessageQuery,
  MessageViews,
  ProjectScopeHandle,
  RequestScopeHandle,
  ScopeIdentity,
  ScopeType,
  SessionItem,
  SessionItemViews,
  SessionMetadata,
  SessionMetadataInput,
  SessionScopeHandle,
  UserScopeHandle
} from "./scope";

export type { BindingCacheOptions, BindingProvider } from "./binding";

export type { Middleware, MiddlewareContext, MiddlewareFn } from "./middleware";

export type { TokenCounter } from "./tokens";

export type { CASOptions, ScopeStateOps, StateContainer } from "./state";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaybePromise,
  OptionalSchema,
  SchemaInput,
  SchemaOutput
} from "../schema/common";

export { serializeActionSchema } from "../schema/action-schema";
export type {
  ActionFieldSchema,
  ActionFieldType,
  ActionInputSchema
} from "../schema/action-schema";

export { defineResource, resource } from "./resource";
