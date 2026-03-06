/**
 * Hooks into a ResponseEmitter's event stream to feed content deltas
 * into the TTS pipeline for streaming sentence-boundary synthesis.
 */
import type { MessageItem, OutputItem } from "@flow-state-dev/core/items";
import type { SpeechResolver, TTSConfig } from "@flow-state-dev/core/types";
import type { ResponseEmitter, RequestStreamEventWithId } from "../streaming/response-emitter";
import { createTTSPipeline, type TTSPipeline } from "./tts-pipeline";

export type TTSEmitterHook = {
  /** Called after each event is emitted. Intercepts content.delta for TTS. */
  onEvent(event: RequestStreamEventWithId): void;
  /** Flush remaining buffered text and wait for all synthesis to complete. */
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
    },

    async finalize() {
      // Flush all tracked assistant message buffers
      for (const itemId of assistantMessageIds) {
        await pipeline.flush(itemId);
      }
      await pipeline.drain();
    }
  };
}
