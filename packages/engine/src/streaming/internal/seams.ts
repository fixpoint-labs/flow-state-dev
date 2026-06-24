/**
 * Internal streaming seam hooks for item/envelope interception.
 */
import type { OutputItem, StreamEvent } from "@flow-state-dev/core/items";
import type { StreamEnvelope } from "../types";

export type InternalItemInterceptionStage = "item.added" | "item.done";
export type InternalEnvelopeInterceptionStage =
  | "event.before_store"
  | "event.before_encode";

export type InternalStreamingSeams = {
  interceptItem?: <TItem extends OutputItem>(
    item: TItem,
    stage: InternalItemInterceptionStage
  ) => TItem | void;
  interceptEnvelope?: <TEvent extends StreamEvent>(
    envelope: StreamEnvelope<TEvent>,
    stage: InternalEnvelopeInterceptionStage
  ) => StreamEnvelope<TEvent> | void;
};

/**
 * Default seam set with no behavior changes.
 */
export const NOOP_INTERNAL_STREAMING_SEAMS: InternalStreamingSeams = {};

/**
 * Applies optional item interception.
 */
export function applyItemSeam<TItem extends OutputItem>(
  seams: InternalStreamingSeams | undefined,
  item: TItem,
  stage: InternalItemInterceptionStage
): TItem {
  const intercepted = seams?.interceptItem?.(item, stage);
  return (intercepted ?? item) as TItem;
}

/**
 * Applies optional envelope interception.
 */
export function applyEnvelopeSeam<TEvent extends StreamEvent>(
  seams: InternalStreamingSeams | undefined,
  envelope: StreamEnvelope<TEvent>,
  stage: InternalEnvelopeInterceptionStage
): StreamEnvelope<TEvent> {
  const intercepted = seams?.interceptEnvelope?.(envelope, stage);
  return intercepted ?? envelope;
}
