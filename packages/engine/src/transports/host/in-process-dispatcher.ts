/**
 * Default FlowDispatcher — runs actions in the current process via runAction.
 * Extracted from the inline dispatch body in createInboundTransportHost so the
 * host can accept pluggable dispatchers without changing adapter contracts.
 */
import type { FlowRegistry } from "../../registry/flow-registry";
import type { StoreRegistry } from "../../stores/types";
import type { RuntimeConfig } from "../../runtime-config";
import type { ResponseEmitter } from "../../streaming/response-emitter";
import type { ExecutionResult } from "../../execution/types";
import { runAction } from "../../execution/runAction";
import type {
  DispatchEnvelope,
  FlowDispatchHandle,
  FlowDispatcher,
  StreamBridge
} from "../dispatcher";

export interface InProcessDispatcherDeps {
  registry: FlowRegistry;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
}

/**
 * In-process dispatch context passed per-dispatch. The host constructs
 * this from the InboundRequestEnvelope — it carries the non-serializable
 * bits (signal, responseEmitter) that can't travel through a serialization
 * boundary.
 */
export interface InProcessDispatchContext {
  signal?: AbortSignal;
  responseEmitter?: ResponseEmitter;
  /** Effective runtime config with per-flow overrides already merged. */
  effectiveRuntimeConfig: RuntimeConfig;
}

/**
 * Extended FlowDispatcher that also exposes `dispatchLocal` for the
 * InboundTransportHost, which has access to non-serializable context
 * (signal, responseEmitter) that can't travel through a queue.
 */
export interface InProcessDispatcher extends FlowDispatcher {
  /**
   * Dispatch with local-only context (signal, emitter). Used by the
   * InboundTransportHost which has access to the full envelope including
   * non-serializable parts.
   */
  dispatchLocal(
    envelope: DispatchEnvelope,
    local: InProcessDispatchContext
  ): FlowDispatchHandle;
}

/**
 * Whether a dispatcher runs work in THIS process.
 *
 * `dispatchLocal` is the discriminator because it is the capability that cannot
 * cross a serialization boundary — a dispatcher that accepts a live
 * `AbortSignal` and `ResponseEmitter` is necessarily running the work here. An
 * `undefined` dispatcher is in-process too: the host builds its own
 * `createInProcessDispatcher` for that case.
 *
 * Shared rather than re-tested per call site so the host's dispatch branch and
 * anything else keying on locality cannot drift apart and disagree about the
 * same dispatcher (FIX-1077).
 */
export function isInProcessDispatcher(
  dispatcher: FlowDispatcher | undefined
): boolean {
  return dispatcher === undefined || "dispatchLocal" in dispatcher;
}

/**
 * Create a dispatcher that runs actions in the current process. The host
 * delegates to `dispatchLocal` (which accepts non-serializable context)
 * while the generic `FlowDispatcher.dispatch` interface is also satisfied
 * for callers that only have the serializable envelope.
 */
export function createInProcessDispatcher(
  deps: InProcessDispatcherDeps
): InProcessDispatcher {
  const { registry, stores, runtimeConfig } = deps;

  const dispatchLocal = (
    envelope: DispatchEnvelope,
    local: InProcessDispatchContext
  ): FlowDispatchHandle => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new Error(`Unknown flow "${envelope.flowKind}"`);
    }

    const abortController = new AbortController();
    const signal = local.signal
      ? combineSignals(local.signal, abortController.signal)
      : abortController.signal;

    // Acceptance, separated from completion (FIX-982). `runAction` is async, so
    // this function returns while the run is still at its first await — the
    // `activeRequests` write has been *issued* and not committed. A caller that
    // reads the bare handle as "the request exists" is trusting a write that can
    // still fail, into a `finished` a fire-and-forget caller is not holding.
    //
    // It reports discoverability and nothing more. Setup after it can still
    // fail; what protects a caller that handed over durable work is that work's
    // own lease, and what this adds is that the failure is visible rather than
    // silent.
    let markAccepted: () => void = () => {};
    let failAccepted: (error: unknown) => void = () => {};
    const accepted = new Promise<void>((resolve, reject) => {
      markAccepted = resolve;
      failAccepted = reject;
    });

    const finished = runAction({
      flow,
      actionName: envelope.actionName as keyof typeof flow.actions & string,
      input: envelope.input,
      userId: envelope.userId,
      sessionId: envelope.sessionId,
      requestId: envelope.requestId,
      orgId: envelope.orgId,
      tenantId: envelope.tenantId,
      source: envelope.source,
      metadata: envelope.metadata,
      resolvedActionCore: envelope.resolvedActionCore,
      signal,
      stores,
      responseEmitter: local.responseEmitter,
      runtimeConfig: local.effectiveRuntimeConfig,
      onRegistered: markAccepted
    });

    // Settles acceptance for a run that never reached registration: the failure
    // it died of becomes the acceptance failure. A run that DID register has
    // already resolved it, so both arms are no-ops by then.
    finished.then(markAccepted, failAccepted);
    // Every existing caller wants `finished` only. Marking it handled keeps an
    // early failure from surfacing as an unhandled rejection; callers that await
    // it still observe it.
    void accepted.catch(() => {});

    return {
      requestId: envelope.requestId,
      finished: finished as Promise<ExecutionResult>,
      accepted,
      abort: () => abortController.abort()
    };
  };

  return {
    async dispatch(
      envelope: DispatchEnvelope,
      _bridge?: StreamBridge
    ): Promise<FlowDispatchHandle> {
      return dispatchLocal(envelope, {
        effectiveRuntimeConfig: runtimeConfig
      });
    },
    dispatchLocal,
    async close() {
      // No resources to clean up for in-process dispatch.
    }
  };
}

function combineSignals(outer: AbortSignal, inner: AbortSignal): AbortSignal {
  if (outer.aborted) return outer;
  return AbortSignal.any([outer, inner]);
}
