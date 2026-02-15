import type { ZodTypeAny } from "zod";
import type { BlockContext, BlockDefinition, RetryPolicy } from "./block";
import type {
  ProjectionConfig,
  ProjectionShorthand,
  ResourceConfig,
  ResourceHandle
} from "./resource";

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
  onToolStarted?: HookHandler<ToolLifecycleEvent> | BlockDefinition<ToolLifecycleEvent, void>;
  onToolCompleted?: HookHandler<ToolLifecycleEvent> | BlockDefinition<ToolLifecycleEvent, void>;
  onToolErrored?: HookHandler<ToolLifecycleEvent> | BlockDefinition<ToolLifecycleEvent, void>;
};

export type ActionConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = TInputSchema["_output"],
  TOutput = unknown
> = {
  inputSchema: TInputSchema;
  block: BlockDefinition<TInput, TOutput>;
  onCompleted?: BlockDefinition<any, void>;
  onErrored?: BlockDefinition<any, void>;
};

export type SessionConfig<
  TResources extends Record<string, ResourceConfig> = Record<string, ResourceConfig>,
  TProjections extends Record<string, ProjectionConfig | ProjectionShorthand> = Record<
    string,
    ProjectionConfig | ProjectionShorthand
  >
> = {
  metadata?: ZodTypeAny;
  stateSchema?: ZodTypeAny;
  resources?: TResources;
  projections?: TProjections;
};

export type RequestConfig = {
  stateSchema?: ZodTypeAny;
  onStarted?: BlockDefinition<any, void>;
  onCompleted?: BlockDefinition<any, void>;
  onErrored?: BlockDefinition<any, void>;
  onFinished?: BlockDefinition<any, void>;
  onStepErrored?: BlockDefinition<any, void>;
};

export type UserConfig<TResources extends Record<string, ResourceConfig> = Record<string, ResourceConfig>> = {
  stateSchema?: ZodTypeAny;
  resources?: TResources;
};

export type ProjectConfig<
  TResources extends Record<string, ResourceConfig> = Record<string, ResourceConfig>
> = {
  stateSchema?: ZodTypeAny;
  resources?: TResources;
};

export type WorkConfig = {
  onStarted?: BlockDefinition<any, void>;
  onCompleted?: BlockDefinition<any, void>;
  onErrored?: BlockDefinition<any, void>;
  onFinished?: BlockDefinition<any, void>;
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
  requireSession?: boolean;
  requireUser?: boolean;

  actions: TActions;

  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;

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
  requireSession?: boolean;
  requireUser?: boolean;
  actions?: Partial<TActions>;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;
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
  requireSession: boolean;
  requireUser: boolean;
  actions: TActions;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;
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
  requireSession: boolean;
  requireUser: boolean;
  actions: TActions;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  project?: TProject;
  work?: TWork;
  tools?: ToolsConfig;

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
  TResources extends Record<string, ResourceHandle<any>> = Record<string, ResourceHandle<any>>
> = {
  resources?: TResources;
  retry?: RetryPolicy;
};
