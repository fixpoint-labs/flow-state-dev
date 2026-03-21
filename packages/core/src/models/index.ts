// Model resolver (AI SDK adapter)
export { createAiSdkModelResolver, wrapAiSdkModel } from "./createAiSdkModelResolver";
export type { ResolveAiSdkLanguageModel } from "./createAiSdkModelResolver";

// Unified model resolver
export { createModelResolver } from "./createModelResolver";
export type { CreateModelResolverOptions } from "./createModelResolver";

export { createAiSdkSpeechResolver, wrapAiSdkSpeechModel } from "./createAiSdkSpeechResolver";
export type { ResolveAiSdkSpeechModel } from "./createAiSdkSpeechResolver";

export { createAiSdkTranscriptionResolver, wrapAiSdkTranscriptionModel } from "./createAiSdkTranscriptionResolver";
export type { ResolveAiSdkTranscriptionModel } from "./createAiSdkTranscriptionResolver";

// FSD Provider (model groups with fallback)
export { createFSDProvider, defaultGroups } from "./createFSDProvider";
export { createFallbackModel, isRetryableError } from "./fallbackModel";
export type { FallbackModelEntry } from "./fallbackModel";

// Provider detection and model string parsing
export { detectAvailableProviders, parseModelString } from "./providerDetection";
export type { ProviderAvailability, ParsedModelString } from "./providerDetection";

// Presets
export { DEFAULT_PRESETS } from "./presets";
export type { PresetConfig } from "./presets";

// Types
export type {
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  ModelGroupDefaults,
  GatewayConfig,
  RetryPolicy,
  GatewayType,
  ProviderName
} from "./types";

// Internal utility (not re-exported from main index — used by model resolver)
export { makeSchemaStrict } from "./makeSchemaStrict";
