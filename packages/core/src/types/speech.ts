/**
 * Flow-level voice configuration. The provider implementations themselves
 * live in `voice-provider.ts`; this file only owns the config shape that
 * flows attach via `defineFlow({ voice })`.
 */

import type { VoiceProvider } from "./voice-provider";

/** TTS configuration on `VoiceConfig`. */
export type TTSConfig = {
  /** Speak model id. Provider-specific; if omitted, the provider's default is used. */
  model?: string;
  voice?: string;
  speed?: number;
};

/** Voice configuration on a flow. */
export type VoiceConfig = {
  tts?: TTSConfig;
  /**
   * Provider that owns the flow's voice surfaces. Consumed server-side by the
   * router and TTS pipeline (wired in FIX-528).
   */
  provider?: VoiceProvider;
};
