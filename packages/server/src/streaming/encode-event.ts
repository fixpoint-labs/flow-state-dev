import type { StreamEvent } from "@flow-state-dev/core/items";
import {
  applyEnvelopeSeam,
  NOOP_INTERNAL_STREAMING_SEAMS,
  type InternalStreamingSeams
} from "./internal/seams";
import { serializeSSEFrame } from "./sse";
import { createStreamEnvelope } from "./types";

export function createRequestEventId(
  requestId: string,
  sequenceNumber: number
): string {
  return `${requestId}:${sequenceNumber}`;
}

export function createUserEventId(
  userId: string,
  sequenceNumber: number
): string {
  return `${userId}:${sequenceNumber}`;
}

export function createStreamEventId(event: StreamEvent): string {
  if (event.stream === "request") {
    return createRequestEventId(event.requestId, event.sequence_number);
  }

  return createUserEventId(event.userId, event.sequence_number);
}

export type EncodeStreamEventInternalOptions = {
  internalSeams?: InternalStreamingSeams;
};

export function encodeStreamEvent(event: StreamEvent): string {
  return encodeStreamEventInternal(event, {
    internalSeams: NOOP_INTERNAL_STREAMING_SEAMS
  });
}

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
