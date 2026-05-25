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
import type { TracingLevel } from "@flow-state-dev/core";
import type { FlowRegistry } from "../../registry/flow-registry";
import type { StoreRegistry } from "../../stores/types";
import type { ExecutionResult } from "../../execution/types";
import type { RuntimeLogger } from "../../execution/logging";
import { createLiveRequestStream } from "../../streaming/live-stream";
import { createResponseEmitter } from "../../streaming/response-emitter";
import { runAction } from "../../execution/runAction";
import { generateId } from "../../utils/generate-id";
import { PrincipalResolutionError } from "../errors";
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
  /**
   * Default SSE wire-level heartbeat interval in milliseconds applied to
   * every live stream when the per-flow `request.sseHeartbeatMs` is unset.
   * When 0 or undefined, no host-level default is applied.
   */
  defaultSseHeartbeatMs?: number;
  /** Tracing verbosity for observability snapshots (FIX-406 6H). */
  tracingLevel?: TracingLevel;
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
    maxResponseBufferSize,
    defaultSseHeartbeatMs,
    tracingLevel
  } = options;

  const dispatch = (envelope: InboundRequestEnvelope): DispatchHandle => {
    const flow = registry.get(envelope.flowKind);
    if (flow === undefined) {
      throw new Error(`Unknown flow "${envelope.flowKind}"`);
    }

    const requestId = envelope.requestId ?? generateId("req");

    // Per-flow SSE heartbeat override wins over the host default.
    const flowHeartbeatMs = flow.request?.sseHeartbeatMs;
    const sseHeartbeatMs =
      flowHeartbeatMs !== undefined ? flowHeartbeatMs : defaultSseHeartbeatMs;

    // The envelope's `responseEmitter` field is three-state:
    //   - `undefined` (default) → host owns streaming; create a LiveRequestStream
    //   - `null`                → explicit fire-and-forget (webhook, schedule)
    //   - a `ResponseEmitter`   → caller is bringing its own; do not create a
    //                             redundant live stream and waste a slot
    const liveStream =
      envelope.responseEmitter === undefined
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
      logger,
      tracingLevel
    }).finally(() => {
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
