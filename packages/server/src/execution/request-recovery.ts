/**
 * Interrupted request detection and recovery utilities.
 */
import type { Middleware, ModelResolver, SpeechResolver } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type {
  ActiveRequestEntry,
  RequestRecord,
  StoreRegistry
} from "../stores/types";
import {
  canRegisterStream,
  registerStream,
  removeStream
} from "../streaming/active-streams";
import { createLiveRequestStream, type LiveRequestStream } from "../streaming/live-stream";
import { generateId } from "../utils/generate-id";
import { logRuntimeEvent, type RuntimeLogger, DEFAULT_RUNTIME_LOGGER } from "./logging";
import { runAction } from "./runAction";

export type InterruptedRequestInfo = {
  entry: ActiveRequestEntry;
  requestRecord?: RequestRecord;
};

/**
 * Scans the active request registry for stale entries and marks
 * the corresponding request records as interrupted.
 *
 * When `userId` is provided, only stale entries owned by that user are
 * processed — the rest are left untouched. This is the safe surface for the
 * client-driven recovery endpoint, which sweeps on behalf of a single user.
 *
 * Returns the list of interrupted requests for optional retry.
 */
export async function detectInterruptedRequests(options: {
  stores: StoreRegistry;
  /** Requests with no heartbeat for this duration are considered stale. Default: 30000 (30s). */
  staleThresholdMs?: number;
  /** Restrict the sweep to entries owned by this userId. */
  userId?: string;
  logger?: RuntimeLogger;
}): Promise<InterruptedRequestInfo[]> {
  const { stores, userId, logger = DEFAULT_RUNTIME_LOGGER } = options;
  const staleThresholdMs = options.staleThresholdMs ?? 30_000;

  const allStale = await stores.activeRequests.listStale(staleThresholdMs);
  const stale = userId === undefined
    ? allStale
    : allStale.filter((entry) => entry.userId === userId);
  const results: InterruptedRequestInfo[] = [];

  for (const entry of stale) {
    const requestRecord = await stores.request.get(entry.requestId);

    if (requestRecord !== undefined && requestRecord.status === "in_progress") {
      await stores.request.set(
        entry.requestId,
        {
          ...requestRecord,
          status: "interrupted",
          interruptedAt: Date.now(),
          updatedAt: Date.now()
        },
        "any"
      );

      logRuntimeEvent(logger, "warn", "[flow-state] detected interrupted request", {
        requestId: entry.requestId,
        flowKind: entry.flowKind,
        actionName: entry.actionName,
        sessionId: entry.sessionId
      });
    }

    await stores.activeRequests.deregister(entry.requestId);
    results.push({ entry, requestRecord });
  }

  return results;
}

export type RetryRequestOptions = {
  /** The requestId of the interrupted or failed request. */
  originalRequestId: string;
  /** Store registry. */
  stores: StoreRegistry;
  /** Flow registry for resolving the flow. */
  flowRegistry: FlowRegistry;
  /** Optional: override the registry entry if available (avoids a store read). */
  registryEntry?: ActiveRequestEntry;
  /** Standard runAction dependencies. */
  modelResolver?: ModelResolver;
  speechResolver?: SpeechResolver;
  middleware?: Middleware[];
  logger?: RuntimeLogger;
};

export type RetryRequestResult = {
  /** The new request ID. */
  newRequestId: string;
  /** The response stream for the new request (for SSE). */
  liveStream: LiveRequestStream;
};

/**
 * Re-dispatches a previously interrupted or failed request against
 * the same session, with the original parameters.
 */
export async function retryRequest(
  options: RetryRequestOptions
): Promise<RetryRequestResult> {
  const { stores, flowRegistry, logger = DEFAULT_RUNTIME_LOGGER } = options;

  // Load original request info
  const originalRecord = await stores.request.get(options.originalRequestId);
  const entry = options.registryEntry;

  const flowKind = entry?.flowKind ?? originalRecord?.flowKind;
  const actionName = entry?.actionName ?? originalRecord?.actionName;
  const sessionId = entry?.sessionId ?? originalRecord?.sessionId;
  const userId = entry?.userId ?? originalRecord?.userId;
  const orgId = entry?.orgId ?? originalRecord?.orgId;
  const input = entry?.input ?? originalRecord?.input;
  const originalMetadata = entry?.metadata ?? originalRecord?.metadata;

  if (flowKind === undefined || actionName === undefined || userId === undefined) {
    throw new Error(
      `Cannot retry request ${options.originalRequestId}: missing flow/action/user info`
    );
  }

  const flow = flowRegistry.get(flowKind);
  if (flow === undefined) {
    throw new Error(`Cannot retry request ${options.originalRequestId}: unknown flow "${flowKind}"`);
  }

  const newRequestId = generateId("req");
  const liveStream = createLiveRequestStream({ requestId: newRequestId });

  if (!canRegisterStream()) {
    throw new Error("Server is at active stream capacity");
  }

  registerStream(newRequestId, liveStream);

  void runAction({
    flow,
    actionName: actionName as keyof typeof flow.actions & string,
    input,
    userId,
    sessionId,
    requestId: newRequestId,
    orgId,
    metadata: {
      ...(originalMetadata ?? {}),
      retryOf: options.originalRequestId
    },
    modelResolver: options.modelResolver,
    speechResolver: options.speechResolver,
    middleware: options.middleware,
    stores,
    responseEmitter: liveStream.emitter,
    logger
  }).finally(() => {
    liveStream.close();
    removeStream(newRequestId);
  });

  logRuntimeEvent(logger, "info", "[flow-state] retrying interrupted request", {
    originalRequestId: options.originalRequestId,
    newRequestId,
    flowKind,
    actionName,
    sessionId
  });

  return { newRequestId, liveStream };
}
