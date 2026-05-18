/**
 * Streaming-aware audio player for TTS output (FIX-523).
 *
 * Backed by the Web Audio API: each chunk is decoded into an `AudioBuffer`
 * and scheduled on a `AudioBufferSourceNode` at a moving `nextStartTime`
 * cursor so consecutive sources butt up gap-free. This is the production
 * pattern used by OpenAI Realtime Console and ElevenLabs community SDKs;
 * the previous `<audio>` + Blob URL approach had audible gaps between
 * chunks that defeated the latency win of streaming TTS.
 *
 * Supports both the streaming path (per-chunk `enqueueChunk`, used by the
 * streaming TTS pipeline) and the whole-buffer path (`enqueue`, used by
 * batch providers like OpenAI). The whole-buffer path is a thin wrapper
 * around `enqueueChunk` with `isLast: true`.
 *
 * MP3 (`audio/mpeg`) is the only supported codec in M1 — works with
 * `decodeAudioData` on all modern browsers including Safari iOS. PCM and
 * WAV require either WAV-header injection or an AudioWorklet path and are
 * deferred.
 */

export type AudioPlayerState = "idle" | "playing";

export type AudioPlayerCallbacks = {
  onStateChange?: (state: AudioPlayerState) => void;
  onChunkStart?: (index: number) => void;
  onChunkEnd?: (index: number) => void;
  onError?: (error: Error) => void;
};

/**
 * A single chunk of streamed audio. `mediaType` is sourced from the parent
 * `OutputAudioContent` and is expected to be stable across all chunks for a
 * given content part.
 */
export type AudioChunk = {
  audio: string;
  mediaType: string;
  isLast?: boolean;
};

export type AudioPlayer = {
  readonly state: AudioPlayerState;
  /**
   * Streaming path: append a single chunk. Decoded and scheduled against
   * the shared `AudioContext` timeline for gap-free playback.
   */
  enqueueChunk(chunk: AudioChunk): void;
  /**
   * Whole-buffer path retained for batch (non-streaming) providers.
   * Equivalent to `enqueueChunk({ audio, mediaType, isLast: true })`.
   */
  enqueue(audioData: string, mediaType: string): void;
  stop(): void;
  /**
   * Releases the underlying `AudioContext`. Browsers cap concurrent
   * contexts (Chrome ~6, Safari historically lower); long-lived SPAs that
   * remount voice surfaces will eventually hit the cap if contexts leak.
   * `useVoice` calls this in its unmount cleanup effect.
   */
  dispose(): void;
};

type AudioContextCtor = typeof AudioContext;

/** Decode a base64 string into a fresh ArrayBuffer (the shape `decodeAudioData` requires). */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function resolveAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof globalThis === "undefined") return undefined;
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext;
}

/**
 * Creates an audio player that decodes and schedules chunks on a shared
 * `AudioContext`. Lazily constructs the context on the first chunk so the
 * user gesture that triggered the action has time to propagate.
 */
export function createAudioPlayer(
  callbacks?: AudioPlayerCallbacks
): AudioPlayer {
  let currentState: AudioPlayerState = "idle";
  let audioContext: AudioContext | null = null;
  let nextStartTime = 0;
  let chunkIndex = 0;
  let activeChunkCount = 0;
  // Live sources kept so `stop()` can cancel in-flight playback. Sources
  // are removed from the set in their `onended` handler whether they end
  // naturally or are stopped explicitly.
  const activeSources = new Set<AudioBufferSourceNode>();
  // Suspended-context chunks queued for replay once the context resumes.
  // Bounded so a player that never gets a user gesture doesn't grow
  // memory unbounded; capacity matches the spec's stated tolerance.
  const SUSPENDED_BUFFER_LIMIT = 3;
  const suspendedQueue: AudioChunk[] = [];

  function setState(next: AudioPlayerState) {
    if (currentState === next) return;
    currentState = next;
    callbacks?.onStateChange?.(next);
  }

  function ensureContext(): AudioContext | null {
    if (audioContext !== null) return audioContext;
    const Ctor = resolveAudioContextCtor();
    if (Ctor === undefined) {
      callbacks?.onError?.(
        new Error("AudioContext is not available in this environment")
      );
      return null;
    }
    audioContext = new Ctor();
    nextStartTime = audioContext.currentTime;
    return audioContext;
  }

  function scheduleChunk(chunk: AudioChunk, ctx: AudioContext): void {
    const index = chunkIndex++;
    const arrayBuffer = base64ToArrayBuffer(chunk.audio);

    // Track this chunk as active immediately so concurrent decodes don't
    // race a `clear()` that would otherwise leave `activeChunkCount` out
    // of sync with the playing state.
    activeChunkCount += 1;
    setState("playing");

    ctx.decodeAudioData(arrayBuffer).then(
      (audioBuffer) => {
        // `clear()` may have invalidated this chunk while we were decoding.
        // The decoded buffer is harmless to discard; the chunk counter was
        // already drained by clear().
        if (audioContext !== ctx) {
          return;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const startAt = Math.max(nextStartTime, ctx.currentTime);
        source.start(startAt);
        nextStartTime = startAt + audioBuffer.duration;

        activeSources.add(source);
        callbacks?.onChunkStart?.(index);

        source.onended = () => {
          activeSources.delete(source);
          activeChunkCount = Math.max(0, activeChunkCount - 1);
          callbacks?.onChunkEnd?.(index);
          if (activeChunkCount === 0) {
            setState("idle");
          }
        };
      },
      (err: unknown) => {
        // Decoding can fail for corrupt bytes or unsupported formats — log
        // and skip without tearing down subsequent chunks (the user just
        // hears a brief gap).
        activeChunkCount = Math.max(0, activeChunkCount - 1);
        callbacks?.onError?.(
          err instanceof Error ? err : new Error(String(err))
        );
        callbacks?.onChunkEnd?.(index);
        if (activeChunkCount === 0) {
          setState("idle");
        }
      }
    );
  }

  function flushSuspendedQueue(ctx: AudioContext): void {
    if (suspendedQueue.length === 0) return;
    const queued = suspendedQueue.splice(0, suspendedQueue.length);
    for (const chunk of queued) {
      scheduleChunk(chunk, ctx);
    }
  }

  function handleChunk(chunk: AudioChunk): void {
    const ctx = ensureContext();
    if (ctx === null) return;

    if (ctx.state === "suspended") {
      // Buffer up to N chunks and try to resume. If resume succeeds, drain
      // the queue; otherwise drop the chunk after the limit to avoid an
      // unbounded buffer if the user never grants a gesture.
      if (suspendedQueue.length >= SUSPENDED_BUFFER_LIMIT) {
        callbacks?.onError?.(
          new Error(
            "AudioContext is suspended and the buffered chunk limit is reached; discarding chunk"
          )
        );
        return;
      }
      suspendedQueue.push(chunk);
      ctx.resume().then(
        () => flushSuspendedQueue(ctx),
        () => {
          // Resume rejected — leave chunks queued; the next gesture-driven
          // call will retry. No state change.
        }
      );
      return;
    }

    scheduleChunk(chunk, ctx);
  }

  return {
    get state() {
      return currentState;
    },

    enqueueChunk(chunk: AudioChunk) {
      handleChunk(chunk);
    },

    enqueue(audioData: string, mediaType: string) {
      handleChunk({ audio: audioData, mediaType, isLast: true });
    },

    stop() {
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          // `stop()` throws if the source already ended; ignore.
        }
      }
      activeSources.clear();
      suspendedQueue.length = 0;
      activeChunkCount = 0;
      if (audioContext !== null) {
        nextStartTime = audioContext.currentTime;
      }
      setState("idle");
    },

    dispose() {
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          // Already ended — ignore.
        }
      }
      activeSources.clear();
      suspendedQueue.length = 0;
      activeChunkCount = 0;
      if (audioContext !== null) {
        const ctx = audioContext;
        audioContext = null;
        ctx.close().catch(() => {
          // Best-effort close; nothing actionable if the runtime refuses.
        });
      }
      setState("idle");
    }
  };
}
