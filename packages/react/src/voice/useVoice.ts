/**
 * Voice-aware React hook that composes with useSession() for
 * STT input, TTS output, and voice state management.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { transcribe, type TranscribeOptions } from "@flow-state-dev/client";
import type { Content, MessageItem, OutputAudioContent } from "@flow-state-dev/core/items";
import { createAudioRecorder, type AudioRecorder } from "./audio-recorder";
import { createAudioPlayer, type AudioPlayer, type AudioPlayerState } from "./audio-player";
import type { OutputItem } from "@flow-state-dev/core/items";
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
  /**
   * `(itemId, contentIndex)` pairs that have received streaming audio
   * deltas in this session. The batch-path scanner below skips any
   * `OutputAudioContent` whose key is in this set so a streaming TTS turn
   * doesn't get double-played when the final snapshot arrives via
   * `content.added` after the chunks (FIX-523). Writes happen synchronously
   * inside the audio-delta callback — before any `decodeAudioData` await —
   * so the batch scanner can never observe a streaming part without its
   * dedup entry already in place.
   */
  const streamingAudioPartsRef = useRef<Set<string>>(new Set());
  /**
   * Mirror of the latest `session` reference so the audio-delta callback
   * (whose identity must be stable for the subscribe-on-mount effect) can
   * still resolve the current item list when looking up mediaType. The
   * callback fires from the SSE stream, which can run between renders.
   */
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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

  // Initialize audio player. `dispose()` (not `stop()`) on teardown so the
  // underlying AudioContext is released — browsers cap concurrent contexts
  // and React strict-mode remounts would otherwise leak one each time.
  useEffect(() => {
    if (!autoPlayTTS) return;

    const player = createAudioPlayer({
      onStateChange: setPlayerState
    });
    playerRef.current = player;

    return () => {
      player.dispose();
      playerRef.current = null;
    };
  }, [autoPlayTTS]);

  // Subscribe to streaming TTS audio chunks (FIX-523). The handler is
  // attached once per session reference; the player and dedup ref are
  // accessed through refs so handler identity stays stable.
  useEffect(() => {
    if (!autoPlayTTS) return;

    const handler = (event: { itemId: string; contentIndex: number; audio: string; isLast?: boolean }) => {
      const player = playerRef.current;
      if (player === null) return;

      // EAGER dedup write — synchronous, before any await. The batch-path
      // scanner below runs on every session.items change; if it fires
      // before this write, it would see the eventual `OutputAudioContent`
      // snapshot and double-play. Writing the set up-front closes that
      // window.
      const key = `${event.itemId}:${event.contentIndex}`;
      streamingAudioPartsRef.current.add(key);

      // Resolve mediaType from the parent OutputAudioContent placeholder.
      // The pipeline contract (FIX-528) emits `content.added` with the
      // placeholder before the first delta. Fallback to audio/mpeg if the
      // placeholder hasn't arrived yet — chunks are still playable in
      // isolation; only an unverified mediaType is at risk, and MP3 is
      // the only supported codec in M1 anyway.
      const item = sessionRef.current.items.find((i: OutputItem) => i.id === event.itemId);
      let mediaType = "audio/mpeg";
      if (item !== undefined && item.type === "message") {
        const part = (item as MessageItem).content?.[event.contentIndex];
        if (part?.type === "output_audio") {
          mediaType = part.mediaType;
        }
      }

      player.enqueueChunk({
        audio: event.audio,
        mediaType,
        isLast: event.isLast
      });
    };

    return session.subscribeAudioDelta(handler);
  }, [session, autoPlayTTS]);

  // Auto-play OutputAudioContent from session items (batch / non-streaming
  // providers). Skips any (itemId, contentIndex) that has already received
  // streaming chunks — the final `content.added` snapshot for a streamed
  // part would otherwise double-play the audio that already came through
  // the streaming path.
  useEffect(() => {
    if (!autoPlayTTS || playerRef.current === null) return;

    for (const item of session.items) {
      if (item.type !== "message") continue;
      const msg = item as MessageItem;
      if (msg.role !== "assistant") continue;

      for (let i = 0; i < msg.content.length; i++) {
        const part = msg.content[i];
        if (part?.type !== "output_audio") continue;

        const streamKey = `${item.id}:${i}`;
        if (streamingAudioPartsRef.current.has(streamKey)) continue;

        const key = `${item.id}:${part.audio.slice(0, 20)}`;
        if (!playedKeysRef.current.has(key)) {
          playedKeysRef.current.add(key);
          playerRef.current!.enqueue(part.audio, part.mediaType);
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

  // Cleanup on unmount. The player effect already runs `dispose()` on
  // its own teardown, but recorder/recognition outlive that effect's
  // dependencies, so they're cleaned up here unconditionally.
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recognitionRef.current?.abort();
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
