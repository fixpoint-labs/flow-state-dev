import type { ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition, RetryPolicy } from "./block";
import type { Middleware } from "./middleware";
import type {
  ResourceConfig,
  ResourceRef,
  StateOf
} from "./resource";
import type {
  ResourceCollectionConfig,
  ResourceCollectionRef
} from "./resource-collection";
import type { TokenCounter } from "./tokens";
import type { JsonObject, JsonValue } from "../schema/common";
import type { VoiceConfig } from "./speech";

export type ScopeResourceConfig = ResourceConfig | ResourceCollectionConfig;

type InferResourceRefs<TResources extends Record<string, ScopeResourceConfig>> = {
  [K in keyof TResources]: TResources[K] extends ResourceCollectionConfig
    ? ResourceCollectionRef<StateOf<TResources[K]> extends import("../schema/common").JsonObject ? StateOf<TResources[K]> : import("../schema/common").JsonObject>
    : ResourceRef<StateOf<TResources[K]>>;
};

/** Union of handle types that can appear in a resource registry. */
export type AnyResourceHandle = ResourceRef<any> | ResourceCollectionRef<any>;

/**
 * Context provided to a clientData compute function.
 * Contains the scope state and, where applicable, the scope's resource handles.
 */
export type ClientDataContext<
  TState extends JsonObject = JsonObject,
  TResources extends Record<string, AnyResourceHandle> = Record<string, AnyResourceHandle>
> = {
  state: Readonly<TState>;
  resources: TResources;
};

/**
 * A compute function that derives client-visible data from scope state.
 * Always client-visible (no `client: true` flag). Returns serializable data.
 */
export type ClientDataComputeFn<
  TState extends JsonObject = JsonObject,
  TResources extends Record<string, AnyResourceHandle> = Record<string, AnyResourceHandle>
> = (
  ctx: ClientDataContext<TState, TResources>
) => JsonValue | Promise<JsonValue>;

export type HookHandler<TInput = unknown> = (
  input: TInput,
  ctx: BlockContext
) => Promise<void> | void;

export type ToolLifecycleEvent = {
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: Error;
};

export type ToolsConfig = {
  defaults?: {
    timeoutMs?: number;
    concurrency?: "parallel" | "serial";
    retry?: RetryPolicy;
  };
  onToolStarted?: HookHandler<ToolLifecycleEvent> | BlockDefinition<any, any>;
  onToolCompleted?: HookHandler<ToolLifecycleEvent> | BlockDefinition<any, any>;
  onToolErrored?: HookHandler<ToolLifecycleEvent> | BlockDefinition<any, any>;
};

export interface ModelUsageEntry {
  prompt: number;
  completion: number;
  total: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface CostEstimator {
  estimate(usage: ModelUsageEntry, model: string): number;
}

export interface TokenLedger {
  readonly totalConsumed: number;
  readonly byModel: Record<string, ModelUsageEntry>;
  readonly remaining: number;
}

export interface CostEstimate {
  readonly totalUSD: number;
  readonly byModel: Record<string, number>;
}

export type ActionConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
> = {
  inputSchema: TInputSchema;
  block: BlockDefinition<TInputSchema, any>;
  onCompleted?: BlockDefinition<any, any>;
  onErrored?: BlockDefinition<any, any>;
  userMessage?: (input: TInputSchema["_output"]) => string;
  tokenBudget?: {
    maxTotalTokens: number;
    warnAt?: number;
    onExceeded?: "error" | "stop" | "warn";
  };
};

/**
 * Retention policy for bounding a session's persisted item log.
 * When limits are exceeded, entire old request records are evicted (lazy, on write).
 */
export type RetentionPolicy = {
  /** Maximum number of items across all completed requests. Oldest requests evicted first. */
  maxItems?: number;
  /** Maximum age of completed requests. Milliseconds (number) or duration string ('24h', '7d'). */
  maxAge?: number | string;
};

export type SessionConfig<
  TResources extends Record<string, ScopeResourceConfig> = Record<string, ScopeResourceConfig>
> = {
  metadata?: ZodTypeAny;
  stateSchema?: ZodTypeAny;
  resources?: TResources;
  clientData?: Record<string, ClientDataComputeFn<JsonObject, InferResourceRefs<TResources>>>;
  /** Retention policy that bounds session item log size. */
  retention?: RetentionPolicy;
};

export type RequestConfig = {
  stateSchema?: ZodTypeAny;
  onStarted?: BlockDefinition<any, any>;
  onCompleted?: BlockDefinition<any, any>;
  onErrored?: BlockDefinition<any, any>;
  onFinished?: BlockDefinition<any, any>;
  onStepErrored?: BlockDefinition<any, any>;
  /**
   * Heartbeat interval in milliseconds for the active request registry.
   * Default: 10000 (10 seconds). Set to 0 to disable.
   */
  heartbeatIntervalMs?: number;
};

export type UserConfig<
  TResources extends Record<string, ScopeResourceConfig> = Record<string, ScopeResourceConfig>
> = {
  stateSchema?: ZodTypeAny;
  resources?: TResources;
  clientData?: Record<string, ClientDataComputeFn<JsonObject, InferResourceRefs<TResources>>>;
};

export type ProjectConfig<
  TResources extends Record<string, ScopeResourceConfig> = Record<string, ScopeResourceConfig>
> = {
  stateSchema?: ZodTypeAny;
  resources?: TResources;
  clientData?: Record<string, ClientDataComputeFn<JsonObject, InferResourceRefs<TResources>>>;
};

export type WorkConfig = {
  onStarted?: BlockDefinition<any, any>;
  onCompleted?: BlockDefinition<any, any>;
  onErrored?: BlockDefinition<any, any>;
  onFinished?: BlockDefinition<any, any>;
};

export type FlowDefinition<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TProject extends ProjectConfig | undefined = ProjectConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined
> = {
  kind: string;
  requireUser?: boolean;

  actions: TActions;

  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];

  tokenCounter?: TokenCounter;
  costEstimator?: CostEstimator;

  defaultBlockRenderer?: unknown | false;
};

export type FlowInstanceOptions<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TProject extends ProjectConfig | undefined = ProjectConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined
> = {
  id?: string;
  kind?: string;
  requireUser?: boolean;
  actions?: Partial<TActions> & Record<string, ActionConfig>;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];
  tokenCounter?: TokenCounter;
  costEstimator?: CostEstimator;
};

export type FlowInstance<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TProject extends ProjectConfig | undefined = ProjectConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined
> = {
  id: string;
  kind: string;
  requireUser: boolean;
  actions: TActions;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];
  tokenCounter?: TokenCounter;
  costEstimator?: CostEstimator;
};

export type FlowType<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TProject extends ProjectConfig | undefined = ProjectConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined
> = {
  kind: string;
  requireUser: boolean;
  actions: TActions;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];

  (options?: FlowInstanceOptions<TActions, TSession, TRequest, TUser, TProject, TWork>): FlowInstance<
    TActions,
    TSession,
    TRequest,
    TUser,
    TProject,
    TWork
  >;
};

export type InferScopeStateFromConfig<TScopeConfig> = TScopeConfig extends {
  stateSchema?: infer TSchema;
}
  ? TSchema extends ZodTypeAny
    ? TSchema["_output"]
    : Record<string, never>
  : Record<string, never>;

export type InferFlowStateMap<TDefinition extends FlowDefinition> = {
  request: InferScopeStateFromConfig<TDefinition["request"]>;
  session: InferScopeStateFromConfig<TDefinition["session"]>;
  user: InferScopeStateFromConfig<TDefinition["user"]>;
  project: InferScopeStateFromConfig<TDefinition["project"]>;
};

export type InferFlowBlockContext<TDefinition extends FlowDefinition> = BlockContext<
  InferFlowStateMap<TDefinition>["request"],
  InferFlowStateMap<TDefinition>["session"],
  InferFlowStateMap<TDefinition>["user"],
  InferFlowStateMap<TDefinition>["project"]
>;

export type FlowActionInput<TAction extends ActionConfig> = TAction["inputSchema"]["_output"];

export type FlowActionBlock<TAction extends ActionConfig> = TAction["block"];

export type FlowToolContext<
  TResources extends Record<string, AnyResourceHandle> = Record<string, AnyResourceHandle>
> = {
  resources?: TResources;
  retry?: RetryPolicy;
};
