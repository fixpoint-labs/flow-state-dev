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
      signal,
      stores,
      responseEmitter: local.responseEmitter,
      runtimeConfig: local.effectiveRuntimeConfig
    });

    return {
      requestId: envelope.requestId,
      finished: finished as Promise<ExecutionResult>,
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
