/**
 * Server-side TTS pipeline that intercepts content deltas and emits
 * OutputAudioContent on sentence boundaries. Runs alongside text streaming.
 */
import type { OutputAudioContent } from "@flow-state-dev/core/items";
import type { SpeechModel, SpeechResolver, TTSConfig } from "@flow-state-dev/core/types";
import type { ResponseEmitter } from "../streaming/response-emitter";
import { createSentenceBuffer, type SentenceBuffer } from "./sentence-buffer";

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
 */
export function createTTSPipeline(options: TTSPipelineOptions): TTSPipeline {
  const speechModel = resolveSpeechModel(options.config, options.speechResolver);
  const buffers = new Map<string, SentenceBuffer>();
  const contentIndexes = new Map<string, number>();
  const pending: Promise<void>[] = [];

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

  async function synthesizeAndEmit(itemId: string, text: string): Promise<void> {
    try {
      const result = await speechModel.generate({
        text,
        voice: options.config.voice,
        speed: options.config.speed,
        outputFormat: "mp3"
      });

      const base64Audio = uint8ArrayToBase64(result.audio);

      const audioContent: OutputAudioContent = {
        type: "output_audio",
        audio: base64Audio,
        mediaType: result.mediaType,
        transcript: text,
        duration: result.duration
      };

      const contentIndex = getNextContentIndex(itemId);
      await options.emitter.emitContentAdded(itemId, contentIndex, audioContent);
      await options.emitter.emitContentDone(itemId, contentIndex, audioContent);
    } catch (error) {
      // TTS failures should not break the text stream.
      // Log and continue.
      await options.emitter.emitDebug("tts.synthesis.error", {
        itemId,
        text: text.slice(0, 100),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    onContentDelta(itemId: string, _contentIndex: number, delta: string) {
      const buffer = getBuffer(itemId);
      const sentences = buffer.append(delta);

      for (const sentence of sentences) {
        const p = synthesizeAndEmit(itemId, sentence);
        pending.push(p);
      }
    },

    async flush(itemId: string) {
      const buffer = buffers.get(itemId);
      if (buffer === undefined) {
        return;
      }

      const remaining = buffer.flush();
      if (remaining !== undefined) {
        const p = synthesizeAndEmit(itemId, remaining);
        pending.push(p);
        await p;
      }

      buffers.delete(itemId);
    },

    async drain() {
      await Promise.allSettled(pending);
      pending.length = 0;
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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
