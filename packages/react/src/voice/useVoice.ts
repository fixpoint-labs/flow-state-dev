/**
 * Voice-aware React hook that composes with useSession() for
 * STT input, TTS output, and voice state management.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcribe, type TranscribeOptions } from "@flow-state-dev/client";
import type { Content, MessageItem, OutputAudioContent } from "@flow-state-dev/core/items";
import { createAudioRecorder, type AudioRecorder } from "./audio-recorder";
import { createAudioPlayer, type AudioPlayer, type AudioPlayerState } from "./audio-player";
import {
  createSpeechRecognition,
  isSpeechRecognitionAvailable,
  type SpeechRecognitionHandle
} from "./speech-recognition";
import type { SessionView } from "../hooks/useSession";

export type UseVoiceOptions = {
  /** Action name to dispatch with transcribed text. */
  action: string;
  /** Transform transcribed text into action input. Default: { message: text } */
  buildInput?: (text: string) => unknown;
  /** Base URL for the transcription endpoint. */
  baseUrl?: string;
  /** Language for SpeechRecognition. Default: "en-US" */
  language?: string;
  /** Auto-play TTS audio from assistant messages. Default: true */
  autoPlayTTS?: boolean;
};

export type VoiceState = {
  /** Microphone is actively recording. */
  readonly isListening: boolean;
  /** TTS audio is currently playing. */
  readonly isSpeaking: boolean;
  /** Server transcription is in progress. */
  readonly isProcessing: boolean;
  /** Live interim transcript from browser SpeechRecognition. */
  readonly interimTranscript: string;
  /** Whether voice APIs are available in this browser. */
  readonly isAvailable: boolean;
  /** Start recording / listening. */
  startListening(): Promise<void>;
  /** Stop recording, transcribe, and send action. */
  stopListening(): Promise<void>;
  /** Stop TTS playback. */
  stopSpeaking(): void;
};

/**
 * Hook that adds voice interaction to a session.
 * Provides STT input (hybrid browser + server) and TTS output (auto-play audio content).
 */
export function useVoice(
  session: SessionView,
  options: UseVoiceOptions
): VoiceState {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [playerState, setPlayerState] = useState<AudioPlayerState>("idle");

  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const recognitionRef = useRef<SpeechRecognitionHandle | null>(null);
  const playedKeysRef = useRef<Set<string>>(new Set());

  const autoPlayTTS = options.autoPlayTTS !== false;
  const buildInput = options.buildInput ?? ((text: string) => ({ message: text }));

  // Defer browser API detection to a client-only effect so the initial
  // render matches the server (false) and avoids hydration mismatches.
  const [isAvailable, setIsAvailable] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (typeof MediaRecorder === "undefined") return;
    setIsAvailable(true);
  }, []);

  // Initialize audio player
  useEffect(() => {
    if (!autoPlayTTS) return;

    const player = createAudioPlayer({
      onStateChange: setPlayerState
    });
    playerRef.current = player;

    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [autoPlayTTS]);

  // Auto-play OutputAudioContent from session items.
  // Uses a Set to track every audio chunk already enqueued so that
  // re-renders during streaming never re-enqueue earlier sentences.
  useEffect(() => {
    if (!autoPlayTTS || playerRef.current === null) return;

    for (const item of session.items) {
      if (item.type !== "message") continue;
      const msg = item as MessageItem;
      if (msg.role !== "assistant") continue;

      for (const part of msg.content) {
        if (part.type === "output_audio") {
          const key = `${item.id}:${part.audio.slice(0, 20)}`;
          if (!playedKeysRef.current.has(key)) {
            playedKeysRef.current.add(key);
            playerRef.current!.enqueue(part.audio, part.mediaType);
          }
        }
      }
    }
  }, [session.items, autoPlayTTS]);

  const transcribeOptions: TranscribeOptions = useMemo(
    () => ({ baseUrl: options.baseUrl }),
    [options.baseUrl]
  );

  const startListening = useCallback(async () => {
    if (isListening || !isAvailable) return;

    const recorder = createAudioRecorder();
    if (recorder === null) return;

    recorderRef.current = recorder;
    setInterimTranscript("");

    // Start browser SpeechRecognition for interim feedback
    if (isSpeechRecognitionAvailable()) {
      const recognition = createSpeechRecognition({
        onInterimTranscript: setInterimTranscript,
        onFinalTranscript: (text) => setInterimTranscript(text)
      }, { language: options.language });
      recognitionRef.current = recognition;
      recognition.start();
    }

    await recorder.start();
    setIsListening(true);
  }, [isListening, isAvailable, options.language]);

  const stopListening = useCallback(async () => {
    if (!isListening) return;

    setIsListening(false);

    // Stop browser SpeechRecognition
    if (recognitionRef.current !== null) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    // Stop recording and get audio
    const recorder = recorderRef.current;
    if (recorder === null) return;
    recorderRef.current = null;

    setIsProcessing(true);
    const voiceMetadata = {
      metadata: {
        voice: {
          inputModality: "speech" as const,
          ttsEnabled: autoPlayTTS
        }
      }
    };

    try {
      const audioBlob = await recorder.stop();

      // Send to server for authoritative transcription
      const result = await transcribe({
        audio: audioBlob,
        mediaType: audioBlob.type || "audio/webm",
        language: options.language,
        userId: session.userId
      }, transcribeOptions);

      setInterimTranscript("");

      if (result.text.trim().length > 0) {
        const input = buildInput(result.text);
        await session.sendAction(options.action, input, voiceMetadata);
      }
    } catch (error) {
      // If transcription fails, try using the interim transcript
      const fallback = interimTranscript.trim();
      if (fallback.length > 0) {
        const input = buildInput(fallback);
        await session.sendAction(options.action, input, voiceMetadata);
      }
    } finally {
      setIsProcessing(false);
      setInterimTranscript("");
    }
  }, [
    isListening,
    session,
    options.action,
    options.language,
    buildInput,
    transcribeOptions,
    interimTranscript
  ]);

  const stopSpeaking = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recognitionRef.current?.abort();
      playerRef.current?.stop();
    };
  }, []);

  return {
    isListening,
    isSpeaking: playerState === "playing",
    isProcessing,
    interimTranscript,
    isAvailable,
    startListening,
    stopListening,
    stopSpeaking
  };
}
