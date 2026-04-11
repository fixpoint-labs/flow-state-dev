import type { ModelGroupDefaults } from "./types";

// ---------------------------------------------------------------------------
// Preset config
// ---------------------------------------------------------------------------

export interface PresetConfig {
  /** Ordered model preference list. Format: 'provider/model-id'. */
  models: string[];
  /** Default generation settings for this preset. */
  defaults?: ModelGroupDefaults;
}

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

const OPENAI_TINY_MODEL = "openai/gpt-5.4-nano";
const OPENAI_SMALL_MODEL = "openai/gpt-5.4-mini";
const OPENAI_MEDIUM_MODEL = "openai/gpt-5.4";
const OPENAI_LARGE_MODEL = "openai/gpt-5.4";
const ANTHROPIC_SMALL_MODEL = "anthropic/claude-haiku-4-5";
const ANTHROPIC_MEDIUM_MODEL = "anthropic/claude-sonnet-4-6";
const ANTHROPIC_LARGE_MODEL = "anthropic/claude-opus-4-6";
const GOOGLE_TINY_MODEL = "google/gemini-3.1-flash-lite-preview";
const GOOGLE_SMALL_MODEL = "google/gemini-3-flash";
const GOOGLE_MEDIUM_MODEL = "google/gemini-2.5-pro";
const GOOGLE_LARGE_MODEL = "google/gemini-3.1-pro-preview";

const THINKING_DEFAULT_OPTIONS = {
  providerOptions: {
    anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
    // openai: { reasoningSummary: "detailed" },
  },
};

export const DEFAULT_PRESETS: Record<string, PresetConfig> = {  
  // deprecated
  fast: {
    models: [
      OPENAI_SMALL_MODEL,
      ANTHROPIC_SMALL_MODEL,
      GOOGLE_SMALL_MODEL,
    ]
  },
  tiny: {
    models: [
      OPENAI_TINY_MODEL,
      GOOGLE_TINY_MODEL,
    ]
  },
  small: {
    models: [
      OPENAI_SMALL_MODEL,
      ANTHROPIC_SMALL_MODEL,
      GOOGLE_SMALL_MODEL,
    ],
    defaults: { maxTokens: 1024 },
  },
  "thinking-small": {
    models: [
      OPENAI_MEDIUM_MODEL,
      ANTHROPIC_MEDIUM_MODEL,
      GOOGLE_MEDIUM_MODEL,
    ],
    defaults: THINKING_DEFAULT_OPTIONS,
  },
  "thinking-medium": {
    models: [
      OPENAI_MEDIUM_MODEL,
      ANTHROPIC_MEDIUM_MODEL,
      GOOGLE_MEDIUM_MODEL,
    ],
    defaults: THINKING_DEFAULT_OPTIONS,
  },
  "thinking-large": {
    models: [
      ANTHROPIC_LARGE_MODEL,
      OPENAI_LARGE_MODEL,
      GOOGLE_LARGE_MODEL,
    ],
    defaults: THINKING_DEFAULT_OPTIONS,
  },
  medium: {
    models: [
      OPENAI_MEDIUM_MODEL,
      ANTHROPIC_MEDIUM_MODEL,
      GOOGLE_MEDIUM_MODEL,
    ],
  },
  large: {
    models: [
      ANTHROPIC_LARGE_MODEL,
      OPENAI_LARGE_MODEL,
      GOOGLE_LARGE_MODEL,
    ],
  },
};
