/**
 * Same-request suspend/resume continuation (FIX-811).
 *
 * `continueRequest` re-enters a suspended/interrupted request under its OWN id
 * — no new request is created. It rebuilds a live SSE stream and the
 * active-request heartbeat for the same id, then calls `runAction` in replay
 * mode so already-completed blocks are injected from the durable item log
 * instead of re-running. The resolving `ctx.suspend()` returns the resume
 * payload; post-resume items append; the record transitions
 * `suspended → in_progress → terminal` in place.
 *
 * This is the in-process counterpart to the host's `dispatch`: where `dispatch`
 * starts a fresh run, `continueRequest` resumes an existing one.
 */
import type { ResumeContext } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { RuntimeConfig } from "../runtime-config";
import type { ExecutionResult } from "./types";
import type { ResponseEmitter } from "../streaming/response-emitter";
import { createLiveRequestStream, type LiveRequestStream } from "../streaming/live-stream";
import { runAction } from "./runAction";

export interface ContinueRequestOptions {
  /** The suspended/interrupted request to continue, re-entered under this id. */
  requestId: string;
  stores: StoreRegistry;
  flowRegistry: FlowRegistry;
  /** The resolution to inject — which gate, approve/reject, payload, resolver. */
  resumeContext?: ResumeContext;
  runtimeConfig: RuntimeConfig;
  signal?: AbortSignal;
  /**
   * Bring-your-own emitter. When provided, no LiveRequestStream is created and
   * `liveStream` is `null` on the result (the caller owns streaming).
   */
  responseEmitter?: ResponseEmitter;
}

export interface ContinueRequestResult {
  /** The continued request's id — the SAME id that was passed in. */
  requestId: string;
  /** Live SSE stream for the re-entry, or `null` when a `responseEmitter` was supplied. */
  liveStream: LiveRequestStream | null;
  /** Resolves when the continued run reaches a terminal (or re-suspended) state. */
  finished: Promise<ExecutionResult>;
}

/**
 * Re-enter a suspended request under its own id and run it to its next terminal
 * (or re-suspension) state in replay mode. Throws synchronously for a missing
 * record or an unregistered flow — the caller (resume route) maps these to
 * 404. A failure AFTER the in-progress transition is durable (`failed`); a
 * failure before it leaves the record `suspended` (see runAction's
 * point-of-no-return ordering).
 */
export async function continueRequest(
  options: ContinueRequestOptions
): Promise<ContinueRequestResult> {
  const { requestId, stores, flowRegistry, resumeContext, runtimeConfig } = options;

  const record = await stores.request.get(requestId);
  if (record === undefined) {
    throw new Error(`Request "${requestId}" not found`);
  }

  const flow = flowRegistry.get(record.flowKind);
  if (flow === undefined) {
    throw new Error(`Unknown flow "${record.flowKind}"`);
  }

  // Per-flow SSE heartbeat override wins over the host default, mirroring
  // `dispatch`.
  const sseHeartbeatMs =
    flow.request?.sseHeartbeatMs ?? runtimeConfig.defaultSseHeartbeatMs;

  const liveStream =
    options.responseEmitter === undefined
      ? createLiveRequestStream({
          requestId,
          maxBufferSize: runtimeConfig.maxResponseBufferSize,
          sseHeartbeatMs
        })
      : null;

  const responseEmitter = options.responseEmitter ?? liveStream?.emitter;

  // Re-register the heartbeat under the SAME id so the stale-request sweeper
  // doesn't reap the continued run. Mirrors the field set the external-dispatch
  // branch of `dispatch` uses, sourced from the loaded record.
  const now = Date.now();
  await stores.activeRequests.register({
    requestId,
    flowKind: record.flowKind,
    actionName: record.actionName,
    sessionId: record.sessionId,
    userId: record.userId,
    orgId: record.orgId,
    tenantId: record.tenantId,
    source: record.source ?? "http",
    input: record.input,
    metadata: record.metadata,
    startedAt: now,
    lastHeartbeatAt: now
  });

  const finished = runAction({
    flow,
    actionName: record.actionName as keyof typeof flow.actions & string,
    input: record.input,
    userId: record.userId,
    sessionId: record.sessionId,
    orgId: record.orgId,
    tenantId: record.tenantId,
    requestId,
    source: record.source,
    signal: options.signal,
    stores,
    responseEmitter,
    replayMode: true,
    metadata: { ...record.metadata, resumeContext },
    runtimeConfig
  }) as Promise<ExecutionResult>;

  // Close the live stream once the run settles so the SSE connection ends.
  const settled = finished.finally(() => {
    if (liveStream !== null) liveStream.close();
  });
  // Callers that consume `liveStream` may not await `finished`; mark handled.
  void settled.catch(() => {});

  return { requestId, liveStream, finished };
}
