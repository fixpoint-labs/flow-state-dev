/**
 * Typed stream envelope used by storage/encoding paths.
 */
import type { StreamEvent } from "@flow-state-dev/core/items";

export type StreamEnvelope<TEvent extends StreamEvent = StreamEvent> = {
  id: string;
  event: TEvent;
};

/**
 * Builds a stream envelope with id.
 */
export function createStreamEnvelope<TEvent extends StreamEvent>(
  event: TEvent,
  id: string
): StreamEnvelope<TEvent> {
  return { id, event };
}
