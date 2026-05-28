/**
 * Server-side TTS pipeline that intercepts content deltas and emits synthesized
 * audio on sentence boundaries, running alongside text streaming.
 *
 * Dispatch is ability-gated: providers that advertise `speakStream` emit
 * chunked audio via `content.audio.delta` for low first-audio latency;
 * batch-only providers emit a whole-buffer `OutputAudioContent` snapshot.
 * Synthesis is best-effort — a failed sentence is reported as a non-fatal
 * debug event (carrying the `VoiceError` kind) and never interrupts text
 * streaming. Per-item emission order is preserved across concurrent synthesis.
 */
import type { OutputAudioContent } from "@flow-state-dev/core/items";
import type { SpeakChunk, TTSConfig, VoiceProvider } from "@flow-state-dev/core/types";
import { canSpeakStream, VoiceError } from "@flow-state-dev/core/types";
import type { ResponseEmitter } from "../streaming/response-emitter";
import { uint8ArrayToBase64 } from "../streaming/binary";
import { createSentenceBuffer, type SentenceBuffer } from "./sentence-buffer";

/** Maximum number of concurrent TTS API calls. */
const MAX_CONCURRENCY = 3;
/**
 * First-chunk / whole-call synthesis timeout in milliseconds. For streaming
 * this bounds time-to-first-chunk only; once audio is flowing there is no
 * per-chunk timer (request-level abort is the escape hatch). For batch it
 * bounds the whole `speak()` call.
 */
const SYNTHESIS_TIMEOUT_MS = 15_000;

/** Media type used for the durable snapshot when no chunk declared one. */
const DEFAULT_AUDIO_MEDIA_TYPE = "audio/mpeg";

export type TTSPipelineOptions = {
  config: TTSConfig;
  /** Voice provider; dispatch branches on `canSpeakStream(provider)`. */
  provider: VoiceProvider;
  emitter: ResponseEmitter;
  /** Request-level signal; threaded into provider calls so a client
   *  disconnect cancels in-flight synthesis. */
  signal?: AbortSignal;
};

export type TTSPipeline = {
  /** Called when a content delta arrives for an assistant message item. */
  onContentDelta(itemId: string, contentIndex: number, delta: string): void;
  /** Called when the stream finishes to flush remaining buffered text. */
  flush(itemId: string): Promise<void>;
  /** Wait for all pending synthesis to complete (success path). */
  drain(): Promise<void>;
  /**
   * Abandon in-flight synthesis (failure path): return active iterators,
   * settle pending emission chains, and release every concurrency slot.
   * Idempotent and safe to call alongside the chains' own cleanup.
   */
  cancel(): Promise<void>;
};

/** Error raised when a slot is requested after the pipeline was cancelled. */
class PipelineCancelledError extends Error {
  constructor() {
    super("TTS pipeline cancelled");
    this.name = "PipelineCancelledError";
  }
}

/**
 * Creates a TTS pipeline that synthesizes audio from text content deltas.
 * The pipeline buffers text and dispatches on sentence boundaries, emitting
 * audio either as streamed `content.audio.delta` chunks (streaming providers)
 * or as a whole-buffer `OutputAudioContent` part (batch providers).
 *
 * Synthesis calls run concurrently (up to MAX_CONCURRENCY), but results are
 * emitted strictly in sentence order via a per-item emission chain.
 */
export function createTTSPipeline(options: TTSPipelineOptions): TTSPipeline {
  const streaming = canSpeakStream(options.provider);
  const buffers = new Map<string, SentenceBuffer>();
  const contentIndexes = new Map<string, number>();

  // Per-item emission chain ensures audio is emitted in sentence order even
  // though synthesis calls run concurrently.
  const emitChains = new Map<string, Promise<void>>();

  // Iterators for in-flight streaming syntheses, so cancel() can return them.
  const activeIterators = new Set<AsyncIterator<SpeakChunk>>();

  // Fired by cancel(); composed into every streaming provider call so an
  // in-flight first-chunk pull or drain unblocks immediately.
  const cancelController = new AbortController();

  let cancelled = false;

  // Concurrency limiter: bounds in-flight TTS API calls.
  let inFlight = 0;
  const waiting: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  function acquireSlot(): Promise<void> {
    if (cancelled) return Promise.reject(new PipelineCancelledError());
    if (inFlight < MAX_CONCURRENCY) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      waiting.push({
        resolve: () => {
          inFlight++;
          resolve();
        },
        reject
      });
    });
  }

  function releaseSlot(): void {
    inFlight--;
    const next = waiting.shift();
    if (next !== undefined) {
      next.resolve();
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

  /**
   * Reports a synthesis failure as a non-fatal debug event. Non-`VoiceError`
   * throwables are normalized to a `VoiceError` of kind `unknown` so the
   * report always carries a typed kind. Text streaming is never interrupted.
   */
  async function reportSynthesisError(
    itemId: string,
    text: string,
    error: unknown
  ): Promise<void> {
    const voiceError =
      error instanceof VoiceError
        ? error
        : new VoiceError({
            kind: "unknown",
            provider: options.provider.providerName,
            message: error instanceof Error ? error.message : String(error),
            cause: error
          });

    // Log level by kind, per the FIX-528 error taxonomy: retryable kinds are
    // expected transient noise (info), `aborted` is routine (debug), `unknown`
    // is a contract violation (error), everything else is a hard fail (warn).
    const level =
      voiceError.kind === "aborted"
        ? "debug"
        : voiceError.kind === "unknown"
          ? "error"
          : voiceError.retryable
            ? "info"
            : "warn";

    try {
      await options.emitter.emitDebug("tts.synthesis.error", {
        itemId,
        text: text.slice(0, 100),
        kind: voiceError.kind,
        retryable: voiceError.retryable,
        level,
        message: voiceError.message
      });
    } catch {
      // Last resort: never let error reporting break the emission chain.
    }
  }

  /** Builds the durable `OutputAudioContent` snapshot for a sentence. */
  function buildAudioContent(
    audio: string,
    mediaType: string,
    transcript: string
  ): OutputAudioContent {
    return {
      type: "output_audio",
      ephemeral: true,
      audio,
      mediaType,
      transcript
    };
  }

  /**
   * Batch dispatch: one `speak()` call under a whole-call timeout, emitted as
   * a whole-buffer `OutputAudioContent` part. Synthesis runs concurrently; the
   * slot is released as soon as the call settles (emission is chained
   * separately and ordered).
   */
  function enqueueBatch(itemId: string, text: string): void {
    const resultPromise = (async () => {
      await acquireSlot();
      try {
        if (cancelled) throw new PipelineCancelledError();
        return await withTimeout(
          options.provider.speak!({
            text,
            voice: options.config.voice,
            speed: options.config.speed,
            model: options.config.model,
            signal: options.signal
          }),
          SYNTHESIS_TIMEOUT_MS
        );
      } finally {
        releaseSlot();
      }
    })();
    // Pre-attach a catch so an early rejection doesn't surface as an unhandled
    // rejection while it waits for the prior sentence's chain to run.
    resultPromise.catch(() => {});

    const prev = emitChains.get(itemId) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        const result = await resultPromise;
        const audioContent = buildAudioContent(
          uint8ArrayToBase64(result.audio),
          result.mediaType,
          text
        );
        const contentIndex = getNextContentIndex(itemId);
        await options.emitter.emitContentAdded(itemId, contentIndex, audioContent);
        await options.emitter.emitContentDone(itemId, contentIndex, audioContent);
      } catch (error) {
        if (error instanceof PipelineCancelledError) return;
        await reportSynthesisError(itemId, text, error);
      }
    });
    emitChains.set(itemId, next);
  }

  /**
   * Streaming dispatch: pull the first chunk under a first-chunk timeout
   * composed with the request signal, then drain the rest with no per-chunk
   * timer. Each chunk emits a `content.audio.delta`; a `content.done` snapshot
   * closes the part. The slot is held for the whole drain (head-of-line
   * blocking across sentences is intrinsic and accepted).
   */
  function enqueueStreaming(itemId: string, text: string): void {
    // Kick the stream + first-chunk pull concurrently (subject to the slot
    // limit). Resolves to the live iterator and its first chunk, or rejects.
    const startPromise = (async (): Promise<{
      iterator: AsyncIterator<SpeakChunk>;
      first: IteratorResult<SpeakChunk>;
    }> => {
      await acquireSlot();
      let slotHeld = true;
      try {
        if (cancelled) throw new PipelineCancelledError();

        // First-chunk timeout via a plain timer (so test fake-timers drive it),
        // composed with the request signal and the pipeline cancel signal.
        const timeoutController = new AbortController();
        const timer = setTimeout(
          () =>
            timeoutController.abort(
              new DOMException("first-chunk timeout", "TimeoutError")
            ),
          SYNTHESIS_TIMEOUT_MS
        );
        const signals = [cancelController.signal, timeoutController.signal];
        if (options.signal !== undefined) signals.push(options.signal);
        const firstChunkSignal = AbortSignal.any(signals);

        const iterable = options.provider.speakStream!({
          text,
          voice: options.config.voice,
          speed: options.config.speed,
          model: options.config.model,
          signal: firstChunkSignal
        });
        const iterator = iterable[Symbol.asyncIterator]();
        // Track immediately so cancel() can return() it even while the first
        // chunk is still pending. The chain removes it in its finally.
        activeIterators.add(iterator);
        let first: IteratorResult<SpeakChunk>;
        try {
          // Race the first chunk against the timeout/request signal directly,
          // so a provider that ignores `signal` still times out rather than
          // hanging. After the first chunk we drop the timer (drain below).
          first = await raceAbort(iterator.next(), firstChunkSignal);
        } catch (error) {
          activeIterators.delete(iterator);
          // Fire-and-forget: return() on a generator suspended at an `await`
          // may never resolve, so we must not block teardown on it.
          void iterator.return?.().catch(() => {});
          throw error;
        } finally {
          clearTimeout(timer);
        }
        slotHeld = false; // ownership transferred to the chain's finally
        return { iterator, first };
      } finally {
        // Release the slot only if we never handed it to the chain (i.e. an
        // error before first chunk). On success the chain releases it.
        if (slotHeld) releaseSlot();
      }
    })();
    // Pre-attach a catch so an early rejection doesn't surface as an unhandled
    // rejection while it waits for the prior sentence's chain to run.
    startPromise.catch(() => {});

    const prev = emitChains.get(itemId) ?? Promise.resolve();
    const next = prev.then(async () => {
      let started: {
        iterator: AsyncIterator<SpeakChunk>;
        first: IteratorResult<SpeakChunk>;
      };
      try {
        started = await startPromise;
      } catch (error) {
        // Cancellation (flag or cancel-signal abort) is routine teardown.
        if (cancelled || error instanceof PipelineCancelledError) return;
        await reportSynthesisError(itemId, text, error);
        return;
      }

      const { iterator, first } = started;
      // Cancelled between first-chunk pull and our turn in the chain — bail
      // without emitting; the finally still returns the iterator.
      if (cancelled) {
        void iterator.return?.().catch(() => {});
        activeIterators.delete(iterator);
        releaseSlot();
        return;
      }
      const contentIndex = getNextContentIndex(itemId);
      let mediaType = DEFAULT_AUDIO_MEDIA_TYPE;
      // Drain interruption: cancel() or request abort unblocks a hung next().
      const drainSignals = [cancelController.signal];
      if (options.signal !== undefined) drainSignals.push(options.signal);
      const drainSignal = AbortSignal.any(drainSignals);
      try {
        if (!first.done) {
          mediaType = first.value.mediaType;
          await options.emitter.emitContentAudioDelta(itemId, contentIndex, {
            bytes: first.value.bytes,
            isLast: first.value.isLast
          });
          // Drain the rest — no per-chunk timer, but cancel/abort can interrupt.
          while (true) {
            const step = await raceAbort(iterator.next(), drainSignal);
            if (step.done) break;
            mediaType = step.value.mediaType;
            await options.emitter.emitContentAudioDelta(itemId, contentIndex, {
              bytes: step.value.bytes,
              isLast: step.value.isLast
            });
          }
        }
        await options.emitter.emitContentDone(
          itemId,
          contentIndex,
          buildAudioContent("", mediaType, text)
        );
      } catch (error) {
        // A cancel-driven abort is routine teardown, not a synthesis failure.
        if (!cancelled) await reportSynthesisError(itemId, text, error);
      } finally {
        // Belt-and-suspenders: release the upstream generator even if the
        // request signal already stopped it, then free the slot. Fire-and-
        // forget — return() may never resolve on a stalled generator.
        void iterator.return?.().catch(() => {});
        activeIterators.delete(iterator);
        releaseSlot();
      }
    });
    emitChains.set(itemId, next);
  }

  function enqueue(itemId: string, text: string): void {
    if (cancelled) return;
    if (streaming) {
      enqueueStreaming(itemId, text);
    } else {
      enqueueBatch(itemId, text);
    }
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

      const chain = emitChains.get(itemId);
      if (chain !== undefined) {
        await chain;
      }
    },

    async drain() {
      await Promise.allSettled([...emitChains.values()]);
      emitChains.clear();
    },

    async cancel() {
      cancelled = true;
      // Fire the cancel signal so in-flight first-chunk pulls and drains unblock.
      cancelController.abort(new DOMException("pipeline cancelled", "AbortError"));
      // Unblock any waiters so their syntheses bail without calling the provider.
      const pending = waiting.splice(0);
      for (const waiter of pending) {
        waiter.reject(new PipelineCancelledError());
      }
      // Return active iterators so a hung `next()` unblocks; the chains' own
      // finally blocks also do this (idempotent).
      for (const iterator of activeIterators) {
        void iterator.return?.().catch(() => {});
      }
      // Settle pending chains (each releases its own slot/iterator in finally).
      await Promise.allSettled([...emitChains.values()]);
      emitChains.clear();
      inFlight = 0;
    }
  };
}

/**
 * Resolves with `promise`, but rejects with the signal's reason if `signal`
 * aborts first. Used to bound the streaming first-chunk pull even when the
 * provider does not honor the abort signal itself.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError")
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Resolves a promise but rejects if it doesn't settle within `ms`. Argument
 * order is `(promise, ms)`. Used for the batch whole-call timeout.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
