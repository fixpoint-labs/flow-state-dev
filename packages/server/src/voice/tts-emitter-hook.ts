/**
 * Hooks into a ResponseEmitter's event stream to feed content deltas
 * into the TTS pipeline for streaming sentence-boundary synthesis.
 *
 * The hook intercepts three event types:
 *   - item.added    → registers assistant message items for TTS
 *   - content.delta  → feeds text into the sentence buffer → enqueues on boundaries
 *   - content.done   → flushes remaining buffered text so the last sentence
 *                       starts synthesis as soon as text streaming ends (not when
 *                       the entire action completes)
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import type { SpeechResolver, TTSConfig } from "@flow-state-dev/core/types";
import type { ResponseEmitter, RequestStreamEventWithId } from "../streaming/response-emitter";
import { createTTSPipeline, type TTSPipeline } from "./tts-pipeline";

export type TTSEmitterHook = {
  /** Called after each event is emitted. Intercepts content events for TTS. */
  onEvent(event: RequestStreamEventWithId): void;
  /** Wait for all pending synthesis to complete. */
  finalize(): Promise<void>;
};

/**
 * Creates a TTS hook that observes emitter events and feeds content deltas
 * into the TTS pipeline for assistant message items.
 */
export function createTTSEmitterHook(options: {
  config: TTSConfig;
  speechResolver?: SpeechResolver;
  emitter: ResponseEmitter;
}): TTSEmitterHook {
  const pipeline = createTTSPipeline({
    config: options.config,
    speechResolver: options.speechResolver,
    emitter: options.emitter
  });

  // Track which items are assistant messages
  const assistantMessageIds = new Set<string>();
  // Track items that have been flushed so we don't flush twice
  const flushedItemIds = new Set<string>();

  return {
    onEvent(event: RequestStreamEventWithId) {
      // Track assistant message items
      if (event.type === "item.added") {
        const item = (event as any).item as OutputItem;
        if (item.type === "message" && (item as MessageItem).role === "assistant") {
          assistantMessageIds.add(item.id);
        }
      }

      // Feed content deltas from assistant messages into TTS
      if (event.type === "content.delta") {
        const deltaEvent = event as any;
        if (assistantMessageIds.has(deltaEvent.itemId)) {
          pipeline.onContentDelta(
            deltaEvent.itemId,
            deltaEvent.contentIndex,
            deltaEvent.delta
          );
        }
      }

      // When a content part finishes, flush remaining buffered text so the
      // last sentence starts synthesis immediately instead of waiting for
      // finalize(). This fires as each content part completes during
      // streaming, significantly reducing time-to-first-audio for the
      // final sentence.
      if (event.type === "content.done") {
        const doneEvent = event as any;
        if (
          assistantMessageIds.has(doneEvent.itemId) &&
          !flushedItemIds.has(doneEvent.itemId)
        ) {
          flushedItemIds.add(doneEvent.itemId);
          // Fire-and-forget: flush starts synthesis but we don't block the
          // event observer. finalize() will still await the emission chain.
          void pipeline.flush(doneEvent.itemId);
        }
      }
    },

    async finalize() {
      // Flush any items that didn't receive a content.done event
      for (const itemId of assistantMessageIds) {
        if (!flushedItemIds.has(itemId)) {
          await pipeline.flush(itemId);
        }
      }
      await pipeline.drain();
    }
  };
}
