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

    // Two signals ahead of completion, because a run has two distinct earlier
    // milestones and callers need different ones (FIX-982).
    //
    // `accepted` — the request is registered and discoverable. `runAction` is
    // async, so this function returns while the run is still at its first await
    // and that write has been *issued*, not committed; a caller reading the bare
    // handle as "the request exists" is trusting a write that can still fail,
    // into a `finished` a fire-and-forget caller is not holding.
    //
    // `started` — the run reached its main try, past the session write, the
    // opening emits, the execution context's eager resource loads and the
    // flow's `onStarted` hook. Everything in that window fails silently: no
    // terminal record, and the entry deregistered on the way out. So a caller
    // handing over ownership of work waits for THIS, and an HTTP ack — which
    // must not wait on author-supplied setup — waits for `accepted`.
    let markAccepted: () => void = () => {};
    let failAccepted: (error: unknown) => void = () => {};
    const accepted = new Promise<void>((resolve, reject) => {
      markAccepted = resolve;
      failAccepted = reject;
    });
    let markStarted: () => void = () => {};
    let failStarted: (error: unknown) => void = () => {};
    const started = new Promise<void>((resolve, reject) => {
      markStarted = resolve;
      failStarted = reject;
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
      onRegistered: markAccepted,
      onExecutionStarted: markStarted
    });

    // Settles both milestones for a run that never reached them: the failure it
    // died of becomes their failure. A run that got there has already resolved
    // them, so every arm is a no-op by then.
    finished.then(markAccepted, failAccepted);
    finished.then(markStarted, failStarted);
    // Every existing caller wants `finished` only. Marking these handled keeps
    // an early failure from surfacing as an unhandled rejection; callers that
    // await them still observe it.
    void accepted.catch(() => {});
    void started.catch(() => {});

    return {
      requestId: envelope.requestId,
      finished: finished as Promise<ExecutionResult>,
      accepted,
      started,
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
