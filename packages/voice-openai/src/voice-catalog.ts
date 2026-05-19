/**
 * Static catalog of OpenAI's prebuilt TTS voices. Returned by
 * `OpenAIVoiceProvider.listVoices()`.
 *
 * Convention: `supportedModels === undefined` means "supported by every
 * OpenAI TTS model". Voices that are only available on a subset (currently
 * `marin` and `cedar`, which require `gpt-4o-mini-tts`) declare the
 * intersection explicitly via `supportedModels`.
 *
 * OpenAI does not expose a discovery endpoint for TTS voices; the catalog
 * is updated manually when OpenAI publishes new entries.
 */

import type { VoiceInfo } from "@flow-state-dev/core";

export const OPENAI_VOICE_CATALOG: readonly VoiceInfo[] = [
  { id: "alloy", name: "Alloy", provider: "openai" },
  { id: "ash", name: "Ash", provider: "openai" },
  { id: "ballad", name: "Ballad", provider: "openai" },
  { id: "coral", name: "Coral", provider: "openai" },
  { id: "echo", name: "Echo", provider: "openai" },
  { id: "fable", name: "Fable", provider: "openai" },
  { id: "nova", name: "Nova", provider: "openai" },
  { id: "onyx", name: "Onyx", provider: "openai" },
  { id: "sage", name: "Sage", provider: "openai" },
  { id: "shimmer", name: "Shimmer", provider: "openai" },
  { id: "verse", name: "Verse", provider: "openai" },
  { id: "marin", name: "Marin", provider: "openai", supportedModels: ["gpt-4o-mini-tts"] },
  { id: "cedar", name: "Cedar", provider: "openai", supportedModels: ["gpt-4o-mini-tts"] },
];
