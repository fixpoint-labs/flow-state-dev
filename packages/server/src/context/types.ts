import type {
  BlockContext,
  FlowInstance,
  FlowStateSettings,
  JsonObject,
  ModelResolver,
  RequestStatus,
  ResponseEmitterHandle
} from "@flow-state-dev/core/types";
import type { TracingLevel } from "@flow-state-dev/core";
import type { RuntimeLogger } from "../execution/logging";
import type { StoreRegistry } from "../stores/types";

export type RequestRuntime = {
  requestId: string;
  actionName: string;
  status: RequestStatus;
  startedAtMs: number;
  completedAtMs?: number;
  failedAtMs?: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionContext<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TOrgState extends JsonObject = JsonObject
> = BlockContext<TRequestState, TSessionState, TUserState, TOrgState> & {
  flow: FlowInstance;
  actionName: string;
  requestRuntime: RequestRuntime;
  stores: StoreRegistry;
};

export type CreateExecutionContextOptions<
  TRequestState extends JsonObject = JsonObject,
  TSessionState extends JsonObject = JsonObject,
  TUserState extends JsonObject = JsonObject,
  TOrgState extends JsonObject = JsonObject
> = {
  flow: FlowInstance;
  actionName: string;
  requestId: string;
  userId?: string;
  sessionId?: string;
  orgId?: string;
  /** Optional tenant the request runs under (FIX-406 6D). */
  tenantId?: string;
  /**
   * Inbound transport provenance written to the initial `RequestRecord`.
   * Defaults to `"http"` for callers that don't supply one (FIX-438).
   */
  source?: string;
  requestState?: TRequestState;
  sessionState?: TSessionState;
  userState?: TUserState;
  orgState?: TOrgState;
  metadata?: Record<string, unknown>;
  input?: unknown;
  signal?: AbortSignal;
  /**
   * Background-work abort signal (FIX-663). Attached to every context as
   * `_requestBackgroundSignal` and substituted for `ctx.signal` inside
   * `.work()` task trees. Fires only on explicit user-requested abort, not
   * on transport-level teardown. Absent for non-server callers.
   */
  backgroundSignal?: AbortSignal;
  response?: ResponseEmitterHandle;
  modelResolver?: ModelResolver;
  /** Instance-level settings exposed on every block as `ctx.settings`. */
  settings?: FlowStateSettings;
  stores: StoreRegistry;
  logger?: RuntimeLogger;
  /**
   * Tracing verbosity for observability snapshots (FIX-406 6H). Threaded onto
   * every block context as `_tracingLevel`. Unset → the runtime falls back to
   * `resolveTracingLevel()` (env / observability default).
   */
  tracingLevel?: TracingLevel;
  /** Whether a DurabilityProvider is configured. Guards ctx.suspend(). */
  durabilityEnabled?: boolean;
};
