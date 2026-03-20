// Model resolver (AI SDK adapter)
export { createAiSdkModelResolver, wrapAiSdkModel } from "./createAiSdkModelResolver";
export type { ResolveAiSdkLanguageModel } from "./createAiSdkModelResolver";

export { createDefaultModelResolver } from "./createDefaultModelResolver";

export { createAiSdkSpeechResolver, wrapAiSdkSpeechModel } from "./createAiSdkSpeechResolver";
export type { ResolveAiSdkSpeechModel } from "./createAiSdkSpeechResolver";

export { createAiSdkTranscriptionResolver, wrapAiSdkTranscriptionModel } from "./createAiSdkTranscriptionResolver";
export type { ResolveAiSdkTranscriptionModel } from "./createAiSdkTranscriptionResolver";

// FSD Provider (model groups with fallback)
export { createFSDProvider, defaultGroups } from "./createFSDProvider";
export { createFallbackModel, isRetryableError } from "./fallbackModel";
export type { FallbackModelEntry } from "./fallbackModel";

export { detectAvailableProviders, parseModelId, toGatewayModelId } from "./providerDetection";
export type { ProviderAvailability } from "./providerDetection";

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
