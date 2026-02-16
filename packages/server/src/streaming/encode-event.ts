import type { StreamEvent } from "@flow-state-dev/core/items";
import { serializeSSEFrame } from "./sse";

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

export function encodeStreamEvent(event: StreamEvent): string {
  return serializeSSEFrame({
    id: createStreamEventId(event),
    event: event.type,
    data: event
  });
}
