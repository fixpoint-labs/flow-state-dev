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
import { encodeStreamEvent } from "../streaming/encode-event";
import { replayRequestEvents } from "../streaming/resume";
import {
  buildReplayEvents,
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

  const activeStream = getActiveStream(route.requestId);
  if (activeStream !== undefined) {
    return new Response(activeStream.readable, {
      status: 200,
      headers: SSE_HEADERS
    });
  }

  const requestRecord = await ctx.stores.request.get(route.requestId);
  if (
    requestRecord === undefined ||
    requestRecord.flowKind !== flow.kind
  ) {
    return jsonResponse(404, {
      error: `Unknown request "${route.requestId}"`
    });
  }

  const url = new URL(request.url);
  const replay = replayRequestEvents({
    requestId: route.requestId,
    events: buildReplayEvents(requestRecord),
    lastEventId: request.headers.get("last-event-id"),
    startingAfter: url.searchParams.get("starting_after")
  });
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
