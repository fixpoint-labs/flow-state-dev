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
export { detectAvailableProviders, parseModelString, extractProviderName } from "./providerDetection";
export type { ProviderAvailability, ParsedModelString } from "./providerDetection";

// Types
export type {
  FSDProviderConfig,
  FSDProvider,
  ModelGroupConfig,
  ModelGroupDefaults,
  GatewayConfig,
  GatewayEntry,
  RetryPolicy,
  GatewayType,
  ProviderName,
  ProviderPreference,
  ResolveOptions,
  ExplainCandidate,
  ExplainResult
} from "./types";

// Reorder-by-preference (FIX-425)
export {
  reorderByPreference,
  normalizePreference,
  hasPreferredProvider
} from "./reorderByPreference";

// Model selection utility
export { selectModel, isModelSelection } from "./selectModel";
export type {
  ModelRule,
  PreferProviderRule,
  WhenRule,
  ModelSelection,
} from "./selectModel";

// Prompt caching (provider-specific cacheControl translation)
export { applyCaching, DEFAULT_CACHING_CONFIG } from "./caching";

// Internal utility (not re-exported from main index — used by model resolver)
export { makeSchemaStrict } from "./makeSchemaStrict";
