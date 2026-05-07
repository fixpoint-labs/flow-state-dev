/**
 * SSE streaming and transcription route handlers.
 *
 * Live tail is store-driven (FIX-569): `store.request.subscribeToEvents`
 * yields catch-up + live events for in-flight requests, regardless of which
 * instance is hosting the runner. The completed-request flat-string replay
 * branch is unchanged.
 */
import type { TranscriptionResolver } from "@flow-state-dev/core/types";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { FlowRegistry } from "../registry/flow-registry";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import {
  createClientEventFilter,
  filterClientEvents
} from "../streaming/client-filter";
import { encodeStreamEvent } from "../streaming/encode-event";
import {
  resolveRequestReplayCursor,
  replayRequestEvents
} from "../streaming/resume";
import { createSSEStream } from "../streaming/sse-stream";
import { isTerminalRequestStreamEvent } from "../stores/subscribe-helpers";
import {
  buildReplayEvents,
  getString,
  jsonResponse,
  parseJsonBody,
  SSE_HEADERS
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

/** Default cross-process liveness timeout — overridable via `LIVE_TAIL_LIVENESS_MS`. */
const DEFAULT_LIVE_TAIL_LIVENESS_MS = 30_000;

function resolveLivenessTimeoutMs(): number {
  const raw = process.env.LIVE_TAIL_LIVENESS_MS;
  if (raw === undefined || raw === "") return DEFAULT_LIVE_TAIL_LIVENESS_MS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIVE_TAIL_LIVENESS_MS;
}

type StreamRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  transcriptionResolver?: TranscriptionResolver;
  /**
   * Default SSE wire heartbeat interval in milliseconds. Applied to GET
   * attach streams when the per-flow `request.sseHeartbeatMs` is unset.
   */
  defaultSseHeartbeatMs?: number;
};

/**
 * Whether an event should reach the SSE wire. Drops internal-only types
 * (`ping`, `debug`). Trace-channel filtering is applied via the optional
 * `shouldForward` predicate (`?include=trace` keeps it undefined, retaining
 * trace events).
 */
function shouldEmitToWire(
  event: { type: string },
  shouldForward: ((event: { type: string }) => boolean) | undefined
): boolean {
  if (event.type === "ping" || event.type === "debug") return false;
  if (shouldForward && !shouldForward(event)) return false;
  return true;
}

/** Whether a request status is past the in-flight phase. */
function isTerminalStatus(status: RequestRecord["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "incomplete" ||
    status === "interrupted" ||
    status === "aborted"
  );
}

export async function handleRequestStream(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "request_stream" }>,
  ctx: StreamRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${route.flowKind}"`
    });
  }

  const url = new URL(request.url);
  const includeTrace = url.searchParams.get("include") === "trace";

  // Per-flow heartbeat override wins over the host-level default.
  const flowHeartbeatMs = flow.request?.sseHeartbeatMs;
  const sseHeartbeatMs =
    flowHeartbeatMs !== undefined ? flowHeartbeatMs : ctx.defaultSseHeartbeatMs;

  let requestRecord = await ctx.stores.request.get(route.requestId);

  // On serverless platforms the POST (action execution) and GET (stream) may
  // land on different instances. The request record might not be persisted yet
  // if createExecutionContext is still running. Check the active_requests
  // registry (written earlier in the runAction lifecycle) and wait briefly.
  if (requestRecord === undefined) {
    const active = await ctx.stores.activeRequests.get(route.requestId);
    if (active !== undefined) {
      // Request is in-flight — wait for the record to appear.
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
        requestRecord = await ctx.stores.request.get(route.requestId);
        if (requestRecord !== undefined) break;
      }
    }
  }

  // Live-tail branch: a known-in-flight request streams via subscribeToEvents.
  if (requestRecord !== undefined && !isTerminalStatus(requestRecord.status)) {
    if (requestRecord.flowKind !== flow.kind) {
      return jsonResponse(404, {
        error: `Unknown request "${route.requestId}"`
      });
    }

    const cursor = resolveRequestReplayCursor({
      requestId: route.requestId,
      lastEventId: request.headers.get("last-event-id"),
      startingAfter: url.searchParams.get("starting_after")
    });

    const fromSequence = cursor.sequenceNumber ?? 0;
    const shouldForward = includeTrace ? undefined : createClientEventFilter();
    const handle = createSSEStream({
      pingIntervalMs: sseHeartbeatMs,
      signal: request.signal
    });

    const subscription = ctx.stores.request.subscribeToEvents(
      route.requestId,
      {
        fromSequence,
        signal: request.signal,
        livenessTimeoutMs: resolveLivenessTimeoutMs()
      }
    );

    void pumpSubscription(subscription, handle, shouldForward);

    return new Response(handle.readable, {
      status: 200,
      headers: SSE_HEADERS
    });
  }

  // No record AND no events: 404. The completed-request branch below covers
  // the case where a record was GC'd but events survive.
  if (requestRecord === undefined) {
    const events = await ctx.stores.request.getEvents(route.requestId);
    if (events.length === 0) {
      return jsonResponse(404, {
        error: `Unknown request "${route.requestId}"`
      });
    }
    let replay = replayRequestEvents({
      requestId: route.requestId,
      events,
      lastEventId: request.headers.get("last-event-id"),
      startingAfter: url.searchParams.get("starting_after")
    });
    if (!includeTrace) replay = filterClientEvents(replay);
    const payload = replay.map((event) => encodeStreamEvent(event)).join("");
    return new Response(payload, { status: 200, headers: SSE_HEADERS });
  }

  if (requestRecord.flowKind !== flow.kind) {
    return jsonResponse(404, {
      error: `Unknown request "${route.requestId}"`
    });
  }

  // Terminal request: completed-request flat-string replay (unchanged).
  const session =
    requestRecord.sessionId !== undefined
      ? await ctx.stores.session.get(requestRecord.sessionId)
      : undefined;

  // Prefer persisted canonical event history for cursor-accurate replay.
  // Fall back to item-based reconstruction if no events have been persisted.
  let replaySource = await ctx.stores.request.getEvents(route.requestId);
  if (replaySource.length === 0) {
    replaySource = buildReplayEvents(requestRecord, session);
  }

  let replay = replayRequestEvents({
    requestId: route.requestId,
    events: replaySource,
    lastEventId: request.headers.get("last-event-id"),
    startingAfter: url.searchParams.get("starting_after")
  });
  if (!includeTrace) replay = filterClientEvents(replay);
  const payload = replay.map((event) => encodeStreamEvent(event)).join("");

  return new Response(payload, {
    status: 200,
    headers: SSE_HEADERS
  });
}

/**
 * Drains the store subscription onto the SSE handle. Errors thrown from the
 * iterator (e.g. `StoreSubscriptionError`) close the wire after a best-effort
 * encoded error frame. Terminal events (including the synthetic
 * `request.interrupted` from the liveness timeout) close the wire after
 * yielding.
 */
async function pumpSubscription(
  subscription: AsyncIterableIterator<RequestStreamEvent>,
  handle: ReturnType<typeof createSSEStream>,
  shouldForward: ((event: { type: string }) => boolean) | undefined
): Promise<void> {
  try {
    for await (const event of subscription) {
      if (handle.closed) break;
      if (!shouldEmitToWire(event, shouldForward)) continue;
      handle.writeRaw(encodeStreamEvent(event));
      if (isTerminalRequestStreamEvent(event)) break;
    }
  } catch {
    // Swallow — the SSE consumer's `last-event-id` reconnect path is the
    // intended recovery channel. Logging here would leak internals to the
    // operator log without giving the client anything actionable.
  } finally {
    handle.close();
  }
}

export async function handleTranscribe(
  request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "transcribe" }>,
  ctx: StreamRouteContext
): Promise<Response> {
  if (ctx.transcriptionResolver === undefined) {
    return jsonResponse(501, {
      error: "Transcription is not configured on this server"
    });
  }

  const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

  const contentType = request.headers.get("content-type") ?? "";
  let audioData: Uint8Array;
  let mediaType: string;
  let language: string | undefined;

  if (contentType.includes("application/json")) {
    const body = await parseJsonBody(request);
    const userId = getString(body.userId as string | undefined);
    if (userId === undefined) {
      return jsonResponse(400, {
        error: "Transcription requires non-empty userId"
      });
    }
    const audioBase64 = getString(body.audio as string | undefined);
    if (audioBase64 === undefined) {
      return jsonResponse(400, {
        error: "Transcription requires audio data (base64 in 'audio' field)"
      });
    }
    audioData = new Uint8Array(Buffer.from(audioBase64, "base64"));
    if (audioData.byteLength === 0) {
      return jsonResponse(400, {
        error: "Transcription requires non-empty audio data"
      });
    }
    if (audioData.byteLength > MAX_AUDIO_BYTES) {
      return jsonResponse(413, {
        error: `Audio payload exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
      });
    }
    mediaType = getString(body.mediaType as string | undefined) ?? "audio/webm";
    language = getString(body.language as string | undefined);
  } else {
    const url = new URL(request.url);
    const userId = getString(url.searchParams.get("userId"));
    if (userId === undefined) {
      return jsonResponse(400, {
        error: "Transcription requires non-empty userId query parameter"
      });
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const size = parseInt(contentLength, 10);
      if (!Number.isNaN(size) && size > MAX_AUDIO_BYTES) {
        return jsonResponse(413, {
          error: `Audio payload exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
        });
      }
    }

    const buffer = await request.arrayBuffer();
    if (buffer.byteLength === 0) {
      return jsonResponse(400, {
        error: "Transcription requires audio data in request body"
      });
    }
    if (buffer.byteLength > MAX_AUDIO_BYTES) {
      return jsonResponse(413, {
        error: `Audio payload exceeds maximum size of ${MAX_AUDIO_BYTES} bytes`
      });
    }
    audioData = new Uint8Array(buffer);
    mediaType = contentType.split(";")[0].trim() || "audio/webm";
    language = getString(url.searchParams.get("language"));
  }

  const model = ctx.transcriptionResolver("gpt-4o-mini-transcribe");
  const result = await model.transcribe({
    audio: audioData,
    mediaType,
    language
  });

  return jsonResponse(200, {
    text: result.text,
    language: result.language
  });
}

