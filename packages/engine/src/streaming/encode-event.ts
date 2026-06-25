/**
 * Streaming event encoding utilities for SSE transport.
 */
import type { StreamEvent } from "@flow-state-dev/core/items";
import {
  applyEnvelopeSeam,
  NOOP_INTERNAL_STREAMING_SEAMS,
  type InternalStreamingSeams
} from "./internal/seams";
import { serializeSSEFrame } from "./sse";
import { createStreamEnvelope } from "./types";

/**
 * Builds a stable stream event id for request-scoped events.
 */
export function createRequestEventId(
  requestId: string,
  sequenceNumber: number
): string {
  return `${requestId}:${sequenceNumber}`;
}

/**
 * Builds a stable stream event id for user-scoped events.
 */
export function createUserEventId(
  userId: string,
  sequenceNumber: number
): string {
  return `${userId}:${sequenceNumber}`;
}

/**
 * Resolves the canonical stream event id for any stream event.
 */
export function createStreamEventId(event: StreamEvent): string {
  if (event.stream === "request") {
    return createRequestEventId(event.requestId, event.sequence_number);
  }

  return createUserEventId(event.userId, event.sequence_number);
}

export type EncodeStreamEventInternalOptions = {
  internalSeams?: InternalStreamingSeams;
};

/**
 * Encodes a stream event as a single SSE frame using default seams.
 */
export function encodeStreamEvent(event: StreamEvent): string {
  return encodeStreamEventInternal(event, {
    internalSeams: NOOP_INTERNAL_STREAMING_SEAMS
  });
}

/**
 * Encodes a stream event as a single SSE frame with optional internal seam interception.
 */
export function encodeStreamEventInternal(
  event: StreamEvent,
  options?: EncodeStreamEventInternalOptions
): string {
  const seams = options?.internalSeams ?? NOOP_INTERNAL_STREAMING_SEAMS;
  const envelope = applyEnvelopeSeam(
    seams,
    createStreamEnvelope(event, createStreamEventId(event)),
    "event.before_encode"
  );

  return serializeSSEFrame({
    id: envelope.id,
    event: envelope.event.type,
    data: envelope.event
  });
}
