/**
 * Construct an `InboundTransportHost` that adapters consume.
 *
 * The host owns registry/stores wiring, principal resolution, and the
 * action-dispatch machinery. It is the runtime surface every adapter
 * (HTTP, MCP, webhook, scheduled, custom) sees — adapters never touch
 * `runAction` directly.
 */
import type { FlowRegistry } from "../../registry/flow-registry";
import type { StoreRegistry } from "../../stores/types";
import type { ExecutionResult } from "../../execution/types";
import type { RuntimeConfig } from "../../runtime-config";
import { createLiveRequestStream } from "../../streaming/live-stream";
import { createResponseEmitter } from "../../streaming/response-emitter";
import { resolveSessionStorageKey, tenantMatches } from "../../stores/scope-keys";
import { createInitialRequestRecord } from "../../context/initial-request-record";
import { generateId } from "../../utils/generate-id";
import { OrgRequiredError, PrincipalResolutionError } from "../errors";
import type { FlowDispatcher, DispatchEnvelope } from "../dispatcher";
import {
  createInProcessDispatcher,
  type InProcessDispatcher
} from "./in-process-dispatcher";
import type {
  DispatchHandle,
  InboundRequestEnvelope,
  InboundTransportHost,
  PrincipalResolutionContext,
  PrincipalResolver,
  ResolvedPrincipal
} from "../types";

export type CreateInboundTransportHostOptions = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  resolvePrincipal: PrincipalResolver;
  /**
   * Instance-level options forwarded verbatim through the execution chain.
   * The host reads `maxResponseBufferSize` / `defaultSseHeartbeatMs` /
   * `onBackgroundWork` for live-stream wiring, exposes the resolvers /
   * middleware / logger on the returned host, and passes the bundle to
   * `runAction`. See {@link RuntimeConfig}.
   */
  runtimeConfig: RuntimeConfig;
  /**
   * Controls where flow actions execute. Default: in-process via runAction.
   * Set to a FlowDispatcher implementation to route execution to an
   * external worker (e.g., BullMQ WorkerDispatcher).
   */
  dispatcher?: FlowDispatcher;
};

/**
 * Build the host used by every transport adapter.
 *
 * `dispatch` resolves the flow, registers a live-stream for SSE consumers,
 * and starts `runAction` in fire-and-forget mode. The returned
 * `DispatchHandle` lets the adapter consume the live stream synchronously
 * (HTTP+SSE) or await `finished` for a final result (webhook, schedule).
 */
export function createInboundTransportHost(
  options: CreateInboundTransportHostOptions
): InboundTransportHost {
  const { registry, stores, resolvePrincipal, runtimeConfig } = options;
  const { onBackgroundWork, maxResponseBufferSize, defaultSseHeartbeatMs } =
    runtimeConfig;

  const inProcessDispatcher = createInProcessDispatcher({
    registry,
    stores,
    runtimeConfig
  });
  const effectiveDispatcher: FlowDispatcher | InProcessDispatcher =
    options.dispatcher ?? inProcessDispatcher;
  const isExternalDispatcher = !("dispatchLocal" in effectiveDispatcher);

  const dispatch = (envelope: InboundRequestEnvelope): DispatchHandle => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new Error(`Unknown flow "${envelope.flowKind}"`);
    }

    const requestId = envelope.requestId ?? generateId("req");

    // Per-flow `voice.provider` wins over the router-level provider, mirroring
    // the principal-resolver override pattern below. Merged once here so
    // `runAction` receives the effective value (via `runtimeConfig.voiceProvider`)
    // and never re-merges.
    const effectiveVoiceProvider =
      flow.voice?.provider ?? runtimeConfig.voiceProvider;

    // Per-flow SSE heartbeat override wins over the host default.
    const flowHeartbeatMs = flow.request?.sseHeartbeatMs;
    const sseHeartbeatMs =
      flowHeartbeatMs !== undefined ? flowHeartbeatMs : defaultSseHeartbeatMs;

    // The envelope's `responseEmitter` field is three-state:
    //   - `undefined` (default) → host owns streaming; create a LiveRequestStream
    //   - `null`                → explicit fire-and-forget (webhook, schedule)
    //   - a `ResponseEmitter`   → caller is bringing its own; do not create a
    //                             redundant live stream and waste a slot
    //
    // External dispatchers (BullMQ, etc.) execute in a separate context and
    // persist events to the shared store. The client falls back to the GET
    // request-stream endpoint (store-driven live tail) when it receives a 202
    // instead of an inline SSE response, so creating a live stream here would
    // be an empty pipe that never receives events.
    const liveStream =
      envelope.responseEmitter === undefined && !isExternalDispatcher
        ? createLiveRequestStream({
            requestId,
            maxBufferSize: maxResponseBufferSize,
            sseHeartbeatMs
          })
        : null;

    // Pick the emitter in priority order: caller-provided emitter wins when
    // present (skips the live-stream branch above by construction), otherwise
    // the host's live-stream emitter, otherwise a fresh internal emitter so
    // the runtime always has somewhere to write items. The handle exposes
    // whichever one was used.
    const responseEmitter =
      envelope.responseEmitter ??
      liveStream?.emitter ??
      createResponseEmitter({ requestId });

    const dispatchEnvelope: DispatchEnvelope = {
      requestId,
      flowKind: envelope.flowKind,
      actionName: envelope.action,
      input: envelope.input,
      userId: envelope.principal.userId,
      sessionId: envelope.sessionId,
      orgId: envelope.orgId ?? envelope.principal.orgId,
      tenantId: envelope.tenantId,
      source: envelope.source,
      metadata: envelope.metadata
    };

    // Delegate to the dispatcher. InProcessDispatcher uses dispatchLocal
    // (carries non-serializable context); external dispatchers use the
    // generic dispatch interface.
    let finished: Promise<ExecutionResult>;
    if ("dispatchLocal" in effectiveDispatcher) {
      const handle = (effectiveDispatcher as InProcessDispatcher).dispatchLocal(
        dispatchEnvelope,
        {
          signal: envelope.signal,
          responseEmitter,
          effectiveRuntimeConfig: {
            ...runtimeConfig,
            voiceProvider: effectiveVoiceProvider
          }
        }
      );
      finished = handle.finished;
    } else {
      // External dispatchers (BullMQ, etc.) run in a separate process and only
      // register the request once the worker starts `runAction`. A client GET
      // .../stream that arrives first would find no record and 404. Materialize
      // the activeRequests entry and an `in_progress` record here, at enqueue
      // time, so the stream route resolves a live record and tails events
      // immediately (FIX-828). The shared `createInitialRequestRecord` builder
      // constructs this stub the same way the worker would, so the worker
      // adopts it as-is and skips its own write. Gating the dispatcher hand-off
      // on these writes means a store failure fails the dispatch rather than
      // enqueueing a job with no discoverable record (no orphan). Resume and the
      // Vercel adapter route through here too, so both inherit the fix.
      //
      // `lastHeartbeatAt` is stamped at enqueue, and nothing heartbeats until
      // the worker claims the job and re-registers (runAction). So the
      // request-recovery sweeper reaps this entry if the worker never starts —
      // but also if a backed-up queue delays worker-start past the sweeper's
      // staleness threshold (default 30s). That false-positive window is the
      // accepted tradeoff of enqueue-time registration.
      const ts = Date.now();
      const materialized = Promise.all([
        stores.activeRequests.register({
          requestId,
          flowKind: dispatchEnvelope.flowKind,
          actionName: dispatchEnvelope.actionName,
          sessionId: dispatchEnvelope.sessionId,
          userId: dispatchEnvelope.userId,
          orgId: dispatchEnvelope.orgId,
          tenantId: dispatchEnvelope.tenantId,
          source: dispatchEnvelope.source ?? "http",
          input: dispatchEnvelope.input,
          metadata: dispatchEnvelope.metadata,
          startedAt: ts,
          lastHeartbeatAt: ts
        }),
        stores.request.set(
          requestId,
          createInitialRequestRecord(dispatchEnvelope, ts),
          "any"
        )
      ]);
      finished = materialized
        .then(() => effectiveDispatcher.dispatch(dispatchEnvelope))
        .then((handle) => handle.finished);
    }

    finished = finished.finally(() => {
      if (liveStream !== null) {
        liveStream.close();
      }
      // Safety net: deregister if runAction didn't (e.g., truly catastrophic failure)
      stores.activeRequests.deregister(requestId).catch(() => {});
    });

    if (onBackgroundWork !== undefined) {
      onBackgroundWork(finished);
    }

    return {
      requestId,
      responseEmitter,
      liveStream,
      finished: finished as Promise<ExecutionResult>
    };
  };

  const validateDispatch = async (
    envelope: InboundRequestEnvelope
  ): Promise<void> => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new Error(`Unknown flow "${envelope.flowKind}"`);
    }
    if (!flow.requiresOrg) return;
    if ((envelope.orgId ?? envelope.principal.orgId) !== undefined) return;
    if (envelope.sessionId !== undefined) {
      const existing = await stores.session.get(
        resolveSessionStorageKey(envelope.sessionId, envelope.tenantId)
      );
      // Only honor the loaded session's org binding when its stored tenant
      // matches this request's — guards the `:`-delimited key collision so a
      // crafted sessionId can't borrow another tenant's org (FIX-682).
      if (
        existing?.orgId !== undefined &&
        tenantMatches(existing.tenantId, envelope.tenantId)
      ) {
        return;
      }
    }
    throw new OrgRequiredError(envelope.flowKind);
  };

  const resolve = async (
    context: PrincipalResolutionContext
  ): Promise<ResolvedPrincipal> => {
    // Per-flow `authentication.resolvePrincipal` wins over the host-level
    // fallback when the flow is registered and configured. Adapters never
    // touch this; they always call `host.resolvePrincipal` and the host
    // routes per-flow overrides transparently.
    const flow = registry.get(context.envelope.flowKind);
    const flowAuth = flow?.authentication;
    const resolver = flowAuth?.resolvePrincipal ?? resolvePrincipal;
    const requireUser = flow?.requireUser ?? true;
    const defaultUserId = flowAuth?.defaultUserId;

    const result = await Promise.resolve(resolver(context));
    let userId: string | undefined;
    let orgId: string | undefined;
    if (result !== null && result !== undefined) {
      userId =
        typeof result.userId === "string" && result.userId.length > 0
          ? result.userId
          : undefined;
      orgId =
        typeof result.orgId === "string" && result.orgId.length > 0
          ? result.orgId
          : undefined;
    }

    if (userId === undefined && defaultUserId !== undefined && defaultUserId.length > 0) {
      userId = defaultUserId;
    }

    if (userId === undefined) {
      if (requireUser) {
        throw new PrincipalResolutionError(
          "Action request requires non-empty userId",
          { status: 401 }
        );
      }
      // Flow opted out of user identity but the host has nowhere to route
      // user-keyed runtime state. Authors must either return a userId from
      // the resolver or set `authentication.defaultUserId`. Surface this as
      // a 500 because it's a configuration mistake, not a caller error.
      throw new PrincipalResolutionError(
        `Flow "${context.envelope.flowKind}" has authentication.requireUser: false ` +
        `but no userId was resolved. Set authentication.defaultUserId or return a ` +
        `userId from authentication.resolvePrincipal.`,
        { status: 500 }
      );
    }

    return orgId === undefined ? { userId } : { userId, orgId };
  };

  return {
    registry,
    stores,
    resolvers: {
      model: runtimeConfig.modelResolver,
      // Router-level provider only — the per-action effective provider (which
      // may be a per-flow override) is merged in `dispatch` and not mirrored
      // here. This bag exists for adapter introspection.
      voice: runtimeConfig.voiceProvider
    },
    middleware: runtimeConfig.middleware,
    logger: runtimeConfig.logger,
    dispatch,
    validateDispatch,
    resolvePrincipal: resolve
  };
}
