/**
 * Basic energy-based Voice Activity Detection (VAD).
 * Detects when the user starts/stops speaking based on audio input energy levels.
 */

export type VADOptions = {
  /** Energy threshold (0-1) above which speech is detected. Default: 0.01 */
  threshold?: number;
  /** Milliseconds of silence before speech is considered ended. Default: 1500 */
  silenceMs?: number;
  /** How often to check audio levels in ms. Default: 100 */
  pollIntervalMs?: number;
};

export type VADCallbacks = {
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
};

export type VADHandle = {
  start(stream: MediaStream): void;
  stop(): void;
  readonly isDetectingSpeech: boolean;
};

/**
 * Creates an energy-based VAD that monitors a MediaStream.
 */
export function createVAD(
  callbacks: VADCallbacks,
  options?: VADOptions
): VADHandle {
  const threshold = options?.threshold ?? 0.01;
  const silenceMs = options?.silenceMs ?? 1500;
  const pollInterval = options?.pollIntervalMs ?? 100;

  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let isSpeaking = false;
  let silenceStart: number | null = null;

  function checkLevel() {
    if (analyser === null) {
      return;
    }

    const dataArray = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);

    if (rms > threshold) {
      silenceStart = null;
      if (!isSpeaking) {
        isSpeaking = true;
        callbacks.onSpeechStart?.();
      }
    } else if (isSpeaking) {
      if (silenceStart === null) {
        silenceStart = Date.now();
      } else if (Date.now() - silenceStart >= silenceMs) {
        isSpeaking = false;
        silenceStart = null;
        callbacks.onSpeechEnd?.();
      }
    }
  }

  return {
    get isDetectingSpeech() {
      return isSpeaking;
    },

    start(stream: MediaStream) {
      if (typeof AudioContext === "undefined") {
        return;
      }

      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      pollTimer = setInterval(checkLevel, pollInterval);
    },

    stop() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      source?.disconnect();
      source = null;
      analyser = null;

      if (audioContext !== null) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }

      if (isSpeaking) {
        isSpeaking = false;
        callbacks.onSpeechEnd?.();
      }

      silenceStart = null;
    }
  };
}
