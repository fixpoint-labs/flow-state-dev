import type { ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition, RetryPolicy } from "./block";
import type { Middleware } from "./middleware";
import type {
  ResourceConfig,
  ResourceRef,
  StateOf
} from "./resource";
import type { TokenCounter } from "./tokens";
import type { JsonObject, JsonValue } from "../schema/common";
import type { VoiceConfig } from "./speech";

type InferResourceRefs<TResources extends Record<string, ResourceConfig>> = {
  [K in keyof TResources]: ResourceRef<StateOf<TResources[K]>>;
};

/**
 * Context provided to a clientData compute function.
 * Contains the scope state and, where applicable, the scope's resource handles.
 */
export type ClientDataContext<
  TState extends JsonObject = JsonObject,
  TResources extends Record<string, ResourceRef<any>> = Record<string, ResourceRef<any>>
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
  TResources extends Record<string, ResourceRef<any>> = Record<string, ResourceRef<any>>
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

export type SessionConfig<
  TResources extends Record<string, ResourceConfig> = Record<string, ResourceConfig>
> = {
  metadata?: ZodTypeAny;
  stateSchema?: ZodTypeAny;
  resources?: TResources;
  clientData?: Record<string, ClientDataComputeFn<JsonObject, InferResourceRefs<TResources>>>;
};

export type RequestConfig = {
  stateSchema?: ZodTypeAny;
  onStarted?: BlockDefinition<any, any>;
  onCompleted?: BlockDefinition<any, any>;
  onErrored?: BlockDefinition<any, any>;
  onFinished?: BlockDefinition<any, any>;
  onStepErrored?: BlockDefinition<any, any>;
};

export type UserConfig<
  TResources extends Record<string, ResourceConfig> = Record<string, ResourceConfig>
> = {
  stateSchema?: ZodTypeAny;
  resources?: TResources;
  clientData?: Record<string, ClientDataComputeFn<JsonObject, InferResourceRefs<TResources>>>;
};

export type ProjectConfig<
  TResources extends Record<string, ResourceConfig> = Record<string, ResourceConfig>
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
  TResources extends Record<string, ResourceRef<any>> = Record<string, ResourceRef<any>>
> = {
  resources?: TResources;
  retry?: RetryPolicy;
};
