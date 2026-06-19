/**
 * SSE streaming and transcription route handlers.
 *
 * Live tail is store-driven (FIX-569): `store.request.subscribeToEvents`
 * yields catch-up + live events for in-flight requests, regardless of which
 * instance is hosting the runner. The completed-request flat-string replay
 * branch is unchanged.
 */
import type { VoiceErrorKind, VoiceProvider } from "@flow-state-dev/core/types";
import { canTranscribe, VoiceError } from "@flow-state-dev/core/types";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { FlowRegistry } from "../registry/flow-registry";
import type { RequestRecord, StoreRegistry } from "../stores/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
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
  isTerminalRequestStatus,
  isTerminalRequestStreamEvent
} from "../stores/subscribe-helpers";
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
  voiceProvider?: VoiceProvider;
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

  // A held continuation lease means a same-request continuation (resume /
  // crash-recovery `continue`) is in flight under this id (FIX-811). A
  // `suspended` record with an active lease must therefore be live-tailed and
  // followed THROUGH the run-1 suspension to the continuation's real terminal,
  // not one-shot replayed as a settled pause. Without a lease, `suspended` is a
  // genuine pause and falls through to the terminal-replay branch below.
  const lease = await ctx.stores.leases.get(route.requestId);
  const leaseHeld = lease !== null;

  // Live-tail branch: a known-in-flight request — or a suspended one with an
  // active continuation — streams via subscribeToEvents.
  if (
    requestRecord !== undefined &&
    (!isTerminalRequestStatus(requestRecord.status) ||
      (requestRecord.status === "suspended" && leaseHeld))
  ) {
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
        livenessTimeoutMs: resolveLivenessTimeoutMs(),
        // While a continuation lease is held, follow through `request.suspended`
        // (the run-1 suspension being continued past) instead of ending there.
        followThroughSuspend: leaseHeld
      }
    );

    void pumpSubscription(subscription, handle, shouldForward, {
      followThroughSuspend: leaseHeld,
      // On a `request.suspended` while following a continuation, end the stream
      // only once the lease has been released — i.e. the continuation reached a
      // terminal or RE-suspended (a fresh pause). A still-held lease means this
      // is the run-1 suspension we're continuing past; keep following.
      isLeaseHeld: async () =>
        (await ctx.stores.leases.get(route.requestId)) !== null
    });

    return new Response(handle.readable, {
      status: 200,
      headers: SSE_HEADERS
    });
  }

  // No record AND no events: 404. The completed-request branch below covers
  // the case where a record was GC'd but events survive.
  if (requestRecord === undefined) {
    const cursor = resolveRequestReplayCursor({
      requestId: route.requestId,
      lastEventId: request.headers.get("last-event-id"),
      startingAfter: url.searchParams.get("starting_after")
    });
    // Read only events past the resume cursor — pre-cursor events are never
    // pulled from the store.
    const events = await ctx.stores.request.getEvents(
      route.requestId,
      cursor.sequenceNumber
    );
    if (events.length === 0) {
      // Without a cursor, an empty read means the request is genuinely
      // unknown → 404. With a cursor, the resuming client already consumed
      // the whole log; there's just nothing new, so return an empty 200
      // rather than a spurious 404.
      if (cursor.sequenceNumber === undefined) {
        return jsonResponse(404, {
          error: `Unknown request "${route.requestId}"`
        });
      }
      return new Response("", { status: 200, headers: SSE_HEADERS });
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

  // Terminal request: completed-request flat-string replay. The request record
  // keeps a bare sessionId + tenantId (FIX-682); namespace the lookup from the
  // record itself so no request header is needed on the attach path.
  const session =
    requestRecord.sessionId !== undefined
      ? await ctx.stores.session.get(
          resolveSessionStorageKey(requestRecord.sessionId, requestRecord.tenantId)
        )
      : undefined;

  const cursor = resolveRequestReplayCursor({
    requestId: route.requestId,
    lastEventId: request.headers.get("last-event-id"),
    startingAfter: url.searchParams.get("starting_after")
  });

  // Prefer persisted canonical event history for cursor-accurate replay,
  // reading only events past the resume cursor. Fall back to item-based
  // reconstruction only when the *unfiltered* log is empty (no cursor and no
  // persisted events). A cursor that filters every event means the client
  // already has the whole stream, so deliver nothing new — never reconstruct.
  let replaySource = await ctx.stores.request.getEvents(
    route.requestId,
    cursor.sequenceNumber
  );
  if (replaySource.length === 0 && cursor.sequenceNumber === undefined) {
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
  shouldForward: ((event: { type: string }) => boolean) | undefined,
  followOptions?: {
    followThroughSuspend?: boolean;
    isLeaseHeld?: () => Promise<boolean>;
  }
): Promise<void> {
  try {
    for await (const event of subscription) {
      if (handle.closed) break;
      if (shouldEmitToWire(event, shouldForward)) {
        handle.writeRaw(encodeStreamEvent(event));
      }
      if (isTerminalRequestStreamEvent(event)) {
        // FIX-811: while following a continuation, `request.suspended` is a
        // checkpoint, not the end — keep following while the lease is held; end
        // only once it's released (continuation reached terminal or re-suspended).
        if (
          event.type === "request.suspended" &&
          followOptions?.followThroughSuspend === true
        ) {
          const stillRunning = followOptions.isLeaseHeld
            ? await followOptions.isLeaseHeld()
            : false;
          if (stillRunning) continue;
        }
        break;
      }
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
  if (ctx.voiceProvider === undefined) {
    return jsonResponse(501, { error: "transcription_not_configured" });
  }
  if (!canTranscribe(ctx.voiceProvider)) {
    return jsonResponse(501, {
      error: "provider_does_not_support_transcription"
    });
  }
  const provider = ctx.voiceProvider;

  const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

  const contentType = request.headers.get("content-type") ?? "";
  let audioData: Uint8Array;
  let mediaType: string;
  let language: string | undefined;
  let requestModel: string | undefined;

  if (contentType.includes("application/json")) {
    const body = await parseJsonBody(request);
    const userId = getString(body.userId as string | undefined);
    if (userId === undefined) {
      return jsonResponse(400, {
        error: "Transcription requires non-empty userId"
      });
    }
    requestModel = getString(body.model as string | undefined);
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
    requestModel = getString(url.searchParams.get("model"));
  }

  // Resolve the model: per-request `model` wins, then the provider's default.
  // An empty string is treated as falsy. No framework-level default literal.
  const model = requestModel || provider.defaultModels?.transcribe;
  if (!model) {
    return jsonResponse(400, {
      error: "no_model",
      message:
        "Request did not specify a model and the provider has no defaultModels.transcribe."
    });
  }

  try {
    const result = await provider.transcribe({
      audio: audioData,
      mediaType,
      language,
      model,
      signal: request.signal
    });
    return jsonResponse(200, {
      text: result.text,
      language: result.language
    });
  } catch (error) {
    if (error instanceof VoiceError) {
      return jsonResponse(voiceErrorToHttpStatus(error.kind), {
        error: error.kind,
        message: error.message
      });
    }
    throw error;
  }
}

/**
 * Maps a {@link VoiceErrorKind} to the HTTP status returned by the transcribe
 * endpoint. `aborted` uses nginx's 499 ("client closed request") convention.
 */
export function voiceErrorToHttpStatus(kind: VoiceErrorKind): number {
  switch (kind) {
    case "auth":
      return 401;
    case "rate_limit":
      return 429;
    case "not_found":
      return 404;
    case "invalid_input":
      return 400;
    case "format_unsupported":
      return 415;
    case "provider_unavailable":
      return 503;
    case "network":
      return 502;
    case "aborted":
      return 499;
    case "unknown":
      return 500;
  }
}

