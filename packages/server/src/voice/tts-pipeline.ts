/**
 * Server-side TTS pipeline that intercepts content deltas and emits
 * OutputAudioContent on sentence boundaries. Runs alongside text streaming.
 */
import type { OutputAudioContent } from "@flow-state-dev/core/items";
import type { SpeechModel, SpeechResolver, TTSConfig } from "@flow-state-dev/core/types";
import type { ResponseEmitter } from "../streaming/response-emitter";
import { uint8ArrayToBase64 } from "../streaming/binary";
import { createSentenceBuffer, type SentenceBuffer } from "./sentence-buffer";

/** Maximum number of concurrent TTS API calls. */
const MAX_CONCURRENCY = 3;
/** Per-sentence synthesis timeout in milliseconds. */
const SYNTHESIS_TIMEOUT_MS = 15_000;

export type TTSPipelineOptions = {
  config: TTSConfig;
  speechResolver?: SpeechResolver;
  emitter: ResponseEmitter;
};

export type TTSPipeline = {
  /** Called when a content delta arrives for an assistant message item. */
  onContentDelta(itemId: string, contentIndex: number, delta: string): void;
  /** Called when the stream finishes to flush remaining buffered text. */
  flush(itemId: string): Promise<void>;
  /** Wait for all pending synthesis to complete. */
  drain(): Promise<void>;
};

/**
 * Creates a TTS pipeline that synthesizes audio from text content deltas.
 * The pipeline buffers text and dispatches to SpeechModel.generate() on
 * sentence boundaries, emitting OutputAudioContent as additional content
 * parts on the message item.
 *
 * Synthesis calls are launched concurrently (up to MAX_CONCURRENCY) for
 * speed, but results are emitted strictly in sentence order via a per-item
 * emission chain.
 */
export function createTTSPipeline(options: TTSPipelineOptions): TTSPipeline {
  const speechModel = resolveSpeechModel(options.config, options.speechResolver);
  const buffers = new Map<string, SentenceBuffer>();
  const contentIndexes = new Map<string, number>();

  // Per-item emission chain ensures audio chunks are emitted in sentence
  // order even though synthesis calls run concurrently.
  const emitChains = new Map<string, Promise<void>>();

  // Concurrency limiter: limits the number of in-flight TTS API calls.
  let inFlight = 0;
  const waiting: Array<() => void> = [];

  async function acquireSlot(): Promise<void> {
    if (inFlight < MAX_CONCURRENCY) {
      inFlight++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
    inFlight++;
  }

  function releaseSlot(): void {
    inFlight--;
    const next = waiting.shift();
    if (next !== undefined) {
      next();
    }
  }

  function getBuffer(itemId: string): SentenceBuffer {
    let buf = buffers.get(itemId);
    if (buf === undefined) {
      buf = createSentenceBuffer();
      buffers.set(itemId, buf);
    }
    return buf;
  }

  function getNextContentIndex(itemId: string): number {
    const current = contentIndexes.get(itemId) ?? 99;
    const next = current + 1;
    contentIndexes.set(itemId, next);
    return next;
  }

  type SynthesisResult = {
    audio: string;
    mediaType: string;
    transcript: string;
    duration?: number;
  };

  /**
   * Pure synthesis — acquires a concurrency slot, calls the speech model
   * with a timeout, and returns the result. Returns null on failure so a
   * single bad sentence doesn't break the chain.
   */
  async function synthesize(text: string): Promise<SynthesisResult | null> {
    await acquireSlot();
    try {
      const result = await withTimeout(
        speechModel.generate({
          text,
          voice: options.config.voice,
          speed: options.config.speed,
          outputFormat: "mp3"
        }),
        SYNTHESIS_TIMEOUT_MS
      );
      return {
        audio: uint8ArrayToBase64(result.audio),
        mediaType: result.mediaType,
        transcript: text
      };
    } catch {
      return null;
    } finally {
      releaseSlot();
    }
  }

  /**
   * Enqueue a sentence for synthesis and ordered emission.
   * The API call starts immediately (subject to concurrency limit), but
   * the emission waits for all prior sentences to emit first (ordered).
   */
  function enqueue(itemId: string, text: string): void {
    // Kick off synthesis immediately — no waiting for earlier sentences.
    const resultPromise = synthesize(text);

    // Chain only the emission so audio arrives at the client in order.
    const prev = emitChains.get(itemId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        const result = await resultPromise;
        if (result === null) {
          await options.emitter.emitDebug("tts.synthesis.error", {
            itemId,
            text: text.slice(0, 100),
            error: "synthesis failed or timed out"
          });
          return;
        }

        const audioContent: OutputAudioContent = {
          type: "output_audio",
          ephemeral: true,
          audio: result.audio,
          mediaType: result.mediaType,
          transcript: result.transcript
        };

        const contentIndex = getNextContentIndex(itemId);
        await options.emitter.emitContentAdded(itemId, contentIndex, audioContent);
        await options.emitter.emitContentDone(itemId, contentIndex, audioContent);
      } catch (error) {
        // Swallow emission errors so subsequent sentences still emit.
        try {
          await options.emitter.emitDebug("tts.emission.error", {
            itemId,
            text: text.slice(0, 100),
            error: error instanceof Error ? error.message : String(error)
          });
        } catch {
          // Last resort: prevent chain breakage.
        }
      }
    });

    emitChains.set(itemId, next);
  }

  return {
    onContentDelta(itemId: string, _contentIndex: number, delta: string) {
      const buffer = getBuffer(itemId);
      const sentences = buffer.append(delta);

      for (const sentence of sentences) {
        enqueue(itemId, sentence);
      }
    },

    async flush(itemId: string) {
      const buffer = buffers.get(itemId);
      if (buffer === undefined) {
        return;
      }

      const remaining = buffer.flush();
      if (remaining !== undefined) {
        enqueue(itemId, remaining);
      }

      buffers.delete(itemId);

      // Wait for this item's emission chain to finish.
      const chain = emitChains.get(itemId);
      if (chain !== undefined) {
        await chain;
      }
    },

    async drain() {
      await Promise.allSettled([...emitChains.values()]);
      emitChains.clear();
    }
  };
}

function resolveSpeechModel(
  config: TTSConfig,
  speechResolver?: SpeechResolver
): SpeechModel {
  if (typeof config.model !== "string") {
    return config.model;
  }

  if (speechResolver === undefined) {
    throw new Error(
      `TTS config uses model ID "${config.model}" but no speechResolver is configured`
    );
  }

  return speechResolver(config.model);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
