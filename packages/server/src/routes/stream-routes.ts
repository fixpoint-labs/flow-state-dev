/**
 * SSE streaming and transcription route handlers.
 */
import type { TranscriptionResolver } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  cleanupStaleStreams,
  getActiveStream
} from "../streaming/active-streams";
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
import {
  buildReplayEvents,
  getBooleanFlag,
  getString,
  jsonResponse,
  parseJsonBody,
  SSE_HEADERS
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

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

export async function handleRequestStream(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "request_stream" }>,
  ctx: StreamRouteContext
): Promise<Response> {
  cleanupStaleStreams();
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

  const activeStream = getActiveStream(route.requestId);
  if (activeStream !== undefined) {
    // Resolve cursor from request headers/params.
    const cursor = resolveRequestReplayCursor({
      requestId: route.requestId,
      lastEventId: request.headers.get("last-event-id"),
      startingAfter: url.searchParams.get("starting_after")
    });

    // Both the buffered replay and the live observer feed write to one
    // SSEStreamHandle — the dual-`ReadableStream` smell from the old
    // implementation goes away; framing, heartbeat, and lifecycle live
    // inside the handle.
    const minSeq = cursor.sequenceNumber ?? -1;
    const emitter = activeStream.emitter;
    const shouldForward = includeTrace ? undefined : createClientEventFilter();

    const handle = createSSEStream({ pingIntervalMs: sseHeartbeatMs });

    // 1. Replay buffered events after the cursor.
    // FIX-479: content.delta is non-replayable. The reconnecting client
    // snaps forward to the latest item snapshot from item.added/done
    // payloads; it picks up live deltas from the observer (step 2) onward.
    const buffered = emitter.getEvents();
    for (const event of buffered) {
      if (event.sequence_number <= minSeq) continue;
      if (
        event.type === "ping" ||
        event.type === "debug" ||
        event.type === "content.delta"
      ) {
        continue;
      }
      if (shouldForward && !shouldForward(event)) continue;
      handle.writeRaw(encodeStreamEvent(event));
    }

    // 2. Subscribe to new events going forward. content.delta is forwarded
    // live here — the resume contract drops only the historical (buffered)
    // deltas, not the in-flight stream.
    emitter.addEventObserver((event) => {
      if (handle.closed) return;
      if (event.sequence_number <= minSeq) return;
      if (event.type === "ping" || event.type === "debug") return;
      if (shouldForward && !shouldForward(event)) return;
      handle.writeRaw(encodeStreamEvent(event));

      // Close on terminal status. The handle's writes after close are
      // no-ops, so any racing observer firings are safely dropped.
      const status = (event as { status?: string }).status;
      if (
        event.type === "request.completed" ||
        event.type === "request.failed" ||
        event.type === "request.incomplete" ||
        event.type === "request.aborted" ||
        (event.type === "request.interrupted" && status === "interrupted")
      ) {
        handle.close();
      }
    });

    return new Response(handle.readable, {
      status: 200,
      headers: SSE_HEADERS
    });
  }

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

  // If the record still doesn't exist, check whether events were persisted
  // (events are written before the main record via incremental persistence hooks).
  if (requestRecord === undefined) {
    const events = await ctx.stores.request.getEvents(route.requestId);
    if (events.length > 0) {
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
  }

  if (
    requestRecord === undefined ||
    requestRecord.flowKind !== flow.kind
  ) {
    return jsonResponse(404, {
      error: `Unknown request "${route.requestId}"`
    });
  }

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
