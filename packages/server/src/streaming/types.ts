import type {
  ItemProvenance,
  ItemAddedEvent,
  ItemDoneEvent,
  StreamEvent
} from "@flow-state-dev/core/items";

export type StreamCorrelation = {
  stream: StreamEvent["stream"];
  streamId: string;
  sequenceNumber: number;
  eventType: StreamEvent["type"];
  ts: number;
  requestId?: string;
  userId?: string;
};

export type StreamEnvelope<TEvent extends StreamEvent = StreamEvent> = {
  id: string;
  event: TEvent;
  correlation: StreamCorrelation;
  provenance?: ItemProvenance;
};

function isItemEvent(event: StreamEvent): event is ItemAddedEvent | ItemDoneEvent {
  return event.type === "item.added" || event.type === "item.done";
}

export function createStreamCorrelation(event: StreamEvent): StreamCorrelation {
  if (event.stream === "request") {
    return {
      stream: "request",
      streamId: event.requestId,
      sequenceNumber: event.sequence_number,
      eventType: event.type,
      ts: event.ts,
      requestId: event.requestId
    };
  }

  return {
    stream: "user",
    streamId: event.userId,
    sequenceNumber: event.sequence_number,
    eventType: event.type,
    ts: event.ts,
    userId: event.userId
  };
}

export function extractEventProvenance(
  event: StreamEvent
): ItemProvenance | undefined {
  if (!isItemEvent(event)) {
    return undefined;
  }

  return event.item.provenance;
}

export function createStreamEnvelope<TEvent extends StreamEvent>(
  event: TEvent,
  id: string
): StreamEnvelope<TEvent> {
  return {
    id,
    event,
    correlation: createStreamCorrelation(event),
    provenance: extractEventProvenance(event)
  };
}
