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

export const DEFAULT_PRESETS: Record<string, PresetConfig> = {
  fast: {
    models: [
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4-mini",
      "google/gemini-3-flash",
    ],
    defaults: { maxTokens: 1024 },
  },
  thinking: {
    models: [
      "anthropic/claude-opus-4-6",
      "openai/gpt-5.4",
      "google/gemini-3.1-pro-preview",
    ],
    defaults: {
      providerOptions: {
        anthropic: { thinking: { budgetTokens: 10000 } },
      },
    },
  },
  balanced: {
    models: [
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4",
      "google/gemini-3-flash",
    ],
  },
};
