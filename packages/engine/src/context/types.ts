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
import type { ErrorCaptureBlockInfo, ErrorCaptureHandler } from "../errors/error-capture";
import type { DetachedStartOperation, ParentTaskBinding } from "./create-request-host";
import type { RuntimeConfig } from "../runtime-config";

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
  /**
   * @internal Route a (possibly already-normalized) error to the configured
   * `errorCapture` sink (FIX-724). Deduped per request against block-level
   * captures keyed on the raw error instance. Undefined when no `errorCapture`
   * handler is configured. Called from `executeBlock`'s catch for the root
   * action block; nested block failures are captured via `_runtimeHooks.onBlockError`.
   */
  _captureError?: (error: unknown, block?: ErrorCaptureBlockInfo) => void;
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
  /**
   * Opt-in error-capture sink (FIX-724). When set, runtime block failures are
   * delivered to it with provider-neutral context. Absent → no capture.
   */
  errorCapture?: ErrorCaptureHandler;
  /**
   * Construction inputs for the request-host seam (FIX-999). Hosts supply the
   * inputs; `createExecutionContext` builds the bundle once and every nested
   * scope inherits the same reference.
   *
   * Absent → no seam is attached, and `requireRequestHost(ctx)` throws by name.
   * That is the correct state for a caller that does not execute requests
   * through a host (a unit test, a hand-built context).
   */
  requestHost?: RequestHostConstructionInputs;
  /**
   * The runtime config THIS request is actually running under (FIX-1077).
   *
   * Deliberately not folded into `requestHost` above: that bag rides the shared
   * `runtimeConfig.requestHost` object, which is process-wide, and this value is
   * per-request. A caller may hand `runAction` a derived config — `fsdev run`
   * builds `{ ...appConfig, modelResolver, logger }` so `--model` applies — and
   * a detached child is that request's own work continued in the background, so
   * it inherits this rather than whatever the host was constructed with. Without
   * it a `--model` run's background work silently resolved the app's default
   * model, which is precisely what `--model` exists to control.
   *
   * Absent → a detached child falls back to the dispatching host's own config,
   * which is the correct answer when no caller derived one.
   */
  effectiveRuntimeConfig?: RuntimeConfig;
};

/**
 * What a host has to travel to `createExecutionContext` for the seam to be
 * built (FIX-999).
 *
 * The sweeper facts are here rather than read from a global because the sweeper
 * is built by the router while the gate runs in the context factory, so the fact
 * has to be passed. A host that cannot answer leaves them undefined, which the
 * gate reads as *not sweeping* — fail-closed, like the registry's undeclared
 * sharedness.
 */
export type RequestHostConstructionInputs = {
  /**
   * Starts a detached request through the host-level arbiter and enqueue-time
   * materialization. Absent → `startDetached` refuses `no-start-operation`,
   * which is the `worker-only` case: that mode constructs no dispatcher, so a
   * deployment whose capabilities dispatch must supply this there explicitly.
   */
  startOperation?: DetachedStartOperation;
  /** The parent-board row this request was dispatched for, stamped at spawn. */
  parentTask?: ParentTaskBinding;
  /** The stale-request sweeper's threshold. */
  staleThresholdMs?: number;
  /** The sweeper's cadence. Undefined or 0 → liveness is refused. */
  staleSweepIntervalMs?: number;
};
