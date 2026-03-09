/**
 * MediaRecorder wrapper for capturing audio from the browser microphone.
 * Provides start/stop/getBlob with configurable MIME type.
 */

export type AudioRecorderOptions = {
  mimeType?: string;
  audioBitsPerSecond?: number;
};

export type AudioRecorderState = "inactive" | "recording";

export type AudioRecorder = {
  readonly state: AudioRecorderState;
  start(): Promise<void>;
  stop(): Promise<Blob>;
  cancel(): void;
};

/**
 * Creates an audio recorder backed by the browser's MediaRecorder API.
 * Returns null if MediaRecorder is not available.
 */
export function createAudioRecorder(
  options?: AudioRecorderOptions
): AudioRecorder | null {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let currentState: AudioRecorderState = "inactive";
  let resolveStop: ((blob: Blob) => void) | null = null;

  const preferredMimeType = options?.mimeType ?? selectMimeType();

  return {
    get state() {
      return currentState;
    },

    async start() {
      if (currentState === "recording") {
        return;
      }

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];

      const recorderOptions: MediaRecorderOptions = {};
      if (preferredMimeType && MediaRecorder.isTypeSupported(preferredMimeType)) {
        recorderOptions.mimeType = preferredMimeType;
      }
      if (options?.audioBitsPerSecond !== undefined) {
        recorderOptions.audioBitsPerSecond = options.audioBitsPerSecond;
      }

      mediaRecorder = new MediaRecorder(stream, recorderOptions);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder?.mimeType ?? preferredMimeType ?? "audio/webm";
        const blob = new Blob(chunks, { type: mimeType });
        chunks = [];
        resolveStop?.(blob);
        resolveStop = null;
      };

      mediaRecorder.start();
      currentState = "recording";
    },

    stop(): Promise<Blob> {
      if (currentState !== "recording" || mediaRecorder === null) {
        return Promise.resolve(new Blob([], { type: "audio/webm" }));
      }

      return new Promise<Blob>((resolve) => {
        resolveStop = resolve;
        mediaRecorder!.stop();
        currentState = "inactive";

        if (stream !== null) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          stream = null;
        }
      });
    },

    cancel() {
      if (mediaRecorder !== null && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }

      if (stream !== null) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        stream = null;
      }

      chunks = [];
      currentState = "inactive";
      resolveStop = null;
    }
  };
}

function selectMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const preferred = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];

  for (const type of preferred) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return undefined;
}
