import type {
  BlockContext,
  FlowInstance,
  FlowStateSettings,
  JsonObject,
  ModelResolver,
  ResponseEmitterHandle
} from "@flow-state-dev/core/types";
import type { RuntimeLogger } from "../execution/logging";
import type { StoreRegistry } from "../stores/types";

export type RequestRuntime = {
  requestId: string;
  actionName: string;
  status: "in_progress" | "completed" | "incomplete" | "failed" | "interrupted" | "aborted";
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
};
