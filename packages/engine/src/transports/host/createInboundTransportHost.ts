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
import {
  continueRequest as continueRequestImpl,
  type ContinueRequestResult
} from "../../execution/request-continuation";
import { resolveSessionStorageKey, tenantMatches } from "../../stores/scope-keys";
import { isTerminalRequestStatus } from "../../stores/subscribe-helpers";
import { createInitialRequestRecord } from "../../context/initial-request-record";
import { generateId } from "../../utils/generate-id";
import {
  ConcurrencyQueueTimeoutError,
  OrgRequiredError,
  PrincipalResolutionError
} from "../errors";
import { createConcurrencyArbiter } from "../concurrency/arbiter";
import type { FlowDispatcher, DispatchEnvelope } from "../dispatcher";
import {
  createInProcessDispatcher,
  type InProcessDispatcher
} from "./in-process-dispatcher";
import type {
  DispatchHandle,
  HostContinueRequestOptions,
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
 * Terminate an enqueue-time request record whose job was never started —
 * materialization or the dispatcher hand-off failed. Marks a still-`in_progress`
 * record `failed` so it does not linger forever: the dispatch teardown
 * deregisters the activeRequests entry, leaving the stale-request sweeper
 * nothing to reap. Best-effort and idempotent — a missing or already-terminal
 * record is left untouched. (FIX-828)
 */
async function terminateUnenqueuedRequest(
  stores: StoreRegistry,
  requestId: string
): Promise<void> {
  try {
    const record = await stores.request.get(requestId);
    if (record === undefined || isTerminalRequestStatus(record.status)) return;
    const now = Date.now();
    await stores.request.set(
      requestId,
      { ...record, status: "failed", failedAtMs: now, updatedAt: now },
      "any"
    );
  } catch {
    // Best-effort cleanup; the original dispatch error is what propagates.
  }
}

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

  // One arbiter governs every in-process dispatch, so an action's concurrency
  // policy is enforced once at this shared seam (FIX-837). v1 enforces only the
  // in-process dispatcher (the default): with an external dispatcher (BullMQ)
  // the run completes in another worker, so the policy is deferred to the
  // durable substrate (FIX-830) rather than gating the enqueue, which would give
  // misleading semantics (a `reject` lease freed at enqueue, not run-completion).
  const arbiter = createConcurrencyArbiter();

  const dispatch = (envelope: InboundRequestEnvelope): DispatchHandle => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new Error(`Unknown flow "${envelope.flowKind}"`);
    }

    const requestId = envelope.requestId ?? generateId("req");

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
      metadata: envelope.metadata,
      resolvedActionCore: envelope.resolvedActionCore
    };

    // Concurrency gate, resolved up front and built before any request record or
    // live stream exists. For `reject` this synchronously claims the action's
    // key and throws `ConcurrencyRejectedError` here when another request holds
    // it — so a dropped caller never materializes a run. `queue` defers the
    // kickoff behind the key (FIFO); `allow` is a passthrough preserving today's
    // timing. Only the *start* of execution is gated — the handle (requestId,
    // liveStream, finished) is still returned synchronously, so an SSE client
    // gets an open stream while queued. External dispatchers run elsewhere, so
    // they skip arbitration (no key, passthrough) — see the arbiter note above.
    const decision = isExternalDispatcher
      ? { policy: "allow" as const, key: undefined }
      : arbiter.resolve(flow, envelope.action, dispatchEnvelope);
    const gateStart = arbiter.gate(decision, requestId);

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

    // Delegate to the dispatcher. InProcessDispatcher uses dispatchLocal
    // (carries non-serializable context); external dispatchers use the
    // generic dispatch interface.
    let finished: Promise<ExecutionResult>;
    // Set for external dispatch only: resolves once the request is accepted —
    // enqueue-time store writes committed AND the dispatcher accepted the job
    // (see the external branch). Left undefined for in-process.
    let accepted: Promise<void> | undefined;
    if ("dispatchLocal" in effectiveDispatcher) {
      const startRun = (): Promise<ExecutionResult> => {
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
        return handle.finished;
      };

      if (decision.policy === "queue" && decision.key !== undefined) {
        // A `queue` run's start is deferred behind the key, so `dispatchLocal`
        // (which registers `activeRequests` and writes the request record) has
        // not run when this handle is returned. Materialize a discoverable
        // `in_progress` record + activeRequests entry now — the same enqueue-time
        // stub the external dispatcher writes (FIX-828) — so the synchronously
        // returned `requestId` resolves instead of 404ing on `.../requests/:id/
        // stream` while queued. `runAction` adopts/overwrites the stub when the
        // run starts (last-write-wins). If the wait budget elapses the run never
        // starts, so flip the stub to a terminal failure rather than leaving a
        // phantom `in_progress` the client can never resolve.
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
        ]).catch(async (error: unknown) => {
          await terminateUnenqueuedRequest(stores, requestId);
          throw error;
        });
        finished = materialized.then(() =>
          gateStart(startRun).catch(async (error: unknown) => {
            if (error instanceof ConcurrencyQueueTimeoutError) {
              await terminateUnenqueuedRequest(stores, requestId);
            }
            throw error;
          })
        );
      } else {
        finished = gateStart(startRun);
      }
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
      // `acceptance` resolves once the request is accepted: the enqueue-time
      // writes commit AND the dispatcher accepts the job. The response path
      // awaits the exposed `accepted` view before acking, so the 202 means
      // "discoverable and enqueued" — not merely "record written". Crucially the
      // enqueue (`effectiveDispatcher.dispatch`) is inside this promise, so an
      // enqueue failure rejects the ack (failing the POST / reverting the
      // resume) rather than landing in the detached `finished` chain after a 202
      // already went out. The concurrency gate does not apply here — external
      // dispatch is unarbitrated in v1 (FIX-830).
      const ts = Date.now();
      const acceptance = Promise.all([
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
      ])
        .then(() => effectiveDispatcher.dispatch(dispatchEnvelope))
        .catch(async (error: unknown) => {
            // Materialization or the enqueue failed: the job is not running and
            // never will. Terminate the in_progress record we may have written —
            // `Promise.all` can reject after one write already landed, and a
            // failed enqueue leaves a fully-written record — so it doesn't
            // outlive the job. The `finally` below only deregisters the
            // activeRequests entry, which would otherwise leave the sweeper
            // nothing to reap and the record stuck in_progress forever.
            await terminateUnenqueuedRequest(stores, requestId);
            throw error;
          });

      accepted = acceptance.then(() => undefined);
      finished = acceptance.then((handle) => handle.finished);
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

    // The HTTP 202 path awaits `accepted`, not `finished`, so a fire-and-forget
    // external dispatch can leave `finished` unobserved. Mark it handled to
    // avoid an unhandled rejection (e.g. an enqueue failure, which is already
    // surfaced to the caller via `accepted`). This only registers an extra
    // rejection handler — callers that await `finished` still observe it.
    void finished.catch(() => {});

    return {
      requestId,
      responseEmitter,
      liveStream,
      finished: finished as Promise<ExecutionResult>,
      accepted
    };
  };

  const continueRequest = async (
    opts: HostContinueRequestOptions
  ): Promise<ContinueRequestResult> => {
    const result = await continueRequestImpl({
      requestId: opts.requestId,
      resumeContext: opts.resumeContext,
      signal: opts.signal,
      responseEmitter: opts.responseEmitter,
      includeTrace: opts.includeTrace,
      stores,
      flowRegistry: registry,
      runtimeConfig
    });

    // Keep the serverless function alive until the resumed run finishes, exactly
    // as `dispatch` does (above). The resume route returns 202 without awaiting
    // `finished`, so on a freeze-after-response platform (Vercel: no BullMQ, the
    // continuation runs inline via `runAction`) the inline run would stall when
    // the response is sent and only resume when a later invocation thaws the
    // container — the resume appears to hang for tens of seconds, the flow's
    // remaining steps never run, and a refresh still shows `in_progress`.
    // Registering `finished` with `onBackgroundWork` (→ Next `after()` /
    // waitUntil) lets it run to completion. `void .catch` marks it handled: the
    // 202 path doesn't await `finished`, so an unobserved rejection must not
    // surface as an unhandled rejection.
    if (onBackgroundWork !== undefined) {
      onBackgroundWork(result.finished);
      void result.finished.catch(() => {});
    }

    return result;
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
    continueRequest,
    validateDispatch,
    resolvePrincipal: resolve
  };
}
