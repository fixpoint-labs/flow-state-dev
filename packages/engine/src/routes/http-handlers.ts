/**
 * HTTP route handlers for canonical `/api/flows` endpoints.
 *
 * This file is a thin orchestrator that composes route handlers from
 * domain-specific modules: session-routes, action-routes, stream-routes,
 * and state-routes.
 */
import { toError } from "@flow-state-dev/core/helpers";
import { serializeActionSchema } from "@flow-state-dev/core/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import { withResourceIndexWriter } from "../resources/resource-indexes";
import type { RuntimeConfig } from "../runtime-config";
import { createInMemoryStores } from "../stores";
import type { StoreRegistry } from "../stores/types";
import { withChangeBus } from "../bus/publish-writes";
import { createMemoryBlobStore } from "../blobs/memory-blob-store";
import { createHostDiskState, type HostDiskState } from "../blobs/host-disk";
import { handleGetBlob, handleUploadBlob } from "./blob-routes";
import type { ChangeBus } from "../bus/types";
import { detectInterruptedRequests, internalEntriesFrom } from "../execution/request-recovery";
import {
  parseFlowRoute,
  type ParsedFlowRoute
} from "./parseFlowRoute";
import {
  errorStatus,
  extractTenantId,
  jsonResponse
} from "./route-utils";
import { handleAbortRequest } from "./abort-routes";
import { handleAnswerSuspension } from "./answer-routes";
import { handleResumeSuspension } from "./resume-routes";
import { handleGetRequestStatus } from "./request-status-routes";
import { handleRunRead } from "./read-routes";
import { handleExecuteAction } from "./action-routes";
import { handleFlowIdentity, handleReadScopeResource, resolveResourceSend } from "./scope-routes";
import { DEFAULT_WRITE_FLOW } from "../resources/default-write-flow";
import {
  handleCheckInterruptedRequests,
  handleListInterruptedRequests,
  handleContinueRequest,
  handleListActiveRequests,
  handleRetryRequest
} from "./recovery-routes";
import {
  handleCreateSession,
  handleDeleteSession,
  handleGetSession,
  handleListSessionRequests,
  handleListSessions,
  handlePatchSessionMetadata
} from "./session-routes";
import { handleListSessionChildren } from "./child-session-routes";
import { handleGetSessionState } from "./state-routes";
import { handleSessionStream } from "./session-stream-routes";
import {
  handleGetResourceContent,
  handleGetCollectionResourceContent,
  handleCreateCollectionResource,
  handleUpdateResourceContent,
  handleDeleteCollectionResource,
  handleListCollectionState,
  handleGetCollectionResourceState,
  handleGetResourceManifest
} from "./resource-routes";
import { handleRequestStream, handleTranscribe } from "./stream-routes";
import { authorizeManagementRoute } from "./route-auth";
import {
  handleDebugListResources,
  handleDebugListSuspensions,
  handleDebugListCollectionResources,
  handleDebugGetResourceContent,
  handleDebugGetCollectionResourceContent,
  assertDebugAllowed,
  resolveDebugConfig,
  type ResolvedDebugConfig
} from "./debug-routes";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { createInboundTransportHost } from "../transports/host/createInboundTransportHost";
import { createDispatchOperation } from "../context/dispatch-operation";
import { createServiceRouteOperation } from "../durability/owner-runs";
import { defaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { pinRejectsCaller } from "../context/instance-pin";
import { createInstanceCallerResolver, type InstanceCallerResolver } from "./instance-caller";
import type { FlowRunner } from "../transports/runner";
import { refuseRetiredDispatcherOption } from "../transports/runner";
import type { ConcurrencyArbiter } from "../transports/concurrency/arbiter";
import { createWaitResumeOperation } from "../context/wait-resume-operation";
import { installWaitSweeperFact } from "../durability/wait-deadlines";
import { installWakes } from "../durability/request-wakes";
import { installWaits } from "../durability/wait-chain";
import { DEFAULT_RUNTIME_LOGGER } from "../execution/logging";
import { createParkedStopDeps } from "../durability/stop-suspended";
import { createPushState, handleMintPush, pushCapability, type PushState } from "../push/push-delivery";

export type RequestContext = {
  method: string;
  path: string[];
  request: Request;
  route: ParsedFlowRoute;
};

/**
 * Internal route seam hooks used to prepare middleware-ready request/bootstrap enrichment.
 */
export type InternalRouteSeams = {
  enrichRequestContext?: (
    context: RequestContext
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  enrichActionRunInput?: (
    input: {
      flowKind: string;
      actionName: string;
      input: unknown;
      userId: string;
      sessionId?: string;
      requestId: string;
      orgId?: string;
      metadata?: Record<string, unknown>;
      signal?: AbortSignal;
    },
    context: RequestContext & { body: Record<string, unknown> }
  ) => Promise<Partial<{
    flowKind: string;
    actionName: string;
    input: unknown;
    userId: string;
    sessionId?: string;
    requestId: string;
    orgId?: string;
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
  }> | void> | Partial<{
    flowKind: string;
    actionName: string;
    input: unknown;
    userId: string;
    sessionId?: string;
    requestId: string;
    orgId?: string;
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
  }> | void;
};

/**
 * Default no-op internal route seams.
 */
export const NOOP_INTERNAL_ROUTE_SEAMS: InternalRouteSeams = {};

/**
 * Shared route handler options used by catch-all router adapter.
 */
export type CreateFlowRouteHandlersOptions = {
  registry: FlowRegistry;
  stores?: Partial<StoreRegistry>;
  /**
   * Instance-level options forwarded verbatim through the execution chain
   * (resolvers, voice provider, settings, logger, tracing, SSE
   * buffering). See {@link RuntimeConfig}.
   */
  runtimeConfig: RuntimeConfig;
  onError?: (error: Error, context: { method: string; path: string }) => void;
  /**
   * Host-level fallback resolver. Per-flow `authentication.resolvePrincipal`
   * always wins over this when set. Defaults to the body-userId stub.
   */
  resolvePrincipal?: PrincipalResolver;
  internalSeams?: InternalRouteSeams;
  /**
   * Stale threshold for interrupted request detection on startup.
   * Default: 30000 (30 seconds).
   */
  staleThresholdMs?: number;
  /**
   * Whether to auto-detect interrupted requests on server startup.
   * Default: true.
   */
  detectInterruptedOnStartup?: boolean;
  // FIX-406 6D.
  /**
   * HTTP header carrying the tenant id. Default `x-tenant-id`.
   * The extracted value is threaded onto request/session context identities.
   */
  tenantIdHeader?: string;
  /**
   * Resolved debug-endpoint configuration. Threaded into the debug route
   * handlers; consult `resolveDebugConfig` in `debug-routes.ts` for the
   * env-fallback + defaults logic.
   */
  debugEndpointsEnabled?: boolean;
  debugAllowedOrigins?: string[];
  debugAllowAnonymousLocal?: boolean;
  debugCountLimit?: number;
  /** Pluggable flow runner. Default: in-process via runAction. */
  runner?: FlowRunner;
  // FIX-1077.
  /**
   * Concurrency arbiter for this router's host. Defaults to a fresh one.
   *
   * Supplied by `createFlowState` when it also built a host of its own for
   * detached dispatch, so one declared `queue`/`reject` policy is enforced once
   * across both rather than once per host.
   */
  arbiter?: ConcurrencyArbiter;
};

const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

/**
 * Context object expected by catch-all route handlers.
 */
export type FlowRouteContext = {
  path?: string[];
};

export function resolveStores(partial: Partial<StoreRegistry> | undefined): StoreRegistry & { bus: ChangeBus } {
  const fallback = createInMemoryStores();
  // Every request and session write publishes on its session's topic
  // (FIX-2426), on the given bus or an in-memory one.
  return withChangeBus({
    ...(partial?.bus !== undefined ? { bus: partial.bus } : {}),
    session: partial?.session ?? fallback.session,
    request: partial?.request ?? fallback.request,
    user: partial?.user ?? fallback.user,
    org: partial?.org ?? fallback.org,
    activeRequests: partial?.activeRequests ?? fallback.activeRequests,
    content: partial?.content ?? fallback.content,
    resourceState: partial?.resourceState ?? fallback.resourceState,
    checkpoints: partial?.checkpoints ?? fallback.checkpoints,
    traces: partial?.traces ?? fallback.traces,
    suspensions: partial?.suspensions ?? fallback.suspensions,
    leases: partial?.leases ?? fallback.leases,
    // Optional (FIX-2078 D1), and never filled in for stores that were given:
    // an in-memory stand-in beside a durable store would claim debts survive
    // a crash when they don't. Only a host given no stores at all keeps them
    // in memory, with everything else.
    ...(partial === undefined ? { wakes: fallback.wakes } : partial.wakes !== undefined ? { wakes: partial.wakes } : {}),
    // Attachment bytes (FIX-824), on the same rule: kept when given, in memory
    // only for a host given no stores at all.
    ...(partial === undefined ? { blobs: createMemoryBlobStore() } : partial.blobs !== undefined ? { blobs: partial.blobs } : {})
  });
}

/**
 * Creates method-aware route handlers for canonical `/api/flows` endpoints.
 *
 * Constructs an `InboundTransportHost` internally and routes action
 * execution through `host.dispatch`; non-action routes (sessions, streams,
 * resources, etc.) read from the same host's stores and registry directly.
 */
export function createFlowRouteHandlers(options: CreateFlowRouteHandlersOptions): {
  handle: (request: Request, context: FlowRouteContext) => Promise<Response>;
  host: InboundTransportHost;
  // FIX-2428.
  /** Push delivery's state: empty until a host turns push on. */
  push: PushState;
  // FIX-824.
  /** Whether the host keeps its disk: lasts until a host adapter declares it doesn't. */
  hostDisk: HostDiskState;
} {
  refuseRetiredDispatcherOption(options, "createFlowRouteHandlers");
  // A router built straight over its stores keeps declared indexes in step
  // too. Stores `createFlowState` already wrapped are left as they are.
  const stores = withResourceIndexWriter(resolveStores(options.stores), () =>
    options.registry.indexedCollections()
  );
  const debugConfig: ResolvedDebugConfig = resolveDebugConfig({
    debugEndpointsEnabled: options.debugEndpointsEnabled,
    debugAllowedOrigins: options.debugAllowedOrigins,
    debugAllowAnonymousLocal: options.debugAllowAnonymousLocal,
    debugCountLimit: options.debugCountLimit
  });
  const seams = options.internalSeams ?? NOOP_INTERNAL_ROUTE_SEAMS;

  // Resolve the host-level SSE heartbeat default once, then thread the
  // resolved value back onto the runtime config so the host and the
  // GET-attach stream handler share the same value.
  const defaultSseHeartbeatMs =
    options.runtimeConfig.defaultSseHeartbeatMs !== undefined
      ? options.runtimeConfig.defaultSseHeartbeatMs
      : DEFAULT_SSE_HEARTBEAT_MS;
  const runtimeConfig: RuntimeConfig = {
    ...options.runtimeConfig,
    defaultSseHeartbeatMs
  };

  const hostResolver = options.resolvePrincipal ?? defaultBodyUserIdPrincipalResolver;
  const push = createPushState(stores.bus);
  const hostDisk = createHostDiskState();

  const host: InboundTransportHost = createInboundTransportHost({
    registry: options.registry,
    stores,
    resolvePrincipal: hostResolver,
    runtimeConfig,
    runner: options.runner,
    arbiter: options.arbiter
  });

  // The LAST-RESORT installer, and only that (FIX-1077).
  //
  // This used to be the only one, with a comment claiming the assignment reached
  // "every request the host serves, including a worker's" because a spread
  // copies the `requestHost` *reference*. True of this function's own input;
  // false of the path that mattered. `createFlowApiRouter` hands us a config
  // whose `requestHost` it has already rebuilt as a fresh literal
  // (`{ ...base.requestHost, staleThresholdMs, staleSweepIntervalMs }`), and
  // that spread is a fork — so anything stamped here lands on a copy nobody
  // else holds. The object `createFlowState` gives `worker.startWorker` never
  // saw it, so a colocated queue worker running a board that dispatches met
  // `no-dispatch-operation`; and because this operation carries no child tracking,
  // an HTTP-started child session was invisible to the shutdown drain.
  //
  // `createFlowState` now installs on the shared config before any fork exists,
  // so in every deployment it owns, the operation is already present here and
  // the guard below skips. What remains is the case it cannot own: a DIRECT
  // `createFlowApiRouter` caller, which has no `FlowState`, no worker, and no
  // `dispose()` to drain — there the router's own config is the only object
  // there is, so installing on it forks nothing and is the only way the caller
  // gets the capability at all.
  //
  // The guard is therefore load-bearing rather than defensive: it is what makes
  // "the owner installs it, and this only fills a gap no owner exists for" true
  // instead of two installers racing to define one field.
  //
  // **Do not delete this block to make the ownership rule tidier.** It looks
  // redundant precisely because it never fires in a `createFlowState`
  // deployment, which is every deployment you are likely to be reading this
  // from. Removing it silently drops detached work for anyone mounting this
  // router in their own server without a `FlowState` — a supported embedding —
  // and `integration-tests`' `task-board-dispatch-detached` scenario, which
  // drives `createFlowApiRouter` directly, is the thing that will tell you.
  // The dispatch seam's operation, installed on the same last-resort terms and
  // over the same host, so a direct router caller can dispatch too.
  if (
    runtimeConfig.requestHost !== undefined &&
    runtimeConfig.requestHost.dispatchOperation === undefined
  ) {
    runtimeConfig.requestHost.dispatchOperation = createDispatchOperation({ host });
  }
  // FIX-2630: the seam's service route, on the same terms and over the same host.
  if (runtimeConfig.requestHost !== undefined && runtimeConfig.requestHost.serviceRoute === undefined) {
    runtimeConfig.requestHost.serviceRoute = createServiceRouteOperation(host);
  }

  // Same last-resort terms for the wait resume, and only with durable execution:
  // a router mounted without a `FlowState` can still serve waits.
  if (
    runtimeConfig.requestHost !== undefined &&
    runtimeConfig.requestHost.waitResume === undefined &&
    runtimeConfig.durabilityProvider !== undefined
  ) {
    runtimeConfig.requestHost.waitResume = createWaitResumeOperation({
      provider: runtimeConfig.durabilityProvider,
      stores,
      continueRequest: (opts) => host.continueRequest(opts)
    });
  }
  // And whether a sweeper bounds a wait here, so the turn is offered one.
  if (runtimeConfig.requestHost !== undefined && runtimeConfig.durabilityProvider !== undefined) {
    installWaitSweeperFact(runtimeConfig.requestHost, runtimeConfig.durabilityProvider);
  }
  // Debts' due times (FIX-2078 D1), on the same last-resort terms.
  if (runtimeConfig.requestHost !== undefined) {
    installWakes(runtimeConfig.requestHost, {
      stores,
      durable: runtimeConfig.durabilityProvider !== undefined,
      ...(runtimeConfig.maxDebtAgeMs !== undefined ? { maxDebtAgeMs: runtimeConfig.maxDebtAgeMs } : {}),
      logger: runtimeConfig.logger ?? DEFAULT_RUNTIME_LOGGER
    });
    // Waits (FIX-2082), where the wakes are: a wait's deadline is one.
    installWaits(runtimeConfig.requestHost, runtimeConfig.durabilityProvider, runtimeConfig.waitDeadlines);
  }
  // How this router stops a parked request (FIX-1816), with durable
  // execution only: for the abort route, and, on the same last-resort terms,
  // for a block's `ctx.session.stopRequest`.
  const parkedStop =
    runtimeConfig.durabilityProvider !== undefined
      ? createParkedStopDeps({
          provider: runtimeConfig.durabilityProvider,
          stores,
          continueRequest: (opts) => host.continueRequest(opts)
        })
      : undefined;
  if (
    runtimeConfig.requestHost !== undefined &&
    runtimeConfig.requestHost.parkedStop === undefined &&
    parkedStop !== undefined
  ) {
    runtimeConfig.requestHost.parkedStop = parkedStop;
  }

  // Same last-resort terms, one field over: the exact-address lookup a
  // cross-instance dispatch resolves through. A router mounted without a
  // `FlowState` has a registry of its own, and without this every cross-flow
  // address it serves would refuse `flow-not-found` for flows sitting in that
  // registry.
  if (
    runtimeConfig.requestHost !== undefined &&
    runtimeConfig.requestHost.resolveFlow === undefined
  ) {
    runtimeConfig.requestHost.resolveFlow = (address: string) => options.registry.get(address);
  }

  // Detect interrupted requests from previous runs on startup
  if (options.detectInterruptedOnStartup !== false) {
    void detectInterruptedRequests({
      stores,
      // Both sweep bounds come off the resolved config, not off flat options.
      // `staleThresholdMs` here is the router's own `staleSweepThresholdMs`
      // after `resolveStaleSweep`, which is the same value its periodic sweeper
      // and its liveness gate use — a restart must not reap on a different
      // clock than the running server, or it deregisters a healthy
      // cross-process request and the next liveness read calls it dead.
      // `options.staleThresholdMs` is kept as an explicit override for a direct
      // `createFlowRouteHandlers` caller, but no shipped path sets it: it is
      // absent from `CreateFlowApiRouterOptions`, which is exactly how this
      // path silently kept `detectInterruptedRequests`' own 30s fallback while
      // everything else in the process ran on 60s.
      staleThresholdMs:
        options.staleThresholdMs ?? runtimeConfig.requestHost?.staleThresholdMs,
      // Same grace the periodic sweeper runs with, so a restart cannot reap a
      // queued row the running server would have left alone.
      queuedGraceMs: runtimeConfig.queuedGraceMs,
      // A request reaped here owes its session's passes now (FIX-2166).
      wakeEntriesOf: internalEntriesFrom(options.registry)
    }).then((interrupted) => {
      if (interrupted.length > 0) {
        console.warn(
          `[flow-state] detected ${interrupted.length} interrupted request(s) from previous run`,
          interrupted.map((i) => i.entry.requestId)
        );
      }
    }).catch((err) => {
      console.error("[flow-state] failed to detect interrupted requests on startup", err);
    });
  }

  const handle = async (
    request: Request,
    context: FlowRouteContext
  ): Promise<Response> => {
    const path = Array.isArray(context.path) ? context.path : [];
    const route = parseFlowRoute(request.method, path);
    const requestContext: RequestContext = {
      method: request.method.toUpperCase(),
      path,
      request,
      route
    };

    const bootstrapMetadata =
      (await seams.enrichRequestContext?.(requestContext)) ?? {};
    const bootstrapPath = `/api/flows/${path.join("/")}`;

    try {
      // Tenant id for every session-touching route (FIX-682). Extracted once
      // here so session/state/resource reads namespace the session storage key
      // the same way action dispatch does. Undefined for single-tenant
      // requests; rejected (400) inside the try if it contains ":".
      const tenantId = extractTenantId(request, options.tenantIdHeader);

      // Authenticate and authorize the management surface (sessions, state,
      // resources, request control, debug) before dispatching. Action routes
      // resolve their own principal inside `handleExecuteAction` and are
      // exempt here; so are the public metadata routes. No-op for an app on
      // the framework default resolver — see `route-auth.ts`.
      const auth = await authorizeManagementRoute(request, route, {
        registry: options.registry,
        stores,
        host,
        hostResolver,
        tenantId
      });
      if (auth.denied !== undefined) {
        // A debug route gates on enablement and origin before it looks a
        // session up, so another user's session gets that gate's answer
        // first, as an unused id does.
        if (auth.sessionHidden === true && route.kind.startsWith("debug_")) {
          const gated = assertDebugAllowed(request, debugConfig);
          if (gated !== null) return gated;
        }
        return auth.denied;
      }
      const principal = auth.principal;
      const anonymousFlowIds = auth.anonymousFlowIds;
      // The caller as each instance's own doors resolve it, for the routes
      // that span every instance. Resolves nothing until one of them asks.
      const callerFor = createInstanceCallerResolver({
        registry: options.registry,
        host,
        request,
        hostResolver,
        action: route.kind
      });

      if (route.kind === "not_found") {
        return jsonResponse(404, { error: "Route not found" });
      }

      if (route.kind === "list_flows") {
        const visible = await flowsForCaller(options.registry, callerFor);
        return jsonResponse(200, {
          flows: visible.map((flow) => ({
            id: flow.id,
            kind: flow.kind,
            cardinality: flow.cardinality,
            requireUser: flow.requireUser,
            actions: Object.keys(flow.actions),
            actionSchemas: Object.fromEntries(
              Object.entries(flow.actions).map(([name, config]) => [
                name,
                serializeActionSchema(config.inputSchema ?? config.block.inputSchema)
              ])
            )
          }))
        });
      }

      if (route.kind === "capabilities") {
        return jsonResponse(200, { userStream: false, push: pushCapability(push) });
      }

      if (route.kind === "execute_action") {
        return await handleExecuteAction(request, route, {
          host,
          registry: options.registry,
          stores,
          seams,
          bootstrapMetadata,
          requestContext,
          tenantIdHeader: options.tenantIdHeader
        });
      }

      // FIX-2624: user and org resources with no session.
      if (route.kind === "read_scope_resource") {
        return await handleReadScopeResource(request, route, {
          host,
          registry: options.registry,
          stores,
          hostResolver
        });
      }

      if (route.kind === "flow_identity") {
        return await handleFlowIdentity(request, route, {
          host,
          registry: options.registry,
          stores,
          hostResolver
        });
      }

      if (route.kind === "send_resource") {
        const send = await resolveResourceSend(request, route, {
          host,
          registry: options.registry,
          stores,
          hostResolver,
          tenantIdHeader: options.tenantIdHeader
        });
        if (send instanceof Response) return send;
        return await handleExecuteAction(
          request,
          { kind: "execute_action", flowKind: send.flowKind, actionName: route.actionName, sessionId: send.sessionId },
          {
            host,
            registry: options.registry,
            stores,
            seams,
            bootstrapMetadata,
            requestContext,
            tenantIdHeader: options.tenantIdHeader
          },
          send
        );
      }

      if (route.kind === "run_read") {
        return await handleRunRead(request, route, {
          host,
          registry: options.registry,
          stores,
          runtimeConfig,
          tenantIdHeader: options.tenantIdHeader
        });
      }

      if (route.kind === "request_stream") {
        return await handleRequestStream(request, route, {
          registry: options.registry,
          stores,
          voiceProvider: runtimeConfig.voiceProvider,
          defaultSseHeartbeatMs,
          checkedRequest: auth.request
        });
      }

      if (route.kind === "list_sessions") {
        return await handleListSessions(request, route, {
          registry: options.registry,
          stores,
          durabilityProvider: runtimeConfig.durabilityProvider,
          tenantId,
          principal,
          anonymousFlowIds,
          callerFor
        });
      }

      if (route.kind === "get_session") {
        return await handleGetSession(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "list_session_requests") {
        return await handleListSessionRequests(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "list_session_children") {
        return await handleListSessionChildren(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          maxListLimit: runtimeConfig.maxChildSessionListLimit,
          checkedSession: auth.session
        });
      }

      if (route.kind === "get_session_state") {
        return await handleGetSessionState(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "session_stream") {
        return await handleSessionStream(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "create_session") {
        return await handleCreateSession(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          principal
        });
      }

      if (route.kind === "delete_session") {
        return await handleDeleteSession(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "patch_session_metadata") {
        return await handlePatchSessionMetadata(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      // The socket (FIX-2428): the host takes the upgrade before a request
      // reaches here, so what arrives is a plain GET.
      if (route.kind === "user_stream") {
        return jsonResponse(426, { error: "This route takes a WebSocket upgrade" });
      }

      if (route.kind === "user_stream_mint") {
        return await handleMintPush(request, route.userId, {
          registry: options.registry,
          stores,
          host,
          hostResolver,
          tenantId,
          state: push,
          ...(principal !== undefined ? { principal } : {}),
          anonymous: anonymousFlowIds !== undefined
        });
      }

      if (route.kind === "upload_blob") {
        if (route.flowKind !== undefined && options.registry.get(route.flowKind) === undefined) {
          return jsonResponse(404, { error: `Unknown flow "${route.flowKind}"` });
        }
        return await handleUploadBlob(request, { stores, principal, hostDisk });
      }

      if (route.kind === "get_blob") {
        return await handleGetBlob(request, route, { stores, tenantId, checkedSession: auth.session });
      }

      if (route.kind === "transcribe") {
        return await handleTranscribe(request, route, {
          registry: options.registry,
          stores,
          voiceProvider: runtimeConfig.voiceProvider
        });
      }

      if (route.kind === "retry_request") {
        return await handleRetryRequest(request, route, {
          registry: options.registry,
          stores,
          runtimeConfig,
          tenantId,
          principal
        });
      }

      if (route.kind === "continue_request") {
        return await handleContinueRequest(request, route, {
          host,
          registry: options.registry,
          stores,
          runtimeConfig,
          tenantId,
          principal
        });
      }

      if (route.kind === "abort_request") {
        return await handleAbortRequest(request, route, {
          stores,
          tenantId,
          principal,
          ...(parkedStop !== undefined ? { parked: parkedStop } : {})
        });
      }

      if (route.kind === "resume_suspension") {
        return await handleResumeSuspension(request, route, {
          host,
          registry: options.registry,
          stores,
          durabilityProvider: runtimeConfig.durabilityProvider,
          publicReentrySources: runtimeConfig.publicReentrySources,
          tenantId,
          principal,
          seams,
          requestContext
        });
      }

      if (route.kind === "answer_suspension") {
        return await handleAnswerSuspension(request, route, {
          host,
          registry: options.registry,
          stores,
          durabilityProvider: runtimeConfig.durabilityProvider,
          tenantId,
          principal
        });
      }

      if (route.kind === "request_status") {
        return await handleGetRequestStatus(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          principal
        });
      }

      if (route.kind === "active_requests") {
        return await handleListActiveRequests(request, {
          registry: options.registry,
          stores,
          runtimeConfig,
          tenantId,
          principal,
          anonymousFlowIds,
          callerFor
        });
      }

      if (route.kind === "list_interrupted_requests") {
        return await handleListInterruptedRequests(route, {
          registry: options.registry,
          stores,
          runtimeConfig,
          tenantId,
          principal,
          anonymousFlowIds,
          callerFor
        });
      }

      if (route.kind === "check_interrupted_requests") {
        return await handleCheckInterruptedRequests(request, route, {
          registry: options.registry,
          stores,
          runtimeConfig,
          tenantId,
          principal,
          anonymousFlowIds
        });
      }

      if (route.kind === "get_resource_content") {
        return await handleGetResourceContent(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "get_collection_item_content") {
        return await handleGetCollectionResourceContent(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "create_collection_item") {
        return await handleCreateCollectionResource(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "update_resource_content") {
        return await handleUpdateResourceContent(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "delete_collection_item") {
        return await handleDeleteCollectionResource(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "list_collection_state") {
        return await handleListCollectionState(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "get_collection_item_state") {
        return await handleGetCollectionResourceState(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "get_resource_manifest") {
        return await handleGetResourceManifest(request, route, {
          registry: options.registry,
          stores,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "debug_list_resources") {
        return await handleDebugListResources(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "debug_list_suspensions") {
        return await handleDebugListSuspensions(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "debug_list_collection_items") {
        return await handleDebugListCollectionResources(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "debug_get_resource_content") {
        return await handleDebugGetResourceContent(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig,
          tenantId,
          checkedSession: auth.session
        });
      }

      if (route.kind === "debug_get_collection_item_content") {
        return await handleDebugGetCollectionResourceContent(request, route, {
          registry: options.registry,
          stores,
          debug: debugConfig,
          tenantId,
          checkedSession: auth.session
        });
      }

      return jsonResponse(404, { error: "Route not found" });
    } catch (error) {
      const normalized = toError(error, "Unknown route error");
      options.onError?.(normalized, {
        method: request.method.toUpperCase(),
        path: bootstrapPath
      });

      return jsonResponse(errorStatus(normalized), {
        error: normalized.message
      });
    }
  };

  return {
    handle,
    host,
    push,
    hostDisk
  };
}

/**
 * Catalog rows for this caller.
 *
 * Unpinned flows are always listed. A pinned instance is listed only when the
 * caller, resolved the way that instance's own doors resolve it
 * (`createInstanceCallerResolver`), matches its pin. Resolution runs only when
 * the registry holds a pin, so a catalog of shared flows does not start
 * requiring a principal, and the route stays exempt. A caller an instance's
 * resolver refuses is not that instance's caller, so the instance is omitted
 * and the route never answers 401.
 */
async function flowsForCaller(
  registry: FlowRegistry,
  callerFor: InstanceCallerResolver
): Promise<FlowInstance[]> {
  // FIX-2624: the default write flow runs only on a send addressed to a
  // resource, so it is no flow a client lists.
  const flows = registry.list().filter((flow) => flow.id !== DEFAULT_WRITE_FLOW);
  if (!flows.some((flow) => flow.ownerPin !== undefined)) return flows;

  const visible: FlowInstance[] = [];
  for (const flow of flows) {
    const pin = flow.ownerPin;
    if (pin === undefined) {
      visible.push(flow);
      continue;
    }
    const caller = await callerFor(flow);
    if (caller !== undefined && !pinRejectsCaller(pin, caller)) visible.push(flow);
  }
  return visible;
}
