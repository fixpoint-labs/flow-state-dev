export type {
  BlockCacheableConfig,
  BlockConfig,
  BlockContext,
  BlockTraceCapturePayload,
  BlockTraceCapturePhase,
  BlockDefinition,
  BlockInput,
  BlockKind,
  BlockOutput,
  BlockOutputHint,
  BlockResult,
  BlockRuntime,
  ChunkValidation,
  ConnectorFn,
  DeclaredResourceEntry,
  ExecutionParent,
  FlowContextView,
  FlowStateSettings,
  InferFlowConfigFromSchema,
  RescueHandlerSpec,
  ResponseEmitterHandle,
  RetryPolicy,
  StateRef,
  TargetRef,
  GeneratorModelResultPayload
} from "./block";

export { asRuntime, itemScope } from "./block";

export type {
  LivenessAnswers,
  ParentTaskOutcome,
  RequestHost,
  ResumeWaitInput,
  ResumeWaitResult,
  RequestWaits,
  RequestSessions,
  SessionView,
  RequestWakes,
  SettleParentTaskInput,
  SettleParentTaskResult,
  SuspensionAddress,
  WaitDeadlines,
  WakeSettleResult,
  WakeView
} from "./request-host";

export { NoRequestHostError, requireRequestHost } from "./request-host";

export type {
  WaitEndingErrorCode,
  WaitGateBinding,
  WaitGateData,
  WaitOutcome,
  WaitRow,
  ParkOnWaitInput
} from "./wait-gate";
export {
  MAX_WAIT_DEPTH,
  WAIT_DEADLINE_ENTRY,
  WAIT_DEADLINE_OUTCOME,
  WAIT_GATE_REASON,
  isWaitGate,
  continuesAtExpiry,
  parkOnWait,
  canHoldWait,
  parseWaitOutcome,
  recordedWaitOutcome,
  waitGateDataOf
} from "./wait-gate";

export type {
  SessionCreateCheck,
  SessionCreateCheckInput,
  SessionCreateCheckResult,
  SessionCreatePath,
  SessionCreatePrincipal
} from "./session-create";

export type {
  BlockDispatchType,
  DispatchAddress,
  DispatchOutcome,
  DispatchRefusal,
  DispatchSeam,
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
} from "./dispatch";

/** How the running request resumed (FIX-2129): read where a resumed request is admitted. */
export { REQUEST_RESUME_SEAM, requestResumeOf } from "./request-resume";
export type { RequestResume } from "./request-resume";

/** Waiting for a user (FIX-2129): `ctx.waitForUser`, its options and what it returns. */
export { waitForUserOn } from "./wait-for-user";
export type { ApprovalAnswer, UserAnswer, WaitForUser, WaitForUserCancelled, WaitForUserContext, WaitForUserOptions } from "./wait-for-user";

/** The request-end seam (FIX-2077): a framework package's hook after a request's last drain. */
export {
  REQUEST_END_SEAM,
  REQUEST_SPEND_SEAM,
  SESSION_REQUEST_END_HOOK,
  addRequestSpendSource,
  onRequestEnded,
  readRequestSpend,
  requestSpendSources
} from "./request-end";
export type {
  BackgroundFailure,
  RequestEndHook,
  RequestEndSeam,
  RequestEndStatus,
  RequestEndVerdict,
  RequestEnding,
  RequestSpend,
  RequestSpendSeam,
  RequestSpendSource,
  SessionRequestEndHook
} from "./request-end";

export {
  DISPATCH_SEAM,
  DISPATCH_TYPES,
  DispatchRefusedError,
  NoDispatchSeamError,
  bindTaskDispatcher,
  dispatchThroughSeam,
  markDispatcher,
  taskBindingOf,
  framed,
  readFramed,
  addressEntries,
  describeAction,
  resolveTaskAction,
  resolveTaskFlowKind,
  resolveTaskSessionTarget,
  resolveTaskState,
  taskDispatchInputSchema,
  taskSessionKeyFor
} from "./dispatch";

export type {
  ActionConfig,
  TypedEntries,
  ActionCore,
  ActionMcpConfig,
  CostEstimator,
  ModelUsageEntry,
  ClientDataComputeFn,
  ClientDataContext,
  FlowActionBlock,
  FlowActionInput,
  FlowConfigInput,
  FlowConfigValue,
  FlowDefinition,
  FlowInstance,
  FlowInstanceOptions,
  InstanceOwnerPin,
  FlowToolContext,
  FlowType,
  FlowCardinality,
  HookHandler,
  InferFlowBlockContext,
  CostEstimate,
  InferFlowStateMap,
  InferScopeStateFromConfig,
  McpConfig,
  OrgConfig,
  RequestConfig,
  RetentionPolicy,
  ScopeResourceConfig,
  SessionConfig,
  ToolLifecycleEvent,
  ToolsConfig,
  UserConfig
} from "./flow";

export type {
  AuthenticationConfig,
  InboundSource,
  PrincipalResolutionContext,
  ResolvePrincipalFn,
  ResolvedPrincipal
} from "./auth";

export { DEFAULT_LOCAL_USER_ID, DEFAULT_ORG_ID, isValidOrgId } from "./auth";

export type {
  ScheduleConfig,
  ScheduleInputContext,
  ScheduleInputFn,
  ScheduleResolutionContext,
  ScheduleResolutionStores,
  SchedulesConfig
} from "./schedules";

export {
  defineScheduleBinding,
  isFiveFieldCron,
  isKnownTimeZone,
  validateScheduleConfig,
  validateSchedulesConfig
} from "./schedules";

export type {
  ConcurrencyConfig,
  ConcurrencyKey,
  ConcurrencyKeyContext,
  ConcurrencyPolicyName
} from "./concurrency";

export { validateConcurrencyConfig } from "./concurrency";

export type { TTSConfig, VoiceConfig } from "./speech";



export type {
  WebhookConfig,
  WebhookEventBinding,
  WebhookInboundEvent,
  WebhookSubscriptionConfig
} from "./webhooks";

export { defineWebhookBinding, validateWebhookConfig } from "./webhooks";

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
} from "./voice-provider";

export {
  canListVoices,
  canSpeak,
  canSpeakStream,
  canTranscribe,
  createCompositeVoiceProvider
} from "./voice-provider";

export type { VoiceErrorKind, VoiceErrorOptions } from "./voice-error";
export { VoiceError } from "./voice-error";
export type {
  CachingBreakpointMode,
  CachingConfig,
  CachingTtl,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelLoopOptions,
  GeneratorModelResult,
  GeneratorModelSource,
  GeneratorModelStreamChunk,
  GeneratorModelTool,
  GeneratorModelToolCall,
  GeneratorModelUsage,
  GeneratorSearchConfig,
  GeneratorStepResult,
  ModelIdentity,
  ModelResolver,
  PrepareStepFn,
  PrepareStepResult,
  ProviderTool
} from "./model";

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
} from "./evaluation";

export type {
  AnchoredPath,
  CollectionClientConfig,
  CollectionClientContentConfig,
  CollectionStateClientConfig,
  ContextOf,
  DefinedResource,
  MessageLike,
  ResourceClientConfig,
  ResourceClientContentConfig,
  ResourceClientDataFn,
  ResourceConfig,
  ResourceContext,
  ResourceScope,
  AnyResourceRef,
  ResourceRef,
  ResourceRefOptions,
  ResourceRegistry,
  StateOf
} from "./resource";
export type { ResourceVisibility, ResourceVisibilityRule, ResourceVisibilityTarget } from "./resource-visibility";

export type {
  CollectionHookContext,
  DefinedResourceCollection,
  EvictionPolicy,
  ResourceCollectionConfig,
  ResourceCollectionRef,
} from "./resource-collection";

export {
  defineResourceCollection,
  isDefinedResourceCollection,
  resolveCollectionKey,
  normalizeResourcePath,
  matchesPattern,
  getPatternPrefix,
  isParameterizedPattern,
  extractBareTopic,
  extractPatternParams,
  encodeUserSegment,
  ownerSegment,
} from "./resource-collection";

export { isCollectionConfig, resourceStorageKeys } from "./storage-identity";

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
} from "./faceted-collection";

export type {
  DefinedProjectedResourceCollection,
  ProjectedRecordHit,
  ProjectedReactiveBindings,
  ProjectedResourceCollectionConfig,
  ProjectedResourceCollectionRef,
  ProjectedResourceContext,
  ProjectedResourceRef,
  ResourceQuery,
  ResourceSearchResult,
  ValidatedProjectedHit,
} from "./projected-resource-collection";

export {
  defineProjectedResourceCollection,
  isProjectedResourceCollection,
  readProjectedRecord,
  searchProjectedRecords,
} from "./projected-resource-collection";

export type {
  JournalEntry,
  JournalEntryInput,
  HistoryTurn,
  HistoryTurnQuery,
  ItemQuery,
  LLMMessage,
  Message,
  MessageLimit,
  MessageQuery,
  MessageViews,
  OrgScopeHandle,
  RequestScopeHandle,
  ScopeIdentity,
  ScopeType,
  SessionItem,
  SessionHistoryWindow,
  SessionItemViews,
  SessionMetadata,
  SessionMetadataInput,
  SessionScopeHandle,
  StopRequestOutcome,
  UserScopeHandle
} from "./scope";

export type { BindingCacheOptions, BindingProvider } from "./binding";

export type { RequestStatus, RequestStatusSnapshot } from "./request";

export type {
  ResumeAction,
  ResumeContext,
  SuspensionFilter,
  SuspensionReason,
  SuspensionRecord,
  SuspensionSkipped,
  SuspensionStatus,
  WaitForUserKind
} from "./suspension";
export {
  RESUME_ACTION_STATUS,
  isUserSuspension,
  waitForUserKindOf,
  SUSPENSION_SKIPPED,
  TERMINAL_SUSPENSION_STATUSES,
  isTerminalSuspensionStatus,
  matchesSuspensionFilter
} from "./suspension";

export type { SequencerCheckpoint } from "./checkpoints";

export type { TokenCounter } from "./tokens";

export type { CASOptions, ScopeStateOps, StateContainer } from "./state";

export type {
  InitialSkill,
  MatchedSkill,
  RunSkillInput,
  RunSkillOutput,
  Skill,
  SkillActivationSource,
  SkillContextMode,
  SkillFile,
  SkillState,
  SkillsCollectionMeta,
  ToolCatalog,
} from "./skill";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaybePromise,
  SchemaInput,
  SchemaOutput
} from "../schema/common";

export { serializeActionSchema } from "../schema/action-schema";
export type {
  ActionFieldSchema,
  ActionFieldType,
  ActionInputSchema
} from "../schema/action-schema";

export { applyGetOrPatchState, defineResource, resource } from "./resource";

/**
 * The run's plan record, also exported here (it is on the package root too)
 * so browser code can read its keys without importing the root, which pulls
 * in server-only modules.
 */
export {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  observedPlanCollection,
  observedPlanItemStateSchema,
  observedPlanListCollection,
  observedPlanListStateSchema,
  harnessConversationNamespace,
  planConversationPrefix,
  planKeySegment,
  planRowsPrefix,
  readPlanTarget,
} from "./harness-plan";
export type { ObservedOutcome, ObservedPlanListStatus, PlanListItem, PlanMarkerRead } from "./harness-plan";

/** The session's pull-request record's key, rows and key builder (FIX-2268). Isomorphic: a page reads them. */
export { OBSERVED_PULL_REQUESTS, observedPullRequestsCollection, observedPullRequestStateSchema, pullRequestKey } from "./pull-requests";
export type { ObservedPullRequestState, PullRequestRef, PullRequestSource } from "./pull-requests";

/**
 * The coding-harness contract (LAB-152) — what a harness block is handed and
 * what it hands back, plus the signatures a host feeds it configuration
 * through. The matching runtime schemas are exported from the package root.
 * `reportHarnessSpend` is how a harness counts a run's spend in the request
 * (FIX-2145).
 */
export { reportHarnessSpend } from "./harness";
export type {
  ClassifiedHarnessError,
  HarnessActivity,
  HarnessActivityHook,
  HarnessBilling,
  HarnessBlock,
  HarnessCallbackContext,
  HarnessCostBasis,
  HarnessFailureKind,
  HarnessResolver,
  HarnessRunCost,
  HarnessRunEnvelope,
  HarnessRunHandle,
  HarnessRunInput,
  HarnessRunOutcome,
  HarnessRunSpend,
  HarnessRunStatus,
  HarnessRunUsage,
  HarnessSessionHook,
  HarnessSource,
  HarnessSteer,
  HarnessSteerHook,
  HarnessUsageHook,
  HarnessUsageLevel,
  HarnessUsageReader,
  HarnessUsageReading,
  HarnessUsageReport,
  HarnessUsageWindow,
} from "./harness";
