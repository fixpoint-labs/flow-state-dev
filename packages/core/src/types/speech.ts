/**
 * Speech-to-text and text-to-speech model abstractions.
 * Follows the same provider-agnostic pattern as GeneratorModel.
 */

export type SpeechResult = {
  audio: Uint8Array;
  mediaType: string;
  duration?: number;
};

export type SpeechStreamChunk = {
  type: "audio_delta" | "finish";
  audioData?: Uint8Array;
  duration?: number;
};

export interface SpeechModel {
  modelId: string;
  generate(options: {
    text: string;
    voice?: string;
    speed?: number;
    instructions?: string;
    outputFormat?: "mp3" | "wav" | "pcm16";
  }): Promise<SpeechResult>;
  stream?(options: {
    text: string;
    voice?: string;
    speed?: number;
    outputFormat?: "mp3" | "wav" | "pcm16";
  }): AsyncIterable<SpeechStreamChunk>;
}

export type TranscriptionResult = {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
};

export interface TranscriptionModel {
  modelId: string;
  transcribe(options: {
    audio: Uint8Array | Blob;
    mediaType?: string;
    language?: string;
  }): Promise<TranscriptionResult>;
}

export type SpeechResolver = (modelId: string) => SpeechModel;
export type TranscriptionResolver = (modelId: string) => TranscriptionModel;

export type TTSConfig = {
  model: string | SpeechModel;
  voice?: string;
  speed?: number;
};

export type VoiceConfig = {
  tts?: TTSConfig;
};
