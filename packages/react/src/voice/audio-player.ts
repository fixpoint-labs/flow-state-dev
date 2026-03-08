/**
 * Queue-based audio playback for streaming TTS output.
 * Plays audio chunks sequentially for gapless playback of sentence-by-sentence TTS.
 *
 * Uses Blob URLs instead of data URLs to avoid keeping large base64 strings
 * in memory. Each Blob URL is revoked after playback completes.
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

/** Decode a base64 string into a Uint8Array. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Creates an audio player that queues and plays audio chunks sequentially.
 * Uses HTMLAudioElement for broad browser compatibility.
 */
export function createAudioPlayer(
  callbacks?: AudioPlayerCallbacks
): AudioPlayer {
  const queue: Array<{ blobUrl: string }> = [];
  let currentState: AudioPlayerState = "idle";
  let currentAudio: HTMLAudioElement | null = null;
  let currentBlobUrl: string | null = null;
  let chunkIndex = 0;
  let playing = false;

  function setState(next: AudioPlayerState) {
    if (currentState === next) {
      return;
    }

    currentState = next;
    callbacks?.onStateChange?.(next);
  }

  function revokeCurrentUrl() {
    if (currentBlobUrl !== null) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
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

    currentBlobUrl = item.blobUrl;
    const audio = new Audio(item.blobUrl);
    currentAudio = audio;

    audio.onended = () => {
      currentAudio = null;
      revokeCurrentUrl();
      callbacks?.onChunkEnd?.(index);
      playNext();
    };

    audio.onerror = () => {
      currentAudio = null;
      revokeCurrentUrl();
      callbacks?.onError?.(new Error(`Audio playback failed for chunk ${index}`));
      callbacks?.onChunkEnd?.(index);
      playNext();
    };

    audio.play().catch((err) => {
      currentAudio = null;
      revokeCurrentUrl();
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
      const bytes = base64ToBytes(audioData);
      const blob = new Blob([bytes], { type: mediaType });
      const blobUrl = URL.createObjectURL(blob);
      queue.push({ blobUrl });

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

      revokeCurrentUrl();
      // Revoke any queued blob URLs
      for (const item of queue) {
        URL.revokeObjectURL(item.blobUrl);
      }
      queue.length = 0;
      playing = false;
      setState("idle");
    },

    clear() {
      // Revoke queued blob URLs to free memory
      for (const item of queue) {
        URL.revokeObjectURL(item.blobUrl);
      }
      queue.length = 0;
    }
  };
}
