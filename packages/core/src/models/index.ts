// Model resolver (AI SDK adapter)
export { createAiSdkModelResolver, wrapAiSdkModel } from "./createAiSdkModelResolver";
export type { ResolveAiSdkLanguageModel } from "./createAiSdkModelResolver";

// Unified model resolver
export { createModelResolver } from "./createModelResolver";
export type { CreateModelResolverOptions } from "./createModelResolver";
export type { ResolveModelCallOptions } from "../types/model";
export type { IntentDefaults } from "./types";

export { createAiSdkSpeechResolver, wrapAiSdkSpeechModel } from "./createAiSdkSpeechResolver";
export type { ResolveAiSdkSpeechModel } from "./createAiSdkSpeechResolver";

export { createAiSdkTranscriptionResolver, wrapAiSdkTranscriptionModel } from "./createAiSdkTranscriptionResolver";
export type { ResolveAiSdkTranscriptionModel } from "./createAiSdkTranscriptionResolver";

// Legacy FSD Provider — tombstoned in FIX-633. The runtime function throws
// with migration guidance; the types below are `never` aliases for the same
// reason. Both will be removed entirely in a future minor cycle.
export { createFSDProvider } from "./createFSDProvider";
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

// Strict-mode schema helper. Re-exported from the package root so authors can
// validate generator outputSchemas at test time. See BP-016.
export { makeSchemaStrict } from "./makeSchemaStrict";
