import type { ZodTypeAny } from "zod";
import type { AuthenticationConfig } from "./auth";
import type { BlockContext, BlockDefinition, DeclaredResourceEntry, RetryPolicy } from "./block";
import type { Middleware } from "./middleware";
import type {
  DefinedResource,
  ResourceConfig,
  ResourceRef,
  StateOf
} from "./resource";
import type {
  DefinedResourceCollection,
  ResourceCollectionConfig,
  ResourceCollectionRef
} from "./resource-collection";
import type { SchedulesConfig } from "./schedules";
import type { TokenCounter } from "./tokens";
import type { JsonObject, JsonValue } from "../schema/common";
import type { VoiceConfig } from "./speech";

/** Legacy scope-keyed config alias preserved for type-internal usage. */
export type ScopeResourceConfig = ResourceConfig | ResourceCollectionConfig;

type InferResourceRefs<TResources extends Record<string, DeclaredResourceEntry>> = {
  [K in keyof TResources]: TResources[K] extends DefinedResourceCollection<infer S>
    ? ResourceCollectionRef<S>
    : TResources[K] extends DefinedResource<infer S>
      ? ResourceRef<S>
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

/**
 * Scope-level client config. Declares what state crosses the
 * server/client boundary. Absent or empty means the scope's state is
 * private to the server.
 *
 * - `expose`: top-level state field names whose values are passed
 *   verbatim into `clientData.<scope>.<name>`.
 * - `derived`: named projections computed from `{ state, resources }`,
 *   surfaced under `clientData.<scope>.<name>`.
 *
 * Names in `expose` and `derived` share a namespace (the scope's
 * `clientData` object). They must not collide.
 */
export type ScopeClientConfig<
  TState extends JsonObject = JsonObject,
  TResources extends Record<string, AnyResourceHandle> = Record<string, AnyResourceHandle>
> = {
  expose?: ReadonlyArray<keyof TState & string>;
  derived?: Record<string, ClientDataComputeFn<TState, TResources>>;
};

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

/**
 * Per-action overrides for MCP exposure. The flow-level `mcp.enabled`
 * decides participation; per-action `enabled: false` opts an action out
 * of exposure, and `name` overrides the auto-derived tool name.
 */
export interface ActionMcpConfig {
  /**
   * If false, the action is excluded from MCP exposure even when its
   * flow has `mcp.enabled: true`. Default: true (action is exposed when
   * its flow exposes it).
   */
  enabled?: boolean;
  /**
   * Optional override for the MCP tool name. When omitted, the tool
   * name is derived deterministically from the action key
   * (`recordPayment` → `record_payment`). Names must match the MCP
   * charset `[A-Za-z0-9_.-]{1,128}`.
   */
  name?: string;
}

export type ActionConfig<
  TBlock extends BlockDefinition = BlockDefinition,
> = {
  block: TBlock;
  /**
   * Optional override for action-level input validation. Defaults to
   * `block.inputSchema` — the block already validates its own input, so the
   * action layer only needs an explicit schema when it should diverge from
   * the block (MCP tool surface with richer `.describe()`, narrower public
   * contract, escape hatches like `z.unknown()`).
   */
  inputSchema?: TBlock["inputSchema"];
  /**
   * Human-readable description. Required when the action is exposed via
   * MCP — the text becomes the LLM-facing tool description and must
   * communicate (1) what the tool does, (2) when to use it vs. siblings,
   * (3) preconditions and side effects, (4) what each argument means.
   * Used by the devtool for tooltips even when MCP is not enabled.
   */
  description?: string;
  /** Per-action MCP overrides. */
  mcp?: ActionMcpConfig;
  onCompleted?: BlockDefinition<any, any>;
  onErrored?: BlockDefinition<any, any>;
  userMessage?: (input: TBlock["inputSchema"]["_output"]) => string;
  tokenBudget?: {
    maxTotalTokens: number;
    warnAt?: number;
    onExceeded?: "error" | "stop" | "warn";
  };
};

/**
 * Per-flow MCP exposure config. Opt-in: a flow must set `enabled: true`
 * for the MCP transport adapter to mount routes for it. Per-action
 * inclusion is controlled on each action via `action.mcp.enabled`. The
 * runtime under `host.dispatch` is identical between MCP and HTTP
 * requests.
 */
export interface McpConfig {
  /** Master enable. Default: false. */
  enabled?: boolean;
  /**
   * If true (default), exposes flow-scoped resources via MCP
   * `resources/list` + `resources/read`, honoring the existing
   * `client.content.read` permission. If false, no resources are exposed.
   */
  exposeResources?: boolean;
}

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

/**
 * Per-scope configs (`session`, `user`, `org`) carry only state and
 * client-data hooks. Resources live in the flow-level `resources` field
 * (FIX-435) — the resource's intrinsic `scope` decides where it persists.
 */
export type SessionConfig = {
  metadata?: ZodTypeAny;
  stateSchema?: ZodTypeAny;
  /**
   * Declares which slice of session state crosses to the client. State is
   * private by default — only `expose`d field names and `derived`
   * projections appear in `clientData.session`.
   */
  client?: ScopeClientConfig<JsonObject>;
  /**
   * @deprecated Use `client.derived` instead. `clientData` keeps working
   * with a one-time deprecation warning per scope per process; removal
   * lands in a future minor.
   */
  clientData?: Record<string, ClientDataComputeFn<JsonObject>>;
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
  /**
   * SSE wire-level heartbeat interval in milliseconds. When set,
   * the server emits `: ping\n\n` comment frames on every SSE response
   * for this flow at the configured cadence. This keeps NAT/proxy idle
   * timeouts from closing the connection and gives clients a robust
   * inactivity signal independent of platform-specific abort behaviors.
   * Default: 15000 (15 seconds). Set to 0 to disable.
   */
  sseHeartbeatMs?: number;
  /**
   * When true, durable sequencer checkpoints (FIX-401) are deleted on
   * terminal completion (success / error / abort). When false (default),
   * checkpoints are retained — useful for post-mortem inspection, audit,
   * or letting an external process decide retention.
   *
   * Latest-only persistence keeps storage bounded regardless of this
   * setting (one record per sequencer instance per request), so retention
   * doesn't compound across step counts.
   */
  cleanupCheckpointsOnTerminal?: boolean;
  /**
   * Per-mutation budget for in-memory state writes (target, sequencer
   * scopes — anything not bridged through a `persist` callback). When a
   * mutator's queue wait + execution time exceeds this, the call rejects
   * with `ScopeMutationTimeoutError` instead of hanging the request
   * indefinitely. Default 30000 (30s). Set to `Infinity` to disable.
   *
   * Does not apply to external-store scopes (filesystem / sqlite /
   * postgres adapters) — those use the optimistic CAS retry path and
   * surface contention as `ConcurrentModificationError`.
   */
  mutationTimeoutMs?: number;
};

export type UserConfig = {
  stateSchema?: ZodTypeAny;
  /** See `SessionConfig.client`. */
  client?: ScopeClientConfig<JsonObject>;
  /** @deprecated Use `client.derived` instead. See `SessionConfig.clientData`. */
  clientData?: Record<string, ClientDataComputeFn<JsonObject>>;
};

export type OrgConfig = {
  stateSchema?: ZodTypeAny;
  /** See `SessionConfig.client`. */
  client?: ScopeClientConfig<JsonObject>;
  /** @deprecated Use `client.derived` instead. See `SessionConfig.clientData`. */
  clientData?: Record<string, ClientDataComputeFn<JsonObject>>;
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
  TOrg extends OrgConfig | undefined = OrgConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined,
  TResources extends Record<string, DeclaredResourceEntry> = Record<string, DeclaredResourceEntry>
> = {
  kind: string;
  /**
   * Top-level shorthand for `authentication.requireUser`. When both are set,
   * `authentication.requireUser` wins. Default: true.
   */
  requireUser?: boolean;

  /**
   * Per-flow authentication hook. The framework owns the resolution contract
   * (call `resolvePrincipal`, apply `defaultUserId`, enforce `requireUser`);
   * the host owns credential verification. See `AuthenticationConfig`.
   */
  authentication?: AuthenticationConfig;

  actions: TActions;

  session?: TSession;
  request?: TRequest;
  user?: TUser;
  org?: TOrg;
  work?: TWork;
  /**
   * Flow-level resource declarations. Single flat map, accessor key →
   * resource definition. Resources are routed to the right storage layer
   * via their intrinsic `scope` (set on `defineResource`); cross-flow
   * sharing is controlled by `flowIsolation` on the resource. Replaces
   * the legacy `session.resources` / `user.resources` / `org.resources`
   * (FIX-435).
   */
  resources?: TResources;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];

  /**
   * Per-flow MCP exposure config. When `mcp.enabled === true`, the
   * `@flow-state-dev/mcp` adapter mounts `POST /api/flows/:kind/mcp`
   * for this flow and translates exposed actions into MCP tools.
   */
  mcp?: McpConfig;

  /**
   * Per-flow scheduled-action config. When set, the
   * `@flow-state-dev/scheduled` adapter mounts
   * `POST /api/flows/:kind/schedules/:scheduleId/dispatch` for this flow.
   * Static entries are validated at registration; dynamic entries
   * returned by `resolve` are validated at dispatch.
   */
  schedules?: SchedulesConfig;

  tokenCounter?: TokenCounter;
  costEstimator?: CostEstimator;

  /**
   * Default flow-isolation for user-scoped resources whose `flowIsolation`
   * is unset. Resource-level declarations always win (FIX-435).
   * Default: false (resources are shared across flows under the same userId).
   */
  isolateUserState?: boolean;

  /** Org-scope equivalent of `isolateUserState`. Default: false. */
  isolateOrgState?: boolean;

  defaultBlockRenderer?: unknown | false;
};

export type FlowInstanceOptions<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TOrg extends OrgConfig | undefined = OrgConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined,
  TResources extends Record<string, DeclaredResourceEntry> = Record<string, DeclaredResourceEntry>
> = {
  id?: string;
  kind?: string;
  requireUser?: boolean;
  authentication?: AuthenticationConfig;
  actions?: Partial<TActions> & Record<string, ActionConfig>;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  org?: TOrg;
  work?: TWork;
  resources?: TResources;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];
  mcp?: McpConfig;
  schedules?: SchedulesConfig;
  tokenCounter?: TokenCounter;
  costEstimator?: CostEstimator;
  isolateUserState?: boolean;
  isolateOrgState?: boolean;
};

export type FlowInstance<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TOrg extends OrgConfig | undefined = OrgConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined,
  TResources extends Record<string, DeclaredResourceEntry> = Record<string, DeclaredResourceEntry>
> = {
  id: string;
  kind: string;
  requireUser: boolean;
  /**
   * True when any block in any action declares `requireOrg: true`. The HTTP
   * action route uses this to reject requests against unbound sessions before
   * any execution begins.
   */
  requiresOrg: boolean;
  authentication?: AuthenticationConfig;
  actions: TActions;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  org?: TOrg;
  work?: TWork;
  resources?: TResources;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];
  mcp?: McpConfig;
  schedules?: SchedulesConfig;
  tokenCounter?: TokenCounter;
  costEstimator?: CostEstimator;
  isolateUserState: boolean;
  isolateOrgState: boolean;
};

export type FlowType<
  TActions extends Record<string, ActionConfig> = Record<string, ActionConfig>,
  TSession extends SessionConfig | undefined = SessionConfig | undefined,
  TRequest extends RequestConfig | undefined = RequestConfig | undefined,
  TUser extends UserConfig | undefined = UserConfig | undefined,
  TOrg extends OrgConfig | undefined = OrgConfig | undefined,
  TWork extends WorkConfig | undefined = WorkConfig | undefined,
  TResources extends Record<string, DeclaredResourceEntry> = Record<string, DeclaredResourceEntry>
> = {
  kind: string;
  requireUser: boolean;
  /** Mirror of `FlowInstance.requiresOrg`. */
  requiresOrg: boolean;
  authentication?: AuthenticationConfig;
  actions: TActions;
  session?: TSession;
  request?: TRequest;
  user?: TUser;
  org?: TOrg;
  work?: TWork;
  resources?: TResources;
  tools?: ToolsConfig;
  voice?: VoiceConfig;
  middleware?: Middleware[];
  mcp?: McpConfig;
  schedules?: SchedulesConfig;
  isolateUserState: boolean;
  isolateOrgState: boolean;

  (options?: FlowInstanceOptions<TActions, TSession, TRequest, TUser, TOrg, TWork, TResources>): FlowInstance<
    TActions,
    TSession,
    TRequest,
    TUser,
    TOrg,
    TWork,
    TResources
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
  org: InferScopeStateFromConfig<TDefinition["org"]>;
};

export type InferFlowBlockContext<TDefinition extends FlowDefinition> = BlockContext<
  InferFlowStateMap<TDefinition>["request"],
  InferFlowStateMap<TDefinition>["session"],
  InferFlowStateMap<TDefinition>["user"],
  InferFlowStateMap<TDefinition>["org"]
>;

export type FlowActionInput<TAction extends ActionConfig> = TAction["block"]["inputSchema"]["_output"];

export type FlowActionBlock<TAction extends ActionConfig> = TAction["block"];

export type FlowToolContext<
  TResources extends Record<string, AnyResourceHandle> = Record<string, AnyResourceHandle>
> = {
  resources?: TResources;
  retry?: RetryPolicy;
};
