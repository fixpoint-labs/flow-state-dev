/**
 * Construct an `InboundTransportHost` that adapters consume.
 *
 * The host owns registry/stores wiring, principal resolution, and the
 * action-dispatch machinery. It is the runtime surface every adapter
 * (HTTP, MCP, webhook, scheduled, custom) sees — adapters never touch
 * `runAction` directly.
 */
import type {
  Middleware,
  ModelResolver,
  SpeechResolver,
  TranscriptionResolver
} from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../../registry/flow-registry";
import type { StoreRegistry } from "../../stores/types";
import type { ExecutionResult } from "../../execution/types";
import type { RuntimeLogger } from "../../execution/logging";
import {
  canRegisterStream,
  registerStream,
  removeStream
} from "../../streaming/active-streams";
import { createLiveRequestStream } from "../../streaming/live-stream";
import { createResponseEmitter } from "../../streaming/response-emitter";
import { runAction } from "../../execution/runAction";
import { generateId } from "../../utils/generate-id";
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
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  transcriptionResolver?: TranscriptionResolver;
  middleware?: Middleware[];
  logger?: RuntimeLogger;
  resolvePrincipal: PrincipalResolver;
  /** Forwarded to runAction so serverless platforms can keep work alive. */
  onBackgroundWork?: (promise: Promise<unknown>) => void;
  /** Maximum buffered SSE bytes per request — see `createLiveRequestStream`. */
  maxResponseBufferSize?: number;
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
  const {
    registry,
    stores,
    modelResolver,
    speechResolver,
    transcriptionResolver,
    middleware,
    logger,
    resolvePrincipal,
    onBackgroundWork,
    maxResponseBufferSize
  } = options;

  const dispatch = (envelope: InboundRequestEnvelope): DispatchHandle => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new Error(`Unknown flow "${envelope.flowKind}"`);
    }

    const requestId = envelope.requestId ?? generateId("req");

    // The envelope's `responseEmitter` field is three-state:
    //   - `undefined` (default) → host owns streaming; create a LiveRequestStream
    //   - `null`                → explicit fire-and-forget (webhook, schedule)
    //   - a `ResponseEmitter`   → caller is bringing its own; do not create a
    //                             redundant live stream and waste a slot
    const liveStream =
      envelope.responseEmitter === undefined
        ? createLiveRequestStream({
            requestId,
            maxBufferSize: maxResponseBufferSize
          })
        : null;

    if (liveStream !== null) {
      if (!canRegisterStream()) {
        throw new Error("Server is at active stream capacity. Retry shortly.");
      }
      registerStream(requestId, liveStream);
    }

    // Pick the emitter in priority order: caller-provided emitter wins when
    // present (skips the live-stream branch above by construction), otherwise
    // the host's live-stream emitter, otherwise a fresh internal emitter so
    // the runtime always has somewhere to write items. The handle exposes
    // whichever one was used.
    const responseEmitter =
      envelope.responseEmitter ??
      liveStream?.emitter ??
      createResponseEmitter({ requestId });

    const finished = runAction({
      flow,
      actionName: envelope.action as keyof typeof flow.actions & string,
      input: envelope.input,
      userId: envelope.principal.userId,
      sessionId: envelope.sessionId,
      requestId,
      orgId: envelope.orgId ?? envelope.principal.orgId,
      source: envelope.source,
      metadata: envelope.metadata,
      signal: envelope.signal,
      modelResolver,
      speechResolver,
      middleware,
      stores,
      responseEmitter,
      logger
    }).finally(() => {
      if (liveStream !== null) {
        liveStream.close();
        removeStream(requestId);
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

  const resolve = async (
    context: PrincipalResolutionContext
  ): Promise<ResolvedPrincipal> => {
    return Promise.resolve(resolvePrincipal(context));
  };

  return {
    registry,
    stores,
    resolvers: {
      model: modelResolver,
      speech: speechResolver,
      transcription: transcriptionResolver
    },
    middleware,
    logger,
    dispatch,
    resolvePrincipal: resolve
  };
}
