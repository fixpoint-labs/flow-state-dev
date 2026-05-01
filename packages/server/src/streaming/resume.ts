/**
 * Cursor parsing and replay helpers for resumable request streams.
 */
import type { RequestStreamEvent } from "@flow-state-dev/core/items";

export type ParsedStreamEventId = {
  streamId: string;
  sequenceNumber: number;
};

export type ResumeCursorSource =
  | "starting_after"
  | "last_event_id"
  | "none";

export type ResolveRequestReplayCursorOptions = {
  requestId: string;
  lastEventId?: string | null;
  startingAfter?: number | string | null;
};

export type RequestReplayCursor = {
  source: ResumeCursorSource;
  sequenceNumber?: number;
};

function parseSequence(value: number | string | null | undefined): number | undefined {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      return undefined;
    }

    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

/**
 * Parses `starting_after` query/header input into a valid non-negative sequence.
 */
export function parseStartingAfter(
  value: number | string | null | undefined
): number | undefined {
  return parseSequence(value);
}

/**
 * Parses a stream event id in `<streamId>:<sequenceNumber>` format.
 */
export function parseStreamEventId(
  value: string | null | undefined
): ParsedStreamEventId | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return undefined;
  }

  const streamId = trimmed.slice(0, separatorIndex);
  const sequenceNumber = parseSequence(trimmed.slice(separatorIndex + 1));
  if (sequenceNumber === undefined) {
    return undefined;
  }

  return {
    streamId,
    sequenceNumber
  };
}

/**
 * Resolves replay cursor priority: `starting_after`, then `last_event_id`, then none.
 */
export function resolveRequestReplayCursor(
  options: ResolveRequestReplayCursorOptions
): RequestReplayCursor {
  const parsedStartingAfter = parseStartingAfter(options.startingAfter);
  if (parsedStartingAfter !== undefined) {
    return {
      source: "starting_after",
      sequenceNumber: parsedStartingAfter
    };
  }

  const parsedLastEvent = parseStreamEventId(options.lastEventId);
  if (
    parsedLastEvent !== undefined &&
    parsedLastEvent.streamId === options.requestId
  ) {
    return {
      source: "last_event_id",
      sequenceNumber: parsedLastEvent.sequenceNumber
    };
  }

  return {
    source: "none"
  };
}

export type ReplayRequestEventsOptions = ResolveRequestReplayCursorOptions & {
  events: RequestStreamEvent[];
};

/**
 * Returns events that occur after the resolved replay cursor.
 */
export function replayRequestEvents(
  options: ReplayRequestEventsOptions
): RequestStreamEvent[] {
  const cursor = resolveRequestReplayCursor(options);
  const minSequence = cursor.sequenceNumber ?? -1;

  const matching = options.events.filter(
    (event) => {
      if (event.requestId !== options.requestId) {
        return false;
      }

      if (event.sequence_number <= minSequence) {
        return false;
      }

      if (
        event.type === "ping" ||
        event.type === "debug" ||
        event.type === "content.delta"
      ) {
        return false;
      }

      return true;
    }
  );

  matching.sort((left, right) => left.sequence_number - right.sequence_number);
  return matching;
}
