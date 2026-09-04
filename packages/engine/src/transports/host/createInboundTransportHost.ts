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
import {
  DEFAULT_RUNTIME_LOGGER,
  logRuntimeEvent,
  summarizeForLog
} from "../../execution/logging";
import {
  deregisterAbortController,
  registerAbortController
} from "../../execution/abort-registry";
import { generateId } from "../../utils/generate-id";
import {
  ConcurrencyQueueTimeoutError,
  OrgRequiredError,
  PrincipalResolutionError
} from "../errors";
import {
  createConcurrencyArbiter,
  type ConcurrencyArbiter
} from "../concurrency/arbiter";
import { pickPrincipalResolver } from "../auth/pickPrincipalResolver";
import type { FlowDispatcher, DispatchEnvelope } from "../dispatcher";
import { INTERNAL_SOURCE, TASK_SOURCE } from "../../execution/transport-sources";
import {
  combineSignals,
  createInProcessDispatcher,
  isInProcessDispatcher,
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

/**
 * Fallback cadence for beating an enqueue-time registry entry while an
 * in-process queued run waits behind its concurrency key (FIX-999).
 *
 * Matches `runAction`'s own default so the entry's freshness cadence does not
 * change when the worker body takes over. A flow that configures
 * `request.heartbeatIntervalMs` overrides it — see `resolveQueuedHeartbeatMs`.
 */
const DEFAULT_QUEUED_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * The cadence to keep a queued entry warm at, for a given flow.
 *
 * Must track the flow's own heartbeat rather than the default: a deployment is
 * free to pair a fast heartbeat with a correspondingly tight stale threshold
 * (the liveness gate only requires `threshold >= 2 * heartbeat`), and a fixed
 * 10s beat against a 3s threshold lets the sweeper reap a request that is
 * merely waiting its turn. The queued entry would then read as not live while
 * the work is still perfectly valid — the exact false negative the queued
 * heartbeat was added to remove.
 *
 * `0` disables heartbeats for the flow, and is preserved here: the caller skips
 * the timer entirely rather than falling back to a default the flow declined.
 */
function resolveQueuedHeartbeatMs(heartbeatIntervalMs: number | undefined): number {
  return heartbeatIntervalMs ?? DEFAULT_QUEUED_HEARTBEAT_INTERVAL_MS;
}

export type CreateInboundTransportHostOptions = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  resolvePrincipal: PrincipalResolver;
  /**
   * Instance-level options forwarded verbatim through the execution chain.
   * The host reads `maxResponseBufferSize` / `defaultSseHeartbeatMs` /
   * `onBackgroundWork` for live-stream wiring, exposes the resolvers /
   * logger on the returned host, and passes the bundle to
   * `runAction`. See {@link RuntimeConfig}.
   */
  runtimeConfig: RuntimeConfig;
  /**
   * Controls where flow actions execute. Default: in-process via runAction.
   * Set to a FlowDispatcher implementation to route execution to an
   * external worker (e.g., BullMQ WorkerDispatcher).
   */
  dispatcher?: FlowDispatcher;
  /**
   * Concurrency arbiter to enforce policy through. Defaults to a fresh one.
   *
   * Supplied when more than one host serves the same process, so a declared
   * `queue`/`reject` policy is enforced ONCE rather than once per host — two
   * arbiters hold two independent keyed gates, and a request admitted by one
   * knows nothing about a key the other is holding (FIX-1077).
   */
  arbiter?: ConcurrencyArbiter;
};

/**
 * Terminate an enqueue-time request record whose job was never started, so it
 * does not linger `in_progress` forever: the dispatch teardown deregisters the
 * activeRequests entry, leaving the stale-request sweeper nothing to reap.
 * Best-effort and idempotent — a missing or already-terminal record is left
 * untouched. (FIX-828)
 *
 * `status` distinguishes the two ways a run can end without starting, and they
 * are not the same event to anybody downstream (FIX-1077):
 *
 * - `failed` — materialization or the dispatcher hand-off broke. Something went
 *   wrong and someone should look.
 * - `aborted` — the run was cancelled before it left the concurrency queue,
 *   which is shutdown working as designed. Recording that as `failed` reports a
 *   successful cancellation as an execution failure to clients, to workstream
 *   summaries, and to recovery, which reads terminal statuses to decide what
 *   needs attention.
 *
 * `failedAtMs` is stamped only for the failure, since it is the field readers
 * key on for "this broke"; an abort carries `updatedAt` and its status.
 */
async function terminateUnenqueuedRequest(
  stores: StoreRegistry,
  requestId: string,
  status: "failed" | "aborted" = "failed"
): Promise<void> {
  try {
    const record = await stores.request.get(requestId);
    if (record === undefined || isTerminalRequestStatus(record.status)) return;
    const now = Date.now();
    await stores.request.set(
      requestId,
      {
        ...record,
        status,
        ...(status === "failed" ? { failedAtMs: now } : {}),
        updatedAt: now
      },
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
  const isExternalDispatcher = !isInProcessDispatcher(effectiveDispatcher);

  // One arbiter governs every in-process dispatch, so an action's concurrency
  // policy is enforced once at this shared seam (FIX-837). v1 enforces only the
  // in-process dispatcher (the default): with an external dispatcher (BullMQ)
  // the run completes in another worker, so the policy is deferred to the
  // durable substrate (FIX-830) rather than gating the enqueue, which would give
  // misleading semantics (a `reject` lease freed at enqueue, not run-completion).
  const arbiter = options.arbiter ?? createConcurrencyArbiter();

  /**
   * Hand a STARTED run's `finished` to the adapter's keep-alive hook, containing
   * a synchronous throw from it.
   *
   * Both seams that start a run — `dispatch` and `continueRequest` — call the
   * hook last, once the run is already under way, and both are synchronous from
   * their caller's point of view (`continueRequest` via the promise it returns).
   * The hook is adapter-supplied and does throw in practice: Next's `after()`
   * and `waitUntil` both raise synchronously when called outside a request
   * scope. An escaping throw would therefore make a synchronous failure mean two
   * different things, and each caller reads it as only one — the pre-start one:
   * `createDetachedStartOperation` reads it as "nothing was dispatched" and
   * settles the row it handed over, and the resume route reads it as
   * "setup failed" and reverts the suspension to `pending`, inviting a second
   * resume against a request whose run is still going. Two writers, one row
   * (FIX-982, FIX-1095).
   *
   * Containing it here is what makes "a synchronous throw is pre-start" a
   * property those callers can rely on rather than one they assume.
   *
   * Failing to register keep-alive is real — on a freeze-after-response platform
   * the run can stall — but it is not a failure to start, and the handle the
   * caller gets back is honest either way. So it is logged, not raised.
   */
  /**
   * Emit a diagnostic without letting it become the failure it was describing.
   *
   * A `RuntimeLogger` is adapter- or app-supplied, so `warn`/`error` are
   * arbitrary code that can throw. Both callers here are on a path where that
   * throw would be read as something else entirely: one runs before a detached
   * dispatch has materialized, where `createDetachedStartOperation` reads a
   * synchronous throw as "nothing was started" and settles the row — so a failed
   * log line would report work as never started when the only thing that failed
   * was the logging. The other is the containment inside
   * `registerBackgroundWork`, where a throwing logger would escape the very
   * helper that exists to stop a throw escaping.
   *
   * `console.error` deliberately, and not through the logger: the logger is what
   * just failed.
   */
  const logSafely = (
    logger: RuntimeConfig["logger"],
    level: "warn" | "error",
    message: string,
    context: Record<string, unknown>
  ): void => {
    try {
      logRuntimeEvent(logger ?? DEFAULT_RUNTIME_LOGGER, level, message, context);
    } catch (error) {
      console.error("[flow-state] runtime logger threw", error);
    }
  };

  const registerBackgroundWork = (
    finished: Promise<unknown>,
    context: { requestId: string; flowKind?: string },
    /**
     * The hook for THIS dispatch. Defaults to the host's, which is right for
     * every seam that has no per-request config of its own.
     */
    hook: RuntimeConfig["onBackgroundWork"] = onBackgroundWork
  ): void => {
    if (hook === undefined) return;
    try {
      hook(finished);
    } catch (error) {
      logSafely(
        runtimeConfig.logger,
        "error",
        "[flow-state] onBackgroundWork threw; the run was started but is not registered as background work",
        { ...context, error: summarizeForLog(error) }
      );
    }
  };

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

    // The config this dispatch runs under. Normally the host's own; a detached
    // child carries the LAUNCHING request's, because the caller may have derived
    // one the host was never built with — `fsdev run` does, so `--model` reaches
    // the detached child rather than silently resolving the app's default
    // (FIX-1077). Server-set only; see `InboundRequestEnvelope.runtimeConfig`.
    const dispatchRuntimeConfig = envelope.runtimeConfig ?? runtimeConfig;

    // Say so when a caller-derived model resolver is about to be dropped at the
    // serialization boundary (FIX-1077).
    //
    // No brand and no CLI plumbing needed: the condition IS the divergence. A
    // launching request whose config carries a different resolver from the
    // host's is one a caller derived — `fsdev run --model` is the shipped case —
    // and an external dispatcher cannot carry it, because a `RuntimeConfig`
    // holds live resolvers and providers that do not serialize. Serializing just
    // the model id was the alternative and is worse: the worker is a different
    // process with its own gateways and keys, so a forced id may not resolve
    // there at all, replacing a silent wrong model with a failure surfacing
    // where the caller cannot see it.
    //
    // Warned rather than refused because refusing would break a working command
    // for a condition that may never arise in it — a queue-configured app whose
    // flows never detach is unaffected. This fires only at the exact dispatch
    // that loses the override.
    if (
      isExternalDispatcher &&
      envelope.runtimeConfig !== undefined &&
      envelope.runtimeConfig.modelResolver !== runtimeConfig.modelResolver
    ) {
      logSafely(
        dispatchRuntimeConfig.logger,
        "warn",
        `[flow-state] the model override on this run does NOT apply to background work ` +
          `dispatched to a queue: request "${requestId}" (flow "${envelope.flowKind}") will ` +
          `run under the worker's own model configuration, not the override. Generators in ` +
          `this process still use it.`,
        { requestId, flowKind: envelope.flowKind, source: envelope.source }
      );
    }

    // Per-flow `voice.provider` wins over the router-level provider, mirroring
    // the principal-resolver override pattern below. Merged once here so
    // `runAction` receives the effective value (via `runtimeConfig.voiceProvider`)
    // and never re-merges.
    const effectiveVoiceProvider =
      flow.voice?.provider ?? dispatchRuntimeConfig.voiceProvider;

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
    // Resolves once the request is accepted. Every branch sets it, and each
    // means "discoverable" in the terms its own path can honour: enqueue-time
    // store writes committed plus the job taken (external), those same writes
    // committed (in-process `queue`), or the run's own `activeRequests`
    // registration committed (in-process, FIX-982).
    let accepted: Promise<void> | undefined;
    if ("dispatchLocal" in effectiveDispatcher) {
      // The in-process milestones, held here rather than read off the handle
      // because `gateStart` owns *when* the run is started and the handle does
      // not exist until it does (FIX-982). The `queue` branch below has its own,
      // earlier acceptance — its enqueue-time writes — and ignores these.
      let markAccepted: () => void = () => {};
      let failAccepted: (error: unknown) => void = () => {};
      const inProcessAccepted = new Promise<void>((resolve, reject) => {
        markAccepted = resolve;
        failAccepted = reject;
      });
      // Handled unconditionally: this is discarded on the `queue` path and
      // ignored by every caller that only wants `finished`.
      void inProcessAccepted.catch(() => {});

      /**
       * `cancellation` is a signal the run must inherit rather than merely be
       * checked against. The queued branch holds one: an abort that lands
       * between its pre-start check and `runAction`'s own
       * `registerAbortController` would otherwise be thrown away, because
       * `runAction` mints a fresh controller and overwrites the one that was
       * aborted. Threading it makes the handoff atomic — there is one signal
       * from enqueue to completion, so the abort cannot fall between two
       * registrations no matter when it lands (FIX-1077).
       */
      const startRun = (cancellation?: AbortSignal): Promise<ExecutionResult> => {
        const signal =
          cancellation === undefined
            ? envelope.signal
            : envelope.signal === undefined
              ? cancellation
              : combineSignals(envelope.signal, cancellation);
        const handle = (effectiveDispatcher as InProcessDispatcher).dispatchLocal(
          dispatchEnvelope,
          {
            signal,
            responseEmitter,
            effectiveRuntimeConfig: {
              ...dispatchRuntimeConfig,
              voiceProvider: effectiveVoiceProvider
            }
          }
        );
        handle.accepted?.then(markAccepted, failAccepted);
        return handle.finished;
      };

      // A DISPATCHED request (the seam's `internal` / `task` sources) takes this
      // branch whatever its policy, and the reason is the meaning of `accepted`
      // rather than the concurrency queue. The seam hands back a handle the
      // moment acceptance resolves, and a later read of that request authorizes
      // off the provenance persisted in its record's `metadata.dispatch` — the
      // incarnation guard reads its recipient lineage from there. On the
      // ordinary non-queued path acceptance is `onRegistered`, fired well before
      // the request record is written, so the sender would be handed an id whose
      // durable stamp does not exist yet, and a failure in that window leaves an
      // accepted but unverifiable delivery. The queued branch already resolves
      // acceptance off its own enqueue-time writes, so the id and its stamp
      // become durable together. Under `allow` the gate below is a passthrough,
      // so the run still starts immediately — only what `accepted` waits for
      // changes.
      const isDispatched =
        envelope.source === INTERNAL_SOURCE || envelope.source === TASK_SOURCE;

      if (isDispatched || (decision.policy === "queue" && decision.key !== undefined)) {
        // Registered HERE rather than left to `runAction`, because between this
        // dispatch and the run's own registration the request is real,
        // discoverable, and cancellable by anyone reading the store — and yet
        // has no controller for `abortRequest` to find. `runAction` re-registers
        // (overwriting this one) when it actually starts, which is the same
        // last-write-wins hand-off the enqueue-time record already uses, so this
        // adds a window rather than a second registry to keep in sync. The
        // `finally` below removes it on every exit, started or not.
        const queuedAbort = registerAbortController(requestId);
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

        // This branch defers a start, so it needs the same acceptance signal the
        // external branch has (FIX-999). `accepted` was previously left
        // `undefined` here, so a caller that awaits "where one exists" awaited
        // nothing on the one in-process path that can defer — reporting Started
        // before the record was discoverable, and before a failed materialization
        // was known. Awaiting an absent promise is not a weaker guarantee, it is
        // no guarantee.
        accepted = materialized.then(() => undefined);

        // Nothing heartbeats the enqueue-time entry while the run waits behind
        // the concurrency key, so the stale sweeper reaps a perfectly valid
        // queued request and a liveness read reports it not live. The rule this
        // restores is "whoever owns the entry keeps it warm": the host
        // registered it, so the host heartbeats it until the run starts and
        // `runAction`'s own timer takes over. No sweeper exemption — an
        // exemption for unstarted requests would reintroduce the never-reaped
        // entry the liveness gate's sweep arm exists to prevent.
        let queuedHeartbeat: ReturnType<typeof setInterval> | undefined;
        const stopQueuedHeartbeat = (): void => {
          if (queuedHeartbeat !== undefined) {
            clearInterval(queuedHeartbeat);
            queuedHeartbeat = undefined;
          }
        };

        const queuedHeartbeatMs = resolveQueuedHeartbeatMs(
          flow.request?.heartbeatIntervalMs
        );

        finished = materialized
          .then(() => {
            // A flow that disables heartbeats gets no queued timer either —
            // starting one here would keep an entry warm that the flow asked
            // never to be kept warm.
            if (queuedHeartbeatMs > 0) {
              queuedHeartbeat = setInterval(() => {
                stores.activeRequests.heartbeat(requestId).catch(() => {});
              }, queuedHeartbeatMs);
              if (typeof (queuedHeartbeat as { unref?: () => void }).unref === "function") {
                (queuedHeartbeat as unknown as { unref: () => void }).unref();
              }
            }
            return gateStart(async () => {
              // `runAction` re-registers and starts its own heartbeat timer from
              // here, so the host's stewardship of the entry ends exactly here.
              stopQueuedHeartbeat();
              // Cancelled while it sat in the queue, so do not start it now.
              //
              // A queued run is the one dispatch that exists without an abort
              // controller: `runAction` registers that, and `runAction` has not
              // been called yet. So `abortRequest` finds nothing and returns
              // false, and a cancel issued in this window — shutdown's drain is
              // the reachable one — silently does not apply. Waking up after
              // `dispose()` and starting a run against closed adapters is a
              // corrupting outcome rather than an untidy one, so the wait is
              // registered (above) and the decision is re-read here, at the last
              // moment before anything runs (FIX-1077).
              if (queuedAbort.signal.aborted) {
                await terminateUnenqueuedRequest(stores, requestId, "aborted");
                throw new Error(
                  `Request "${requestId}" was cancelled before it left the concurrency queue`
                );
              }
              // The check above is not sufficient on its own and is not meant to
              // be: an abort landing after it would be lost, because `runAction`
              // registers a fresh controller over this one. Handing the signal
              // down is what closes that gap — the check short-circuits the run
              // entirely when the decision is already made, and the signal
              // carries it when it is made a moment later.
              return startRun(queuedAbort.signal);
            }).catch(async (error: unknown) => {
              if (error instanceof ConcurrencyQueueTimeoutError) {
                await terminateUnenqueuedRequest(stores, requestId);
              }
              throw error;
            });
          })
          .finally(() => {
            stopQueuedHeartbeat();
            // Whoever registered it removes it, on every exit — started,
            // cancelled, or timed out — so the pre-start window cannot leak
            // controllers into a long-lived process. Idempotent with
            // `runAction`'s own deregistration on the path where it did start.
            deregisterAbortController(requestId);
          });
      } else {
        finished = gateStart(startRun);
        // A start that never happens (the gate threw on the way in) must fail
        // acceptance rather than leave it pending forever. Once the run has
        // registered this is already settled and both arms are no-ops.
        finished.then(markAccepted, failAccepted);
        accepted = inProcessAccepted;
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
      // `lastHeartbeatAt` is stamped at enqueue and nothing heartbeats until
      // the worker claims the job and re-registers (runAction), so this entry's
      // age measures queue wait, not worker death. `queuedAt` says so on the
      // entry itself, which is what keeps a backed-up queue from reading as a
      // pile of dead requests (FIX-999): the liveness read reports a queued job
      // live, and the sweeper leaves it alone until it outlives the queued
      // grace, at which point it is reaped like anything else.
      //
      // The in-process branch above keeps its entry warm with a timer instead,
      // and that difference is not an inconsistency. There the host is holding
      // the run and can honestly assert "this is still mine". Here it hands the
      // job to another process and returns 202 — on a serverless host it may be
      // frozen moments later. A timer here would make a queued job's survival
      // depend on the liveness of a process that is not running it, and would
      // beat on behalf of work it has no knowledge of.
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
          lastHeartbeatAt: ts,
          queuedAt: ts
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

    // Contained by `registerBackgroundWork`, because this is the ONLY thing left
    // in `dispatch` that can throw synchronously and the run has already been
    // started above — see that helper for why an escaping throw is damaging.
    //
    // Taken from `dispatchRuntimeConfig`, not from the host's construction-time
    // config, and on a freeze-after-response platform that distinction is the
    // difference between the child finishing and the child stalling. The run
    // executes under the dispatch config; the keep-alive hook is what holds the
    // process open for it. Read the host's instead and a detached child launched
    // by a request whose config carries its own `after()` / `waitUntil` hands
    // `finished` to the wrong scope — or to nothing — and the platform freezes
    // the container the moment the parent responds, with the child mid-run.
    // Every other per-dispatch value here already resolves this way
    // (`voiceProvider`, `logger`); this one did not.
    registerBackgroundWork(
      finished,
      { requestId, flowKind: dispatchEnvelope.flowKind },
      dispatchRuntimeConfig.onBackgroundWork
    );

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
    // waitUntil) lets it run to completion. Contained by
    // `registerBackgroundWork`: `continueRequestImpl` above has already started
    // the run, so a throw escaping from here would reject this promise and the
    // resume route would read that as setup having failed — reverting the
    // suspension of a request that is still running (FIX-1095).
    //
    // `void .catch` marks `finished` handled: the 202 path doesn't await it, so
    // an unobserved rejection must not surface as an unhandled rejection. It
    // stays inside the keep-alive branch, which is the only case where nothing
    // else is guaranteed to observe the promise.
    if (onBackgroundWork !== undefined) {
      registerBackgroundWork(result.finished, { requestId: opts.requestId });
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
    // routes per-flow overrides transparently. The precedence itself lives in
    // `pickPrincipalResolver` so the route-level guard's enforce/skip decision
    // cannot drift from the resolver actually called here.
    const flow = registry.get(context.envelope.flowKind);
    const flowAuth = flow?.authentication;
    const resolver = pickPrincipalResolver(
      registry,
      context.envelope.flowKind,
      resolvePrincipal
    );
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
    logger: runtimeConfig.logger,
    usesExternalDispatcher: isExternalDispatcher,
    dispatch,
    continueRequest,
    validateDispatch,
    resolvePrincipal: resolve
  };
}
