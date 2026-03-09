/**
 * Browser SpeechRecognition wrapper for interim transcript feedback.
 * Provides real-time interim text while the user is speaking, used in the
 * hybrid STT approach alongside server-side Whisper.
 */

/** Minimal interface for the subset of SpeechRecognitionResult we access. */
interface SpeechResult {
  readonly resultIndex: number;
  readonly results: ReadonlyArray<{
    readonly isFinal: boolean;
    readonly [0]: { readonly transcript: string };
  }>;
}

/** Minimal interface for the SpeechRecognition error event. */
interface SpeechErrorEvent {
  readonly error: string;
}

export type SpeechRecognitionCallbacks = {
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string) => void;
  onError?: (error: Error) => void;
  onEnd?: () => void;
};

export type SpeechRecognitionHandle = {
  readonly isAvailable: boolean;
  start(): void;
  stop(): void;
  abort(): void;
};

/**
 * Creates a browser SpeechRecognition wrapper for interim transcript feedback.
 * Returns a handle with isAvailable=false if SpeechRecognition is not supported.
 */
export function createSpeechRecognition(
  callbacks: SpeechRecognitionCallbacks,
  options?: { language?: string; continuous?: boolean }
): SpeechRecognitionHandle {
  const SpeechRecognitionAPI = getSpeechRecognitionAPI();

  if (SpeechRecognitionAPI === null) {
    return {
      isAvailable: false,
      start() {},
      stop() {},
      abort() {}
    };
  }

  let recognition: InstanceType<typeof SpeechRecognitionAPI> | null = null;

  return {
    isAvailable: true,

    start() {
      if (recognition !== null) {
        return;
      }

      recognition = new SpeechRecognitionAPI();
      recognition.continuous = options?.continuous ?? true;
      recognition.interimResults = true;
      recognition.lang = options?.language ?? "en-US";

      recognition.onresult = (event: SpeechResult) => {
        let interim = "";
        let final = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            final += result[0].transcript;
          } else {
            interim += result[0].transcript;
          }
        }

        if (interim.length > 0) {
          callbacks.onInterimTranscript?.(interim);
        }
        if (final.length > 0) {
          callbacks.onFinalTranscript?.(final);
        }
      };

      recognition.onerror = (event: SpeechErrorEvent) => {
        if (event.error === "aborted" || event.error === "no-speech") {
          return;
        }
        callbacks.onError?.(new Error(`SpeechRecognition error: ${event.error}`));
      };

      recognition.onend = () => {
        recognition = null;
        callbacks.onEnd?.();
      };

      recognition.start();
    },

    stop() {
      if (recognition !== null) {
        recognition.stop();
        recognition = null;
      }
    },

    abort() {
      if (recognition !== null) {
        recognition.abort();
        recognition = null;
      }
    }
  };
}

/** Minimal constructor interface for browser SpeechRecognition API. */
interface SpeechRecognitionConstructor {
  new (): {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechResult) => void) | null;
    onerror: ((event: SpeechErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  };
}

function getSpeechRecognitionAPI(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const win = window as unknown as Record<string, unknown>;
  return (
    (win.SpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    (win.webkitSpeechRecognition as SpeechRecognitionConstructor | undefined) ??
    null
  );
}

/**
 * Checks if browser SpeechRecognition API is available.
 */
export function isSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionAPI() !== null;
}
