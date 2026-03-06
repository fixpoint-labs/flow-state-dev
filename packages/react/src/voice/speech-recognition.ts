/**
 * Browser SpeechRecognition wrapper for interim transcript feedback.
 * Provides real-time interim text while the user is speaking, used in the
 * hybrid STT approach alongside server-side Whisper.
 */

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

      recognition.onresult = (event: any) => {
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

      recognition.onerror = (event: any) => {
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

function getSpeechRecognitionAPI(): any {
  if (typeof window === "undefined") {
    return null;
  }

  return (
    (window as any).SpeechRecognition ??
    (window as any).webkitSpeechRecognition ??
    null
  );
}

/**
 * Checks if browser SpeechRecognition API is available.
 */
export function isSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionAPI() !== null;
}
