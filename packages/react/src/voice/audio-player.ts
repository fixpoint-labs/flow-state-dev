/**
 * Queue-based audio playback for streaming TTS output.
 * Plays audio chunks sequentially for gapless playback of sentence-by-sentence TTS.
 */

export type AudioPlayerState = "idle" | "playing";

export type AudioPlayerCallbacks = {
  onStateChange?: (state: AudioPlayerState) => void;
  onChunkStart?: (index: number) => void;
  onChunkEnd?: (index: number) => void;
  onError?: (error: Error) => void;
};

export type AudioPlayer = {
  readonly state: AudioPlayerState;
  enqueue(audioData: string, mediaType: string): void;
  stop(): void;
  clear(): void;
};

/**
 * Creates an audio player that queues and plays audio chunks sequentially.
 * Uses HTMLAudioElement for broad browser compatibility.
 */
export function createAudioPlayer(
  callbacks?: AudioPlayerCallbacks
): AudioPlayer {
  const queue: Array<{ dataUrl: string }> = [];
  let currentState: AudioPlayerState = "idle";
  let currentAudio: HTMLAudioElement | null = null;
  let chunkIndex = 0;
  let playing = false;

  function setState(next: AudioPlayerState) {
    if (currentState === next) {
      return;
    }

    currentState = next;
    callbacks?.onStateChange?.(next);
  }

  function playNext() {
    if (queue.length === 0) {
      playing = false;
      setState("idle");
      return;
    }

    playing = true;
    setState("playing");
    const item = queue.shift()!;
    const index = chunkIndex++;

    callbacks?.onChunkStart?.(index);

    const audio = new Audio(item.dataUrl);
    currentAudio = audio;

    audio.onended = () => {
      currentAudio = null;
      callbacks?.onChunkEnd?.(index);
      playNext();
    };

    audio.onerror = () => {
      currentAudio = null;
      callbacks?.onError?.(new Error(`Audio playback failed for chunk ${index}`));
      callbacks?.onChunkEnd?.(index);
      playNext();
    };

    audio.play().catch((err) => {
      currentAudio = null;
      callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
      callbacks?.onChunkEnd?.(index);
      playNext();
    });
  }

  return {
    get state() {
      return currentState;
    },

    enqueue(audioData: string, mediaType: string) {
      const dataUrl = `data:${mediaType};base64,${audioData}`;
      queue.push({ dataUrl });

      if (!playing) {
        playNext();
      }
    },

    stop() {
      if (currentAudio !== null) {
        currentAudio.pause();
        currentAudio.src = "";
        currentAudio = null;
      }

      queue.length = 0;
      playing = false;
      setState("idle");
    },

    clear() {
      queue.length = 0;
    }
  };
}
